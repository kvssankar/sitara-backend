import {
  intentsCollectionName,
  connectToDatabase,
  usersCollectionName,
} from "./connect.js";
import { nanoid } from "nanoid";
import { DOCS_BUCKET_NAME } from "./rag.js";
import { ObjectId } from "mongodb";

//intent schema

// projectid
// intentid
// "rJ2Wnn3sH"
// steps
// intent
// "My internet is not working"
// description
// "Help when internet connection is not working"

// alternate_phrases
// Array (2)

// createdAt
// 2024-07-06T17:10:33.396+00:00
// updatedAt
// 2024-07-07T19:16:54.440+00:00

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
};

export const deleteIntent = async (intentid) => {
  const db = await connectToDatabase();
  const collection = db.collection(intentsCollectionName);

  // Use deleteOne for a single document
  const result = await collection.deleteOne({ intentid });

  if (result.deletedCount === 0) {
    throw new Error(`No document found with the given intentid: ${intentid}`);
  }

  return result;
};

export const addFileToUser = async (userid, fileName) => {
  const db = await connectToDatabase();
  const collection = db.collection(usersCollectionName);

  const S3_URL = `https://${DOCS_BUCKET_NAME}.s3.amazonaws.com/${fileName}`;

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

  const S3_URL = `https://${DOCS_BUCKET_NAME}.s3.amazonaws.com/${fileName}`;

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
