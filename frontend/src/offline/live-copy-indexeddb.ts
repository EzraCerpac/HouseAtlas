import type { OfflineBackend, OfflineTable, OfflineTransaction } from './live-copy-types';
export const LIVE_COPY_DATABASE = 'houseatlas-live-readonly-copy-v1';
const TABLES: OfflineTable[] = ['control', 'metadata', 'bytes'];
/** Acknowledges only transaction completion. No silent fallback or automatic repair. */
export function openLiveCopyBackend(factory: IDBFactory | undefined, timers: {
  set(callback: () => void, milliseconds: number): unknown; clear(token: unknown): void;
} = { set: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clear: token => clearTimeout(token as ReturnType<typeof setTimeout>) }): OfflineBackend {
  let connection: Promise<IDBDatabase> | null = null, closed = false;
  function database(): Promise<IDBDatabase> {
    if (closed || !factory) return Promise.reject(new Error('Offline storage unavailable'));
    return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(LIVE_COPY_DATABASE, 1); let settled = false;
      const timer = timers.set(() => { settled = true; connection = null; reject(new Error('Offline storage timeout')); }, 10_000);
      request.onupgradeneeded = () => { for (const table of TABLES)
        if (!request.result.objectStoreNames.contains(table)) request.result.createObjectStore(table); };
      request.onerror = request.onblocked = () => {
        timers.clear(timer); settled = true; connection = null; reject(request.error ?? new Error('Offline storage blocked'));
      };
      request.onsuccess = () => {
        timers.clear(timer); const db = request.result;
        if (settled || closed) { db.close(); if (!settled) { settled = true; reject(new Error('Offline storage closed')); } return; }
        settled = true; db.onversionchange = () => { db.close(); connection = null; }; resolve(db);
      };
    }).catch(error => { connection = null; throw error; });
  }
  return {
    async transaction<T>(write: boolean, work: (tx: OfflineTransaction) => Promise<T>): Promise<T> {
      const db = await database();
      if (closed) throw new Error('Offline storage closed');
      return new Promise<T>((resolve, reject) => {
        const tx = db.transaction(TABLES, write ? 'readwrite' : 'readonly');
        let answer!: T, finished = false, failure: unknown, settled = false;
        let timer: unknown;
        const rejectOnce = (error: unknown) => {
          if (settled) return; settled = true; timers.clear(timer); reject(error);
        };
        timer = timers.set(() => {
          failure = Object.assign(new Error(write ? 'Offline write completion is unknown after timeout' : 'Offline read timed out'),
            { name: write ? 'OfflineCommitUnknown' : 'OfflineReadTimeout' });
          // abort may fail once committing. Reject exactly once regardless; never assert rollback.
          try { tx.abort(); } catch { /* completion remains unknown */ }
          rejectOnce(failure);
        }, 10_000);
        const ask = <R>(request: IDBRequest<R>): Promise<R> => new Promise((yes, no) => {
          request.onsuccess = () => yes(request.result);
          request.onerror = () => no(request.error ?? new Error('Offline storage request failed'));
        });
        const access: OfflineTransaction = {
          get: <R>(table: OfflineTable, key: string) => ask<R | undefined>(tx.objectStore(table).get(key)),
          scan(table, maxRows, visit) {
            if (!Number.isSafeInteger(maxRows) || maxRows < 1) return Promise.reject(new Error('Invalid offline scan bound'));
            return new Promise<void>((yes, no) => {
              let count = 0, stopped = false;
              const request = tx.objectStore(table).openCursor();
              const fail = (error: unknown) => { stopped = true; no(error); };
              request.onerror = () => fail(request.error ?? new Error('Offline cursor failed'));
              request.onsuccess = () => {
                if (stopped) return;
                if (settled || failure) { fail(failure ?? new Error('Offline transaction retired')); return; }
                const cursor = request.result;
                if (!cursor) { yes(); return; }
                if (++count > maxRows) {
                  fail(Object.assign(new Error('Offline scan capacity exceeded'), { name: 'OfflineResourceLimit' })); return;
                }
                if (typeof cursor.key !== 'string') { fail(new Error('Invalid offline key')); return; }
                // One browser-delivered value may be oversized; the visitor admits fields before copying.
                void Promise.resolve().then(() => visit(cursor.key as string, cursor.value)).then(() => {
                  if (settled || failure) { fail(failure ?? new Error('Offline transaction retired')); return; }
                  try { cursor.continue(); } catch (error) { fail(error); }
                }, fail);
              };
            });
          },
          async put(table, key, value) { await ask(tx.objectStore(table).put(value, key)); },
          async remove(table, key) { await ask(tx.objectStore(table).delete(key)); },
          async empty(table) { await ask(tx.objectStore(table).clear()); },
        };
        tx.oncomplete = () => {
          if (settled) return;
          if (failure || !finished) { rejectOnce(failure ?? new Error('Incomplete offline transaction')); return; }
          settled = true; timers.clear(timer); resolve(answer);
        };
        tx.onabort = () => rejectOnce(failure ?? tx.error ?? new Error('Offline transaction aborted'));
        void Promise.resolve().then(() => work(access)).then(value => { answer = value; finished = true; }, error => {
          failure = error; try { tx.abort(); } catch {
            rejectOnce(write ? Object.assign(new Error('Offline write completion is unknown'), { name: 'OfflineCommitUnknown', cause: error }) : error);
          }
        });
      });
    },
    close() { closed = true; void connection?.then(db => db.close(), () => undefined); connection = null; },
  };
}
