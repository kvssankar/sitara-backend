// lambda-handler.js
import { Client } from "@opensearch-project/opensearch";
import { BedrockEmbeddings } from "@langchain/aws";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import pkg from "@opensearch-project/opensearch/aws";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "@langchain/core/documents";

const { AwsSigv4Signer } = pkg;

// Initialize clients outside handler for connection reuse
const embeddings = new BedrockEmbeddings({
  region: process.env.AWS_REGION || "us-east-1",
  model: "amazon.titan-embed-text-v1",
});

const client = new Client({
  nodes: [process.env.OPENSEARCH_URL],
  ...AwsSigv4Signer({
    region: process.env.AWS_REGION || "us-east-1",
    service: "aoss",
    getCredentials: () => {
      const credentials = defaultProvider()();
      console.log("Using AWS credentials provider");
      return credentials;
    },
  }),
});

const opensearchConfig = {
  client,
  indexName: process.env.OPENSEARCH_INDEX,
  vectorFieldName: "vector_field",
  textField: "text",
  metadataField: "metadata",
};

// Your existing functions (same as in your original code)
async function createIndexWithMapping(
  indexName = process.env.OPENSEARCH_INDEX
) {
  try {
    const { body: indexExists } = await client.indices.exists({
      index: indexName,
    });

    if (!indexExists) {
      console.log(`Creating index '${indexName}'...`);
      const createResponse = await client.indices.create({
        index: indexName,
        body: {
          settings: {
            "index.knn": true,
            "index.knn.algo_param.ef_search": 100,
          },
          mappings: {
            properties: {
              vector_field: {
                type: "knn_vector",
                dimension: 1536,
                method: {
                  name: "hnsw",
                  space_type: "cosinesimil",
                  engine: "nmslib",
                },
              },
              text: {
                type: "text",
              },
              metadata: {
                type: "object",
                properties: {
                  id: { type: "keyword" },
                  uploadTime: { type: "date" },
                },
              },
            },
          },
        },
      });
      console.log(
        `Index '${indexName}' created with the appropriate mappings.`
      );
    } else {
      console.log(`Index '${indexName}' already exists.`);
    }
  } catch (error) {
    console.error(`Error creating index '${indexName}':`, error);
    throw error;
  }
}

async function deleteDocuments(id) {
  try {
    const { body: indexExists } = await client.indices.exists({
      index: process.env.OPENSEARCH_INDEX,
    });

    if (!indexExists) {
      console.log(
        `Index '${process.env.OPENSEARCH_INDEX}' does not exist, skipping deletion`
      );
      return { deleted: 0 };
    }

    console.log(`Searching for documents with id '${id}' to delete...`);

    const searchResponse = await client.search({
      index: process.env.OPENSEARCH_INDEX,
      body: {
        query: {
          bool: {
            must: [{ match: { "metadata.id": id } }],
          },
        },
        size: 100,
      },
    });

    const documentsToDelete = searchResponse.body.hits.hits;
    console.log(`Found ${documentsToDelete.length} documents to delete`);

    if (documentsToDelete.length === 0) {
      console.log(`No documents found with id '${id}'`);
      return { deleted: 0 };
    }

    let deletedCount = 0;
    for (const doc of documentsToDelete) {
      try {
        await client.delete({
          index: process.env.OPENSEARCH_INDEX,
          id: doc._id,
        });
        deletedCount++;
        console.log(`Deleted document: ${doc._id}`);
      } catch (deleteErr) {
        console.error(
          `Failed to delete document ${doc._id}:`,
          deleteErr.message
        );
      }
    }

    console.log(
      `Successfully deleted ${deletedCount} documents with id '${id}'`
    );
    return { deleted: deletedCount };
  } catch (err) {
    console.error("Error deleting documents:", err);
    return { deleted: 0, error: err.message };
  }
}

