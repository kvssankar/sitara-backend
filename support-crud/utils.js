import { caseSummaryPrompt } from "/opt/nodejs/sitara/prompt.js";
import {
  getSupportCase,
  updateSupportCase,
  getCaseMessages,
} from "/opt/nodejs/sitara/supportCrud.js";
import { callClaudeOnce } from "/opt/nodejs/sitara/utils.js";

export const generateCaseSummary = async (caseId) => {
  try {
    const supportCase = await getSupportCase(caseId);
    const allMessages = await getCaseMessages(caseId);
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
  } catch (error) {
    console.error("Error generating case summary:", error);
  }
};
