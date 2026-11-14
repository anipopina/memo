import { expect, it, vi } from 'vitest';
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@aws-sdk/lib-dynamodb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@aws-sdk/lib-dynamodb')>()),
  DynamoDBDocumentClient: { from: () => ({ send }) },
}));
import { DynamoRepository } from '../apps/server/dynamo';
import { Conflict } from '../apps/server/repository';

it('classifies both DynamoDB contention reasons as conflicts without swallowing unrelated failures', async () => {
  const repo = new DynamoRepository('test');
  for (const code of [
    'ConditionalCheckFailed',
    'TransactionConflict',
    'ValidationError',
  ]) {
    const error = Object.assign(new Error('cancelled'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: code }],
    });
    send.mockRejectedValueOnce(error);
    const result = repo.commit([
      {
        key: { pk: 'test', sk: 'test' },
        expected: null,
        value: { expires: 100 },
      },
    ]);
    if (code === 'ValidationError') await expect(result).rejects.toBe(error);
    else await expect(result).rejects.toBeInstanceOf(Conflict);
  }
});
