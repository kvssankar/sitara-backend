import express from "express";
import sessionManager from "../models/SessionManager.js";
import {
  cleanText,
  ProceedStatus,
  RunType,
  SessionDataProperty,
} from "../utils/index.js";

const router = express.Router();

router.post("/chat", async (req, res) => {
  try {
    const {
      text,
      sessionId = "default",
      conversationHistory = [],
      userId,
    } = req.body;

    const actualUserId = userId || req.headers.authorization || "default";

    // Get or create session (isVoice = false for chat)
    await sessionManager.getSession(sessionId, actualUserId, false);

    const output = await sessionManager.run({
      session_id: sessionId,
      text: text,
      type: RunType.AI,
      isChat: true,
      userId: actualUserId,
    });

    console.log("Chat Output:", output);

    if (output.proceed.status === ProceedStatus.TELL_CUSTOMER) {
      return res.json({
        response: output.proceed.text,
        sessionId: output.sessionId,
      });
    } else if (output.proceed.status === ProceedStatus.END) {
      return res.json({
        response: output.proceed.text,
        sessionId: output.sessionId,
        conversationEnded: true,
      });
    } else {
      return res.status(400).json({
        error: "Unable to process request",
        status: output.proceed.status,
      });
    }
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
