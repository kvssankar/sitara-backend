import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
} from "@aws-sdk/client-sqs";
import SupportAgent from "./SupportAgent.js";
import {
  addMessageToCase,
  createSupportCaseWithMessage,
  getSupportCase,
  updateSupportCase,
} from "/opt/nodejs/sitara/supportCrud.js";
import { findIntentsByText } from "./utils.js";

const sqsClient = new SQSClient({
  region: process.env.REGION || "us-east-1",
});
const supportAgent = new SupportAgent();

const QUEUE_URL = process.env.QUEUE_URL;
const MAX_MESSAGES = process.env.MAX_MESSAGES;

const receiveMessages = async () => {
  try {
    const command = new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: MAX_MESSAGES,
      WaitTimeSeconds: 0, // Short polling for Lambda
      VisibilityTimeoutSeconds: 300, // 5 minutes to process
      MessageAttributeNames: ["All"],
      AttributeNames: ["All"],
    });

    const response = await sqsClient.send(command);
    return response.Messages || [];
  } catch (error) {
    console.error("Error receiving messages from SQS:", error);
    throw error;
  }
};

const isValidMessage = (messageBody) => {
  return (
    messageBody &&
    typeof messageBody.caseId === "string" &&
    typeof messageBody.text === "string" &&
    messageBody.text.trim().length > 0 &&
    typeof messageBody.senderId === "string" &&
    messageBody.senderId.trim().length > 0 &&
    (messageBody.mediaUrls === undefined ||
      Array.isArray(messageBody.mediaUrls))
  );
};

const processMessages = async (messages) => {
  const results = {
    successful: [],
    failed: [],
    pendingIntents: [],
  };
  const messagesToDelete = [];

  for (const message of messages) {
    try {
      // Always add message to delete list - we'll delete it regardless of processing outcome
      messagesToDelete.push(message);

      let messageBody;
      try {
        messageBody = JSON.parse(message.Body);
      } catch (parseError) {
        console.error("Failed to parse message body:", parseError);
        results.failed.push({
          messageId: message.MessageId,
          error: "Invalid JSON format",
          rawBody: message.Body,
        });
        continue;
      }

      if (!isValidMessage(messageBody)) {
        console.error("Invalid message format:", messageBody);
        results.failed.push({
          messageId: message.MessageId,
          error: "Invalid message format",
          messageBody,
        });
        continue;
      }

      const { caseId, text, mediaUrls, senderId } = messageBody;
      console.log(
        `Processing message for caseId: ${caseId}, senderId: ${senderId}`
      );

      let result;

      const supportCase = await getSupportCase(caseId);

      // Consider a case new if it doesn't have both intentId and pendingIntents
      const isNewCase =
        !supportCase || (!supportCase.intentId && !supportCase.pendingIntents);

      if (isNewCase) {
        result = await processNewTicket(caseId, text, senderId);
      } else {
        await addMessageToCase(
          caseId,
          senderId,
          "customer",
          text,
          "text",
          mediaUrls || []
        );
        await supportAgent.chatWithCustomer(caseId);
        result = {
          statusCode: 200,
          body: JSON.stringify({
            message: "Message added to existing support case",
            caseId,
            intentId: supportCase.intentId,
          }),
        };
      }

      // Determine result type based on response
      const parsedResult = JSON.parse(result.body);
      if (parsedResult.pendingIntents) {
        results.pendingIntents.push({
          messageId: message.MessageId,
          caseId,
          senderId,
          pendingIntents: parsedResult.pendingIntents,
        });
      } else {
        results.successful.push({
          messageId: message.MessageId,
          caseId,
          senderId,
          intentId: parsedResult.intentId,
          intentName: parsedResult.intentName,
        });
      }
    } catch (error) {
      console.error(`Error processing message ${message.MessageId}:`, error);
      results.failed.push({
        messageId: message.MessageId,
        error: error.message,
        stack: error.stack,
      });
      // Message is already in messagesToDelete, so it will still be deleted
    }
  }

  // Always delete all messages, regardless of processing outcome
  await deleteProcessedMessages(messagesToDelete);

  return results;
};

