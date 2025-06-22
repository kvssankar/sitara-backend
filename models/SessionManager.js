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
import ConversationalAgent from "./ConversationalAgent.js";

const dynamoDbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
});
const TABLE_NAME = "Sessions";
const SESSION_TTL = 3600;

class SessionManager {
  constructor() {
    this.sessions = {};
  }

  createNewSession(sessionId, userId = null, isVoice = false) {
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

      // Conversational agent
      conversationalAgent: null,
      awaitingIntentConfirmation: false,

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

    return newSession;
  }

  async preloadIntents(session, userId) {
    try {
      session.intentsLoading = true;
      const intents = await getIntents(userId);

      session.intents = intents;
      session.intentsLoadedAt = Date.now();
      session.intentsLoading = false;

      // Create fast intent matcher
      if (intents && intents.length > 0) {
        session.intentMatcher = new FastIntentMatcher(intents);
      }
    } catch (error) {
      console.error(`[SessionManager] Error pre-loading intents:`, error);
      session.intentsLoading = false;
    }
  }

  async getSession(sessionId, userId = null, isVoice = false) {
    // Check local cache first
    let session = this.sessions[sessionId];
    if (session) {
      session.lastActivity = Math.floor(Date.now() / 1000);

      // If intents not loaded and we have userId, load them
      if (!session.intents && !session.intentsLoading && userId) {
        session.userId = userId;
        this.preloadIntents(session, userId);
      }

      // Initialize conversational agent if needed
      if (!session.conversationalAgent && userId) {
        session.conversationalAgent = new ConversationalAgent(userId, session);
      }

      return session;
    }

    // Attempt to retrieve session from DynamoDB for both chat and voice
    const params = {
      TableName: TABLE_NAME,
      Key: {
        sessionId: { S: sessionId },
      },
    };

    try {
      const result = await dynamoDbClient.send(new GetItemCommand(params));

      if (result.Item) {
        // Deserialize the session data
        const sessionDataStr = result.Item.data.S;
        const sessionDataObj = JSON.parse(sessionDataStr);

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
        sessionDataObj.conversationalAgent = null;

        // Recreate intent matcher if intents exist
        if (sessionDataObj.intents && sessionDataObj.intents.length > 0) {
          sessionDataObj.intentMatcher = new FastIntentMatcher(
            sessionDataObj.intents
          );
        }

        // Initialize conversational agent
        if (sessionDataObj.userId) {
          sessionDataObj.conversationalAgent = new ConversationalAgent(
            sessionDataObj.userId,
            sessionDataObj
          );
        }

        // Cache the session locally
        this.sessions[sessionId] = sessionDataObj;

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
        // Create a new session if not found
        const newSession = this.createNewSession(sessionId, userId, isVoice);
        await this.saveSession(newSession);
        this.sessions[sessionId] = newSession;
      }
    } catch (error) {
      console.error(
        `[SessionManager] Error retrieving session from DynamoDB: ${sessionId}`,
        error
      );

      // Fallback to local session
      const newSession = this.createNewSession(sessionId, userId, isVoice);
      this.sessions[sessionId] = newSession;
    }

    return this.sessions[sessionId];
  }

  async saveSession(session) {
    const sessionId = session.id;

    if (!sessionId) {
      const error = "Session must have a sessionId.";
      console.error(`[SessionManager] Save error: ${error}`);
      throw new Error(error);
    }

    const { expiresAt } = this.getTimestamps();

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
      conversationalAgent: null, // Don't persist agent instance
      expiresAt,
    };

    const serializedSession = JSON.stringify(persistentSession);

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

    try {
      await dynamoDbClient.send(new UpdateItemCommand(params));
      // Update local cache
      this.sessions[sessionId] = session;
    } catch (error) {
      console.error(
        `[SessionManager] Error saving session to DynamoDB: ${sessionId}`,
        error
      );
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
    const oldSession = this.sessions[sessionId];
    const newSession = this.createNewSession(
      sessionId,
      oldSession?.userId,
      oldSession?.isVoice
    );
    this.sessions[sessionId] = newSession;
  }

  setProperty(sessionId, property, value) {
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
        delete this.sessions[sessionId];
        cleanedCount++;
      }
    });

    console.log(
      `[SessionManager] Session cleanup complete. Cleaned ${cleanedCount} sessions`
    );
  }

  async run(options) {
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
    // Voice-specific transfer handling
    if (!options.isChat) {
      const transferKeywords = ["agent", "representative", "human", "person"];
      const lowerText = options.text.toLowerCase();

      if (transferKeywords.some((keyword) => lowerText.includes(keyword))) {
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

    if (isTransferred) {
      return new OutputCapture({
        proceed: {
          status: ProceedStatus.PASS_TO_HUMAN,
          text: "",
        },
        sessionId: options.session_id,
      });
    }

    try {
      const result = await this.processMessage(options, session);
      return result;
    } catch (error) {
      console.error(
        `[SessionManager] Error processing AI request for session ${options.session_id}:`,
        error
      );

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
    // If we already have a confirmed intent, proceed with the workflow
    if (session.intent && !session.awaitingIntentConfirmation) {
      return await this.processIntentMessage(options, session);
    }

    // Initialize conversational agent if needed
    if (!session.conversationalAgent) {
      session.conversationalAgent = new ConversationalAgent(
        options.userId || "default",
        session
      );
    }

    // Process message with conversational agent
    const agentResponse = await session.conversationalAgent.processMessage(
      options.text
    );

    // Handle intent confirmation
    if (agentResponse.proceedToWorkflow && agentResponse.confirmedIntent) {
      session.intent = agentResponse.confirmedIntent;
      session.awaitingIntentConfirmation = false;

      // Reset conversational agent for next interaction
      session.conversationalAgent.reset();

      // Process the confirmed intent
      return await this.processIntentMessage(options, session);
    }

    // Update session state for pending confirmation
    if (agentResponse.awaitingConfirmation) {
      session.awaitingIntentConfirmation = true;
    } else {
      session.awaitingIntentConfirmation = false;
    }

    // Return conversational response
    return new OutputCapture({
      proceed: {
        status: ProceedStatus.TELL_CUSTOMER,
        text: agentResponse.text,
      },
      sessionId: options.session_id,
    });
  }

  async processIntentMessage(options, session) {
    const intent = session.intent;

    if (!intent.messages) {
      intent.messages = [];
    }

    intent.messages.push({
      content: options.text,
      role: "user",
    });

    const agentMessage = new AgentMessage(
      options.session_id,
      intent.messages,
      intent.steps,
      intent.functions,
      options.isChat
    );

    const { messages, done, answers, outputCapture } =
      await agentMessage.processResponse({
        text: options.text,
      });

    session.intent.messages = messages;

    const responseText =
      answers.length > 0
        ? answers[answers.length - 1]
        : "I'm processing your request...";

    if (done) {
      session.intent = null;
      session.awaitingIntentConfirmation = false;

      // Reset conversational agent for next interaction
      if (session.conversationalAgent) {
        session.conversationalAgent.reset();
      }

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
      return outputCapture;
    }

    return new OutputCapture({
      proceed: {
        status: ProceedStatus.TELL_CUSTOMER,
        text: responseText,
      },
      sessionId: options.session_id,
    });
  }

  async processHumanRequest(options, session) {
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
const sessionManager = new SessionManager();

// Periodic cleanup
setInterval(() => {
  sessionManager.cleanupSessions();
}, 300000); // Every 5 minutes

export default sessionManager;
