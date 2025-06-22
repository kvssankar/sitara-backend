// models/SessionManager.js
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { AgentMessage } from "./AgentMessage.js";
import {
  ProceedStatus,
  RunType,
  SessionDataProperty,
  getAIText,
  intentFinder,
} from "../utils/index.js";
import { getIntents } from "../utils/crud.js";
import { OutputCapture } from "./OutputCapture.js";
import { FastIntentMatcher } from "../utils/FastIntentMatcher.js";

const dynamoDbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
});
const TABLE_NAME = "Sessions";
const SESSION_TTL = 3600;

class SessionManager {
  constructor() {
    console.log("[SessionManager] Initializing SessionManager");
    this.sessions = {};
  }

  createNewSession(sessionId, userId = null, isVoice = false) {
    console.log(
      `[SessionManager] Creating new session: ${sessionId}, userId: ${userId}, isVoice: ${isVoice}`
    );

    const newSession = {
      id: sessionId,
      sessionId,
      messages: [],

      // User and type info
      userId: userId,
      isVoice: isVoice,

      // Intent data
      intents: null,
      intentsLoading: false,
      intentsLoadedAt: null,
      intentMatcher: null,
      intent: null,

      // Mutex flags
      processing: false,
      apiProcessing: false,
      outputBlockProcessing: false,
      agentLoopProcessing: false,
      humanSpeaking: false,
      listen: true,
      shouldStop: false,

      // Session variables
      sessionVariables: {
        session_id: sessionId,
      },
      backuptext: "",
      removeHistory: 0,

      // Voice properties
      ws: null,
      streamSid: "",

      // Timestamps
      lastActivity: Math.floor(Date.now() / 1000),
    };

    // Pre-fetch intents asynchronously
    if (userId) {
      this.preloadIntents(newSession, userId);
    }

    console.log(
      `[SessionManager] New session created with pre-fetch initiated`
    );
    return newSession;
  }

  async preloadIntents(session, userId) {
    console.log(
      `[SessionManager] Pre-loading intents for session: ${session.sessionId}, user: ${userId}`
    );

    try {
      session.intentsLoading = true;
      const startTime = Date.now();

      const intents = await getIntents(userId);

      session.intents = intents;
      session.intentsLoadedAt = Date.now();
      session.intentsLoading = false;

      // Create fast intent matcher
      if (intents && intents.length > 0) {
        session.intentMatcher = new FastIntentMatcher(intents);
      }

      const loadTime = Date.now() - startTime;
      console.log(
        `[SessionManager] Pre-loaded ${
          intents?.length || 0
        } intents in ${loadTime}ms`
      );
    } catch (error) {
      console.error(`[SessionManager] Error pre-loading intents:`, error);
      session.intentsLoading = false;
    }
  }