async function createDocuments(text, indexName, metainfo) {
  try {
    console.log("Starting document creation process...");
    console.log("Text length:", text.length);
    console.log("Index name:", indexName);
    console.log("Metadata:", metainfo);

    await createIndexWithMapping(indexName);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      console.log("Attempting to delete existing documents...");
      const deleteResult = await deleteDocuments(metainfo.id);
      console.log("Delete operation completed:", deleteResult);
    } catch (deleteErr) {
      console.log("Could not delete existing documents:", deleteErr.message);
    }

    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 100,
    });

    const docs = await textSplitter.splitDocuments([
      new Document({
        metadata: {
          ...metainfo,
          uploadTime: new Date().toISOString(),
        },
        pageContent: text,
      }),
    ]);

    console.log(`Created ${docs.length} document chunks`);

    const results = [];
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      console.log(`Processing chunk ${i + 1}/${docs.length}`);

      try {
        const embedding = await embeddings.embedQuery(doc.pageContent);

        const document = {
          text: doc.pageContent,
          vector_field: embedding,
          metadata: doc.metadata,
        };

        const response = await client.index({
          index: indexName,
          body: document,
        });

        results.push(response.body);
        console.log(
          `Document ${i + 1} indexed successfully:`,
          response.body._id
        );

        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (docError) {
        console.error(`Error indexing document ${i + 1}:`, docError);
      }
    }

    console.log(
      `Documents creation completed! Created ${results.length} documents.`
    );
    return { success: true, documentsCreated: results.length, results };
  } catch (err) {
    console.error("Error creating documents:", err);
    throw err;
  }
}

async function queryVDB(text) {
  try {
    const { body: indexExists } = await client.indices.exists({
      index: process.env.OPENSEARCH_INDEX,
    });
    if (!indexExists) {
      console.log(`Index '${process.env.OPENSEARCH_INDEX}' does not exist`);
      return [];
    }

    console.log("Querying vector database using direct OpenSearch client...");

    const queryEmbedding = await embeddings.embedQuery(text);

    const searchBody = {
      size: 2,
      query: {
        knn: {
          vector_field: {
            vector: queryEmbedding,
            k: 2,
          },
        },
      },
    };

    const response = await client.search({
      index: process.env.OPENSEARCH_INDEX,
      body: searchBody,
    });

    const hits = response.body.hits.hits;
    console.log(`Found ${hits.length} similar documents`);

    const results = hits.map((hit) => ({
      pageContent: hit._source.text,
      metadata: hit._source.metadata,
      score: hit._score,
    }));

    return results;
  } catch (e) {
    console.error("Error querying vector database:", e);
    return [];
  }
}

async function searchDocuments(
  queryText,
  indexName = process.env.OPENSEARCH_INDEX
) {
  try {
    console.log("Searching documents directly...");

    const queryEmbedding = await embeddings.embedQuery(queryText);

    const searchBody = {
      size: 5,
      query: {
        knn: {
          vector_field: {
            vector: queryEmbedding,
            k: 5,
          },
        },
      },
    };

    const response = await client.search({
      index: indexName,
      body: searchBody,
    });

    console.log("Direct search results:", response.body.hits.total);
    return response.body.hits.hits;
  } catch (error) {
    console.error("Error searching documents directly:", error);
    return [];
  }
}

// Lambda handler function
export const handler = async (event) => {
  console.log("Lambda event received:", JSON.stringify(event, null, 2));

  try {
    // Parse the event body
    let body;
    if (typeof event.body === "string") {
      body = JSON.parse(event.body);
    } else {
      body = event.body || event;
    }

    const { operation, ...params } = body;

    console.log("Operation:", operation);
    console.log("Parameters:", params);

    let result;

    switch (operation) {
      case "createDocuments":
        const { text, indexName, metainfo } = params;
        if (!text || !indexName || !metainfo) {
          throw new Error(
            "Missing required parameters: text, indexName, metainfo"
          );
        }
        result = await createDocuments(text, indexName, metainfo);
        break;

      case "deleteDocuments":
        const { id } = params;
        if (!id) {
          throw new Error("Missing required parameter: id");
        }
        result = await deleteDocuments(id);
        break;

      case "queryVDB":
        const { queryText } = params;
        if (!queryText) {
          throw new Error("Missing required parameter: queryText");
        }
        result = await queryVDB(queryText);
        break;

      case "searchDocuments":
        const { query, index } = params;
        if (!query) {
          throw new Error("Missing required parameter: query");
        }
        result = await searchDocuments(query, index);
        break;

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify({
        success: true,
        result: result,
      }),
    };
  } catch (error) {
    console.error("Lambda execution error:", error);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
      }),
    };
  }
};
