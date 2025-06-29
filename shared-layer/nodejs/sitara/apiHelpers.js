// Helper function to create standardized responses
export const createResponse = (statusCode, data, additionalHeaders = {}) => {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token",
      ...additionalHeaders,
    },
    body: JSON.stringify(data),
  };
};

// Helper function to parse request body safely
export const parseBody = (event) => {
  if (!event.body) return {};

  try {
    return JSON.parse(event.body);
  } catch (error) {
    console.error("Error parsing request body:", error);
    throw new Error("Invalid JSON in request body");
  }
};

// Helper function to extract path parameters
export const getPathParameter = (event, paramName) => {
  return event.pathParameters?.[paramName];
};

// Helper function to extract query parameters
export const getQueryParameter = (event, paramName) => {
  return event.queryStringParameters?.[paramName];
};

// Helper function to handle CORS preflight requests
export const handleCorsPrelight = () => {
  return createResponse(200, { message: "CORS preflight" });
};

// Common error handler
export const handleError = (error, context = "") => {
  console.error(`Error ${context}:`, error);

  // Determine appropriate status code based on error type
  let statusCode = 500;
  if (
    error.message.includes("not found") ||
    error.message.includes("Not found")
  ) {
    statusCode = 404;
  } else if (
    error.message.includes("required") ||
    error.message.includes("Invalid")
  ) {
    statusCode = 400;
  } else if (
    error.message.includes("Unauthorized") ||
    error.message.includes("unauthorized")
  ) {
    statusCode = 401;
  }

  return createResponse(statusCode, { error: error.message });
};

// Validate required fields in request body
export const validateRequiredFields = (body, requiredFields) => {
  const missingFields = requiredFields.filter((field) => !body[field]);

  if (missingFields.length > 0) {
    throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
  }
};


// Route matcher utility
export const matchRoute = (event, pattern, method) => {
  const resource = event.resource || event.path;
  const httpMethod = event.httpMethod;

  return resource === pattern && httpMethod === method;
};
