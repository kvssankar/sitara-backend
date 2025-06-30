import SupportAgent from "./SupportAgent.js";
import {
  addMessageToCase,
  createSupportCaseWithMessage,
  getSupportCase,
  updateSupportCase,
} from "/opt/nodejs/sitara/supportCrud.js";
import { findIntentsByText } from "./utils.js";


const supportAgent = new SupportAgent();


const isValidMessage = (messageBody) => {
  console.log(`[isValidMessage] Validating message body:`, JSON.stringify(messageBody, null, 2));
  
  if (!messageBody) {
    console.log(`[isValidMessage] Validation failed: messageBody is null/undefined`);
    return false;
  }
  
  if (typeof messageBody.caseId !== "string") {
    console.log(`[isValidMessage] Validation failed: caseId is not a string. Type: ${typeof messageBody.caseId}, Value: ${messageBody.caseId}`);
    return false;
  }
  
  if (typeof messageBody.text !== "string") {
    console.log(`[isValidMessage] Validation failed: text is not a string. Type: ${typeof messageBody.text}, Value: ${messageBody.text}`);
    return false;
  }
  
  if (messageBody.text.trim().length === 0) {
    console.log(`[isValidMessage] Validation failed: text is empty after trimming`);
    return false;
  }
  
  if (typeof messageBody.senderId !== "string") {
    console.log(`[isValidMessage] Validation failed: senderId is not a string. Type: ${typeof messageBody.senderId}, Value: ${messageBody.senderId}`);
    return false;
  }
  
  if (messageBody.senderId.trim().length === 0) {
    console.log(`[isValidMessage] Validation failed: senderId is empty after trimming`);
    return false;
  }
  
  if (messageBody.mediaUrls !== undefined && !Array.isArray(messageBody.mediaUrls)) {
    console.log(`[isValidMessage] Validation failed: mediaUrls is not an array. Type: ${typeof messageBody.mediaUrls}, Value: ${messageBody.mediaUrls}`);
    return false;
  }
  
  console.log(`[isValidMessage] Validation passed successfully`);
  return true;
};

const processMessage = async (sqsRecord) => {
  console.log(`[processMessage] Starting to process message: ${sqsRecord.messageId}`);
  console.log(`[processMessage] Raw SQS record:`, JSON.stringify(sqsRecord, null, 2));
  
  try {
    let messageBody;
    try {
      console.log(`[processMessage] Parsing message body for messageId: ${sqsRecord.messageId}`);
      messageBody = JSON.parse(sqsRecord.body);
      console.log(`[processMessage] Parsed message body:`, JSON.stringify(messageBody, null, 2));
    } catch (parseError) {
      console.error(`[processMessage] Failed to parse message body for messageId ${sqsRecord.messageId}:`, parseError);
      throw new Error("Invalid JSON format");
    }

    console.log(`[processMessage] Validating message format for messageId: ${sqsRecord.messageId}`);
    if (!isValidMessage(messageBody)) {
      console.error(`[processMessage] Invalid message format for messageId ${sqsRecord.messageId}:`, JSON.stringify(messageBody, null, 2));
      console.error(`[processMessage] Validation failed - missing required fields or incorrect types`);
      throw new Error("Invalid message format");
    }
    console.log(`[processMessage] Message validation passed for messageId: ${sqsRecord.messageId}`);

    const { caseId, text, mediaUrls, senderId } = messageBody;
    console.log(`[processMessage] Extracted data - caseId: ${caseId}, senderId: ${senderId}, text length: ${text?.length}, mediaUrls: ${mediaUrls ? mediaUrls.length : 'none'}`);
    console.log(`[processMessage] Processing message for caseId: ${caseId}, senderId: ${senderId}`);

    console.log(`[processMessage] Fetching support case for caseId: ${caseId}`);
    const supportCase = await getSupportCase(caseId);
    console.log(`[processMessage] Support case fetched:`, supportCase ? JSON.stringify(supportCase, null, 2) : 'null');

    // Consider a case new if it doesn't have both intentId and pendingIntents
    const isNewCase =
      !supportCase || (!supportCase.intentId && !supportCase.pendingIntents);
    console.log(`[processMessage] Case classification - isNewCase: ${isNewCase}, hasIntentId: ${!!supportCase?.intentId}, hasPendingIntents: ${!!supportCase?.pendingIntents}`);

    let result;
    if (isNewCase) {
      console.log(`[processMessage] Processing as new ticket for caseId: ${caseId}`);
      result = await processNewTicket(caseId, text, senderId);
      console.log(`[processMessage] New ticket processing result:`, JSON.stringify(result, null, 2));
    } else {
      console.log(`[processMessage] Processing as existing case for caseId: ${caseId}`);
      //already added by frontend
      // await addMessageToCase(
      //   caseId,
      //   senderId,
      //   "customer",
      //   text,
      //   "text",
      //   mediaUrls || []
      // );
      console.log(`[processMessage] Calling supportAgent.chatWithCustomer for caseId: ${caseId}`);
      await supportAgent.chatWithCustomer(caseId);
      console.log(`[processMessage] supportAgent.chatWithCustomer completed for caseId: ${caseId}`);
      result = {
        statusCode: 200,
        body: JSON.stringify({
          message: "Message added to existing support case",
          caseId,
          intentId: supportCase.intentId,
        }),
      };
      console.log(`[processMessage] Existing case processing result:`, JSON.stringify(result, null, 2));
    }

    console.log(`[processMessage] Message processing completed successfully for messageId: ${sqsRecord.messageId}`);
    return {
      messageId: sqsRecord.messageId,
      status: 'success',
      result: JSON.parse(result.body)
    };

  } catch (error) {
    console.error(`[processMessage] Error processing message ${sqsRecord.messageId}:`, error);
    console.error(`[processMessage] Error stack for ${sqsRecord.messageId}:`, error.stack);
    return {
      messageId: sqsRecord.messageId,
      status: 'failed',
      error: error.message,
      stack: error.stack
    };
  }
};

