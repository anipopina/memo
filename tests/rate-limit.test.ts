import { expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SqliteRepository } from '../apps/server/sqlite';
import { createApp } from '../apps/server/app';
import { Conflict } from '../apps/server/repository';
import { consumeRate } from '../apps/server/rate-limit';

it('admits concurrent authenticated account requests while enforcing the actual quota', async () => {
  const repo = new SqliteRepository(':memory:');
  try {
    const cookie = randomBytes(32).toString('base64url');
    const { hash } = await import('../apps/server/crypto');
    await repo.commit([
      {
        key: { pk: `session#${hash(cookie)}`, sk: 'session' },
        expected: null,
        value: {
          account: 'alice',
          expires: Math.floor(Date.now() / 1000) + 3600,
        } as { account: string; expires: number },
      },
    ]);
    const app = createApp(repo, {
      origin: 'https://memo.test',
      vaultKey: randomBytes(32).toString('base64'),
    });
    const paths = [
      '/api/session',
      '/api/auth/credentials',
      '/api/oauth/connections',
    ];
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        app.request(paths[i % 3], {
          headers: { Cookie: `__Host-memo=${cookie}` },
        }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(12).fill(200));
    const key = { pk: 'quota', sk: 'rate' };
    await consumeRate(repo, key, 1, 60);
    await expect(consumeRate(repo, key, 1, 60)).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    });
  } finally {
    repo.db.close();
  }
});

it('retries conflicts but bounds contention separately from quota errors', async () => {
  const repo = new SqliteRepository(':memory:');
  try {
    const commit = vi.spyOn(repo, 'commit');
    commit
      .mockRejectedValueOnce(new Conflict())
      .mockRejectedValueOnce(new Conflict());
    const key = { pk: 'retry', sk: 'rate' };
    await consumeRate(repo, key, 10, 60);
    expect(
      (await repo.get<{ count: number; expires: number }>(key))?.value.count,
    ).toBe(1);
    commit.mockRejectedValue(new Conflict());
    await expect(consumeRate(repo, key, 10, 60)).rejects.toMatchObject({
      code: 'request_busy',
      status: 503,
    });
  } finally {
    repo.db.close();
  }
});
