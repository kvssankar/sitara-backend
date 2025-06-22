import { Pinecone } from "@pinecone-database/pinecone";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "@langchain/core/documents";
import pdf from "pdf-extraction";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import uniqid from "uniqid";
import { BedrockEmbeddings } from "@langchain/aws";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { addFileToUser, removeFileFromUser } from "./crud.js";

const pc = new Pinecone({
  apiKey: process.env.PINECONE_KEY,
});
const pcIndex = pc.index(process.env.PINECONE_INDEX);

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 100,
});

export const DOCS_BUCKET_NAME = process.env.DOCS_BUCKET_NAME;

const s3Client = new S3Client({
  region: "us-east-1",
});

async function deleteAllRecords(userId, fileName) {
  let paginationToken = null;
  let hasMorePages = true;
  let i = 0;

  try {
    while (hasMorePages) {
      let list = null;
      if (i === 0) {
        list = await pcIndex.listPaginated({
          prefix: `${userId}#${fileName}#`,
        });
        i++;
      } else {
        list = await pcIndex.listPaginated({
          prefix: `${userId}#${fileName}#`,
          paginationToken: paginationToken,
        });
      }

      if (!list || !list.vectors || list.vectors.length === 0) {
        break;
      }

      // Delete all records with source filename in metadata
      console.log(list);
      const vectorIds = list.vectors.map((vector) => vector.id);
      await pcIndex.deleteMany(vectorIds);

      if (list.pagination && list.pagination.next) {
        paginationToken = list.pagination.next;
      } else {
        hasMorePages = false;
      }
    }
    console.log("All records deleted.");
  } catch (error) {
    console.error("Error deleting records:", error);
  }
}

const streamToBuffer = async (stream) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
};

export const createDocumentEmbeddings = async (userId, fileName) => {
  let fileContents;
  try {
    const command = new GetObjectCommand({
      Bucket: DOCS_BUCKET_NAME,
      Key: fileName,
    });
    const response = await s3Client.send(command);

    fileContents = await streamToBuffer(response.Body);
  } catch (error) {
    console.error("Error downloading file from S3:", error);
    return;
  }

  try {
    const data = await pdf(fileContents);
    console.log("Data successfully extracted from PDF file");
    const extractedText = data.text.replace(/^\s*[\r\n]/gm, "");
    console.log("Removed new lines from text");

    await deleteAllRecords(userId, fileName);

    let docs = await splitter.splitDocuments([
      new Document({
        pageContent: extractedText,
        metadata: { source: fileName, userId },
      }),
    ]);

    console.log("Document successfully split");

    docs.forEach((doc) => {
      doc.id = doc.metadata.userId + "#" + fileName + "#" + uniqid();
      doc.metadata = {
        source: `https://${DOCS_BUCKET_NAME}.s3.amazonaws.com/${fileName}`,
        userId: doc.metadata.userId,
        text: doc.pageContent,
      };
    });

    const texts = docs.map((doc) => doc.pageContent);
    const metadata = docs.map((doc) => doc.metadata);
    const ids = docs.map((doc) => doc.id);

    const embedder = new BedrockEmbeddings({
      region: "us-east-1",
      model: "amazon.titan-embed-text-v1",
    });

    const embeddings = await embedder.embedDocuments(texts);

    const records = embeddings.map((embedding, i) => ({
      id: ids[i],
      values: embedding,
      metadata: metadata[i],
    }));

    console.log(`Total records to upsert: ${records.length}`);

    const batchSize = 100;
    const promises = [];

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = [];
      for (let j = i; j < i + batchSize && j < records.length; j++) {
        batch.push(records[j]);
      }
      const upsertPromise = pcIndex.upsert(batch);
      promises.push(upsertPromise);
    }

    await Promise.all(promises);

    console.log("Document successfully stored in Pinecone");
  } catch (e) {
    throw new Error(e);
  }
};

export const getPresignedUrl = async (fileName, fileType) => {
  const params = {
    Bucket: DOCS_BUCKET_NAME,
    Key: fileName,
    ContentType: fileType,
  };
  const command = new PutObjectCommand(params);
  const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  return signedUrl;
};

export const deleteFileFromS3 = async (fileName) => {
  const params = {
    Bucket: DOCS_BUCKET_NAME,
    Key: fileName,
  };
  try {
    await s3Client.send(new DeleteObjectCommand(params));
    console.log("File deleted from S3");
  } catch (error) {
    console.error("Error deleting file from S3:", error);
  }
};

export const uploadFileToKnowledge = async (userId, fileName, fileType) => {
  addFileToUser(userId, fileName);
  createDocumentEmbeddings(userId, fileName);
};

export const removeFileFromKnowledge = async (userId, fileName) => {
  removeFileFromUser(userId, fileName);
  deleteFileFromS3(fileName);
  deleteAllRecords(userId, fileName);
};

export const performRAGSearch = async (query, userId, topK = 5) => {
  try {
    // Create embeddings for the search query
    const embedder = new BedrockEmbeddings({
      region: "us-east-1",
      model: "amazon.titan-embed-text-v1",
    });

    // Generate embedding for the query
    const queryEmbedding = await embedder.embedQuery(query);

    // Search in Pinecone with user-specific filter
    const searchResults = await pcIndex.query({
      vector: queryEmbedding,
      topK,
      includeMetadata: true,
      filter: {
        userId: { $eq: userId },
      },
    });

    // Format results for easier consumption
    const formattedResults = searchResults.matches.map((match) => ({
      score: match.score,
      text: match.metadata.text,
      source: match.metadata.source,
      id: match.id,
    }));

    // Filter out low-relevance results (optional, adjust threshold as needed)
    const relevantResults = formattedResults.filter(
      (result) => result.score > 0.7
    );

    return {
      query,
      results: relevantResults,
      count: relevantResults.length,
      success: true,
    };
  } catch (error) {
    console.error("Error performing RAG search:", error);
    return {
      query,
      results: [],
      count: 0,
      success: false,
      error: error.message,
    };
  }
};
