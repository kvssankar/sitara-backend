import { extractTextWithinCurlyBraces } from "./index.js";
import { searchDocumentsDirectly } from "./intent-rag.js";
import { intentAnalysisPrompt, intentFallbackPrompt } from "./prompt.js";
import { getIntents } from "./crud.js";

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const findIntentsByText = async (text) => {
  // Due to costing reasing we have commented this code, but it works fully with aws opensearch serverless
  // let intents = await searchDocumentsDirectly(text);

  let intents = await getIntents("684d43c3234f6819aae4d80e");
  if (!intents || intents.length === 0) {
    return [];
  }

  console.log("Found intents:", intents);

  // intents = intents.map((intent) => intent._source.metadata);

  console.log(intents);

  let contextString = intents
    .slice(0, 10)
    .map(
      (intent) =>
        `1. Intent ID: ${intent.intentid}\nText: ${
          intent.intent + " " + intent.description
        }`
    )
    .join("\n\n");
  console.log(contextString);

  const prompt = intentAnalysisPrompt(text, contextString);

  const message = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MEDIUM_MODEL,
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const responseText = message.content[0].text;
  const result = JSON.parse(extractTextWithinCurlyBraces(responseText));

  //get intendIds in result that have a confidence score greater than 70
  if (result.confidenceScore > 90) {
    const intent = intents.find((i) => i.intentid === result.intentid);
    return [
      {
        ...intent,
        confidenceScore: result.confidenceScore,
        reasoning: result.reasoning,
      },
    ];
  }
  const fallbackPrompt = intentFallbackPrompt(
    text,
    contextString,
    result.confidenceScore
  );

  const fallbackMessage = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MEDIUM_MODEL,
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: fallbackPrompt,
      },
    ],
  });

  const fallbackResponseText = fallbackMessage.content[0].text;
  const fallbackResult = JSON.parse(
    extractTextWithinCurlyBraces(fallbackResponseText)
  );

  console.log("Fallback result:", fallbackResult);
  //get intents in fallbackResult intents with confidence score greater than 50
  const topIntents = fallbackResult.topIntents
    .map((intent) => {
      const matchedIntent = intents.find((i) => i.intentid === intent.intentid);
      if (!matchedIntent) {
        console.warn(`No matching intent found for ID: ${intent.intentid}`);
        return null;
      }
      return {
        ...matchedIntent,
        confidenceScore: intent.confidenceScore,
        reasoning: intent.reasoning,
      };
    })
    .filter((intent) => intent !== null && intent.confidenceScore > 50);
  return topIntents;
};
