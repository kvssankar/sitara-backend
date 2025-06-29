import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const lambda = new LambdaClient({ region: process.env.REGION || "us-east-1" });

export async function invokeLambda(lambdaName, operation, params) {
  const payload = {
    body: JSON.stringify({
      operation,
      ...params,
    }),
  };

  const command = new InvokeCommand({
    FunctionName: lambdaName,
    Payload: JSON.stringify(payload),
  });

  const response = await lambda.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.Payload));

  if (result.statusCode !== 200) {
    throw new Error(`Lambda invocation failed: ${result.body}`);
  }

  const parsedBody = JSON.parse(result.body);
  if (!parsedBody.success) {
    throw new Error(parsedBody.error);
  }

  return parsedBody.result;
}
