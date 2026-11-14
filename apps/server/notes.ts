import { randomBytes, randomUUID } from 'node:crypto';
import { assertNoteSize, isNoteToken } from '../../packages/core/src/note';
import { hash, TokenVault } from './crypto';
import {
  Conflict,
  nowSeconds,
  type Repository,
  type RecordValue,
  type Change,
} from './repository';
export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export interface Note extends RecordValue {
  id: string;
  content: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}
interface NoteVersion extends RecordValue {
  version: number;
  title: string;
}
interface Operation extends RecordValue {
  fingerprint: string;
  version: number;
}
interface Reference extends RecordValue {
  token: string;
  noteHash: string;
  addedAt: number;
}
export const noteKey = (token: string) => ({
  pk: `note#${hash(token)}`,
  sk: 'note',
});
const referenceKey = (account: string, token: string) => ({
  pk: `account#${account}`,
  sk: `note#${hash(token)}`,
});
export class Notes {
  constructor(
    readonly repo: Repository,
    private vault: TokenVault,
  ) {}
  async read(token: string): Promise<Note> {
    if (!isNoteToken(token)) throw new AppError('not_found', 404);
    const record = await this.repo.get<Note>(noteKey(token));
    if (!record) throw new AppError('not_found', 404);
    return record.value;
  }
  async version(token: string) {
    const row = await this.repo.get<NoteVersion>({
      ...noteKey(token),
      sk: 'version',
    });
    if (!row) throw new AppError('not_found', 404);
    return { version: row.value.version };
  }
  async create(
    token: string,
    content: string,
    account?: string,
  ): Promise<Note> {
    return this.createRecord(token, content, account);
  }
  async requireMember(account: string, token: string) {
    if (
      !isNoteToken(token) ||
      !(await this.repo.get(referenceKey(account, token)))
    )
      throw new AppError('not_found', 404);
  }
  async createInAccount(account: string, content: string, operationId: string) {
    assertNoteSize(content);
    const key = {
      pk: `account#${account}`,
      sk: `create-operation#${operationId}`,
    };
    const fingerprint = hash(content);
    const replay = async () => {
      const row = await this.repo.get<
        RecordValue & { fingerprint: string; token: string }
      >(key);
      if (!row) return;
      if (row.value.fingerprint !== fingerprint)
        throw new AppError('operation_id_reused', 409);
      const token = this.vault.decrypt(
        row.value.token,
        `${account}:${operationId}`,
      );
      await this.requireMember(account, token);
      return { token, version: 1 };
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      const previous = await replay();
      if (previous) return previous;
      const period = 3600;
      const rateKey = {
        pk: `rate#${hash(`oauth-create:${account}:${Math.floor(nowSeconds() / period)}`)}`,
        sk: 'rate',
      };
      const rate = await this.repo.get<RecordValue & { count: number }>(
        rateKey,
      );
      if ((rate?.value.count ?? 0) >= 30)
        throw new AppError('rate_limited', 429);
      const token = randomBytes(16).toString('base64url');
      try {
        await this.createRecord(token, content, account, [
          {
            key: rateKey,
            expected: rate?.rev ?? null,
            value: {
              count: (rate?.value.count ?? 0) + 1,
              expires: nowSeconds() + period * 2,
            } as RecordValue,
          },
          {
            key,
            expected: null,
            value: {
              fingerprint,
              token: this.vault.encrypt(token, `${account}:${operationId}`),
              expires: nowSeconds() + 86400,
            } as RecordValue,
          },
        ]);
        return { token, version: 1 };
      } catch (error) {
        if (!(error instanceof AppError && error.code === 'already_exists'))
          throw error;
      }
    }
    const previous = await replay();
    if (previous) return previous;
    throw new AppError('rate_limited', 429);
  }