const deleteProcessedMessages = async (messages) => {
  if (!messages || messages.length === 0) {
    console.log("No messages to delete");
    return;
  }

  try {
    if (messages.length === 1) {
      // Single message deletion
      const command = new DeleteMessageCommand({
        QueueUrl: QUEUE_URL,
        ReceiptHandle: messages[0].ReceiptHandle,
      });
      await sqsClient.send(command);
      console.log("Successfully deleted 1 message");
    } else if (messages.length <= 10) {
      // Batch deletion (up to 10 messages)
      const entries = messages.map((message, index) => ({
        Id: index.toString(),
        ReceiptHandle: message.ReceiptHandle,
      }));

      const command = new DeleteMessageBatchCommand({
        QueueUrl: QUEUE_URL,
        Entries: entries,
      });

      const response = await sqsClient.send(command);
      console.log(
        `Successfully deleted ${response.Successful?.length || 0} messages`
      );

      if (response.Failed && response.Failed.length > 0) {
        console.error("Failed to delete some messages:", response.Failed);
        // Log which specific messages failed to delete
        response.Failed.forEach((failedMsg) => {
          console.error(
            `Failed to delete message ID ${failedMsg.Id}: ${failedMsg.Message}`
          );
        });
      }
    } else {
      // Handle more than 10 messages by splitting into batches
      console.log(`Deleting ${messages.length} messages in batches of 10`);
      for (let i = 0; i < messages.length; i += 10) {
        const batch = messages.slice(i, i + 10);
        await deleteProcessedMessages(batch);
      }
    }
  } catch (error) {
    console.error("Error deleting messages:", error);
    // Log details about which messages we failed to delete
    console.error(
      "Failed to delete messages with IDs:",
      messages.map((m) => m.MessageId)
    );
    // Don't throw here - we don't want to fail the entire batch for deletion issues
  }
};

const processNewTicket = async (caseId, text, senderId) => {
  let supportCase = await getSupportCase(caseId);

  // If case exists but already has intentId or pendingIntents, return existing info
  if (supportCase && (supportCase.intentId || supportCase.pendingIntents)) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Support case already exists with intent information",
        caseId,
        intentId: supportCase.intentId,
        pendingIntents: supportCase.pendingIntents,
      }),
    };
  }

  const matchingIntents = await findIntentsByText(text);

  if (matchingIntents.length === 1) {
    const intent = matchingIntents[0];

    // If case doesn't exist, create it; otherwise, we'll update the existing one
    if (!supportCase) {
      supportCase = await createSupportCaseWithMessage(
        senderId,
        `Support Case for Intent: ${intent.intent}`,
        text,
        "medium"
      );
    } else {
      // Add message to existing case
      await addMessageToCase(caseId, senderId, "customer", text, "text", []);
    }

    if (intent.intentid) {
      await supportAgent.processNewTicket(supportCase.caseId, intent.intentid);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message:
          supportCase.caseId === caseId
            ? "Support case updated with intent"
            : "New support case created",
        caseId: supportCase.caseId,
        intentId: intent.intentid,
        intentName: intent.intent,
      }),
    };
  } else {
    // Multiple or no intents found - update case with pending intents
    await updateSupportCase(caseId, {
      pendingIntents: matchingIntents,
    });

    // If case doesn't exist, we might need to create it first
    if (!supportCase) {
      await addMessageToCase(caseId, senderId, "customer", text, "text", []);
    } else {
      // Add message to existing case
      await addMessageToCase(caseId, senderId, "customer", text, "text", []);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Pending intents found",
        caseId,
        pendingIntents: matchingIntents,
      }),
    };
  }
};

export const handler = async (event) => {
  try {
    const messages = await receiveMessages();

    if (!messages || messages.length === 0) {
      console.log("No messages to process");
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "No messages to process",
          processedCount: 0,
        }),
      };
    }

    console.log(`Processing ${messages.length} messages`);

    const results = await processMessages(messages);

    console.log(
      `Processing completed. Successful: ${results.successful.length}, Failed: ${results.failed.length}, Pending: ${results.pendingIntents.length}`
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Messages processed successfully",
        processedCount: messages.length,
        results: {
          successful: results.successful.length,
          failed: results.failed.length,
          pendingIntents: results.pendingIntents.length,
        },
        details: results,
      }),
    };
  } catch (error) {
    console.error("Lambda execution error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message,
        message: "Lambda execution failed",
      }),
    };
  }
};
