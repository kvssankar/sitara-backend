// agent.js
import Anthropic from "@anthropic-ai/sdk";
import { getIntents } from "../utils/crud.js";
import { performRAGSearch } from "../utils/rag.js";
import { FastIntentMatcher } from "../utils/FastIntentMatcher.js";
import { convertTextToSpeechStream } from "./Synthesizer.js";
import { cleanText, getAIText, intentFinder } from "../utils/index.js";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

class ConversationalAgent {
  constructor(userId, session) {
    this.userId = userId;
    this.session = session;
    this.conversationHistory = [];
    this.pendingIntent = null;
  }

  async processMessage(userMessage) {
    // Add to history
    this.conversationHistory.push({
      role: "user",
      content: userMessage,
      timestamp: new Date(),
    });

    // Check if we're waiting for intent confirmation
    if (this.pendingIntent) {
      return await this.handleIntentConfirmation(userMessage);
    }

    const tools = [
      {
        name: "search_knowledge_base",
        description: "Search for information to answer user questions",
        input_schema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query for the knowledge base",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "identify_intent",
        description:
          "Identify user's specific intent when they describe a need or problem",
        input_schema: {
          type: "object",
          properties: {
            user_message: {
              type: "string",
              description: "The user's message to analyze for intent",
            },
          },
          required: ["user_message"],
        },
      },
    ];

    const systemPrompt = `You are a friendly, conversational assistant. Your goal is to:

1. Have natural, engaging conversations with users
2. When users ask questions, ALWAYS use the search_knowledge_base tool to find answers
3. Only provide information that comes from the knowledge base search results
4. If the search returns no results, politely say you don't have that information and ask for more details
5. When users describe problems or needs, use the identify_intent tool
6. If no intent is identified, ask clarifying questions to better understand their needs
7. Keep responses conversational and warm, but stay focused on helping

Important rules:
- Never answer factual questions without using search_knowledge_base first
- If search returns nothing, don't make up answers - ask for clarification
- Be genuinely interested in understanding what the user needs
- Guide conversations naturally toward identifying how you can help
- When an intent is identified, you'll receive confirmation instructions`;

    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MEDIUM_MODEL,
      max_tokens: 500,
      system: systemPrompt,
      tools,
      messages: [
        ...this.getFormattedHistory(),
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    await convertTextToSpeechStream(
      this.session?.sessionId,
      cleanText(getAIText(response))
    );

    // Process tool calls
    let finalResponse = response;
    let intentFound = false;
    let finalResponseChanged = false;

    console.log("Claude response:", response);

    for (const block of response.content) {
      if (block.type === "tool_use") {
        const toolResult = await this.executeTool(block.name, block.input);

        console.log(`Tool result for ${block.name}:`, toolResult);

        // Check if intent was found
        if (block.name === "identify_intent" && toolResult.intent) {
          intentFound = true;
          this.pendingIntent = toolResult.intent;
        }
        finalResponseChanged = true;
        // Send tool result back to Claude for final response
        finalResponse = await client.messages.create({
          model: process.env.ANTHROPIC_MEDIUM_MODEL,
          max_tokens: 500,
          system: systemPrompt,
          tools,
          messages: [
            ...this.getFormattedHistory(),
            {
              role: "user",
              content: userMessage,
            },
            {
              role: "assistant",
              content: response.content,
            },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify(toolResult),
                },
              ],
            },
          ],
        });
      }
    }

    const responseText = this.extractText(finalResponse);

    if (finalResponseChanged) {
      await convertTextToSpeechStream(
        this.session?.sessionId,
        cleanText(responseText)
      );
    }

    // Add to history
    this.conversationHistory.push({
      role: "assistant",
      content: responseText,
      timestamp: new Date(),
    });

    // If intent was found, ask for confirmation
    if (intentFound && this.pendingIntent) {
      const confirmationText = `I understand you need help with "${this.pendingIntent.intent}". Is that correct?`;

      await convertTextToSpeechStream(
        this.session?.sessionId,
        cleanText(confirmationText)
      );

      this.conversationHistory.push({
        role: "assistant",
        content: confirmationText,
        timestamp: new Date(),
      });

      return {
        text: responseText + "\n\n" + confirmationText,
        pendingIntent: this.pendingIntent,
        awaitingConfirmation: true,
      };
    }

    return {
      text: responseText,
      pendingIntent: null,
      awaitingConfirmation: false,
    };
  }

  async handleIntentConfirmation(userMessage) {
    const lowerMessage = userMessage.toLowerCase().trim();

    // Check for positive confirmation
    const positiveResponses = [
      "yes",
      "yeah",
      "correct",
      "right",
      "exactly",
      "that's right",
      "yep",
      "sure",
      "absolutely",
      "definitely",
    ];
    const negativeResponses = [
      "no",
      "nope",
      "not really",
      "wrong",
      "incorrect",
      "not quite",
      "not exactly",
    ];

    const isPositive = positiveResponses.some((response) =>
      lowerMessage.includes(response)
    );
    const isNegative = negativeResponses.some((response) =>
      lowerMessage.includes(response)
    );

    if (isPositive) {
      // User confirmed the intent
      const confirmedIntent = this.pendingIntent;
      this.pendingIntent = null;

      this.conversationHistory.push({
        role: "assistant",
        content: "Great! Let me help you with that.",
        timestamp: new Date(),
      });

      return {
        text: "Great! Let me help you with that.",
        confirmedIntent: confirmedIntent,
        proceedToWorkflow: true,
      };
    } else if (isNegative) {
      // User rejected the intent
      this.pendingIntent = null;

      const responseText =
        "I apologize for the misunderstanding. Could you please tell me more about what you need help with?";

      this.conversationHistory.push({
        role: "assistant",
        content: responseText,
        timestamp: new Date(),
      });

      return {
        text: responseText,
        confirmedIntent: null,
        proceedToWorkflow: false,
      };
    } else {
      // Unclear response, ask again
      const responseText =
        "I'm not sure if I understood correctly. Do you need help with \"" +
        this.pendingIntent.intent +
        '"? Please answer yes or no.';

      this.conversationHistory.push({
        role: "assistant",
        content: responseText,
        timestamp: new Date(),
      });

      return {
        text: responseText,
        pendingIntent: this.pendingIntent,
        awaitingConfirmation: true,
      };
    }
  }

  async executeTool(toolName, input) {
    switch (toolName) {
      case "search_knowledge_base":
        try {
          const results = await performRAGSearch(input.query, this.userId);
          return {
            success: true,
            results: results || [],
            query: input.query,
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
          };
        }

      case "identify_intent":
        try {
          if (!this.session.intents) {
            this.session.intents = await getIntents(this.userId);
          }
          // Get intents from session if available
          const identifiedIntent = await intentFinder(
            this.session.intents,
            input.user_message
          );

          return {
            success: true,
            intent: identifiedIntent,
            found: !!identifiedIntent,
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
          };
        }

      default:
        return { success: false, error: "Unknown tool" };
    }
  }

  getFormattedHistory() {
    // Keep last 10 messages for context
    return this.conversationHistory.slice(-10).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  extractText(response) {
    return response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }

  reset() {
    this.conversationHistory = [];
    this.pendingIntent = null;
  }
}

export default ConversationalAgent;
