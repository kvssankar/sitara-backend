import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export function cleanText(text) {
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

export const createToolCode = (code) => `
import sys

${code}

if __name__ == "__main__":
    params_str = sys.argv[1]
    params = json.loads(params_str)

    result = block_handler(params)
    print(result)
`;

export function hasCurlyBracesWithText(inputString) {
  const regex = /\{[^{}]*}/;
  return regex.test(inputString);
}

export function extractTextWithinCurlyBraces(inputString) {
  const regex = /\{[^{}]*\}/;
  const match = inputString.match(regex);
  return match ? match[0] : null;
}

export const ProceedStatus = {
  YES: "YES",
  NO: "NO",
  TELL_CUSTOMER: "TELL_CUSTOMER",
  PASS_TO_HUMAN: "PASS_TO_HUMAN",
  END: "END",
};

export const RunType = {
  AI: "AI",
  HUMAN: "HUMAN",
};

export const SessionDataProperty = {
  processing: "processing",
  apiProcessing: "apiProcessing",
  outputBlockProcessing: "outputBlockProcessing",
  agentLoopProcessing: "agentLoopProcessing",
  humanSpeaking: "humanSpeaking",
  listen: "listen",
  shouldStop: "shouldStop",
  sessionVariables: "sessionVariables",
  ws: "ws",
  streamSid: "streamSid",
  backuptext: "backuptext",
  removeHistory: "removeHistory",
};

export const callClaudeOnce = async (text, systemPrompt) => {
  const messages = [
    {
      role: "user",
      content: text,
    },
  ];
  try {
    const result = await client.messages.create({
      model: process.env.ANTHROPIC_MEDIUM_MODEL,
      temperature: 0.2,
      max_tokens: 1024,
      messages: messages,
      // tools: this.tools,
      system: systemPrompt,
    });
    console.log("result", JSON.stringify(result, null, 2));
    const ans = result?.content[0].text || "";
    if (hasCurlyBracesWithText(ans)) {
      const cap = JSON.parse(extractTextWithinCurlyBraces(ans));
      return cap;
    } else {
      throw new Error("No utterances found");
    }
  } catch (err) {
    throw new Error(`Something went wrong - ${err.message}`);
  }
};

export const intentFinder = async (intents, text) => {
  let joinedIntents = intents
    ?.map((intent, idx) => `${idx}. ${intent.intent}`)
    .join("\n");
  const template = `You are a world class assistant for finding the intent of the user query. You have to find the intent of the user query from the below intents.
  Intents:-
  ${joinedIntents}

  Query: ${text}

  Identify the intent of the user query and Generate JSON output with the following structure:
  {
      "intent": number //index of the intent, if not found then -1
  }`;
  const data = await callClaudeOnce(
    template,
    "You are a world class assistant for finding the intent of the user query."
  );

  console.log("intentFinder data", data);

  if (data.intent === -1) {
    return null;
  } else {
    return intents[data.intent];
  }
};

export const getAIText = (message) => {
  if (!message) {
    throw new Error("No message found");
  }
  let aiText = message.content
    .map((content) => (content.type === "text" ? content.text : null))
    .filter(Boolean)
    .join("\n");
  // aiText = aiText.replace(/\b\d{3,}\b/g, (match) =>
  //   match.split("").join(" "),
  // );
  return aiText;
};
