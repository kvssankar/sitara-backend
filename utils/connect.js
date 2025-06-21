import { MongoClient } from "mongodb";

const uri = process.env.MONGO_URI;
const dbName = process.env.MONGO_DB_NAME;
export const intentsCollectionName = "intents";
export const usersCollectionName = "users";
export const sessionsCollectionName = "sessions";
let cachedDb = null;

export async function connectToDatabase() {
  if (cachedDb) {
    console.log("Using cached database connection");
    return cachedDb;
  }
  console.log("Connecting to MongoDB");
  const client = new MongoClient(uri);
  await client.connect();
  cachedDb = client.db(dbName);
  console.log("Connected to MongoDB");
  return cachedDb;
}