  async getSession(sessionId, userId = null, isVoice = false) {
    console.log(
      `[SessionManager] Getting session: ${sessionId}, isVoice: ${isVoice}`
    );

    // Check local cache first
    let session = this.sessions[sessionId];
    if (session) {
      console.log(
        `[SessionManager] Session found in local cache: ${sessionId}`
      );
      session.lastActivity = Math.floor(Date.now() / 1000);

      // If intents not loaded and we have userId, load them
      if (!session.intents && !session.intentsLoading && userId) {
        session.userId = userId;
        this.preloadIntents(session, userId);
      }

      return session;
    }

    console.log(
      `[SessionManager] Session not in cache, querying DynamoDB: ${sessionId}`
    );

    // Attempt to retrieve session from DynamoDB for both chat and voice
    const params = {
      TableName: TABLE_NAME,
      Key: {
        sessionId: { S: sessionId },
      },
    };

    console.log(`[SessionManager] DynamoDB query params:`, params);

    try {
      const result = await dynamoDbClient.send(new GetItemCommand(params));
      console.log(`[SessionManager] DynamoDB query result:`, {
        hasItem: !!result.Item,
        sessionId,
      });

      if (result.Item) {
        console.log(
          `[SessionManager] Deserializing session data for: ${sessionId}`
        );
        // Deserialize the session data
        const sessionDataStr = result.Item.data.S;
        const sessionDataObj = JSON.parse(sessionDataStr);

        console.log(
          `[SessionManager] Parsed session data keys:`,
          Object.keys(sessionDataObj)
        );

        // Reset transient properties
        sessionDataObj.processing = false;
        sessionDataObj.apiProcessing = false;
        sessionDataObj.outputBlockProcessing = false;
        sessionDataObj.agentLoopProcessing = false;
        sessionDataObj.humanSpeaking = false;
        sessionDataObj.ws = null;
        sessionDataObj.streamSid = "";
        sessionDataObj.lastActivity = Math.floor(Date.now() / 1000);
        sessionDataObj.intentsLoading = false;

        // Recreate intent matcher if intents exist
        if (sessionDataObj.intents && sessionDataObj.intents.length > 0) {
          sessionDataObj.intentMatcher = new FastIntentMatcher(
            sessionDataObj.intents
          );
        }

        console.log(
          `[SessionManager] Reset transient properties for session: ${sessionId}`
        );

        // Cache the session locally
        this.sessions[sessionId] = sessionDataObj;
        console.log(`[SessionManager] Cached session locally: ${sessionId}`);

        // If intents not loaded and we have userId, load them
        if (
          !sessionDataObj.intents &&
          !sessionDataObj.intentsLoading &&
          userId
        ) {
          sessionDataObj.userId = userId;
          this.preloadIntents(sessionDataObj, userId);
        }
      } else {
        console.log(
          `[SessionManager] Session not found in DynamoDB, creating new: ${sessionId}`
        );
        // Create a new session if not found
        const newSession = this.createNewSession(sessionId, userId, isVoice);
        await this.saveSession(newSession);
        this.sessions[sessionId] = newSession;
        console.log(
          `[SessionManager] New session created and saved: ${sessionId}`
        );
      }
    } catch (error) {
      console.error(
        `[SessionManager] Error retrieving session from DynamoDB: ${sessionId}`,
        error
      );
      console.error(`[SessionManager] Error details:`, {
        message: error.message,
        code: error.code,
        statusCode: error.$metadata?.httpStatusCode,
      });

      // Fallback to local session
      console.log(
        `[SessionManager] Creating fallback local session: ${sessionId}`
      );
      const newSession = this.createNewSession(sessionId, userId, isVoice);
      this.sessions[sessionId] = newSession;
    }

    console.log(`[SessionManager] Returning session: ${sessionId}`);
    return this.sessions[sessionId];
  }

  async saveSession(session) {
    const sessionId = session.id;
    console.log(`[SessionManager] Saving session: ${sessionId}`);

    if (!sessionId) {
      const error = "Session must have a sessionId.";
      console.error(`[SessionManager] Save error: ${error}`);
      throw new Error(error);
    }

    const { expiresAt } = this.getTimestamps();
    console.log(`[SessionManager] Session expiry timestamp: ${expiresAt}`);

    // Create a copy without transient properties for storage
    const persistentSession = {
      ...session,
      ws: null, // Don't persist WebSocket
      streamSid: session.streamSid || "", // Persist streamSid but reset ws
      processing: false, // Reset processing flags
      apiProcessing: false,
      outputBlockProcessing: false,
      agentLoopProcessing: false,
      humanSpeaking: false,
      intentsLoading: false, // Don't persist loading state
      intentMatcher: null, // Don't persist matcher object
      expiresAt,
    };

    console.log(`[SessionManager] Persistent session properties:`, {
      id: persistentSession.id,
      sessionId: persistentSession.sessionId,
      messagesCount: persistentSession.messages?.length || 0,
      sessionVariablesKeys: Object.keys(
        persistentSession.sessionVariables || {}
      ),
      expiresAt: persistentSession.expiresAt,
      hasIntent: !!persistentSession.intent,
      isVoice: persistentSession.isVoice,
      userId: persistentSession.userId,
      intentsCount: persistentSession.intents?.length || 0,
    });

    const serializedSession = JSON.stringify(persistentSession);
    console.log(
      `[SessionManager] Serialized session size: ${serializedSession.length} characters`
    );

    const params = {
      TableName: TABLE_NAME,
      Key: {
        sessionId: { S: sessionId },
      },
      UpdateExpression: "SET #data = :data, #expiresAt = :expiresAt",
      ExpressionAttributeNames: {
        "#data": "data",
        "#expiresAt": "expiresAt",
      },
      ExpressionAttributeValues: {
        ":data": { S: serializedSession },
        ":expiresAt": { N: expiresAt.toString() },
      },
    };

    console.log(
      `[SessionManager] DynamoDB update params for session: ${sessionId}`
    );

    try {
      await dynamoDbClient.send(new UpdateItemCommand(params));
      console.log(
        `[SessionManager] Successfully saved session to DynamoDB: ${sessionId}`
      );

      // Update local cache
      this.sessions[sessionId] = session;
      console.log(
        `[SessionManager] Updated local cache for session: ${sessionId}`
      );
    } catch (error) {
      console.error(
        `[SessionManager] Error saving session to DynamoDB: ${sessionId}`,
        error
      );
      console.error(`[SessionManager] Save error details:`, {
        message: error.message,
        code: error.code,
        statusCode: error.$metadata?.httpStatusCode,
      });
    }
  }

