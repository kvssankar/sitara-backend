// Test script for OpenSearch connection
import { testOpenSearchConnection } from "./utils/intent-rag.js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";

async function main() {
  try {
    console.log("=== OpenSearch Connection Test ===");

    // Test AWS credentials
    console.log("\n1. Testing AWS credentials...");
    const credentialsProvider = defaultProvider();
    const credentials = await credentialsProvider();
    console.log(
      "AWS Access Key ID:",
      credentials.accessKeyId?.substring(0, 10) + "..."
    );
    console.log("AWS Region:", process.env.AWS_REGION || "us-east-1");

    // Test OpenSearch connection
    console.log("\n2. Testing OpenSearch connection...");
    const result = await testOpenSearchConnection();

    if (result.success) {
      console.log("✅ Connection test passed!");
    } else {
      console.log("❌ Connection test failed:", result.error);
    }
  } catch (error) {
    console.error("Test failed:", error);
  }
}

main();
