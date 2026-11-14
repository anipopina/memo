import { setTimeout } from 'node:timers/promises';
import { AppError } from './notes';
import {
  Conflict,
  nowSeconds,
  type Key,
  type RecordValue,
  type Repository,
} from './repository';

const RETRY = { attempts: 6, delayMs: 20 };
export async function consumeRate(
  repo: Repository,
  key: Key,
  limit: number,
  period: number,
) {
  for (let attempt = 0; attempt < RETRY.attempts; attempt++) {
    const row = await repo.get<RecordValue & { count: number }>(key);
    if ((row?.value.count ?? 0) >= limit)
      throw new AppError('rate_limited', 429);
    try {
      await repo.commit([
        {
          key,
          expected: row?.rev ?? null,
          value: {
            count: (row?.value.count ?? 0) + 1,
            expires: nowSeconds() + period * 2,
          } as RecordValue,
        },
      ]);
      return;
    } catch (error) {
      if (!(error instanceof Conflict)) throw error;
      // Concurrent page requests share a bucket; contention is not quota exhaustion.
      if (attempt < RETRY.attempts - 1)
        await setTimeout(RETRY.delayMs * 2 ** attempt * (0.5 + Math.random()));
    }
  }
  throw new AppError('request_busy', 503);
}
