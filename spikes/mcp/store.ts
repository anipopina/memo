import { assertNoteSize, isNoteToken } from '../../packages/core/src/note';

export interface Note {
  content: string;
  version: number;
}
interface Mutation {
  fingerprint: string;
  result: Note;
}

/** In-memory spike only. Production writes must use database conditional transactions. */
export class MemoryNoteStore {
  private readonly notes = new Map<string, Note>();
  private readonly mutations = new Map<string, Mutation>();

  seed(token: string, content: string): void {
    if (!isNoteToken(token)) throw new Error('invalid_token');
    assertNoteSize(content);
    this.notes.set(token, { content, version: 1 });
  }

  read(token: string): Note {
    const note = this.notes.get(token);
    if (!note) throw new Error('not_found');
    return { ...note };
  }

  mutate(
    token: string,
    operationId: string,
    kind: 'write' | 'append',
    content: string,
    expectedVersion?: number,
  ): Note {
    const key = `${token}:${operationId}`;
    const fingerprint = JSON.stringify([kind, content, expectedVersion]);
    const previous = this.mutations.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new Error('operation_id_reused');
      return { ...previous.result };
    }
    const current = this.read(token);
    if (expectedVersion !== undefined && expectedVersion !== current.version)
      throw new Error('version_conflict');
    const next = {
      content: kind === 'append' ? current.content + content : content,
      version: current.version + 1,
    };
    assertNoteSize(next.content);
    this.notes.set(token, next);
    this.mutations.set(key, { fingerprint, result: next });
    return { ...next };
  }
}
