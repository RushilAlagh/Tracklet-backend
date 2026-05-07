const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

const isLambda = !!process.env.LAMBDA_TASK_ROOT;

if (!isLambda) {
  require("dotenv").config();
}

// 1. Create the base DynamoDB Client
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-south-1",
  ...(!isLambda && {
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  }),
});

// 2. Wrap it with the Document Client (for simplified JSON objects)
const docClient = DynamoDBDocumentClient.from(client);

/**
 * 3. Compatibility Wrapper
 * AWS SDK v3 uses a .send(Command) pattern instead of .promise().
 * This wrapper allows you to keep using .put(params).promise() 
 * across the rest of your existing codebase without changes.
 */
const compatClient = {
  get: (params) => ({
    promise: () => docClient.send(new GetCommand(params)),
  }),
  put: (params) => ({
    promise: () => docClient.send(new PutCommand(params)),
  }),
  query: (params) => ({
    promise: () => docClient.send(new QueryCommand(params)),
  }),
  scan: (params) => ({
    promise: () => docClient.send(new ScanCommand(params)),
  }),
  update: (params) => ({
    promise: () => docClient.send(new UpdateCommand(params)),
  }),
  delete: (params) => ({
    promise: () => docClient.send(new DeleteCommand(params)),
  }),
};

module.exports = compatClient;