import type { RemoteNote } from './api';

const LIMIT = 10;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export const PREVIEW_EPOCH_KEY = 'memo.preview-epoch';
interface Preview extends RemoteNote {
  token: string;
  epoch: string;
  cachedAt: number;
}

export function previewEpoch(): string | undefined {
  try {
    return localStorage.getItem(PREVIEW_EPOCH_KEY) ?? '';
  } catch {
    return undefined;
  }
}

let database: Promise<IDBDatabase> | undefined;
function open() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('memo-previews', 1);
    request.onupgradeneeded = () => {
      request.result
        .createObjectStore('notes', { keyPath: 'token' })
        .createIndex('cachedAt', 'cachedAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

async function update(action: (store: IDBObjectStore) => void) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('notes', 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    action(transaction.objectStore('notes'));
  });
}

// Trim by index keys so a cache hit only reads the requested body.
function prune(store: IDBObjectStore, now: number) {
  let kept = 0;
  const request = store.index('cachedAt').openKeyCursor(null, 'prev');
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    if (Number(cursor.key) <= now - MAX_AGE || ++kept > LIMIT)
      store.delete(cursor.primaryKey);
    cursor.continue();
  };
}

export const notePreviews = {
  async get(token: string, epoch: string | undefined) {
    if (epoch === undefined || epoch !== previewEpoch()) return;
    let result: Preview | undefined;
    await update((store) => {
      const now = Date.now();
      prune(store, now);
      const request = store.get(token) as IDBRequest<Preview | undefined>;
      request.onsuccess = () => {
        const entry = request.result;
        if (entry && entry.epoch === epoch && now - entry.cachedAt < MAX_AGE)
          result = entry;
      };
    });
    return epoch === previewEpoch() ? result : undefined;
  },
  async put(token: string, note: RemoteNote, epoch: string | undefined) {
    if (epoch === undefined || epoch !== previewEpoch()) return;
    await update((store) => {
      const request = store.get(token) as IDBRequest<Preview | undefined>;
      request.onsuccess = () => {
        if (epoch !== previewEpoch()) return;
        const previous = request.result;
        const cachedAt = Date.now();
        if (
          !previous ||
          previous.epoch !== epoch ||
          previous.version <= note.version
        )
          store.put({
            token,
            content: note.content,
            version: note.version,
            epoch,
            cachedAt,
          } satisfies Preview);
        prune(store, cachedAt);
      };
    });
  },
  async remove(token: string, epoch: string | undefined) {
    if (epoch === undefined || epoch !== previewEpoch()) return;
    await update((store) => {
      if (epoch === previewEpoch()) store.delete(token);
    });
  },
  clear: async () => {
    // Responses already in flight cannot repopulate the cache after sign-out.
    try {
      localStorage.setItem(PREVIEW_EPOCH_KEY, crypto.randomUUID());
    } finally {
      await update((store) => {
        store.clear();
      });
    }
  },
};
