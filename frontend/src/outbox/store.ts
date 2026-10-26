import type { OutboxEntry } from './types.ts';

export const OUTBOX_DATABASE = 'houseatlas-outbox-v1';
const STORE = 'entries';

export interface OutboxStore {
  list(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  remove(id: string): Promise<void>;
  close(): void;
}

/** The device's outbox. A write resolves once IndexedDB reports the
 * transaction complete, so a queued edit survives a closed tab. */
export function openOutboxStore(factory: IDBFactory = indexedDB): OutboxStore {
  let opening: Promise<IDBDatabase> | null = null;
  const database = () => opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(OUTBOX_DATABASE, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: 'id' }); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    request.onerror = () => { opening = null; reject(request.error ?? new Error('The outbox is unavailable')); };
    request.onblocked = () => { opening = null; reject(new Error('The outbox is blocked by another tab')); };
  });
  async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest | void): Promise<T> {
    const db = await database();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction([STORE], mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result as T : undefined as T);
      tx.onabort = () => reject(tx.error ?? new Error('The outbox write did not complete'));
    });
  }
  return {
    list: async () => (await run<OutboxEntry[]>('readonly', store => store.getAll())).sort((a, b) => a.seq - b.seq),
    put: entry => run('readwrite', store => { store.put(entry); }),
    remove: id => run('readwrite', store => { store.delete(id); }),
    close() { void opening?.then(db => db.close(), () => undefined); opening = null; },
  };
}
