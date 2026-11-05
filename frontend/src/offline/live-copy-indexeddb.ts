import type { OfflineBackend, OfflineTable, OfflineTransaction } from './live-copy-types';
export const LIVE_COPY_DATABASE = 'houseatlas-live-readonly-copy-v1';
const TABLES: OfflineTable[] = ['control', 'metadata', 'bytes'];
/** Acknowledges only transaction completion. No silent fallback or automatic repair. */
export function openLiveCopyBackend(factory: IDBFactory | undefined): OfflineBackend {
  let connection: Promise<IDBDatabase> | null = null, closed = false;
  function database(): Promise<IDBDatabase> {
    if (closed || !factory) return Promise.reject(new Error('Offline storage unavailable'));
    return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(LIVE_COPY_DATABASE, 1); let settled = false;
      const timer = setTimeout(() => { settled = true; connection = null; reject(new Error('Offline storage timeout')); }, 10_000);
      request.onupgradeneeded = () => { for (const table of TABLES)
        if (!request.result.objectStoreNames.contains(table)) request.result.createObjectStore(table); };
      request.onerror = request.onblocked = () => {
        clearTimeout(timer); settled = true; connection = null; reject(request.error ?? new Error('Offline storage blocked'));
      };
      request.onsuccess = () => {
        clearTimeout(timer); const db = request.result;
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
        let answer!: T, finished = false, failure: unknown;
        const timer = setTimeout(() => { failure = new Error('Offline transaction timeout'); try { tx.abort(); } catch { /* already terminal */ } }, 10_000);
        const ask = <R>(request: IDBRequest<R>): Promise<R> => new Promise((yes, no) => {
          request.onsuccess = () => yes(request.result);
          request.onerror = () => no(request.error ?? new Error('Offline storage request failed'));
        });
        const access: OfflineTransaction = {
          get: <R>(table: OfflineTable, key: string) => ask<R | undefined>(tx.objectStore(table).get(key)),
          async list<R>(table: OfflineTable) {
            const store = tx.objectStore(table);
            const keys = ask(store.getAllKeys()), values = ask(store.getAll());
            const [k, v] = await Promise.all([keys, values]);
            if (k.length !== v.length || k.some(key => typeof key !== 'string')) throw new Error('Invalid offline keys');
            return k.map((key, i) => ({ key: key as string, value: v[i] as R }));
          },
          async put(table, key, value) { await ask(tx.objectStore(table).put(value, key)); },
          async remove(table, key) { await ask(tx.objectStore(table).delete(key)); },
          async empty(table) { await ask(tx.objectStore(table).clear()); },
        };
        tx.oncomplete = () => { clearTimeout(timer); if (finished) resolve(answer); else reject(failure ?? new Error('Incomplete offline transaction')); };
        tx.onabort = () => { clearTimeout(timer); reject(failure ?? tx.error ?? new Error('Offline transaction aborted')); };
        void Promise.resolve().then(() => work(access)).then(value => { answer = value; finished = true; }, error => {
          failure = error; try { tx.abort(); } catch { clearTimeout(timer); reject(error); }
        });
      });
    },
    close() { closed = true; void connection?.then(db => db.close(), () => undefined); connection = null; },
  };
}
