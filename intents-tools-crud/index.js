import {
  getIntents,
  getIntent,
  createIntent,
  deleteIntent,
  updateIntent,
  addToolToUser,
  getAllToolsFromUser,
  removeToolFromUser,
  updateToolOfUser,
} from "/opt/nodejs/sitara/intentCrud.js";

import {
  createResponse,
  parseBody,
  getPathParameter,
  handleError,
  handleCorsPrelight,
  matchRoute,
} from "/opt/nodejs/sitara/apiHelpers.js";

export const handler = async (event) => {
  try {
    console.log(event);
    const httpMethod = event.httpMethod;
    const pathParameters = event.pathParameters || {};
    const path = event.path || event.resource;
    const userId = process.env.PROJECT_ID;

    // Handle CORS preflight requests
    if (httpMethod === "OPTIONS") {
      return handleCorsPrelight();
    }

    let body = {};
    if (event.body) {
      body = parseBody(event);
    }

    // Determine if this is an intents or tools request
    const isIntentsRoute = path.includes("/intents");
    const isToolsRoute = path.includes("/tools");

    if (isIntentsRoute) {
      return await handleIntentsRoute(httpMethod, pathParameters, body, userId);
    } else if (isToolsRoute) {
      return await handleToolsRoute(httpMethod, pathParameters, body, userId);
    } else {
      return createResponse(404, { message: "Route not found" });
    }
  } catch (error) {
    return handleError(error, "in main handler");
  }
};

// Handle intents routes
const handleIntentsRoute = async (httpMethod, pathParameters, body, userId) => {
  try {
    switch (httpMethod) {
      case "GET":
        if (pathParameters.intentid) {
          // GET /intents/:intentid
          const intent = await getIntent(pathParameters.intentid, userId);
          return createResponse(200, intent);
        } else {
          // GET /intents
          const intents = await getIntents(userId);
          return createResponse(200, intents);
        }

      case "POST":
        // POST /intents
        await createIntent(body, userId);
        return createResponse(200, { message: "Intent created" });

      case "PUT":
        // PUT /intents/:intentid
        await updateIntent(pathParameters.intentid, body, userId);
        return createResponse(200, { message: "Intent updated" });

      case "DELETE":
        // DELETE /intents/:intentid
        await deleteIntent(pathParameters.intentid);
        return createResponse(200, { message: "Intent deleted" });

      default:
        return createResponse(405, { message: "Method not allowed" });
    }
  } catch (error) {
    const statusCode = httpMethod === "PUT" ? 400 : 401;
    return createResponse(statusCode, { message: error.message });
  }
};

// Handle tools routes
const handleToolsRoute = async (httpMethod, pathParameters, body, userId) => {
  try {
    switch (httpMethod) {
      case "GET":
        // GET /tools
        const tools = await getAllToolsFromUser(userId);
        return createResponse(200, tools);

      case "POST":
        // POST /tools
        const { tool } = body;
        const result = await addToolToUser(userId, tool);
        return createResponse(200, result);

      case "PUT":
        // PUT /tools
        const { name, updatedTool } = body;
        const updateResult = await updateToolOfUser(userId, name, updatedTool);
        return createResponse(200, updateResult);

      case "DELETE":
        // DELETE /tools/:name
        const { name: toolName } = pathParameters;
        const deleteResult = await removeToolFromUser(userId, toolName);
        return createResponse(200, deleteResult);

      default:
        return createResponse(405, { message: "Method not allowed" });
    }
  } catch (error) {
    return handleError(error, "in tools route");
  }
};
