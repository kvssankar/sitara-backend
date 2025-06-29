// utils/dynamoDB.js

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

const dynamoDbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
});

// Create DynamoDB Document client for easier JSON operations
const docClient = DynamoDBDocumentClient.from(dynamoDbClient);

export { docClient, dynamoDbClient };

// Table names
export const TABLES = {
  SUPPORT_CASES: process.env.SUPPORT_CASES_TABLE || "SupportCases",
  SUPPORT_MESSAGES: process.env.SUPPORT_MESSAGES_TABLE || "SupportMessages",
};

// Utility functions for DynamoDB operations
export const putItem = async (tableName, item) => {
  const command = new PutCommand({
    TableName: tableName,
    Item: item,
  });
  return await docClient.send(command);
};

export const getItem = async (tableName, key) => {
  const command = new GetCommand({
    TableName: tableName,
    Key: key,
  });
  const result = await docClient.send(command);
  return result.Item;
};

export const updateItem = async (
  tableName,
  key,
  updateExpression,
  expressionValues,
  expressionNames = {}
) => {
  const command = new UpdateCommand({
    TableName: tableName,
    Key: key,
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionValues,
    ...(Object.keys(expressionNames).length > 0 && {
      ExpressionAttributeNames: expressionNames,
    }),
    ReturnValues: "ALL_NEW",
  });
  const result = await docClient.send(command);
  return result.Attributes;
};

export const deleteItem = async (tableName, key) => {
  const command = new DeleteCommand({
    TableName: tableName,
    Key: key,
  });
  return await docClient.send(command);
};

export const queryItems = async (
  tableName,
  keyConditionExpression,
  expressionValues,
  options = {}
) => {
  const command = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: keyConditionExpression,
    ExpressionAttributeValues: expressionValues,
    ...options,
  });
  const result = await docClient.send(command);
  return result.Items;
};

export const scanItems = async (
  tableName,
  filterExpression = null,
  expressionValues = {},
  options = {}
) => {
  const command = new ScanCommand({
    TableName: tableName,
    ...(filterExpression && { FilterExpression: filterExpression }),
    ...(Object.keys(expressionValues).length > 0 && {
      ExpressionAttributeValues: expressionValues,
    }),
    ...options,
  });
  const result = await docClient.send(command);
  return result.Items;
};
