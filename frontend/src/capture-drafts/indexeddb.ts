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
      const unavailable = () => new Error('Local draft storage with strict durability is unavailable');
      let transaction: IDBTransaction;
      try {
        // Write completion may release a foreground handoff or confirm cleanup.
        // Never substitute the browser's default/relaxed commit policy.
        transaction = mode === 'readwrite' ? db.transaction(storeName, mode, { durability: 'strict' }) : db.transaction(storeName, mode);
      } catch (error) { reject(mode === 'readwrite' ? unavailable() : error); return; }
      let value: T;
      let failure: unknown;
      let failed = false;
      const finish = () => clearTimeout(timer);
      const fail = (error: unknown) => {
        failed = true; failure = error; finish();
        try { transaction.abort(); } catch { /* No successful result is released. */ }
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error('Local draft storage did not complete')), deadlineMs);
      transaction.oncomplete = () => { finish(); if (failed) reject(failure); else resolve(value); };
      transaction.onabort = () => { finish(); reject(failure ?? transaction.error ?? new Error('Local draft transaction was not saved')); };
      transaction.onerror = () => { failed = true; failure ??= transaction.error ?? new Error('Local draft transaction failed'); };
      // Install terminal handlers before inspecting capability or aborting.
      // Old browsers may reject/ignore the options or omit this property.
      try {
        if (mode === 'readwrite' && transaction.durability !== 'strict') { fail(unavailable()); return; }
      } catch { fail(unavailable()); return; }
      // One extra row detects incompatible over-capacity storage without an
      // unbounded census. No original bytes are decoded in this transaction.
      try {
        const store = transaction.objectStore(storeName);
        const request = store.getAll(undefined, 5);
        request.onsuccess = () => {
          if (failed) return;
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
          } catch (error) { fail(error); }
        };
      } catch (error) { fail(error); }
    });
  }
  return {
    read: () => run('readonly', rows => ({ rows, value: rows })),
    change: edit => run('readwrite', edit),
    close() { closed = true; void database.then(db => db.close()).catch(() => undefined); },
  };
}
