import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  Conflict,
  nowSeconds,
  type Repository,
  type Key,
  type Stored,
  type RecordValue,
  type Change,
} from './repository';
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ maxAttempts: 3 }),
  { marshallOptions: { removeUndefinedValues: true } },
);
export class DynamoRepository implements Repository {
  constructor(private tableName: string) {}
  async get<T extends RecordValue>(key: Key): Promise<Stored<T> | undefined> {
    const { Item } = await client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: key,
        ConsistentRead: true,
      }),
    );
    if (!Item || (Item.expires !== undefined && Item.expires <= nowSeconds()))
      return undefined;
    return { value: Item.data as T, rev: Item.rev as number };
  }
  async query<T extends RecordValue>(
    pk: string,
    prefix: string,
  ): Promise<Stored<T>[]> {
    const items: Stored<T>[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const result = await client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk=:pk AND begins_with(sk,:prefix)',
          ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix },
          ConsistentRead: true,
          ExclusiveStartKey: cursor,
        }),
      );
      for (const item of result.Items ?? [])
        if (!item.expires || item.expires > nowSeconds())
          items.push({ value: item.data as T, rev: item.rev });
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    return items;
  }
  async commit(changes: Change[]): Promise<void> {
    try {
      await client.send(
        new TransactWriteCommand({
          TransactItems: changes.map((change) => {
            const condition =
              change.expected === null
                ? 'attribute_not_exists(pk) OR expires <= :now'
                : 'rev=:rev';
            const values =
              change.expected === null
                ? { ':now': nowSeconds() }
                : { ':rev': change.expected };
            const common = {
              TableName: this.tableName,
              ConditionExpression: condition,
              ExpressionAttributeValues: values,
            };
            return change.value
              ? {
                  Put: {
                    ...common,
                    Item: {
                      ...change.key,
                      rev: (change.expected ?? 0) + 1,
                      data: change.value,
                      expires: change.value.expires,
                    },
                  },
                }
              : { Delete: { ...common, Key: change.key } };
          }),
        }),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'TransactionCanceledException' &&
        'CancellationReasons' in error &&
        Array.isArray(error.CancellationReasons) &&
        error.CancellationReasons.some(
          (reason: { Code?: string }) =>
            reason.Code === 'ConditionalCheckFailed' ||
            reason.Code === 'TransactionConflict',
        )
      )
        throw new Conflict();
      throw error;
    }
  }
}
