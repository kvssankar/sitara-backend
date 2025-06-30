// lambda/support-handler.js

import {
  getSupportCase,
  updateSupportCase,
  getSupportCases,
  deleteSupportCase,
  getCaseMessages,
  addMessageToCase,
  createSupportCase,
} from "/opt/nodejs/sitara/supportCrud.js";
import { getPresignedUploadUrl } from "./supportFiles.js";

import {
  createResponse,
  parseBody,
  getPathParameter,
  getQueryParameter,
  handleError,
  validateRequiredFields,
  handleCorsPrelight,
  matchRoute,
} from "/opt/nodejs/sitara/apiHelpers.js";
import { generateCaseSummary } from "./utils.js";

export const handler = async (event, context) => {
  console.log("Event:", JSON.stringify(event, null, 2));

  try {
    const httpMethod = event.httpMethod;
    const resource = event.resource;
    const body = parseBody(event);

    // Handle CORS preflight requests
    if (httpMethod === "OPTIONS") {
      return handleCorsPrelight();
    }

    // Route handling using the common matchRoute utility
    const routes = [
      {
        pattern: "/support/cases/{caseId}",
        method: "GET",
        handler: () => handleGetCase(event),
      },
      {
        pattern: "/support/cases/{caseId}",
        method: "PUT",
        handler: () => handleUpdateCase(event, body),
      },
      {
        pattern: "/support/cases",
        method: "GET",
        handler: () => handleGetCases(event),
      },
      {
        pattern: "/support/cases",
        method: "POST",
        handler: () => handleCreateCase(event),
      },
      {
        pattern: "/support/cases/{caseId}",
        method: "DELETE",
        handler: () => handleDeleteCase(event),
      },
      {
        pattern: "/support/cases/{caseId}/messages",
        method: "GET",
        handler: () => handleGetMessages(event),
      },
      {
        pattern: "/support/cases/{caseId}/messages",
        method: "POST",
        handler: () => handleCreateMessage(event),
      },
      {
        pattern: "/support/cases/{caseId}/upload-url",
        method: "POST",
        handler: () => handleGetUploadUrl(event, body),
      },
    ];

    const matchedRoute = routes.find((route) =>
      matchRoute(event, route.pattern, route.method)
    );

    if (matchedRoute) {
      return await matchedRoute.handler();
    }

    return createResponse(404, { error: "Route not found" });
  } catch (error) {
    return handleError(error, "in support handler");
  }
};

const handleGetCase = async (event) => {
  try {
    const caseId = getPathParameter(event, "caseId");
    const supportCase = await getSupportCase(caseId);
    return createResponse(200, supportCase);
  } catch (error) {
    return handleError(error, "fetching support case");
  }
};

const handleCreateCase = async (event) => {
  try {
    const body = parseBody(event);
    const { customerId, title, description, priority, intentId } = body;
    if (!customerId || !title || !description) {
      return createResponse(400, { error: "Missing required fields" });
    }
    const supportCase = await createSupportCase(
      customerId,
      title,
      description,
      priority
    );
    return createResponse(201, supportCase);
  } catch (error) {
    return handleError(error, "creating support case");
  }
};

const handleUpdateCase = async (event, body) => {
  try {
    const caseId = getPathParameter(event, "caseId");
    const supportCase = await updateSupportCase(caseId, body);
    if (body.resolved === true || body.resolved === false) {
      await generateCaseSummary(caseId);
    }
    return createResponse(200, supportCase);
  } catch (error) {
    return handleError(error, "updating support case");
  }
};

const handleGetCases = async (event) => {
  try {
    const filters = {
      customerId: getQueryParameter(event, "customerId"),
      status: getQueryParameter(event, "status"),
      assignedAgent: getQueryParameter(event, "assignedAgent"),
      priority: getQueryParameter(event, "priority"),
      limit: parseInt(getQueryParameter(event, "limit")) || 50,
    };

    const cases = await getSupportCases(filters);
    return createResponse(200, cases);
  } catch (error) {
    return handleError(error, "fetching support cases");
  }
};

const handleDeleteCase = async (event) => {
  try {
    const caseId = getPathParameter(event, "caseId");
    await deleteSupportCase(caseId);
    return createResponse(200, {
      message: "Support case deleted successfully",
    });
  } catch (error) {
    return handleError(error, "deleting support case");
  }
};

const handleGetMessages = async (event) => {
  try {
    const caseId = getPathParameter(event, "caseId");
    const limit = parseInt(getQueryParameter(event, "limit")) || 100;

    const messages = await getCaseMessages(caseId, limit);
    return createResponse(200, messages);
  } catch (error) {
    return handleError(error, "fetching messages");
  }
};

const handleCreateMessage = async (event) => {
  try {
    const caseId = getPathParameter(event, "caseId");
    const body = parseBody(event);
    const { senderId, content, messageType, mediaUrls } = body;
    if (!senderId || !content) {
      return createResponse(400, {
        error: "Missing required fields: senderId and content are required",
      });
    }
    const message = await addMessageToCase(
      caseId,
      senderId,
      "customer",
      content,
      messageType || "text",
      mediaUrls || []
    );
    return createResponse(201, message);
  } catch (error) {
    return handleError(error, "adding message to case");
  }
};

const handleGetUploadUrl = async (event, body) => {
  try {
    const caseId = getPathParameter(event, "caseId");
    validateRequiredFields(body, ["fileName", "fileType"]);

    const { fileName, fileType } = body;
    const uploadInfo = await getPresignedUploadUrl(caseId, fileName, fileType);
    return createResponse(200, uploadInfo);
  } catch (error) {
    return handleError(error, "generating upload URL");
  }
};
