import type { DraftRow, DraftStore } from './types.ts';
import { validateRows } from './validation.ts';

export const DRAFT_DATABASE = 'houseatlas-local-unsent-captures-v1';
const storeName = 'drafts';
const deadlineMs = 10_000;

/** Feature-only database; no Cache API, localStorage, worker or network. */
export function openDraftStore(factory: IDBFactory = indexedDB): DraftStore {
  let closed = false;
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DRAFT_DATABASE, 1);
    let settled = false;
    const stop = (error: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer); reject(error);
    };
    const timer = setTimeout(() => stop(new Error('Local draft storage did not open')), deadlineMs);
    request.onerror = () => stop(request.error ?? new Error('Local draft storage is unavailable'));
    request.onblocked = () => stop(new Error('Close another Atlas tab before opening local drafts'));
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'id' });
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { closed = true; db.close(); };
      if (settled || closed) { db.close(); stop(new Error('Local draft storage is closed')); return; }
      settled = true; clearTimeout(timer); resolve(db);
    };
  });
  // A failed eager open must not create an unhandled rejection before first use.
  void database.catch(() => undefined);
  async function run<T>(mode: IDBTransactionMode, edit: (rows: readonly DraftRow[]) => { rows: readonly DraftRow[]; value: T }): Promise<T> {
    if (closed) throw new Error('Local draft storage is closed');
    const db = await database;
    if (closed) throw new Error('Local draft storage is closed');
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let value: T;
      let failure: unknown;
      const timer = setTimeout(() => {
        failure = new Error('Local draft storage did not complete');
        try { transaction.abort(); } catch { /* Completion handlers settle. */ }
      }, deadlineMs);
      const finish = () => clearTimeout(timer);
      transaction.oncomplete = () => { finish(); resolve(value); };
      transaction.onabort = () => { finish(); reject(failure ?? transaction.error ?? new Error('Local draft transaction was not saved')); };
      transaction.onerror = () => { failure ??= transaction.error; };
      // One extra row detects incompatible over-capacity storage without an
      // unbounded census. No original bytes are decoded in this transaction.
      const request = store.getAll(undefined, 5);
      request.onsuccess = () => {
        try {
          const rows = request.result as DraftRow[];
          validateRows(rows);
          const next = edit(rows);
          validateRows(next.rows);
          if (mode === 'readwrite') {
            store.clear();
            for (const row of next.rows) store.put(row);
          }
          value = next.value;
        } catch (error) { failure = error; transaction.abort(); }
      };
    });
  }
  return {
    read: () => run('readonly', rows => ({ rows, value: rows })),
    change: edit => run('readwrite', edit),
    close() { closed = true; void database.then(db => db.close()).catch(() => undefined); },
  };
}
