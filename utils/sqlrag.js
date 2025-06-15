import { SqlDatabase } from "langchain/sql_db";
import { DataSource } from "typeorm";
import { QuerySqlTool } from "langchain/tools/sql";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

export function hasCurlyBracesWithText(inputString) {
  const regex = /\{[^{}]*}/;
  return regex.test(inputString);
}

export function extractTextWithinCurlyBraces(inputString) {
  const regex = /\{[^{}]*\}/;
  const match = inputString.match(regex);
  return match ? match[0] : null;
}

const client = new AnthropicBedrock({
  awsAccessKey: "AKIA5BCKCG47CW3TQBT4",
  awsSecretKey: "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",
});

const datasource = new DataSource({
  type: "mysql",
  database: "ECommerceDB",
  username: "root",
  password: "sankar",
  port: 3306,
  host: "localhost",
});

const db = await SqlDatabase.fromDataSourceParams({
  appDataSource: datasource,
});

console.log(db.getTableInfo());

let prompt = `Given an input question, create a syntactically correct {dialect} query to run to help find the answer. Unless the user specifies in his question a specific number of examples they wish to obtain, always limit your query to at most {top_k} results. You can order the results by a relevant column to return the most interesting examples in the database.

Never query for all the columns from a specific table, only ask for a the few relevant columns given the question.

Pay attention to use only the column names that you can see in the schema description. Be careful to not query for columns that do not exist. Also, pay attention to which column is in which table.

Only use the following tables:
{table_info}

Question: {input}


Generate JSON output with the following structure:
{
    "query": string //Syntactically valid SQL query
}
`;

const executeQuery = async (query) => {
  const executeQueryTool = new QuerySqlTool(db);
  return { result: await executeQueryTool.invoke(query) };
};

const callClaudeOnce = async (text, systemPrompt) => {
  const messages = [
    {
      role: "user",
      content: text,
    },
  ];
  try {
    const result = await client.messages.create({
      model: "anthropic.claude-3-5-sonnet-20240620-v1:0",
      temperature: 0.2,
      max_tokens: 1024,
      messages: messages,
      // tools: this.tools,
      system: systemPrompt,
    });
    console.log("result", result);
    const ans = result?.content[0].text || "";
    if (hasCurlyBracesWithText(ans)) {
      const cap = JSON.parse(extractTextWithinCurlyBraces(ans));
      return cap;
    } else {
      throw new Error("No utterances found");
    }
  } catch (err) {
    throw new Error(`Something went wrong - ${err.message}`);
  }
};

async function main() {
  const table_info = await db.getTableInfo();
  prompt = prompt.replace("{dialect}", db.appDataSourceOptions.type);
  prompt = prompt.replace("{top_k}", "5");
  prompt = prompt.replace("{table_info}", table_info);
  console.log(prompt);
  const query = await callClaudeOnce("whats the cost of the a laptop", prompt);
  console.log(query);
  const result = await executeQuery(query.query);
  console.log(result);
}

main();
