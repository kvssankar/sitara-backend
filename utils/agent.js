import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";
import { getSession, sessionData, updateSession } from "./chat.js";
import { getIntents } from "./crud.js";
import { createToolCode } from "./tool.js";

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const lambdaClient = new LambdaClient({ region: "us-east-1" });

export const executePythonScript = async (options) => {
  const { apiCode, args = '{}' } = options;
  if (!apiCode) throw new Error("No code provided");
  if (typeof args !== 'string') throw new Error("Arguments should be a JSON string");

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

  if(body.success){
    return {
      result: body.result, // your block_handler return value
    }
  }
  else{
    return {
      error: body.error || "An error occurred in the tool execution",
    }
  }
};

export function hasCurlyBracesWithText(inputString) {
  const regex = /\{[^{}]*}/;
  return regex.test(inputString);
}

export function extractTextWithinCurlyBraces(inputString) {
  const regex = /\{[^{}]*\}/;
  const match = inputString.match(regex);
  return match ? match[0] : null;
}

export function generateTools(tools) {
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
        // @ts-ignore
        tool.input_schema.properties[p.name] = {
          type: p.type,
          description: p.description,
          values: p.values,
        };
      } else {
        // @ts-ignore
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
        console.log("input to function:", obj);
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
  console.log(JSON.stringify(tools, null, 2));
  return {
    tools: Atools,
    functions: functions,
  };
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const generate_agent_block_template = (steps) => {
  let agent_block_template = `You are a world class assistant for conversing and guiding the user with empathy to the following steps:
  Steps:-
  {steps}
  {format_instructions}
  Rules:-
  1. Don't greet user, just guide them.
  2. Always guide one step at a time.
  3. Don't sound mechanical or repetitive. When a user asks for a moment to check or retrieve information, the AI should acknowledge the pause with a simple expression and maintain a natural flow in the conversation.
  4. Just ignore the dashes and spaces in numbers provided by user.
  5. Always reply only the AI part. Don't hallucinate the user part.
  6. Always reply in less than 15 words.
  7. You may not need to use tools for every query - the user may just want to chat!
  `;
  let format_instructions =
    "After that capture the output as a JSON value that adheres to a given 'JSON Schema' instance.\nHere is the JSON Schema instance your output must adhere to. You must include the leading and trailing '```json' and '```':\n";
  format_instructions += "```json\n{\n";
  format_instructions +=
    '  "all_steps_conveyed": string //this is yes when all the steps are conversed with user and conversation is at end\n}';
  agent_block_template = agent_block_template.replace(
    "{format_instructions}",
    format_instructions
  );
  agent_block_template = agent_block_template.replace("{steps}", steps);
  return agent_block_template;
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

export class AgentMessage {
  messages = [];
  functions = null;
  tools = null;
  systemPrompt =
    "You are a world class assistant for conversing and guiding the user with empathy. You may not need to use tools for every query - the user may just want to chat!";

  constructor(messages, steps, schema) {
    this.messages = messages;
    if (schema) {
      const { tools, functions } = generateTools(schema);
      this.tools = tools;
      this.functions = functions;
    }

    this.systemPrompt = generate_agent_block_template(steps);
  }

  async getToolMessages(lastMessage) {
    const toolUseBlocks = lastMessage.content.filter(
      // @ts-ignore
      (content) => content.type === "tool_use"
    );

    if (toolUseBlocks?.length) {
      const allToolResultPromises = toolUseBlocks.map(async (toolBlock) => {
        const { name, id, input } = toolBlock;
        const tool = this.tools?.find((tool) => tool.name === name);
        if (tool) {
          const toolOutput = await this.functions[name](input);
          return {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: id,
                content: toolOutput,
              },
            ],
          };
        } else {
          throw Error(`Tool ${name} does not exist`);
        }
      });
      const allToolResults = await Promise.all(allToolResultPromises);
      return allToolResults;
    } else {
      return null;
    }
  }

  async callClaude(messages = null) {
    let attempts = 0;
    const maxAttempts = 3;
    while (attempts < maxAttempts) {
      try {
        const response = await client.messages.create({
          model: "claude-3-5-sonnet-20240620",
          temperature: 0.2,
          max_tokens: 1024,
          messages: messages || this.messages,
          tools: this.tools,
          system: this.systemPrompt,
        });
        this.messages.push({ role: "assistant", content: response?.content });

        return response;
      } catch (error) {
        attempts++;
        if (attempts >= maxAttempts) {
          throw error;
        }
      }
    }
  }

  async processResponse(options, answers = [], done = null) {
    if (this.messages.length === 0) {
      this.messages.push({ role: "user", content: options.text });
      let response = await this.callClaude();
      answers.push(getAIText(response));
      return this.processResponse(options, answers, getAIText(response));
    }

    let lastMessage = this.messages[this.messages.length - 1];

    //if lastMessage.content is an array of objects
    let isToolUse =
      typeof lastMessage.content === "object" &&
      lastMessage.content.filter((content) => content.type === "tool_use")
        .length > 0;
    console.log("Is tool to be use:", isToolUse);

    let isUserMessage =
      lastMessage.role === "user" && typeof lastMessage.content === "string";
    console.log("Is last message a user message?", isUserMessage);

    let isToolUsed =
      typeof lastMessage.content === "object" &&
      lastMessage.content.filter((content) => content.type === "tool_result")
        .length > 0;
    console.log("Is tool used:", isToolUsed);

    let isAssistantMessage = lastMessage.role === "assistant";
    console.log("Is last message an assistant message?", isAssistantMessage);

    if (isToolUsed) {
      console.log("Tool has been used. Calling Claude again.");
      let response = await this.callClaude();
      console.log("Received response from Claude:", JSON.stringify(response));

      console.log("Recursively calling processResponse.");
      answers.push(getAIText(response));
      return this.processResponse(options, answers, getAIText(response));
    }

    if (isToolUse) {
      console.log("Last message indicates tool to be use.");
      let toolMessages = await this.getToolMessages(lastMessage);

      if (!toolMessages) {
        console.error("No tool responses found. Throwing error.");
        throw new Error("No tool responses found");
      }
      console.log("Tool messages obtained:", toolMessages);

      //check if there is any tool_use in last message messages[-1]
      if (
        this.messages[this.messages.length - 1].content.filter(
          (content) => content.type === "tool_use"
        ).length > 0
      ) {
        this.messages.push(...toolMessages);
      } else {
        options = {
          type: options.type,
          text: "can u pls repeat that?",
          isChat: options.isChat,
        };
        return this.processResponse(options, answers, done);
      }

      console.log("Calling Claude with tool messages.");
      let response = await this.callClaude();

      console.log("Recursively calling processResponse.");
      answers.push(getAIText(response));
      return this.processResponse(options, answers, getAIText(response));
    }

    if (done) {
      console.log("Done parameter is set. sending");
      if (
        hasCurlyBracesWithText(
          getAIText(this.messages[this.messages.length - 1])
        )
      ) {
        return {
          messages: this.messages,
          done: true,
          answers: answers,
        };
      } else {
        return {
          messages: this.messages,
          done: false,
          answers: answers,
        };
      }
    }

    if (isUserMessage) {
      console.log("Last message is a user message. Updating content.");
      lastMessage.content = lastMessage.content + "\n" + options.text;

      console.log("Calling Claude with updated messages.");
      let response = await this.callClaude();
      console.log("Received response from Claude:", response);

      console.log("Recursively calling processResponse.");
      answers.push(getAIText(response));
      return this.processResponse(options, answers, getAIText(response));
    }

    if (isAssistantMessage) {
      console.log(
        "Last message is an assistant message. Adding new user message."
      );
      this.messages.push({
        role: "user",
        content: options.text,
      });

      console.log("Calling Claude with new user message.");
      let response = await this.callClaude();
      console.log("Received response from Claude:", response);

      console.log("Recursively calling processResponse.");
      answers.push(getAIText(response));
      return this.processResponse(options, answers, getAIText(response));
    }

    return null;
  }
}

