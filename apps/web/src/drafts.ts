export interface Draft {
  key: string;
  token: string;
  base: string;
  version: number;
  content: string;
  persisted: boolean;
  updatedAt: number;
}
let database: Promise<IDBDatabase> | undefined;
function open() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('memo', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('drafts', { keyPath: 'key' });
      request.result.createObjectStore('recovery', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
async function access<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
  name = 'drafts',
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(name, mode),
      request = action(transaction.objectStore(name));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
export const drafts = {
  put: (draft: Draft) => access('readwrite', (store) => store.put(draft)),
  remove: (key: string) => access('readwrite', (store) => store.delete(key)),
  all: () => access<Draft[]>('readonly', (store) => store.getAll()),
};

export async function releaseAdoptedDraft(draft: Draft) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('drafts', 'readwrite'),
      store = transaction.objectStore('drafts');
    const request = store.get(draft.key);
    request.onsuccess = () => {
      if (JSON.stringify(request.result) === JSON.stringify(draft))
        store.delete(draft.key);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
export const recovery = {
  put: (token: string, content: string) =>
    access(
      'readwrite',
      (store) => store.put({ key: 'latest', token, content }),
      'recovery',
    ),
  get: () =>
    access<{ key: string; token: string; content: string } | undefined>(
      'readonly',
      (store) => store.get('latest'),
      'recovery',
    ),
};
