export const intentAnalysisPrompt = (
  text,
  contextString
) => `Given the user input: "${text}"

Here are the similar intents found:
${contextString}

Please analyze the similarity and return a JSON response with the following format:
{
    "confidenceScore": <number between 0-100>,
    "intentid": "<best matching intent ID>",
    "reasoning": "<brief explanation of why this intent matches>"
}

Consider semantic similarity, not just keyword matching. The confidence score should reflect how certain you are that the user input matches the intent.`;

export const intentFallbackPrompt = (
  text,
  contextString,
  confidenceScore
) => `Given the user input: "${text}"

Here are the available intents:
${contextString}

The initial analysis showed low confidence (${confidenceScore}%). Please provide the top 3 most relevant intents in JSON format:

{
    "topIntents": [
        {
            "intentid": "<intent ID>",
            "confidenceScore": <number between 0-100>,
            "reasoning": "<brief explanation>"
        },
        {
            "intentid": "<intent ID>",
            "confidenceScore": <number between 0-100>,
            "reasoning": "<brief explanation>"
        },
        {
            "intentid": "<intent ID>",
            "confidenceScore": <number between 0-100>,
            "reasoning": "<brief explanation>"
        }
    ]
}

Order them by relevance, with the most relevant first.`;

export const supportAgentSystemPrompt = (
  steps
) => `You are a support agent AI. Your task is to assist customers with their issues based on the provided information. Follow the below Steps and execute necessary tools and resolve the issue:
Steps:
${steps}

Rules:
1. Always ask for more details if the issue is not clear.
2. Use the provided media files to understand the issue better.
3. If you need to execute a tool, do so and provide the results.
4. At the end, if issue is resolved summarize the resolution to the customer, else ask for just more details (don't explain or summarize anything).
5. Always respond in a professional and helpful manner.
`;

export const caseSummaryPrompt = (
  caseId,
  supportCase,
  conversationHistory
) => `Please analyze the following support case conversation and provide a comprehensive summary.

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

export const caseSummaryAnalysisSystemPrompt = `You are an expert customer support analyst with deep experience in analyzing support conversations and providing actionable insights. Your task is to thoroughly analyze support case conversations and provide comprehensive summaries that help improve customer service operations.

Focus on:
- Identifying the core customer issue and how it evolved
- Evaluating the effectiveness of both AI and human support interventions
- Assessing customer satisfaction based on conversation tone and outcomes
- Providing actionable insights for process improvement
- Clearly distinguishing between different types of participants (customer, AI agent, human agent)

Always provide your response in valid JSON format.`;

export const noDetailsFoundPrompt =
  "Can you please provide more details about your issue?";

// Image analysis prompts
export const imageAnalysisPrompt = (
  userText = ""
) => `Please analyze this image and provide a detailed description. ${
  userText
    ? `The user mentioned: "${userText}". Please validate if what the user said matches what you see in the image and provide details about:`
    : "Please describe:"
}

1. What you see in the image (objects, people, text, etc.)
2. Any technical details visible (error messages, UI elements, product details, etc.)
3. The context or situation shown
${
  userText
    ? `4. Whether the user's description ("${userText}") accurately describes what's in the image`
    : ""
}

Please be comprehensive and specific in your description as this will replace the image in our support system.`;
