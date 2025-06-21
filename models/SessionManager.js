// models/SessionManager.js
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

    // For voice sessions, skip DynamoDB completely
    if (isVoice) {
      console.log(
        `[SessionManager] Creating new voice session (skipping DynamoDB): ${sessionId}`
      );
      const newSession = this.createNewSession(sessionId, userId, true);
      this.sessions[sessionId] = newSession;
      return newSession;
    }

    // For chat sessions, keep existing DynamoDB logic
    console.log(`[SessionManager] Creating new chat session: ${sessionId}`);
    const newSession = this.createNewSession(sessionId, userId, false);
    this.sessions[sessionId] = newSession;

    return newSession;
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
    console.log(
      `[SessionManager] Processing HUMAN request for session: ${options.session_id}`
    );
    // Existing processHumanRequest logic...
    return new OutputCapture({
      proceed: {
        status: ProceedStatus.TELL_CUSTOMER,
        text: "",
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
