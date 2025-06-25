import Anthropic from "@anthropic-ai/sdk";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const lambdaClient = new LambdaClient({ region: "us-east-1" });

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

// Lambda execution function
export const executePythonScript = async (options) => {
  const { apiCode, args = "{}" } = options;
  if (!apiCode) throw new Error("No code provided");
  if (typeof args !== "string")
    throw new Error("Arguments should be a JSON string");

  // build payload for your RunPythonCode Lambda
  const payload = JSON.stringify({ code: apiCode, args });

  // invoke the Python Lambda
  const command = new InvokeCommand({
    FunctionName: process.env.PYTHON_LAMBDA_NAME,
    InvocationType: "RequestResponse",
    Payload: Buffer.from(payload),
  });

  const response = await lambdaClient.send(command);
  if (response.FunctionError) {
    throw new Error(`Python Lambda error: ${response.FunctionError}`);
  }

  // parse out the result
  const resPayload = JSON.parse(Buffer.from(response.Payload).toString());
  const body = JSON.parse(resPayload.body);

  if (body.success) {
    return {
      result: body.result, // your block_handler return value
    };
  } else {
    return {
      error: body.error || "An error occurred in the tool execution",
    };
  }
};

// Generate tools function
export const generateTools = (tools) => {
  let Atools = [];
  let functions = {};
  for (const s of tools) {
    const tool = {
      name: s.name,
      description: s.description,
      input_schema: {
        type: "object",
        properties: {},
      },
    };
    for (const p of s.params) {
      if (p.type === "enum") {
        tool.input_schema.properties[p.name] = {
          type: p.type,
          description: p.description,
          values: p.values,
        };
      } else {
        tool.input_schema.properties[p.name] = {
          type: p.type,
          description: p.description,
        };
      }
    }
    tool.input_schema.required = Object.keys(tool.input_schema.properties);
    Atools.push(tool);
    functions[s.name] = async (obj) => {
      try {
        const data = await executePythonScript({
          apiCode: createToolCode(s.code),
          args: JSON.stringify(obj),
        });

        return data?.result;
      } catch (e) {
        console.log(e);
        return "something went wrong";
      }
    };
  }
  return {
    tools: Atools,
    functions: functions,
  };
};

export function hasCurlyBracesWithText(inputString) {
  const regex = /\{[^{}]*}/;
  return regex.test(inputString);
}

export function extractTextWithinCurlyBraces(str) {
  const start = str.indexOf("{");
  if (start === -1) return null; // no opening brace

  let depth = 0;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        // `i` now points to the matching closing brace
        return str.slice(start, i + 1);
      }
    }
  }

  // ran out of characters => unbalanced
  return null;
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

export const callClaudeOnce = async (text, systemPrompt, model = null) => {
  const messages = [
    {
      role: "user",
      content: text,
    },
  ];
  try {
    const result = await client.messages.create({
      model: model || process.env.ANTHROPIC_MEDIUM_MODEL,
      temperature: 0.2,
      max_tokens: 6557,
      messages: messages,
      // tools: this.tools,
      system: systemPrompt,
    });
    console.log("Claude response:", model, result);
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
    ?.map((intent, idx) => {
      const intentDescription = intent.description
        ? ` - ${intent.description}`
        : "";
      return `${idx}. ${intent.intent}${intentDescription}`;
    })
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

export const getCleanAIText = (message) => {
  if (!message) {
    throw new Error("No message found");
  }
  let aiText = getAIText(message);
  aiText = cleanText(aiText);

  return aiText;
};