const processNewTicket = async (caseId, text, senderId) => {
  console.log(`[processNewTicket] Starting processing for caseId: ${caseId}, senderId: ${senderId}, text length: ${text?.length}`);
  
  console.log(`[processNewTicket] Fetching existing support case for caseId: ${caseId}`);
  let supportCase = await getSupportCase(caseId);
  console.log(`[processNewTicket] Existing support case:`, supportCase ? JSON.stringify(supportCase, null, 2) : 'null');

  // If case exists but already has intentId or pendingIntents, return existing info
  if (supportCase && (supportCase.intentId || supportCase.pendingIntents)) {
    console.log(`[processNewTicket] Case ${caseId} already has intent information - intentId: ${supportCase.intentId}, pendingIntents: ${!!supportCase.pendingIntents}`);
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

  console.log(`[processNewTicket] Finding intents for text: "${text}"`);
  let matchingIntents = await findIntentsByText(text);
  console.log(`[processNewTicket] Found ${matchingIntents.length} matching intents:`, JSON.stringify(matchingIntents, null, 2));

  if (matchingIntents.length === 1) {
    console.log(`[processNewTicket] Single intent found - processing...`);
    const intent = matchingIntents[0];
    console.log(`[processNewTicket] Intent details:`, JSON.stringify(intent, null, 2));

    // If case doesn't exist, create it; otherwise, we'll update the existing one
    if (!supportCase) {
      console.log(`[processNewTicket] Creating new support case for caseId: ${caseId}`);
      supportCase = await createSupportCaseWithMessage(
        senderId,
        `Support Case for Intent: ${intent.intent}`,
        text,
        "medium"
      );
      console.log(`[processNewTicket] New support case created:`, JSON.stringify(supportCase, null, 2));
    } else {
      console.log(`[processNewTicket] Using existing support case for caseId: ${caseId}`);
      // //already added by frontend
      // await addMessageToCase(caseId, senderId, "customer", text, "text", []);
    }

    if (intent.intentid) {
      console.log(`[processNewTicket] Processing new ticket with supportAgent for caseId: ${supportCase.caseId}, intentId: ${intent.intentid}`);
      await supportAgent.processNewTicket(supportCase.caseId, intent.intentid);
      console.log(`[processNewTicket] supportAgent.processNewTicket completed`);
    } else {
      console.log(`[processNewTicket] Warning: Intent found but no intentid present:`, JSON.stringify(intent, null, 2));
    }

    console.log(`[processNewTicket] Single intent processing completed successfully`);
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
    console.log(`[processNewTicket] Multiple or no intents found (${matchingIntents.length} intents) - setting pending intents`);
    // Multiple or no intents found - update case with pending intents
    console.log(`[processNewTicket] Updating support case ${caseId} with pending intents`);
    matchingIntents = matchingIntents.map((intent) => ({
      intendid: intent.intentid,
      intent: intent.intent,
      description: intent.description,
      confidenceScore: intent.confidenceScore || 0,
      reasoning: intent.reasoning || "",
    }));
    await updateSupportCase(caseId, {
      pendingIntents: matchingIntents,
    });
    console.log(`[processNewTicket] Support case updated with pending intents`);

    // If case doesn't exist, we might need to create it first
    if (!supportCase) {
      console.log(`[processNewTicket] Adding message to non-existing case ${caseId}`);
      await addMessageToCase(caseId, senderId, "customer", text, "text", []);
      console.log(`[processNewTicket] Message added to case ${caseId}`);
    } else {
      console.log(`[processNewTicket] Adding message to existing case ${caseId}`);
      // Add message to existing case
      await addMessageToCase(caseId, senderId, "customer", text, "text", []);
      console.log(`[processNewTicket] Message added to existing case ${caseId}`);
    }

    console.log(`[processNewTicket] Pending intents processing completed successfully`);
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
  console.log(`[handler] === LAMBDA EXECUTION START ===`);
  console.log(`[handler] Received batch with ${event.Records.length} messages`);
  console.log(`[handler] Full event object:`, JSON.stringify(event, null, 2));
  
  const results = {
    successful: [],
    failed: [],
    pendingIntents: [],
  };

  // Process all messages in the batch
  console.log(`[handler] Starting parallel processing of ${event.Records.length} messages`);
  const processingPromises = event.Records.map(async (record, index) => {
    console.log(`[handler] Processing record ${index + 1}/${event.Records.length} with messageId: ${record.messageId}`);
    const result = await processMessage(record);
    console.log(`[handler] Completed processing record ${index + 1}/${event.Records.length} with status: ${result.status}`);
    
    if (result.status === 'success') {
      if (result.result.pendingIntents) {
        console.log(`[handler] Adding to pendingIntents for messageId: ${result.messageId}`);
        results.pendingIntents.push({
          messageId: result.messageId,
          caseId: result.result.caseId,
          pendingIntents: result.result.pendingIntents,
        });
      } else {
        console.log(`[handler] Adding to successful for messageId: ${result.messageId}`);
        results.successful.push({
          messageId: result.messageId,
          caseId: result.result.caseId,
          intentId: result.result.intentId,
          intentName: result.result.intentName,
        });
      }
    } else {
      console.log(`[handler] Adding to failed for messageId: ${result.messageId}, error: ${result.error}`);
      results.failed.push(result);
    }
    
    return result;
  });

  console.log(`[handler] Waiting for all ${processingPromises.length} processing promises to complete`);
  await Promise.all(processingPromises);
  console.log(`[handler] All processing promises completed`);

  console.log(`[handler] Processing completed. Successful: ${results.successful.length}, Failed: ${results.failed.length}, Pending: ${results.pendingIntents.length}`);
  console.log(`[handler] Detailed results:`, JSON.stringify(results, null, 2));

  // If there are any failures, throw an error to trigger partial batch failure
  if (results.failed.length > 0) {
    console.error(`[handler] Some messages failed processing:`, JSON.stringify(results.failed, null, 2));
    
    // For partial batch failure, you can either:
    // 1. Throw an error (this will retry ALL messages)
    // 2. Return the failed message IDs (requires reportBatchItemFailures: true)
    
    // Option 2: Return failed message IDs for partial batch failure
    const batchItemFailures = results.failed.map(failure => ({
      itemIdentifier: failure.messageId
    }));
    console.log(`[handler] Returning batch item failures:`, JSON.stringify(batchItemFailures, null, 2));
    
    return {
      batchItemFailures: batchItemFailures
    };
  }

  console.log(`[handler] All messages processed successfully`);
  const finalResult = {
    statusCode: 200,
    body: JSON.stringify({
      message: "Messages processed successfully",
      processedCount: event.Records.length,
      results: {
        successful: results.successful.length,
        failed: results.failed.length,
        pendingIntents: results.pendingIntents.length,
      },
      details: results,
    }),
  };
  
  console.log(`[handler] Final result:`, JSON.stringify(finalResult, null, 2));
  console.log(`[handler] === LAMBDA EXECUTION END ===`);
  
  return finalResult;
};