  private async createRecord(
    token: string,
    content: string,
    account?: string,
    extra: Change[] = [],
  ): Promise<Note> {
    if (!isNoteToken(token)) throw new AppError('invalid_token');
    assertNoteSize(content);
    const time = Date.now();
    const note: Note = {
      id: randomUUID(),
      content,
      version: 1,
      createdAt: time,
      updatedAt: time,
    };
    const changes: Change[] = [
      ...extra,
      { key: noteKey(token), expected: null, value: note },
      {
        key: { ...noteKey(token), sk: 'version' },
        expected: null,
        value: { version: 1, title: noteTitle(content) } as NoteVersion,
      },
    ];
    if (account) changes.push(this.reference(account, token));
    try {
      await this.repo.commit(changes);
    } catch (error) {
      if (error instanceof Conflict) throw new AppError('already_exists', 409);
      throw error;
    }
    return note;
  }
  private reference(account: string, token: string): Change {
    const key = referenceKey(account, token);
    return {
      key,
      expected: null,
      value: {
        token: this.vault.encrypt(token, `${account}:${hash(token)}`),
        noteHash: hash(token),
        addedAt: Date.now(),
      } as Reference,
    };
  }
  async add(account: string, token: string): Promise<void> {
    await this.read(token);
    const key = referenceKey(account, token);
    if (await this.repo.get(key)) return;
    try {
      await this.repo.commit([this.reference(account, token)]);
    } catch (error) {
      if (!(error instanceof Conflict)) throw error;
    }
  }
  async remove(account: string, token: string): Promise<void> {
    const key = referenceKey(account, token),
      entry = await this.repo.get(key);
    if (entry) await this.repo.commit([{ key, expected: entry.rev }]);
  }
  async list(
    account: string,
    { after, limit }: { after?: string; limit?: number } = {},
  ) {
    const rows = await this.repo.query<Reference>(
      `account#${account}`,
      'note#',
    );
    const references = rows
      .map(({ value }) => ({
        ...value,
        token: this.vault.decrypt(value.token, `${account}:${value.noteHash}`),
      }))
      .filter((item) => !after || item.token > after);
    if (limit !== undefined)
      references.sort((a, b) =>
        a.token < b.token ? -1 : a.token > b.token ? 1 : 0,
      );
    else references.sort((a, b) => b.addedAt - a.addedAt);
    return Promise.all(
      references.slice(0, limit).map(async (value) => {
        const metadata = await this.repo.get<NoteVersion>({
          pk: `note#${value.noteHash}`,
          sk: 'version',
        });
        return {
          token: value.token,
          title: metadata?.value.title ?? '無題',
          addedAt: value.addedAt,
        };
      }),
    );
  }
  async mutate(
    token: string,
    operationId: string,
    kind: 'write' | 'append',
    content: string,
    expectedVersion?: number,
  ): Promise<{ version: number }> {
    assertNoteSize(content);
    const key = noteKey(token),
      opKey = { pk: key.pk, sk: `operation#${operationId}` };
    const fingerprint = hash(JSON.stringify([kind, content, expectedVersion]));
    for (let attempt = 0; attempt < 4; attempt++) {
      const previous = await this.repo.get<Operation>(opKey);
      if (previous) {
        if (previous.value.fingerprint !== fingerprint)
          throw new AppError('operation_id_reused', 409);
        return { version: previous.value.version };
      }
      const current = await this.repo.get<Note>(key);
      const metadata = await this.repo.get<NoteVersion>({
        ...key,
        sk: 'version',
      });
      if (!current) throw new AppError('not_found', 404);
      if (
        expectedVersion !== undefined &&
        current.value.version !== expectedVersion
      )
        throw new AppError('version_conflict', 409);
      const next = {
        ...current.value,
        content: kind === 'append' ? current.value.content + content : content,
        version: current.value.version + 1,
        updatedAt: Date.now(),
      };
      assertNoteSize(next.content);
      try {
        await this.repo.commit([
          { key, expected: current.rev, value: next },
          {
            key: { ...key, sk: 'version' },
            expected: metadata?.rev ?? null,
            value: {
              version: next.version,
              title: noteTitle(next.content),
            } as NoteVersion,
          },
          {
            key: opKey,
            expected: null,
            value: {
              fingerprint,
              version: next.version,
              expires: nowSeconds() + 86400,
            } as Operation,
          },
        ]);
        return { version: next.version };
      } catch (error) {
        if (!(error instanceof Conflict)) throw error;
      }
    }
    throw new AppError('version_conflict', 409);
  }
}

function noteTitle(content: string): string {
  return (
    content
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 100) || '無題'
  );
}
