import Anthropic from "@anthropic-ai/sdk";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import {
  getAIText,
  intentFinder,
  createToolCode,
  executePythonScript,
  generateTools,
  callClaudeOnce,
} from "../utils/index.js";
import { getIntent, getIntents } from "../utils/crud.js";
import {
  addMessageToCase,
  getCaseMessages,
  getSupportCase,
  updateSupportCase,
} from "../utils/supportCrud.js";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SUPPORT_BUCKET_NAME = process.env.SUPPORT_BUCKET_NAME;

class SupportAgent {
  async processNewTicket(caseId) {
    const supportCase = await getSupportCase(caseId);

    if (!supportCase) {
      throw new Error(`Support case not found: ${caseId}`);
    }

    const supportMessages = await getCaseMessages(caseId);

    //get count of number of ai messages
    const aiMessages = supportMessages.filter((msg) => msg.senderType === "ai");

    if (aiMessages.length > 4) {
      updateSupportCase(caseId, {
        assignedAgent: "agent123",
      });
      return;
    }

    const title = supportCase.title;
    const description =
      supportCase.description +
      supportMessages.map((msg) => msg.content).join("\n");
    const media = supportMessages[0].mediaUrls || [];

    const issue = `Title: ${title}\nDescription: ${description}`;
    //media is just s3 urls
    //i need to get base64 image content from s3 url
    const images = await Promise.all(
      media.map(async (url) => {
        const fileKey = url.split("/").pop();
        const command = new GetObjectCommand({
          Bucket: SUPPORT_BUCKET_NAME,
          Key: fileKey,
        });
        const response = await s3Client.send(command);
        const buffer = await response.Body.transformToByteArray();
        return {
          type: fileKey.split(".").pop(),
          content: `data:image/${fileKey
            .split(".")
            .pop()};base64,${buffer.toString("base64")}`,
        };
      })
    );

    const content = images.map((img) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/" + img.type,
        data: img.content.split(";base64,").pop(),
      },
    }));

    content.push({
      type: "text",
      text: issue,
    });

    const intents = await getIntents();
    const intentFound = await intentFinder(intents, issue);

    if (!intentFound) {
      await addMessageToCase(
        caseId,
        "support-agent-ai",
        "ai",
        "Can you please provide more details about your issue?"
      );
      return;
    }

    const systemPrompt = `You are a support agent AI. Your task is to assist customers with their issues based on the provided information. Follow the below Steps and execute necessary tools and resolve the issue:
Steps:
${intentFound.steps}

Rules:
1. Always ask for more details if the issue is not clear.
2. Use the provided media files to understand the issue better.
3. If you need to execute a tool, do so and provide the results.
4. At the end, if issue is resolved summarize the resolution to the customer else ask for more details.
5. Always respond in a professional and helpful manner.
`;
    const requestBody = {
      model: process.env.ANTHROPIC_MEDIUM_MODEL,
      system: systemPrompt,
      max_tokens: 8192,
      temperature: 0,
      messages: [{ role: "user", content }],
    };

    const response = await anthropic.messages.create(requestBody);
    const message = getAIText(response);

    await addMessageToCase(caseId, "support-agent-ai", "ai", message);
  }

  async chatWithCustomer(caseId) {
    const supportCase = await getSupportCase(caseId);
    if (!supportCase) {
      throw new Error(`Support case not found: ${caseId}`);
    }

    const supportMessages = await getCaseMessages(caseId);

    const aiMessages = supportMessages.filter((msg) => msg.senderType === "ai");

    if (aiMessages.length > 4) {
      updateSupportCase(caseId, {
        assignedAgent: "agent123",
      });
      return;
    }

    const claudeMessages = supportMessages
      .map((msg) => {
        if (msg.senderType === "customer") {
          return {
            role: "user",
            content: msg.content,
          };
        } else if (msg.senderType === "ai") {
          return {
            role: "assistant",
            content: msg.content,
          };
        }
        return null;
      })
      .filter(Boolean);

    const message = await this.callClaude(claudeMessages, supportCase.intentId);

    await addMessageToCase(caseId, "support-agent-ai", "ai", message.message);
  }

  async callClaude(messages, intentId) {
    const intent = await getIntent(intentId);
    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }

    const systemPrompt = `You are a support agent AI. Your task is to assist customers with their issues based on the provided information. Follow the below Steps and execute necessary tools and resolve the issue:
Steps:
${intent.steps}

Rules:
1. Always ask for more details if the issue is not clear.
2. Use the provided media files to understand the issue better.
3. If you need to execute a tool, do so and provide the results.
4. At the end, if issue is resolved summarize the resolution to the customer else ask for more details.
5. Always respond in a professional and helpful manner.
`;

    let tools = null;
    let functions = null;

    // Generate tools if intent has tools
    if (intent.tools && intent.tools.length > 0) {
      const toolsData = generateTools(intent.tools);
      tools = toolsData.tools;
      functions = toolsData.functions;
    }

    let conversationMessages = [...messages];
    let maxIterations = 10;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      try {
        const requestBody = {
          model: process.env.ANTHROPIC_MEDIUM_MODEL,
          system: systemPrompt,
          max_tokens: 8192,
          temperature: 0.2,
          messages: conversationMessages,
        };

        // Add tools only if they exist
        if (tools && tools.length > 0) {
          requestBody.tools = tools;
        }

        const response = await anthropic.messages.create(requestBody);

        // Add assistant response to conversation
        conversationMessages.push({
          role: "assistant",
          content: response.content,
        });

        // Check if response contains tool calls
        const toolUseBlocks = response.content.filter(
          (content) => content.type === "tool_use"
        );

        if (toolUseBlocks && toolUseBlocks.length > 0) {
          // Execute all tool calls
          const toolResults = await Promise.all(
            toolUseBlocks.map(async (toolBlock) => {
              const { name, id, input } = toolBlock;

              if (functions && functions[name]) {
                try {
                  console.log(`Executing tool: ${name} with input:`, input);
                  const toolOutput = await functions[name](input);
                  console.log(`Tool ${name} output:`, toolOutput);

                  return {
                    type: "tool_result",
                    tool_use_id: id,
                    content:
                      typeof toolOutput === "string"
                        ? toolOutput
                        : JSON.stringify(toolOutput),
                  };
                } catch (error) {
                  console.error(`Error executing tool ${name}:`, error);
                  return {
                    type: "tool_result",
                    tool_use_id: id,
                    content: "Error executing tool: " + error.message,
                  };
                }
              } else {
                return {
                  type: "tool_result",
                  tool_use_id: id,
                  content: `Tool ${name} not found`,
                };
              }
            })
          );

          // Add tool results to conversation
          conversationMessages.push({
            role: "user",
            content: toolResults,
          });

          // Continue the loop to get Claude's response to tool results
          continue;
        } else {
          // Generate summary of what has been done and what else is needed
          const summary = await this.generateConversationSummary(
            conversationMessages
          );

          return {
            message: `${
              summary.summary
            }\n Please take necessary actions:\n ${summary.nextSteps.join(
              "\n"
            )}`,
          };
        }
      } catch (error) {
        console.error(`Claude API call failed:`, error);
        throw error;
      }
    }

    // If we reach here, we hit max iterations - still generate summary
    const summary = await this.generateConversationSummary(
      conversationMessages
    );
    return {
      message: `${
        summary.summary
      }\n Please take necessary actions. ${summary.nextSteps.join(", ")}`,
    };
  }

  async generateConversationSummary(conversationMessages) {
    try {
      // Extract conversation history for summary
      const conversationHistory = conversationMessages
        .map((msg, index) => {
          if (msg.role === "user") {
            const textContent = msg.content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join(" ");
            return `User: ${textContent}`;
          } else if (msg.role === "assistant") {
            const textContent = msg.content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join(" ");
            return `Assistant: ${textContent}`;
          }
          return null;
        })
        .filter(Boolean)
        .join("\n");

      const summaryPrompt = `Based on the following conversation between a support agent and a customer, provide a comprehensive summary.

Conversation:
${conversationHistory}

Please analyze the conversation and provide a JSON response with the following structure:
{
  "summary": "Brief summary of what has been discussed and accomplished",
  "actionsCompleted": ["List of specific actions or steps that were completed"],
  "issueResolved": true/false,
  "nextSteps": ["List of any remaining actions needed or recommendations"],
  "customerSatisfaction": "high/medium/low - based on conversation tone",
  "requiresHumanAgent": true/false
}`;

      const systemPrompt = `You are an expert customer support analyst. Your task is to analyze support conversations and provide detailed summaries that help track progress and determine next steps.`;

      const summary = await callClaudeOnce(summaryPrompt, systemPrompt);
      return summary;
    } catch (error) {
      console.error("Error generating conversation summary:", error);
      return {
        summary: "Unable to generate summary due to an error",
        actionsCompleted: [],
        issueResolved: false,
        nextSteps: ["Review conversation manually"],
        customerSatisfaction: "medium",
        requiresHumanAgent: false,
      };
    }
  }
  async generateCaseSummary(caseId) {
    try {
      const supportCase = await getSupportCase(caseId);
      if (!supportCase) {
        throw new Error(`Support case not found: ${caseId}`);
      }

      const allMessages = await getCaseMessages(caseId);

      if (!allMessages || allMessages.length === 0) {
        throw new Error(`No messages found for case: ${caseId}`);
      }

      // Format conversation history with clear distinction between participants
      const conversationHistory = allMessages
        .map((msg) => {
          const timestamp = new Date(msg.createdAt).toLocaleString();
          let participantLabel = "";

          switch (msg.senderType) {
            case "customer":
              participantLabel = "Customer";
              break;
            case "ai":
              participantLabel = "AI Support Agent";
              break;
            case "agent":
              participantLabel = "Human Support Agent";
              break;
            default:
              participantLabel = "Unknown";
          }

          return `[${timestamp}] ${participantLabel}: ${msg.content}`;
        })
        .join("\n\n");

      const summaryPrompt = `Please analyze the following support case conversation and provide a comprehensive summary.

**Case Information:**
- Case ID: ${caseId}
- Title: ${supportCase.title}
- Description: ${supportCase.description}
- Status: ${supportCase.status}
- Priority: ${supportCase.priority}
- Created: ${new Date(supportCase.createdAt).toLocaleString()}

**Full Conversation:**
${conversationHistory}

Please provide a detailed analysis and summary in the following JSON format:
{
  "caseSummary": "A comprehensive summary of the entire case including the initial issue, all interactions, and current state",
  "customerIssue": "Clear description of the customer's original problem or request",
  "keyInteractions": ["List of the most important interactions or turning points in the conversation"],
  "aiAgentPerformance": {
    "effectiveness": "high/medium/low",
    "helpfulResponses": number,
    "issuesResolved": ["List of issues the AI successfully addressed"],
    "limitations": ["Areas where AI struggled or needed human intervention"]
  },
  "humanAgentInvolvement": {
    "required": true/false,
    "reasonForEscalation": "Why human agent involvement was needed (if applicable)",
    "effectivenessOfIntervention": "How well the human agent addressed the issue"
  },
  "resolutionStatus": {
    "isResolved": true/false,
    "resolutionMethod": "How the issue was resolved (AI, human agent, or combined effort)",
    "customerSatisfactionLevel": "high/medium/low",
    "pendingActions": ["Any remaining tasks or follow-ups needed"]
  },
  "insights": {
    "customerBehavior": "Observations about customer communication style and needs",
    "commonIssueType": "Category or type of issue this represents",
    "improvementSuggestions": ["Suggestions for better handling similar cases in future"]
  },
  "nextSteps": ["Recommended actions for this specific case"],
  "tags": ["Relevant tags for categorizing this case"],
  "timeToResolution": "Estimated or actual time taken to resolve the issue"
}`;

      const systemPrompt = `You are an expert customer support analyst with deep experience in analyzing support conversations and providing actionable insights. Your task is to thoroughly analyze support case conversations and provide comprehensive summaries that help improve customer service operations.

Focus on:
- Identifying the core customer issue and how it evolved
- Evaluating the effectiveness of both AI and human support interventions
- Assessing customer satisfaction based on conversation tone and outcomes
- Providing actionable insights for process improvement
- Clearly distinguishing between different types of participants (customer, AI agent, human agent)

Always provide your response in valid JSON format.`;

      const summary = await callClaudeOnce(summaryPrompt, systemPrompt);

      // Store the summary in the support case
      await updateSupportCase(caseId, {
        summary: summary,
        summaryGeneratedAt: new Date().toISOString(),
        lastAnalyzedAt: new Date().toISOString(),
      });

      return {
        success: true,
        caseId,
        summary,
        message: "Case summary generated and stored successfully",
      };
    } catch (error) {
      console.error("Error generating case summary:", error);
      return {
        success: false,
        caseId,
        error: error.message,
        message: "Failed to generate case summary",
      };
    }
  }

  async getCaseSummary(caseId, forceRegenerate = false) {
    try {
      const supportCase = await getSupportCase(caseId);
      if (!supportCase) {
        throw new Error(`Support case not found: ${caseId}`);
      }

      // If summary exists and we're not forcing regeneration, return existing summary
      if (supportCase.summary && !forceRegenerate) {
        return {
          success: true,
          caseId,
          summary: supportCase.summary,
          lastGenerated: supportCase.summaryGeneratedAt,
          message: "Retrieved existing case summary",
        };
      }

      // Generate new summary
      return await this.generateCaseSummary(caseId);
    } catch (error) {
      console.error("Error getting case summary:", error);
      return {
        success: false,
        caseId,
        error: error.message,
        message: "Failed to get case summary",
      };
    }
  }
}

export default SupportAgent;
