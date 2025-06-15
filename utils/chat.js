import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { AgentMessage, callClaudeOnce, getAIText, intentFinder } from "./agent.js";
import { getIntents } from "./crud.js";

// Initialize DynamoDB Client
const dynamoDbClient = new DynamoDBClient({ region: "us-east-1" }); // Replace with your AWS region
const TABLE_NAME = "Sessions"; // Replace with your DynamoDB table name
const SESSION_TTL = 3600; // Time-to-live for session data in seconds

export const sessionData = {};
// id - steps, tools, messages

export const getSession = async (sessionId) => {
  // Check local cache first
  let session = sessionData[sessionId];
  if (session) {
    return session;
  }

  // Attempt to retrieve session from DynamoDB
  const params = {
    TableName: TABLE_NAME,
    Key: {
      sessionId: { S: sessionId },
    },
  };

  try {
    const result = await dynamoDbClient.send(new GetItemCommand(params));

    if (result.Item) {
      // Deserialize the session data
      const sessionDataStr = result.Item.data.S;
      const sessionDataObj = JSON.parse(sessionDataStr);

      // Cache the session locally
      sessionData[sessionId] = sessionDataObj;
    } else {
      // Create a new session if not found
      const { expiresAt } = getTimestamps();
      const newSession = {
        id: sessionId,
        sessionId,
        messages: [],
      };

      // Save the new session to DynamoDB
      const putParams = {
        TableName: TABLE_NAME,
        Item: {
          sessionId: { S: sessionId },
          expiresAt: { N: expiresAt.toString() },
          data: { S: JSON.stringify(newSession) },
        },
      };
      await dynamoDbClient.send(new PutItemCommand(putParams));

      // Cache the new session locally
      sessionData[sessionId] = newSession;
    }
  } catch (error) {
    console.error("Error retrieving or creating session:", error);
  }

  return sessionData[sessionId];
};

export const updateSession = async (session) => {
  const { expiresAt } = getTimestamps();
  const sessionId = session.id;

  if (!sessionId) {
    throw new Error("Session must have a sessionId.");
  }

  // Serialize the session object
  const serializedSession = JSON.stringify({
    ...session,
    expiresAt,
  });

  const params = {
    TableName: TABLE_NAME,
    Key: {
      sessionId: { S: sessionId },
    },
    UpdateExpression: "SET #data = :data, #expiresAt = :expiresAt",
    ExpressionAttributeNames: {
      "#data": "data",
      "#expiresAt": "expiresAt",
    },
    ExpressionAttributeValues: {
      ":data": { S: serializedSession },
      ":expiresAt": { N: expiresAt.toString() },
    },
  };

  try {
    // Cache the session locally
    sessionData[sessionId] = session;

    await dynamoDbClient.send(new UpdateItemCommand(params));
  } catch (error) {
    console.error("Error updating session:", error);
  }

  return session;
};

// Helper to calculate TTL (Time-to-Live)
const getTimestamps = () => {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_TTL; // Session expiry timestamp
  return { now, expiresAt };
};

const getSummary = async (query, answers) => {
  const template = `You are a world-class assistant in formatting answers. But you have follow the below rules the refine the answer.
Rules:
1. Make sure the answer is clear and concise, is less then 500 characters.
2. Use the below sentences to reformat the answer.

User Query: ${query}
Answer: ${answers.join("\n")}

Generate JSON output with the following structure:
{
    "reformatted_answer": string
}`;
  return await callClaudeOnce(
    template,
    "You are a world-class assistant in reformatting text."
  );
};

const chatIntent = async (sessionId, userId, message) => {
  const session = await getSession(sessionId);
  const intent = session.intent;
  if (!intent.messages) {
    intent.messages = [];
  }
  intent.messages.push({
    content: message,
    role: "user",
  });
  let agentMessage = new AgentMessage(
    intent.messages,
    intent.steps,
    intent.functions
  );
  let { messages, done, answers } = await agentMessage.processResponse({
    text: message,
  });
  session.intent.messages = messages;
  if (done) {
    //get summary and push to messages
    session.intent = null;
  }
  updateSession(session);
  if (answers.length > 1) {
    const ans = await getSummary(message, answers);
    return ans?.reformatted_answer || getAIText(messages[messages.length - 1]);
  } else {
    return getAIText(messages[messages.length - 1]);
  }
};

export const chat = async (sessionId, userId, message) => {
  const session = await getSession(sessionId);
  console.log(session);
  if (!session.intent) {
    session.messages.push(message);
    if (!session.intents) {
      session.intents = await getIntents(userId);
    }
    let intent = await intentFinder(session.intents, message);
    if (intent) {
      session.intent = intent;
    } else {
      updateSession(session);
      return "Can u pls elaborate?";
    }
  }
  if (session.intent) {
    return chatIntent(sessionId, userId, message);
  }
};
