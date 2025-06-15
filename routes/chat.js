import express from "express";
import { chat } from "../utils/chat.js";

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

router.post("/", async (req, res) => {
  const userId = req.userId;
  const { text, sessionId } = req.body;
  const ans = await chat(sessionId, userId, text);
  res.json({
    text: cleanText(ans),
  });
});

export default router;