  async waitForIntents(session, maxWait = 500) {
    const startTime = Date.now();

    while (session.intentsLoading && Date.now() - startTime < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return session.intents !== null;
  }

  resetSession(sessionId) {
    console.log(`[SessionManager] Resetting session: ${sessionId}`);
    const oldSession = this.sessions[sessionId];
    const newSession = this.createNewSession(
      sessionId,
      oldSession?.userId,
      oldSession?.isVoice
    );
    this.sessions[sessionId] = newSession;
    console.log(`[SessionManager] Session reset complete: ${sessionId}`);
    // Note: You might want to also clear from DynamoDB
  }

  setProperty(sessionId, property, value) {
    console.log(
      `[SessionManager] Setting property for session ${sessionId}: ${property} = ${value}`
    );

    if (!this.sessions[sessionId]) {
      const error = `Session ${sessionId} not found. Call getSession first.`;
      console.error(`[SessionManager] SetProperty error: ${error}`);
      throw new Error(error);
    }

    this.sessions[sessionId][property] = value;
    this.sessions[sessionId].lastActivity = Math.floor(Date.now() / 1000);
  }

  getProperty(sessionId, property) {
    if (!this.sessions[sessionId]) {
      const error = `Session ${sessionId} not found.`;
      console.error(`[SessionManager] GetProperty error: ${error}`);
      throw new Error(error);
    }

    return this.sessions[sessionId][property];
  }

  addTranscript(sessionId, text) {
    const session = this.sessions[sessionId];
    if (!session) {
      throw new Error(`Session ${sessionId} not found.`);
    }

    const currentTranscript = session.sessionVariables["transcript"];
    session.sessionVariables["transcript"] = currentTranscript
      ? currentTranscript + "\n" + text
      : text;
  }

  getSessionVariable(sessionId, key) {
    const session = this.sessions[sessionId];
    if (!session) {
      throw new Error(
        `Session ${sessionId} not found during getSessionVariable.`
      );
    }

    return session.sessionVariables[key];
  }

  setSessionVariable(sessionId, key, value) {
    const session = this.sessions[sessionId];
    if (!session) {
      throw new Error(
        `Session ${sessionId} not found during setSessionVariable.`
      );
    }

    session.sessionVariables[key] = value;
    session.lastActivity = Math.floor(Date.now() / 1000);
  }

  // Helper to calculate TTL (Time-to-Live)
  getTimestamps() {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + SESSION_TTL;
    console.log(
      `[SessionManager] Generated timestamps - now: ${now}, expiresAt: ${expiresAt}, TTL: ${SESSION_TTL}`
    );
    return { now, expiresAt };
  }

  cleanupSessions() {
    console.log(`[SessionManager] Starting session cleanup`);
    const now = Math.floor(Date.now() / 1000);
    const maxAge = 1800; // 30 minutes for voice sessions
    const sessionIds = Object.keys(this.sessions);

    let cleanedCount = 0;
    sessionIds.forEach((sessionId) => {
      const session = this.sessions[sessionId];
      if (session.lastActivity && now - session.lastActivity > maxAge) {
        console.log(
          `[SessionManager] Cleaning up expired session: ${sessionId}`
        );
        delete this.sessions[sessionId];
        cleanedCount++;
      }
    });

    console.log(
      `[SessionManager] Session cleanup complete. Cleaned ${cleanedCount} sessions`
    );
  }

  async run(options) {
    console.log(`[SessionManager] Running with options:`, {
      session_id: options.session_id,
      type: options.type,
      text:
        options.text?.substring(0, 100) +
        (options.text?.length > 100 ? "..." : ""),
      userId: options.userId,
      isChat: options.isChat,
    });

    const session = await this.getSession(
      options.session_id,
      options.userId,
      !options.isChat
    );

    if (options.type === RunType.AI) {
      const result = await this.processAIRequest(options, session);
      // Save session after processing
      await this.saveSession(session);
      return result;
    } else if (options.type === RunType.HUMAN) {
      const result = await this.processHumanRequest(options, session);
      // Save session after processing
      await this.saveSession(session);
      return result;
    }

    return new OutputCapture({
      proceed: {
        status: ProceedStatus.PASS_TO_HUMAN,
        text: "",
      },
      sessionId: options.session_id,
    });
  }

  async processAIRequest(options, session) {
    console.log(
      `[SessionManager] Processing AI request for session: ${options.session_id}`
    );

    // Voice-specific transfer handling
    if (!options.isChat) {
      const transferKeywords = ["agent", "representative", "human", "person"];
      const lowerText = options.text.toLowerCase();

      if (transferKeywords.some((keyword) => lowerText.includes(keyword))) {
        console.log(
          `[SessionManager] Transfer keyword detected: ${options.text}`
        );
        return new OutputCapture({
          proceed: {
            status: ProceedStatus.PASS_TO_HUMAN,
            text: "",
          },
          sessionId: options.session_id,
        });
      }
    }

    // Check if already transferred
    const isTransferred = session.sessionVariables["is_transferred"];
    console.log(
      `[SessionManager] Checking transfer status for session ${options.session_id}: ${isTransferred}`
    );

    if (isTransferred) {
      console.log(
        `[SessionManager] Session already transferred, passing to human: ${options.session_id}`
      );
      return new OutputCapture({
        proceed: {
          status: ProceedStatus.PASS_TO_HUMAN,
          text: "",
        },
        sessionId: options.session_id,
      });
    }

    try {
      console.log(
        `[SessionManager] Processing message for AI request: ${options.session_id}`
      );
      const result = await this.processMessage(options, session);
      console.log(
        `[SessionManager] Message processed successfully for session: ${options.session_id}`
      );

      return result;
    } catch (error) {
      console.error(
        `[SessionManager] Error processing AI request for session ${options.session_id}:`,
        error
      );
      console.error(`[SessionManager] AI request error details:`, {
        message: error.message,
        stack: error.stack,
      });

      return new OutputCapture({
        proceed: {
          status: ProceedStatus.PASS_TO_HUMAN,
          text: "",
        },
        sessionId: options.session_id,
        metadata: {
          error: error.message,
        },
      });
    }
  }

  async processMessage(options, session) {
    console.log(
      `[SessionManager] Processing message for session: ${options.session_id}`
    );
    console.log(`[SessionManager] Current session intent status:`, {
      hasIntent: !!session.intent,
      intentId: session.intent?.id || "none",
      hasIntents: !!session.intents,
      intentsCount: session.intents?.length || 0,
    });

    // Intent finding logic
    if (!session.intent) {
      console.log(
        `[SessionManager] No current intent, finding intent for session: ${options.session_id}`
      );

      // Wait briefly for intents if still loading
      if (session.intentsLoading) {
        console.log(`[SessionManager] Intents still loading, waiting...`);
        await this.waitForIntents(session);
      }

      if (!session.intents) {
        console.log(
          `[SessionManager] Loading intents for user: ${
            options.userId || "default"
          }`
        );
        session.intents = await getIntents(options.userId || "default");
        console.log(
          `[SessionManager] Loaded ${session.intents?.length || 0} intents`
        );

        // Create fast matcher after loading
        if (session.intents && session.intents.length > 0) {
          session.intentMatcher = new FastIntentMatcher(session.intents);
        }
      }

      // Try fast pattern matching first
      let intent = null;

      if (session.intentMatcher) {
        const quickMatchIndex = session.intentMatcher.quickMatch(options.text);
        if (quickMatchIndex !== null) {
          intent = session.intents[quickMatchIndex];
          console.log(
            `[SessionManager] Fast pattern match found: ${intent.intent}`
          );
        }
      }

      // Fall back to Claude if no pattern match
      if (!intent) {
        console.log(`[SessionManager] No pattern match, using Claude AI`);
        intent = await intentFinder(session.intents, options.text);
      }

      if (intent) {
        console.log(`[SessionManager] Intent found:`, {
          id: intent._id,
          name: intent.intent || "unnamed",
        });
        session.intent = intent;
      } else {
        console.log(`[SessionManager] No intent found, requesting elaboration`);
        return new OutputCapture({
          proceed: {
            status: ProceedStatus.TELL_CUSTOMER,
            text: options.isChat
              ? "Can u pls elaborate?"
              : "Can you please tell me more about what you need help with?",
          },
          sessionId: options.session_id,
        });
      }
    }

    if (session.intent) {
      return await this.processIntentMessage(options, session);
    }
  }

  async processIntentMessage(options, session) {
    console.log(
      `[SessionManager] Processing intent message for session: ${options.session_id}`
    );

    const intent = session.intent;
    console.log(`[SessionManager] Intent details:`, {
      id: intent.id,
      name: intent.name || "unnamed",
      currentMessagesCount: intent.messages?.length || 0,
      hasSteps: !!intent.steps,
      hasFunctions: !!intent.functions,
    });

    if (!intent.messages) {
      console.log(
        `[SessionManager] Initializing messages array for intent: ${intent.id}`
      );
      intent.messages = [];
    }

    console.log(
      `[SessionManager] Adding user message to intent: ${options.text?.substring(
        0,
        100
      )}...`
    );
    intent.messages.push({
      content: options.text,
      role: "user",
    });

    console.log(
      `[SessionManager] Creating AgentMessage for session: ${options.session_id}`
    );
    const agentMessage = new AgentMessage(
      options.session_id,
      intent.messages,
      intent.steps,
      intent.functions,
      options.isChat
    );

    console.log(
      `[SessionManager] Processing response with AgentMessage for session: ${options.session_id}`
    );
    const { messages, done, answers, outputCapture } =
      await agentMessage.processResponse({
        text: options.text,
      });

    console.log(
      `[SessionManager] AgentMessage response for session ${options.session_id}:`,
      {
        messagesCount: messages?.length || 0,
        done,
        answersCount: answers?.length || 0,
        hasOutputCapture: !!outputCapture,
      }
    );

    session.intent.messages = messages;

    const responseText =
      answers.length > 0
        ? answers[answers.length - 1]
        : "I'm processing your request...";

    console.log(
      `[SessionManager] Response text for session ${
        options.session_id
      }: ${responseText?.substring(0, 100)}...`
    );

    if (done) {
      console.log(
        `[SessionManager] Intent processing complete for session: ${options.session_id}`
      );
      session.intent = null;
      return new OutputCapture({
        proceed: {
          status: ProceedStatus.END,
          text:
            responseText +
            " Thank you! Is there anything else I can help you with?",
        },
        sessionId: options.session_id,
      });
    }

    if (outputCapture) {
      console.log(
        `[SessionManager] Returning custom output capture for session: ${options.session_id}`
      );
      return outputCapture;
    }

    console.log(
      `[SessionManager] Returning standard response for session: ${options.session_id}`
    );
    return new OutputCapture({
      proceed: {
        status: ProceedStatus.TELL_CUSTOMER,
        text: responseText,
      },
      sessionId: options.session_id,
    });
  }

  async processHumanRequest(options, session) {
    console.log(
      `[SessionManager] Processing HUMAN request for session: ${options.session_id}`
    );
    // Handle human agent responses
    return new OutputCapture({
      proceed: {
        status: ProceedStatus.TELL_CUSTOMER,
        text: "Message received by human agent",
      },
      sessionId: options.session_id,
    });
  }
}

// Create singleton instance
console.log("[SessionManager] Creating singleton SessionManager instance");
const sessionManager = new SessionManager();

// Periodic cleanup
console.log(
  "[SessionManager] Setting up periodic session cleanup (every 5 minutes)"
);
setInterval(() => {
  sessionManager.cleanupSessions();
}, 300000); // Every 5 minutes

export default sessionManager;
