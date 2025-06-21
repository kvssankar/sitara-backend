// SessionManager.js
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

const dynamoDbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const TABLE_NAME = "Sessions";
const SESSION_TTL = 3600;

class SessionManager {
  constructor() {
    this.sessions = {};
  }

  createNewSession(sessionId) {
    return {
      id: sessionId,
      sessionId,
      messages: [],

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
  }

  async getSession(sessionId) {
    // Check local cache first
    let session = this.sessions[sessionId];
    if (session) {
      // Update last activity
      session.lastActivity = Math.floor(Date.now() / 1000);
      return session;
    }

    // Attempt to retrieve session from DynamoDB
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

        // Cache the session locally
        this.sessions[sessionId] = sessionDataObj;
      } else {
        // Create a new session if not found
        const newSession = this.createNewSession(sessionId);
        await this.saveSession(newSession);
        this.sessions[sessionId] = newSession;
      }
    } catch (error) {
      console.error("Error retrieving or creating session:", error);
      // Fallback to local session
      const newSession = this.createNewSession(sessionId);
      this.sessions[sessionId] = newSession;
    }

    return this.sessions[sessionId];
  }

  async saveSession(session) {
    const { expiresAt } = this.getTimestamps();
    const sessionId = session.id;

    if (!sessionId) {
      throw new Error("Session must have a sessionId.");
    }

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
      console.error("Error updating session:", error);
    }
  }

  resetSession(sessionId) {
    const newSession = this.createNewSession(sessionId);
    this.sessions[sessionId] = newSession;
    // Note: You might want to also clear from DynamoDB
  }

  setProperty(sessionId, property, value) {
    if (!this.sessions[sessionId]) {
      throw new Error(`Session ${sessionId} not found. Call getSession first.`);
    }
    this.sessions[sessionId][property] = value;
    this.sessions[sessionId].lastActivity = Math.floor(Date.now() / 1000);
  }

  getProperty(sessionId, property) {
    if (!this.sessions[sessionId]) {
      throw new Error(`Session ${sessionId} not found. Call getSession first.`);
    }
    return this.sessions[sessionId][property];
  }

  addTranscript(sessionId, text) {
    const session = this.sessions[sessionId];
    if (!session) {
      throw new Error(`Session ${sessionId} not found.`);
    }

    session.sessionVariables["transcript"] = session.sessionVariables[
      "transcript"
    ]
      ? session.sessionVariables["transcript"] + "\n" + text
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
        `Session ${sessionId} not found during setSessionVariable- ${key} - ${value}`
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

  // Cleanup old sessions from memory
  cleanupSessions() {
    const now = Math.floor(Date.now() / 1000);
    const maxAge = 1800; // 30 minutes

    Object.keys(this.sessions).forEach((sessionId) => {
      const session = this.sessions[sessionId];
      if (session.lastActivity && now - session.lastActivity > maxAge) {
        delete this.sessions[sessionId];
      }
    });
  }

  async run(options) {
    const session = await this.getSession(options.session_id);

    if (options.type === RunType.AI) {
      return await this.processAIRequest(options, session);
    } else if (options.type === RunType.HUMAN) {
      return await this.processHumanRequest(options, session);
    }

    return new OutputCapture({
      proceed: {
        status: ProceedStatus.PASS_TO_HUMAN,
        text: "",
      },
      sessionId: options.session_id,
      metadata: {
        system: `Invalid run type: ${options.type}`,
      },
    });
  }

  async processAIRequest(options, session) {
    // Voice-specific transfer handling
    if (!options.isChat) {
      if (
        options.text.toLowerCase().includes("human") ||
        options.text.toLowerCase().includes("transfer")
      ) {
        return new OutputCapture({
          proceed: {
            status: ProceedStatus.PASS_TO_HUMAN,
            text: "Transferring to human agent",
          },
          sessionId: options.session_id,
        });
      }
    }

    // Check if already transferred
    if (session.sessionVariables["is_transferred"]) {
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
      await this.saveSession(session);
      return result;
    } catch (error) {
      console.error("Error processing AI request:", error);
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

  async processMessage(options, session) {
    // Intent finding logic
    if (!session.intent) {
      if (!session.intents) {
        session.intents = await getIntents(options.userId || "default");
      }

      let intent = await intentFinder(session.intents, options.text);
      if (intent) {
        session.intent = intent;
      } else {
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
      return new OutputCapture({
        proceed: {
          status: ProceedStatus.END,
          text:
            responseText +
            "Thank you! Is there anything else I can help you with?",
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
}

// Create singleton instance
const sessionManager = new SessionManager();

// Periodic cleanup
setInterval(() => {
  sessionManager.cleanupSessions();
}, 300000); // Every 5 minutes

export default sessionManager;
