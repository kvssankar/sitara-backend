import express from "express";
import sessionManager from "../models/SessionManager.js";
import {
  cleanText,
  ProceedStatus,
  RunType,
  SessionDataProperty,
} from "../utils/index.js";

const router = express.Router();

const chat = async (sessionId, userId, message) => {
  try {
    const result = await sessionManager.run({
      session_id: sessionId,
      text: message,
      type: RunType.AI,
      isChat: true,
      userId: userId,
    });

    // Return the text response from the OutputCapture
    return result.proceed.text || "I'm processing your request...";
  } catch (error) {
    console.error("Error in chat:", error);
    return "Sorry, something went wrong. Please try again.";
  }
};

router.post("/", async (req, res) => {
  const userId = req.userId;
  const { text, sessionId } = req.body;
  const ans = await chat(sessionId, userId, text);
  res.json({
    text: cleanText(ans),
  });
});

export default router;
