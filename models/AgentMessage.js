// AgentMessage.js

import Anthropic from "@anthropic-ai/sdk";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import {
  getAIText,
  hasCurlyBracesWithText,
  extractTextWithinCurlyBraces,
  createToolCode,
  cleanText,
} from "../utils/index.js";

import sessionManager from "./SessionManager.js";

import { ProceedStatus, SessionDataProperty } from "../utils/index.js";
import { OutputCapture } from "./OutputCapture.js";
import { convertTextToSpeechStream } from "./Synthesizer.js";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const lambdaClient = new LambdaClient({ region: "us-east-1" });

// Lambda execution function from your original code
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

// Generate tools function from your original code
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

export class AgentMessage {
  constructor(sessionId, messages, steps, schema, isChat = true) {
    this.sessionId = sessionId;
    this.messages = messages || [];
    this.isChat = isChat;
    this.gotAllInputs = false;
    this.functions = null;
    this.tools = null;

    if (schema) {
      const { tools, functions } = generateTools(schema);
      this.tools = tools;
      this.functions = functions;
    }

    this.systemPrompt = this.generateAgentBlockTemplate(steps);
  }

  generateAgentBlockTemplate(steps) {
    const wordLimit = this.isChat
      ? "longer responses for chat"
      : "less than 15 words for voice";

    let template = `You are a world class assistant for conversing and guiding the user with empathy to the following steps:
Steps:-
${steps}

Rules:-
1. Don't greet user, just guide them.
2. Always guide one step at a time.
3. Don't sound mechanical or repetitive.
4. Just ignore the dashes and spaces in numbers provided by user.
5. Always reply only the AI part. Don't hallucinate the user part.
6. Always reply ${wordLimit}.
7. You may not need to use tools for every query - the user may just want to chat!

After that capture the output as a JSON value that adheres to a given 'JSON Schema' instance.
Here is the JSON Schema instance your output must adhere to. You must include the leading and trailing '\`\`\`json' and '\`\`\`':
\`\`\`json
{
  "all_steps_conveyed": string //this is yes when all the steps are conversed with user and conversation is at end
}
\`\`\``;

    return template;
  }

  checkHumanSpeakingMutex(aiText) {
    if (!this.isChat) {
      // Only apply mutex for voice
      aiText = aiText.toLowerCase();

      // Skip mutex if JSON output (final response)
      if (
        aiText.includes("{") &&
        aiText.includes("}") &&
        aiText.includes("json")
      ) {
        return null;
      }

      // Block if human is speaking OR all inputs already captured
      if (
        sessionManager.getProperty(
          this.sessionId,
          SessionDataProperty.humanSpeaking
        ) ||
        this.gotAllInputs
      ) {
        return new OutputCapture({
          proceed: {
            status: ProceedStatus.TELL_CUSTOMER,
            text: "",
          },
          sessionId: this.sessionId,
          metadata: {
            system: `Mutex triggered - human speaking: ${sessionManager.getProperty(
              this.sessionId,
              SessionDataProperty.humanSpeaking
            )}, gotAllInputs: ${this.gotAllInputs}`,
            ai: aiText,
          },
        });
      }
    }
    return null;
  }

