// utils/supportFiles.js (fixed version)

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
});
const SUPPORT_BUCKET_NAME =
  process.env.SUPPORT_BUCKET_NAME || "support-case-files";

export const getPresignedUploadUrl = async (caseId, fileName, fileType) => {
  const key = `cases/${caseId}/${Date.now()}-${fileName}`;

  const command = new PutObjectCommand({
    Bucket: SUPPORT_BUCKET_NAME,
    Key: key,
    ContentType: fileType,
    // Remove the Expires parameter from here - it's not needed for PutObjectCommand
  });

  // Use expiresIn in the getSignedUrl options instead
  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 300, // 5 minutes in seconds
  });

  return {
    uploadUrl,
    fileKey: key,
    publicUrl: `https://${SUPPORT_BUCKET_NAME}.s3.amazonaws.com/${key}`,
  };
};

export const getPresignedDownloadUrl = async (fileKey) => {
  const command = new GetObjectCommand({
    Bucket: SUPPORT_BUCKET_NAME,
    Key: fileKey,
  });

  const downloadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 3600, // 1 hour in seconds
  });
  return downloadUrl;
};

export const generateFileUrl = (fileKey) => {
  return `https://${SUPPORT_BUCKET_NAME}.s3.amazonaws.com/${fileKey}`;
};

// Helper function to validate file types
export const validateFileType = (fileName, fileType) => {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  const allowedExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".pdf",
    ".txt",
    ".doc",
    ".docx",
  ];

  const fileExtension = fileName
    .toLowerCase()
    .substring(fileName.lastIndexOf("."));

  return (
    allowedTypes.includes(fileType) && allowedExtensions.includes(fileExtension)
  );
};

// Helper function to generate safe file names
export const sanitizeFileName = (fileName) => {
  // Remove any non-alphanumeric characters except dots, dashes, and underscores
  return fileName.replace(/[^a-zA-Z0-9.-_]/g, "_");
};