export const callClaudeOnce = async (text, systemPrompt) => {
  const messages = [
    {
      role: "user",
      content: text,
    },
  ];
  try {
    const result = await client.messages.create({
      model: "claude-3-5-sonnet-20240620",
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

export const generateUtterances = async (intent) => {
  const template = `You are a world-class assistant in generative utterances. But you have follow the below rules the refine the prompt.
Rules:
1. Each Utterance should be only 1 line, less than 15 words.
2. You should generate 10 utterances
Generate utterances for below intent:
${intent}
Generate JSON output with the following structure:
{
    "utterances": array<string>
}`;
  return await callClaudeOnce(
    template,
    "You are a world-class assistant in generative utterances."
  );
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
  if (data.intent === -1) {
    return null;
  } else {
    return intents[data.intent];
  }
};

export const getSummary = async (sessionId) => {};

// export const

// const dummyApiCode = `
// import sys
// import json
// import requests
// import json

// #WRITE YOUR CODE IN THIS FUNCTION
// def block_handler(params):
//     return "customer phone-9347994869"

// if __name__ == "__main__":
//     params_str = sys.argv[1]

//     params = json.loads(params_str)

//     result = block_handler(params)
//     print(result)
// `;

// executePythonScript({
//   apiCode: dummyApiCode,
//   args: ["{}"],
// })

// const tools = [
//   {
//     name: "get_customer_info",
//     description: "Get customer information",
//     api_code: dummyApiCode,
//     params: [
//       {
//         name: "customer_name",
//         type: "string",
//         description: "Name of the customer",
//       },
//     ],
//   },
// ];

// const steps =
//   "1. Ask the user for their name\n2. Use the get_customer_info tool to get the customer's phone number";

// async function main() {
//   let agentMessage = new AgentMessage([], steps, tools);
//   let messages = await agentMessage.processResponse({
//     text: "hi",
//   });

//   agentMessage = new AgentMessage(messages, steps, tools);
//   messages = await agentMessage.processResponse({
//     text: "my name is sankar",
//   });

//   //   agentMessage = new AgentMessage(messages, steps, tools);
//   //   messages = await agentMessage.processResponse({
//   //     text: "can u tell me my phone number",
//   //   });
// }

// main();
