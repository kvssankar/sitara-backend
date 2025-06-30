import Anthropic from "@anthropic-ai/sdk";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import {
  generateTools,
  callClaudeOnce,
  getCleanAIText,
} from "/opt/nodejs/sitara/utils.js";
import { invokeLambda } from "/opt/nodejs/sitara/lambdaHelpers.js";
import {
  supportAgentSystemPrompt,
  caseSummaryPrompt,
  caseSummaryAnalysisSystemPrompt,
  imageAnalysisPrompt,
} from "/opt/nodejs/sitara/prompt.js";
import {
  addMessageToCase,
  getCaseMessages,
  getSupportCase,
  updateSupportCase,
  updateMessage,
} from "/opt/nodejs/sitara/supportCrud.js";
import { getIntentWithTools } from "/opt/nodejs/sitara/intentCrud.js";

const s3Client = new S3Client({
  region: process.env.REGION || "us-east-1",
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SUPPORT_BUCKET_NAME = process.env.SUPPORT_BUCKET_NAME;

class SupportAgent {
  async processNewTicket(caseId, intentId) {
    await updateSupportCase(caseId, {
      intentId,
    });
    await this.chatWithCustomer(caseId);
  }
  async chatWithCustomer(caseId) {
    const supportCase = await getSupportCase(caseId);
    if (!supportCase) {
      throw new Error(`Support case not found: ${caseId}`);
    }

    const supportMessages = await getCaseMessages(caseId);

    const aiMessages = supportMessages.filter((msg) => msg.senderType === "ai");

    // if (aiMessages.length > 4) {
    //   updateSupportCase(caseId, {
    //     assignedAgent: "agent123",
    //   });
    //   return;
    // }

    // Process any unprocessed images first
    await Promise.all(
      supportMessages.map(async (msg) => {
        if (
          msg.senderType === "customer" &&
          msg.mediaUrls &&
          msg.mediaUrls.length > 0 &&
          !msg.processedImages
        ) {
          await this.processMessageImages(
            caseId,
            msg.messageId,
            msg.mediaUrls,
            msg.content
          );
        }
      })
    );

    // Fetch updated messages after processing
    const updatedMessages = await getCaseMessages(caseId);

    const claudeMessages = updatedMessages
      .map((msg) => {
        if (msg.senderType === "customer") {
          return {
            role: "user",
            content: msg.content, // Now contains text + image descriptions
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

    await this.callClaude(claudeMessages, supportCase.intentId, caseId);
  }

  async callClaude(messages, intentId, caseId) {
    console.log("Calling Claude with messages:");
    const intent = await getIntentWithTools(intentId, process.env.PROJECT_ID);
    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }
    const systemPrompt = supportAgentSystemPrompt(intent.steps);

    let tools = null;
    let functions = null;

    // Generate tools if intent has tools
    if (intent.tools && intent.tools.length > 0) {
      const toolsData = generateTools(intent.tools);
      tools = toolsData.tools;
      functions = toolsData.functions;
    }

    let conversationMessages = [...messages];
    let maxIterations = 20; // Hard limit increased to 20
    let iteration = 0;

    while (iteration < maxIterations) {
      console.log(`Iteration ${iteration + 1}`);
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

        console.log(`Claude response:`, response.content);
        await addMessageToCase(
          caseId,
          "support-agent-ai",
          "ai",
          getCleanAIText(response)
        );

        // Check if response contains tool calls
        const toolUseBlocks = response.content.filter(
          (content) => content.type === "tool_use"
        );

        console.log(`Found ${toolUseBlocks.length} tool calls in response`);

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
          // No tool calls - Claude has finished processing
          // Exit the loop and return the final response
          console.log("No tool calls found, conversation complete");
          break;
        }
      } catch (error) {
        console.error(`Claude API call failed:`, error);
        throw error;
      }
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
      const summaryPromptText = caseSummaryPrompt(
        caseId,
        supportCase,
        conversationHistory
      );

      const systemPrompt = caseSummaryAnalysisSystemPrompt;
      const summary = await callClaudeOnce(
        summaryPromptText,
        systemPrompt,
        process.env.ANTHROPIC_HIGH_MODEL
      );

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
  async convertImageToText(imageUrl, userText = "") {
    try {
      const fileKey = imageUrl.split("/").pop();
      const command = new GetObjectCommand({
        Bucket: SUPPORT_BUCKET_NAME,
        Key: fileKey,
      });
      const s3Response = await s3Client.send(command);
      const buffer = await s3Response.Body.transformToByteArray();

      const imageContent = {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/" + fileKey.split(".").pop(),
          data: buffer.toString("base64"),
        },
      };
      const prompt = imageAnalysisPrompt(userText);

      const messages = [
        {
          role: "user",
          content: [
            imageContent,
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ];

      const claudeResponse = await anthropic.messages.create({
        model: process.env.ANTHROPIC_MEDIUM_MODEL,
        max_tokens: 1000,
        temperature: 0.2,
        messages: messages,
      });

      return getCleanAIText(claudeResponse);
    } catch (error) {
      console.error("Error converting image to text:", error);
      return `[Image: ${imageUrl.split("/").pop()} - Unable to process image: ${
        error.message
      }]`;
    }
  }

  async processMessageImages(caseId, messageId, mediaUrls, userText) {
    if (!mediaUrls || mediaUrls.length === 0) {
      return userText;
    }

    try {
      // Convert all images to text descriptions
      const imageDescriptions = await Promise.all(
        mediaUrls.map(async (url) => {
          const description = await this.convertImageToText(url, userText);
          return `[Image Analysis: ${description}]`;
        })
      );

      // Combine user text with image descriptions
      const enhancedText = userText
        ? `${userText}\n\n${imageDescriptions.join("\n\n")}`
        : imageDescriptions.join("\n\n");

      // Update the message to remove mediaUrls and update content
      await updateMessage(messageId, {
        content: enhancedText,
        mediaUrls: [], // Remove media URLs
        processedImages: true, // Flag to indicate images were processed
      });

      // Store image information in support case metadata
      const supportCase = await getSupportCase(caseId);
      const existingImageData = supportCase.mediaUrls || [];

      await updateSupportCase(caseId, {
        mediaUrls: [...existingImageData, ...mediaUrls],
      });

      return enhancedText;
    } catch (error) {
      console.error("Error processing message images:", error);
      return userText + "\n[Error: Could not process attached images]";
    }
  }

  async addCustomerMessage(caseId, senderId, content, mediaUrls = []) {
    // First add the message with original content and mediaUrls
    const message = await addMessageToCase(
      caseId,
      senderId,
      "customer",
      content,
      "text",
      mediaUrls
    );

    // If there are images, process them immediately
    if (mediaUrls && mediaUrls.length > 0) {
      await this.processMessageImages(
        caseId,
        message.messageId,
        mediaUrls,
        content
      );
    }

    return message;
  }
}

export default SupportAgent;
