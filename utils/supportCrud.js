// utils/supportCrud.js (fixed version)

import { nanoid } from "nanoid";
import {
  putItem,
  getItem,
  updateItem,
  deleteItem,
  queryItems,
  scanItems,
  TABLES,
} from "./dynamoDB.js";

// Support Case CRUD Operations
export const createSupportCase = async (
  customerId,
  title,
  description,
  priority = "medium"
) => {
  const caseId = nanoid();
  const timestamp = new Date().toISOString();
  const status = "open"; // Define status here

  const supportCase = {
    caseId, // Primary Key
    customerId,
    title,
    description,
    status, // Now properly defined
    priority, // low, medium, high, urgent
    category: null,
    assignedAgent: null,
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    resolvedAt: null,
    closedAt: null,
    metadata: {},
    // GSI keys for querying
    gsi1pk: `CUSTOMER#${customerId}`, // For querying by customer
    gsi1sk: `CASE#${timestamp}`, // Sort by creation time
    gsi2pk: `STATUS#${status}`, // For querying by status - now uses defined status
    gsi2sk: `PRIORITY#${priority}#${timestamp}`, // Sort by priority and time
  };

  await putItem(TABLES.SUPPORT_CASES, supportCase);
  return supportCase;
};

export const getSupportCase = async (caseId) => {
  const supportCase = await getItem(TABLES.SUPPORT_CASES, { caseId });

  if (!supportCase) {
    throw new Error(`Support case not found: ${caseId}`);
  }

  return supportCase;
};

export const updateSupportCase = async (caseId, updates) => {
  const timestamp = new Date().toISOString();

  // Build update expression dynamically
  let updateExpression = "SET updatedAt = :updatedAt";
  const expressionValues = {
    ":updatedAt": timestamp,
  };

  // Add other updates
  Object.keys(updates).forEach((key, index) => {
    const valueKey = `:val${index}`;
    updateExpression += `, ${key} = ${valueKey}`;
    expressionValues[valueKey] = updates[key];
  });

  // Handle status-specific timestamps
  if (updates.status === "resolved" && !updates.resolvedAt) {
    updateExpression += ", resolvedAt = :resolvedAt";
    expressionValues[":resolvedAt"] = timestamp;
  }
  if (updates.status === "closed" && !updates.closedAt) {
    updateExpression += ", closedAt = :closedAt";
    expressionValues[":closedAt"] = timestamp;
  }

  // Update GSI keys if status or priority changed
  if (updates.status) {
    updateExpression += ", gsi2pk = :gsi2pk";
    expressionValues[":gsi2pk"] = `STATUS#${updates.status}`;
  }

  const updatedCase = await updateItem(
    TABLES.SUPPORT_CASES,
    { caseId },
    updateExpression,
    expressionValues
  );

  return updatedCase;
};

export const getSupportCases = async (filters = {}) => {
  let items = [];

  if (filters.customerId) {
    // Query by customer using GSI1
    items = await queryItems(
      TABLES.SUPPORT_CASES,
      "gsi1pk = :gsi1pk",
      { ":gsi1pk": `CUSTOMER#${filters.customerId}` },
      {
        IndexName: "GSI1", // Customer index
        ScanIndexForward: false, // Newest first
        Limit: filters.limit || 50,
      }
    );
  } else if (filters.status) {
    // Query by status using GSI2
    items = await queryItems(
      TABLES.SUPPORT_CASES,
      "gsi2pk = :gsi2pk",
      { ":gsi2pk": `STATUS#${filters.status}` },
      {
        IndexName: "GSI2", // Status index
        ScanIndexForward: false,
        Limit: filters.limit || 50,
      }
    );
  } else {
    // Scan all cases with filters
    let filterExpression = null;
    const expressionValues = {};

    if (filters.assignedAgent) {
      filterExpression = "assignedAgent = :assignedAgent";
      expressionValues[":assignedAgent"] = filters.assignedAgent;
    }
    if (filters.priority) {
      filterExpression = filterExpression
        ? `${filterExpression} AND priority = :priority`
        : "priority = :priority";
      expressionValues[":priority"] = filters.priority;
    }

    items = await scanItems(
      TABLES.SUPPORT_CASES,
      filterExpression,
      expressionValues,
      { Limit: filters.limit || 50 }
    );
  }

  return items;
};

export const deleteSupportCase = async (caseId) => {
  // Check if case exists first
  const existingCase = await getItem(TABLES.SUPPORT_CASES, { caseId });
  if (!existingCase) {
    throw new Error(`No support case found with caseId: ${caseId}`);
  }

  await deleteItem(TABLES.SUPPORT_CASES, { caseId });
  return { success: true };
};

// Support Message CRUD Operations
export const addMessageToCase = async (
  caseId,
  senderId,
  senderType,
  content,
  messageType = "text",
  mediaUrls = []
) => {
  // Verify case exists
  const supportCase = await getItem(TABLES.SUPPORT_CASES, { caseId });
  if (!supportCase) {
    throw new Error(`Support case not found: ${caseId}`);
  }

  const messageId = nanoid();
  const timestamp = new Date().toISOString();

  const message = {
    messageId, // Primary Key
    caseId, // GSI key for querying messages by case
    senderId,
    senderType, // "customer", "agent", "ai"
    content,
    messageType, // "text", "voice", "image", "file"
    mediaUrls,
    isInternal: false,
    createdAt: timestamp,
    metadata: {},
    // GSI keys
    gsi1pk: `CASE#${caseId}`, // For querying by case
    gsi1sk: `MESSAGE#${timestamp}`, // Sort by time
  };

  // Add message
  await putItem(TABLES.SUPPORT_MESSAGES, message);

  // Update case's updatedAt timestamp
  await updateItem(
    TABLES.SUPPORT_CASES,
    { caseId },
    "SET updatedAt = :updatedAt",
    { ":updatedAt": timestamp }
  );

  return message;
};

export const getCaseMessages = async (caseId, limit = 100) => {
  const messages = await queryItems(
    TABLES.SUPPORT_MESSAGES,
    "gsi1pk = :gsi1pk",
    { ":gsi1pk": `CASE#${caseId}` },
    {
      IndexName: "GSI1", // Case messages index
      ScanIndexForward: true, // Oldest first
      Limit: limit,
    }
  );

  return messages || [];
};

export const addInternalNote = async (caseId, agentId, content) => {
  const messageId = nanoid();
  const timestamp = new Date().toISOString();

  const note = {
    messageId,
    caseId,
    senderId: agentId,
    senderType: "agent",
    content,
    messageType: "text",
    mediaUrls: [],
    isInternal: true, // Internal agent note
    createdAt: timestamp,
    metadata: {},
    gsi1pk: `CASE#${caseId}`,
    gsi1sk: `MESSAGE#${timestamp}`,
  };

  await putItem(TABLES.SUPPORT_MESSAGES, note);
  return note;
};

export const updateMessage = async (messageId, updates) => {
  const timestamp = new Date().toISOString();

  let updateExpression = "SET updatedAt = :updatedAt";
  const expressionValues = {
    ":updatedAt": timestamp,
  };

  Object.keys(updates).forEach((key, index) => {
    const valueKey = `:val${index}`;
    updateExpression += `, ${key} = ${valueKey}`;
    expressionValues[valueKey] = updates[key];
  });

  const updatedMessage = await updateItem(
    TABLES.SUPPORT_MESSAGES,
    { messageId },
    updateExpression,
    expressionValues
  );

  return updatedMessage;
};
