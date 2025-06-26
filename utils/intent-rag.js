import { Client } from "@opensearch-project/opensearch";
import { BedrockEmbeddings } from "@langchain/aws";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import pkg from "@opensearch-project/opensearch/aws"; // CJS → destructure
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter"; // For splitting text into chunks
import { Document } from "@langchain/core/documents";
import { OpenSearchVectorStore } from "@langchain/community/vectorstores/opensearch"; // Vector Store for OpenSearch
const { AwsSigv4Signer } = pkg;

const embeddings = new BedrockEmbeddings({
  region: "us-east-1",
  model: "amazon.titan-embed-text-v1",
});

const client = new Client({
  nodes: [process.env.OPENSEARCH_URL],
  ...AwsSigv4Signer({
    region: "us-east-1", // AWS region
    service: "aoss", // Serverless service ID
    getCredentials: () => {
      const credentials = defaultProvider()();
      console.log("Using AWS credentials provider");
      return credentials;
    },
  }),
});

// OpenSearch Serverless compatible configuration
const opensearchConfig = {
  client,
  indexName: process.env.OPENSEARCH_INDEX,
  vectorFieldName: "vector_field",
  textField: "text",
  metadataField: "metadata",
};

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
        `Index '${indexName}' created with the appropriate mappings.`,
        createResponse.body
      );
    } else {
      console.log(`Index '${indexName}' already exists. Checking mappings...`);

      // Get current mappings to verify they're correct
      try {
        const mappings = await client.indices.getMapping({ index: indexName });
        console.log(
          `Current mappings for '${indexName}':`,
          JSON.stringify(mappings.body, null, 2)
        );
      } catch (mappingErr) {
        console.log("Could not retrieve mappings:", mappingErr.message);
      }
    }
  } catch (error) {
    console.error(`Error creating index '${indexName}':`, error);
    throw error;
  }
}

