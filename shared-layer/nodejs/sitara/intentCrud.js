import {
  intentsCollectionName,
  connectToDatabase,
  usersCollectionName,
} from "./connect.js";
import { nanoid } from "nanoid";
import { ObjectId } from "mongodb";
import { ragClient } from "./rag.js";


export const createIntent = async (intent, userid) => {
  const db = await connectToDatabase();
  const collection = db.collection(intentsCollectionName);

  //validate intent
  if (!intent.intent || !intent.steps) {
    throw new Error("Intent and steps are required");
  }
  intent.projectid = userid;
  intent.intentid = nanoid(8);
  intent.createdAt = new Date();
  intent.updatedAt = new Date();

  const tools = await getAllToolsFromUser(userid);

  await collection.insertOne(intent);

  // Add intent to OpenSearch for vector search
  try {
    const intentText = `${intent.intent} ${intent.description || ""} ${
      intent.alternate_phrases ? intent.alternate_phrases.join(" ") : ""
    }`.trim();

    ragClient.createDocuments(intentText, process.env.OPENSEARCH_INDEX, {
      id: intent.intentid,
      type: "intent",
      userid: userid,
      ...intent,
    });
    console.log(`Intent ${intent.intentid} added to OpenSearch successfully`);
  } catch (error) {
    console.error(
      `Error adding intent ${intent.intentid} to OpenSearch:`,
      error
    );
    // Don't throw error here to avoid breaking the main flow
  }
};

export const getIntent = async (intentid, userid) => {
  const db = await connectToDatabase();
  const collection = db.collection(intentsCollectionName);

  const tools = await getAllToolsFromUser(userid);

  const intent = await collection.findOne({ intentid });
  if (intent.tools) {
    intent.functions = intent.tools.map((tool) => {
      const toolObj = tools.find((t) => t.name === tool.value);
      return toolObj;
    });
  }

  return intent;
};

export const getIntentWithTools = async (intentid, userid) => {
  const db = await connectToDatabase();
  const collection = db.collection(intentsCollectionName);

  const tools = await getAllToolsFromUser(userid);

  const intent = await collection.findOne({ intentid });

  if (intent.tools) {
    intent.tools = intent.tools.map((tool) => {
      const toolObj = tools.find((t) => t.name === tool.value);
      return toolObj;
    });
  }

  // console.log("Intent found:", JSON.stringify(intent, null, 2));

  return intent;
};

export const getIntents = async (userid) => {
  console.log("Getting intents for user:", userid);
  const db = await connectToDatabase();
  const collection = db.collection(intentsCollectionName);

  const intents = await collection.find({ projectid: userid }).toArray();
  const tools = await getAllToolsFromUser(userid);

  for (let i = 0; i < intents.length; i++) {
    const intent = intents[i];

    if (intent.tools) {
      intent.functions = intent.tools.map((tool) => {
        const toolObj = tools.find((t) => t.name === tool.value);
        return toolObj;
      });
    }
  }

  console.log("Intents:", intents);
  return intents;
};

export const updateIntent = async (intentid, updatedIntent, userid) => {
  const db = await connectToDatabase();
  const collection = db.collection(intentsCollectionName);

  //validate intent
  if (!updatedIntent.intent || !updatedIntent.steps) {
    throw new Error("Intent and steps are required");
  }

  updatedIntent.updatedAt = new Date();

  await collection.updateOne({ intentid }, { $set: updatedIntent });

  // Update intent in OpenSearch
  try {
    // First delete the existing document
    await ragClient.deleteDocuments(intentid);

    // Then add the updated intent
    const intentText = `${updatedIntent.intent} ${
      updatedIntent.description || ""
    } ${
      updatedIntent.alternate_phrases
        ? updatedIntent.alternate_phrases.join(" ")
        : ""
    }`.trim();

    ragClient.createDocuments(intentText, process.env.OPENSEARCH_INDEX, {
      id: intentid,
      type: "intent",
      userid: userid,
      ...updatedIntent,
    });
    console.log(`Intent ${intentid} updated in OpenSearch successfully`);
  } catch (error) {
    console.error(`Error updating intent ${intentid} in OpenSearch:`, error);
    // Don't throw error here to avoid breaking the main flow
  }
};

