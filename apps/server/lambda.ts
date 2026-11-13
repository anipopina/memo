import { handle } from 'hono/aws-lambda';
import { createApp } from './app';
import { DynamoRepository } from './dynamo';
const repository = new DynamoRepository(process.env.MEMO_TABLE!);
type Handler = ReturnType<typeof handle>;
export const handler: Handler = async (event, context) => {
  // Only the address supplied by API Gateway is trusted for distributed rate limits.
  const requestContext = event.requestContext;
  const sourceIp =
    'http' in requestContext ? requestContext.http.sourceIp : 'unknown';
  const app = createApp(repository, {
    origin: process.env.MEMO_ORIGIN!,
    vaultKey: process.env.MEMO_VAULT_KEY!,
    clientIp: () => sourceIp ?? 'unknown',
  });
  return handle(app)(event, context);
};
