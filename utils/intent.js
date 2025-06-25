import { searchDocumentsDirectly } from "./intent-rag";

export const findIntentsByText = async (text) => {
  let intents = await searchDocumentsDirectly(text);
  if (!intents || intents.length === 0) {
    return [];
  }
  intents = intents.map((intent) => intent.metadata);

  const prompt = `Given the user input: "${inputText}"

Here are the similar intents found:
${contextString}

Please analyze the similarity and return a JSON response with the following format:
{
    "confidenceScore": <number between 0-100>,
    "intentId": "<best matching intent ID>",
    "reasoning": "<brief explanation of why this intent matches>"
}

Consider semantic similarity, not just keyword matching. The confidence score should reflect how certain you are that the user input matches the intent.`;

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
  const result = JSON.parse(responseText);

  //get intendIds in result that have a confidence score greater than 70
  if (result.confidenceScore > 70) {
    const intent = intents.find((i) => i.intentId === result.intentId);
    return [intent];
  }

  const contextString = intents
    .slice(0, 10)
    .map(
      (intent) => `Intent ID: ${intent.intentId}\nText: ${intent.intentText}`
    )
    .join("\n\n");

  const fallbackPrompt = `Given the user input: "${inputText}"

Here are the available intents:
${contextString}

The initial analysis showed low confidence (${initialResult.confidenceScore}%). Please provide the top 3 most relevant intents in JSON format:

{
    "topIntents": [
        {
            "intentId": "<intent ID>",
            "confidenceScore": <number between 0-100>,
            "reasoning": "<brief explanation>"
        },
        {
            "intentId": "<intent ID>",
            "confidenceScore": <number between 0-100>,
            "reasoning": "<brief explanation>"
        },
        {
            "intentId": "<intent ID>",
            "confidenceScore": <number between 0-100>,
            "reasoning": "<brief explanation>"
        }
    ]
}

Order them by relevance, with the most relevant first.`;

  const fallbackMessage = await anthropic.messages.create({
    model: "claude-3-sonnet-20240229",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: fallbackPrompt,
      },
    ],
  });

  const fallbackResponseText = fallbackMessage.content[0].text;
  const fallbackResult = JSON.parse(fallbackResponseText);

  //get intents in fallbackResult intents with intents
  const topIntents = fallbackResult.topIntents.map((intent) => {
    const matchedIntent = intents.find((i) => i.intentId === intent.intentId);
    return {
      ...matchedIntent,
      confidenceScore: intent.confidenceScore,
      reasoning: intent.reasoning,
    };
  });

  return topIntents;
  
};
