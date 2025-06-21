import express from "express";
import sessionManager from "../models/SessionManager.js";
import { ProceedStatus, RunType, SessionDataProperty } from "../utils/index.js";

const router = express.Router();

function cleanText(text) {
  // Remove everything between curly braces
  const withoutCurlyBraces = text.replace(/\{.*?\}/gs, "");

  // Remove the word 'json'
  const withoutJson = withoutCurlyBraces.replace(/json/gi, "");

  const withoutBackticks = withoutJson.replace(/`/g, "");

  const trimmedText = withoutBackticks.trim();

  const removeHyphen = trimmedText.replace(/-/g, " ");

  const cleanText = removeHyphen.replace(/\n\s*\n/g, "\n");

  return cleanText;
}

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
