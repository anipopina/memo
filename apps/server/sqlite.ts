import { DatabaseSync } from 'node:sqlite';
import {
  Conflict,
  nowSeconds,
  type Repository,
  type Key,
  type Stored,
  type RecordValue,
  type Change,
} from './repository';

/** The local adapter uses the same conditional transaction contract as DynamoDB. */
export class SqliteRepository implements Repository {
  readonly db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv (pk TEXT, sk TEXT, value TEXT NOT NULL, rev INTEGER NOT NULL, expires INTEGER, PRIMARY KEY(pk,sk));',
    );
  }
  async get<T extends RecordValue>(key: Key): Promise<Stored<T> | undefined> {
    const row = this.db
      .prepare(
        'SELECT value,rev FROM kv WHERE pk=? AND sk=? AND (expires IS NULL OR expires>?)',
      )
      .get(key.pk, key.sk, nowSeconds());
    return row
      ? { value: JSON.parse(String(row.value)), rev: Number(row.rev) }
      : undefined;
  }
  async query<T extends RecordValue>(
    pk: string,
    prefix: string,
  ): Promise<Stored<T>[]> {
    const rows = this.db
      .prepare(
        'SELECT sk,value,rev FROM kv WHERE pk=? AND (expires IS NULL OR expires>?) ORDER BY sk',
      )
      .all(pk, nowSeconds());
    return rows
      .filter((row) => String(row.sk).startsWith(prefix))
      .map((row) => ({
        value: JSON.parse(String(row.value)),
        rev: Number(row.rev),
      }));
  }
  async commit(changes: Change[]): Promise<void> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('DELETE FROM kv WHERE expires IS NOT NULL AND expires<=?')
        .run(nowSeconds());
      for (const change of changes) {
        const current = this.db
          .prepare('SELECT rev FROM kv WHERE pk=? AND sk=?')
          .get(change.key.pk, change.key.sk);
        if ((current ? Number(current.rev) : null) !== change.expected)
          throw new Conflict();
        if (!change.value)
          this.db
            .prepare('DELETE FROM kv WHERE pk=? AND sk=?')
            .run(change.key.pk, change.key.sk);
        else
          this.db
            .prepare(
              'INSERT OR REPLACE INTO kv (pk,sk,value,rev,expires) VALUES (?,?,?,?,?)',
            )
            .run(
              change.key.pk,
              change.key.sk,
              JSON.stringify(change.value),
              (change.expected ?? 0) + 1,
              change.value.expires ?? null,
            );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