export const deleteIntent = async (intentid) => {
  const db = await connectToDatabase();
  const collection = db.collection(intentsCollectionName);

  // Use deleteOne for a single document
  const result = await collection.deleteOne({ intentid });

  if (result.deletedCount === 0) {
    throw new Error(`No document found with the given intentid: ${intentid}`);
  }

  // Delete intent from OpenSearch
  try {
    ragClient.deleteDocuments(intentid);
    console.log(`Intent ${intentid} deleted from OpenSearch successfully`);
  } catch (error) {
    console.error(`Error deleting intent ${intentid} from OpenSearch:`, error);
    // Don't throw error here to avoid breaking the main flow
  }

  return result;
};

export const addFileToUser = async (userid, fileName) => {
  const db = await connectToDatabase();
  const collection = db.collection(usersCollectionName);

  const S3_URL = `https://${process.env.DOCS_BUCKET_NAME}.s3.amazonaws.com/${fileName}`;

  // Check if the URL already exists in the user's files array
  const user = await collection.findOne({
    _id: new ObjectId(userid),
    "files.url": S3_URL,
  });
  if (user) {
    return { message: "URL already exists in the user's files array" };
  }

  const result = await collection.updateOne(
    { _id: new ObjectId(userid) },
    {
      $push: {
        files: {
          url: S3_URL,
          fileName,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    }
  );

  if (result.modifiedCount === 0) {
    throw new Error(`No document found with the given userid: ${userid}`);
  }

  return result;
};

export const removeFileFromUser = async (userid, fileName) => {
  const db = await connectToDatabase();
  const collection = db.collection(usersCollectionName);

  const S3_URL = `https://${process.env.DOCS_BUCKET_NAME}.s3.amazonaws.com/${fileName}`;

  const result = await collection.updateOne(
    { _id: new ObjectId(userid) },
    { $pull: { files: { url: S3_URL } } }
  );

  if (result.modifiedCount === 0) {
    throw new Error(`No document found with the given userid: ${userid}`);
  }

  return result;
};

export const getFilesFromUser = async (userid) => {
  const db = await connectToDatabase();
  const collection = db.collection(usersCollectionName);

  const user = await collection.findOne({ _id: new ObjectId(userid) });
  return user.files;
};

export const addToolToUser = async (userid, tool) => {
  const db = await connectToDatabase();
  const collection = db.collection(usersCollectionName);

  // Check if the tool already exists in the user's tools array
  const user = await collection.findOne({
    _id: new ObjectId(userid),
    "tools.name": tool.name,
  });
  if (user) {
    return { message: "Tool already exists in the user's tools array" };
  }

  const result = await collection.updateOne(
    { _id: new ObjectId(userid) },
    {
      $push: {
        tools: {
          name: tool.name,
          code: tool.code,
          params: tool.params,
          description: tool.description,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    }
  );

  if (result.modifiedCount === 0) {
    throw new Error(`No document found with the given userid: ${userid}`);
  }

  return result;
};

export const removeToolFromUser = async (userid, toolName) => {
  const db = await connectToDatabase();
  const collection = db.collection(usersCollectionName);

  const result = await collection.updateOne(
    { _id: new ObjectId(userid) },
    { $pull: { tools: { name: toolName } } }
  );

  if (result.modifiedCount === 0) {
    throw new Error(`No document found with the given userid: ${userid}`);
  }

  return result;
};

export const updateToolOfUser = async (userid, toolName, updatedTool) => {
  const db = await connectToDatabase();
  const collection = db.collection(usersCollectionName);

  console.log("Updating tool for user:", userid);
  console.log("Tool name:", toolName);
  console.log("Updated tool:", updatedTool);

  const result = await collection.updateOne(
    { _id: new ObjectId(userid), "tools.name": toolName },
    { $set: { "tools.$": updatedTool } }
  );

  if (result.modifiedCount === 0) {
    throw new Error(`No document found with the given userid: ${userid}`);
  }

  return result;
};

export const getAllToolsFromUser = async (userid) => {
  console.log("Getting all tools for user:", userid);
  const db = await connectToDatabase();
  const collection = db.collection(usersCollectionName);

  const user = await collection.findOne({ _id: new ObjectId(userid) });
  return user.tools || [];
};