export async function deleteDocuments(id) {
  try {
    // Check if index exists before attempting to delete
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

    // First, search for documents with the matching metadata.id
    const searchResponse = await client.search({
      index: process.env.OPENSEARCH_INDEX,
      body: {
        query: {
          bool: {
            must: [{ match: { "metadata.id": id } }],
          },
        },
        size: 100, // Adjust based on expected number of documents
      },
    });

    const documentsToDelete = searchResponse.body.hits.hits;
    console.log(`Found ${documentsToDelete.length} documents to delete`);

    if (documentsToDelete.length === 0) {
      console.log(`No documents found with id '${id}'`);
      return { deleted: 0 };
    }

    // Delete each document individually (OpenSearch Serverless compatible)
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

export async function createDocuments(text, indexName, metainfo) {
  try {
    console.log("Starting document creation process...");
    console.log("Text length:", text.length);
    console.log("Index name:", indexName);
    console.log("Metadata:", metainfo);

    // Ensure index exists with proper mappings
    await createIndexWithMapping(indexName); // Wait a bit for index to be fully ready
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Delete existing documents with the same id (OpenSearch Serverless compatible)
    try {
      console.log("Attempting to delete existing documents...");
      const deleteResult = await deleteDocuments(metainfo.id);
      console.log("Delete operation completed:", deleteResult);
    } catch (deleteErr) {
      console.log("Could not delete existing documents:", deleteErr.message);
      // Continue with creation even if deletion fails
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
    docs.forEach((doc, index) => {
      console.log(
        `Chunk ${index + 1}: ${doc.pageContent.substring(0, 100)}...`
      );
      console.log(`Chunk ${index + 1} metadata:`, doc.metadata);
    });

    console.log("Creating documents using direct OpenSearch client...");

    // Add documents one by one using direct OpenSearch client (serverless compatible)
    const results = [];
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      console.log(`Processing chunk ${i + 1}/${docs.length}`);

      try {
        // Generate embedding
        const embedding = await embeddings.embedQuery(doc.pageContent);

        // Create document
        const document = {
          text: doc.pageContent,
          vector_field: embedding,
          metadata: doc.metadata,
        };

        // Index document
        const response = await client.index({
          index: indexName,
          body: document,
        });

        results.push(response.body);
        console.log(
          `Document ${i + 1} indexed successfully:`,
          response.body._id
        );

        // Small delay between documents to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (docError) {
        console.error(`Error indexing document ${i + 1}:`, docError);
      }
    }

    console.log(
      `Documents creation completed! Created ${results.length} documents.`
    );

    // Check if documents were actually added
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for indexing

    // Try to search for the documents we just added
    try {
      const searchResults = await queryVDB(text.substring(0, 50));
      console.log(
        `Found ${
          searchResults.length
        } documents when searching for: "${text.substring(0, 50)}"`
      );
    } catch (searchErr) {
      console.log("Could not search for documents:", searchErr.message);
    }
    console.log("Documents created successfully!");
    return { success: true, documentsCreated: results.length, results };
  } catch (err) {
    console.error("Error creating documents:", err);
    console.error("Full error details:", JSON.stringify(err, null, 2));
    throw err;
  }
}

export const queryVDB = async (text) => {
  try {
    // Check if index exists before querying
    const { body: indexExists } = await client.indices.exists({
      index: process.env.OPENSEARCH_INDEX,
    });
    if (!indexExists) {
      console.log(`Index '${process.env.OPENSEARCH_INDEX}' does not exist`);
      return [];
    }

    console.log("Querying vector database using direct OpenSearch client...");

    // Generate embedding for the query
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

    // Convert to LangChain Document format for compatibility
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
};

// Alternative method to add documents directly using OpenSearch client
export async function addDocumentDirectly(text, indexName, metainfo) {
  try {
    console.log("Adding document directly to OpenSearch...");

    // Generate embedding for the text
    const embedding = await embeddings.embedQuery(text);
    console.log("Generated embedding with dimension:", embedding.length);

    const document = {
      text: text,
      vector_field: embedding,
      metadata: {
        ...metainfo,
        uploadTime: new Date().toISOString(),
      },
    };
    const response = await client.index({
      index: indexName,
      body: document,
      // Note: AWS OpenSearch Serverless doesn't support refresh parameter
    });

    console.log("Document added directly:", response.body);
    return response.body;
  } catch (error) {
    console.error("Error adding document directly:", error);
    throw error;
  }
}

// Function to search documents directly using OpenSearch client
export async function searchDocumentsDirectly(
  queryText,
  indexName = process.env.OPENSEARCH_INDEX
) {
  try {
    console.log("Searching documents directly...");

    // Generate embedding for the query
    const queryEmbedding = await embeddings.embedQuery(queryText);

    const searchBody = {
      size: 1,
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

// OpenSearch Serverless optimized document creation
export async function createDocumentsServerless(text, indexName, metainfo) {
  try {
    console.log("Starting OpenSearch Serverless document creation...");
    console.log("Text length:", text.length);
    console.log("Index name:", indexName);
    console.log("Metadata:", metainfo);

    // Ensure index exists with proper mappings
    await createIndexWithMapping(indexName);

    // Wait for index to be ready
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Split text into chunks
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

    // Add documents one by one using direct OpenSearch client
    const results = [];
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      console.log(`Processing chunk ${i + 1}/${docs.length}`);

      try {
        // Generate embedding
        const embedding = await embeddings.embedQuery(doc.pageContent);

        // Create document
        const document = {
          text: doc.pageContent,
          vector_field: embedding,
          metadata: doc.metadata,
        };

        // Index document
        const response = await client.index({
          index: indexName,
          body: document,
        });

        results.push(response.body);
        console.log(
          `Document ${i + 1} indexed successfully:`,
          response.body._id
        );

        // Small delay between documents to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (docError) {
        console.error(`Error indexing document ${i + 1}:`, docError);
      }
    }

    // Wait for documents to be available
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log(`Successfully created ${results.length} documents`);
    return results;
  } catch (err) {
    console.error("Error in createDocumentsServerless:", err);
    throw err;
  }
}
