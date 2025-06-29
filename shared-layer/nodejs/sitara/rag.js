// rag-client-direct.js
import { invokeLambda } from "./lambdaHelpers.js";

const RAG_LAMBDA_FUNCTION_NAME = process.env.RAG_LAMBDA_FUNCTION_NAME;

export const ragClient = {
  async createDocuments(text, indexName, metainfo) {
    return invokeLambda(RAG_LAMBDA_FUNCTION_NAME, "createDocuments", {
      text,
      indexName,
      metainfo,
    });
  },

  async deleteDocuments(id) {
    return invokeLambda(RAG_LAMBDA_FUNCTION_NAME, "deleteDocuments", { id });
  },

  async queryVDB(queryText) {
    return invokeLambda(RAG_LAMBDA_FUNCTION_NAME, "queryVDB", { queryText });
  },

  async searchDocuments(query, index) {
    return invokeLambda(RAG_LAMBDA_FUNCTION_NAME, "searchDocuments", {
      query,
      index,
    });
  },
};