  async getToolMessages(lastMessage) {
    const toolUseBlocks = lastMessage.content.filter(
      (content) => content.type === "tool_use"
    );

    if (toolUseBlocks?.length) {
      const allToolResultPromises = toolUseBlocks.map(async (toolBlock) => {
        const { name, id, input } = toolBlock;
        const tool = this.tools?.find((tool) => tool.name === name);
        if (tool) {
          try {
            console.log(`Executing tool: ${name} with input:`, input);
            const toolOutput = await this.functions[name](input);
            console.log(`Tool ${name} output:`, toolOutput);

            return {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: id,
                  content:
                    typeof toolOutput === "string"
                      ? toolOutput
                      : JSON.stringify(toolOutput),
                },
              ],
            };
          } catch (error) {
            console.error(`Error executing tool ${name}:`, error);
            return {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: id,
                  content: "Error executing tool: " + error.message,
                },
              ],
            };
          }
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
          model: process.env.ANTHROPIC_MEDIUM_MODEL,
          temperature: 0.2,
          max_tokens: 1024,
          messages: messages || this.messages,
          tools: this.tools,
          system: this.systemPrompt,
        });

        this.messages.push({ role: "assistant", content: response?.content });

        // Reset human speaking flag after AI responds
        if (!this.isChat) {
          sessionManager.setProperty(
            this.sessionId,
            SessionDataProperty.humanSpeaking,
            false
          );
        }

        return response;
      } catch (error) {
        attempts++;
        console.error(`Claude API attempt ${attempts} failed:`, error);
        if (attempts >= maxAttempts) {
          throw error;
        }
        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
      }
    }
  }

  async processResponse(options, answers = [], done = null) {
    // Set processing flag for voice
    if (!this.isChat) {
      sessionManager.setProperty(
        this.sessionId,
        SessionDataProperty.agentLoopProcessing,
        false
      );
    }

    if (this.messages.length === 0) {
      this.messages.push({ role: "user", content: options.text });

      let response = await this.callClaude();
      const aiText = getAIText(response);
      answers.push(aiText);

      // Send voice response if not chat
      if (!this.isChat) {
        await this.sendVoiceResponse(aiText);

        // Check mutex after sending response
        let mutexResponse = this.checkHumanSpeakingMutex(aiText);
        if (mutexResponse) {
          return {
            messages: this.messages,
            done: false,
            answers,
            outputCapture: mutexResponse,
          };
        }
      }

      return this.processResponse(options, answers, aiText);
    }

    let lastMessage = this.messages[this.messages.length - 1];

    let isToolUse =
      typeof lastMessage.content === "object" &&
      lastMessage.content.filter((content) => content.type === "tool_use")
        .length > 0;

    let isUserMessage =
      lastMessage.role === "user" && typeof lastMessage.content === "string";

    let isToolUsed =
      typeof lastMessage.content === "object" &&
      lastMessage.content.filter((content) => content.type === "tool_result")
        .length > 0;

    let isAssistantMessage = lastMessage.role === "assistant";

    if (isToolUsed) {
      if (!this.isChat) {
        sessionManager.setProperty(
          this.sessionId,
          SessionDataProperty.agentLoopProcessing,
          true
        );
      }

      let response = await this.callClaude();
      const aiText = getAIText(response);
      answers.push(aiText);

      if (!this.isChat) {
        await this.sendVoiceResponse(aiText);

        let mutexResponse = this.checkHumanSpeakingMutex(aiText);
        if (mutexResponse) {
          return {
            messages: this.messages,
            done: false,
            answers,
            outputCapture: mutexResponse,
          };
        }
      }

      return this.processResponse(options, answers, aiText);
    }

    if (isToolUse) {
      let toolMessages = await this.getToolMessages(lastMessage);

      if (!this.isChat) {
        sessionManager.setProperty(
          this.sessionId,
          SessionDataProperty.agentLoopProcessing,
          false
        );
      }

      if (!toolMessages) {
        throw new Error("No tool responses found");
      }

      if (
        this.messages[this.messages.length - 1].content.filter(
          (content) => content.type === "tool_use"
        ).length > 0
      ) {
        this.messages.push(...toolMessages);
      } else {
        options = {
          ...options,
          text: "can u pls repeat that?",
        };
        return this.processResponse(options, answers, done);
      }

      // Check mutex before calling Claude
      if (!this.isChat) {
        let mutexResponse = this.checkHumanSpeakingMutex(
          "got tool responses but got interrupted"
        );
        if (mutexResponse) {
          return {
            messages: this.messages,
            done: false,
            answers,
            outputCapture: mutexResponse,
          };
        }
      }

      let response = await this.callClaude();
      const aiText = getAIText(response);
      answers.push(aiText);

      if (!this.isChat) {
        await this.sendVoiceResponse(aiText);

        let mutexResponse = this.checkHumanSpeakingMutex(aiText);
        if (mutexResponse) {
          return {
            messages: this.messages,
            done: false,
            answers,
            outputCapture: mutexResponse,
          };
        }
      }

      return this.processResponse(options, answers, aiText);
    }

    if (done) {
      const finalMessage = this.messages[this.messages.length - 1];
      if (hasCurlyBracesWithText(getAIText(finalMessage))) {
        this.gotAllInputs = true;
        const jsonOutput = extractTextWithinCurlyBraces(
          getAIText(finalMessage)
        );
        const temp = JSON.parse(jsonOutput);
        if (temp["all_steps_conveyed"] === "no") {
          return {
            messages: this.messages,
            done: false,
            answers: answers,
          };
        } else {
          return {
            messages: this.messages,
            done: true,
            answers: answers,
          };
        }
      } else {
        return {
          messages: this.messages,
          done: false,
          answers: answers,
        };
      }
    }

    if (isUserMessage) {
      lastMessage.content = lastMessage.content + "\n" + options.text;

      let response = await this.callClaude();
      const aiText = getAIText(response);
      answers.push(aiText);

      if (!this.isChat) {
        await this.sendVoiceResponse(aiText);

        let mutexResponse = this.checkHumanSpeakingMutex(aiText);
        if (mutexResponse) {
          return {
            messages: this.messages,
            done: false,
            answers,
            outputCapture: mutexResponse,
          };
        }
      }

      return this.processResponse(options, answers, aiText);
    }

    if (isAssistantMessage) {
      this.messages.push({
        role: "user",
        content: options.text,
      });

      let response = await this.callClaude();
      const aiText = getAIText(response);
      answers.push(aiText);

      if (!this.isChat) {
        await this.sendVoiceResponse(aiText);

        let mutexResponse = this.checkHumanSpeakingMutex(aiText);
        if (mutexResponse) {
          return {
            messages: this.messages,
            done: false,
            answers,
            outputCapture: mutexResponse,
          };
        }
      }

      return this.processResponse(options, answers, aiText);
    }

    return {
      messages: this.messages,
      done: false,
      answers: answers,
    };
  }

  async sendVoiceResponse(text) {
    console.log(`Voice response: ${text}`);
    sessionManager.addTranscript(this.sessionId, `AI: ${text}\n`);
    sessionManager.setProperty(
      this.sessionId,
      SessionDataProperty.processing,
      true
    );
    await convertTextToSpeechStream(this.sessionId, cleanText(text));
    sessionManager.setProperty(
      this.sessionId,
      SessionDataProperty.processing,
      false
    );
    sessionManager.setProperty(
      //@ts-ignore
      this.sessionId,
      SessionDataProperty.outputBlockProcessing,
      false
    );
  }
}
