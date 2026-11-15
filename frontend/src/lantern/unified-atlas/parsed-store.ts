import { meshBuffers } from '../canonical-ifc/geometry';
import type { StandardGlb } from '../canonical-ifc/standard-glb';

/** The Light model as the loader prepared it, kept on this device in its own
 * IndexedDB database so a later open can draw without parsing the model again.
 * One copy at most, named by the actor and home it was read for, the SHA-256
 * and length of the model bytes it was parsed from, and the loader build
 * (standard-glb.ts LOADER_BUILD): a new release of the loader never reuses an
 * older build's copy, and a new publication pins other bytes. Holding it
 * grants nothing: it stands in for the parse only after those exact bytes have
 * verified against a scene's pin, and the caller's admission and scene binding
 * run on it as on a fresh parse. A new copy replaces the old one; sign-out
 * removes it. Every operation is best effort. */
export const PARSED_STORE_NAME = 'houseatlas-atlas-parsed-v1';
const MiB = 1024 * 1024;
/** Space a copy must leave free in the origin's quota, as for the Full detail copy. */
export const PARSED_STORE_HEADROOM = 128 * MiB;
const TABLE = 'copies', SLOT = 'light';

export interface ParsedStore {
  /** The copy parsed from these bytes by this loader build, or null. */
  read(sha256: string, bytes: number, loader: string): Promise<StandardGlb | null>;
  /** Keep what the loader prepared from these verified bytes. Nothing in `glb` may change afterwards. */
  keep(sha256: string, bytes: number, loader: string, glb: StandardGlb): void;
}
/** Where the store lives; checks pass their own. */
export interface ParsedStoreHost { readonly indexedDB?: IDBFactory | undefined; readonly storage?: StorageManager | undefined }
const browserHost = (): ParsedStoreHost => ({
  indexedDB: typeof indexedDB === 'undefined' ? undefined : indexedDB,
  storage: typeof navigator === 'undefined' ? undefined : navigator.storage,
});

function ask<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Parsed copy request failed'));
  });
}
/** One transaction over the store's single table; `body` may issue several requests. */
async function inTable<T>(factory: IDBFactory, mode: IDBTransactionMode, body: (table: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(PARSED_STORE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(TABLE, { keyPath: 'slot' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(TABLE, mode);
      let value: T;
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(transaction.error ?? new Error('Parsed copy transaction aborted'));
      body(transaction.objectStore(TABLE)).then(result => { value = result; }, () => {
        try { transaction.abort(); } catch { /* Already finished. */ }
      });
    });
  } finally { db.close(); }
}
// A durable generation, as in the verified byte cache (native-geometry-scan-cache.ts):
// a handle learns it when opened, every read and write checks it in the same
// transaction, and removal rotates it together with the deletion. A handle opened
// before a sign-out, in this page or another, can then neither read nor write.
const GENERATION = 'generation';
async function generationOf(table: IDBObjectStore): Promise<string | null> {
  const row = await ask(table.get(GENERATION)) as { value?: unknown } | undefined;
  return typeof row?.value === 'string' ? row.value : null;
}

/** The store for one signed-in actor and home, from the generation current when it is opened. */
export function openParsedStore(owner: { readonly actorId: string; readonly workspaceId: string; readonly homeId: string },
  host: ParsedStoreHost = browserHost()): ParsedStore {
  const partition = JSON.stringify([owner.actorId, owner.workspaceId, owner.homeId]), factory = host.indexedDB;
  const opened: Promise<string | null> = factory ? inTable(factory, 'readwrite', async table => {
    const current = await generationOf(table);
    if (current !== null) return current;
    const value = crypto.randomUUID(); table.put({ slot: GENERATION, value }); return value;
  }).catch(() => null) : Promise.resolve(null);
  return Object.freeze({
    async read(sha256: string, bytes: number, loader: string) {
      const expected = await opened;
      if (!factory || expected === null) return null;
      const row: unknown = await inTable(factory, 'readonly', async table => await generationOf(table) === expected ? ask(table.get(SLOT)) : undefined);
      if (!row || typeof row !== 'object') return null;
      const { owner: stored, sha256: digest, bytes: length, loader: build, glb } = row as Record<string, unknown>;
      if (stored !== partition || digest !== sha256 || length !== bytes || build !== loader || !glb || typeof glb !== 'object') return null;
      const { drawn, meshes, work } = glb as Partial<StandardGlb>;
      return Array.isArray(drawn) && Array.isArray(meshes) && drawn.length === meshes.length && work && typeof work === 'object' ? glb as StandardGlb : null;
    },
    keep(sha256: string, bytes: number, loader: string, glb: StandardGlb) {
      if (!factory) return;
      const size = meshBuffers(glb.meshes).reduce((total, buffer) => total + buffer.byteLength, 0);
      void (async () => {
        const [expected, estimate] = await Promise.all([opened, host.storage?.estimate?.()]);
        if (expected === null || estimate?.quota === undefined || estimate.usage === undefined
          || estimate.quota - estimate.usage < size + PARSED_STORE_HEADROOM) return;
        await inTable(factory, 'readwrite', async table => {
          if (await generationOf(table) === expected) table.put({ slot: SLOT, owner: partition, sha256, bytes, loader, glb });
        });
      })().catch(() => undefined);
    },
  });
}

/** Remove the stored copy and end every handle opened before: sign-out. */
export async function clearParsedStore(host: ParsedStoreHost = browserHost()): Promise<void> {
  if (host.indexedDB) await inTable(host.indexedDB, 'readwrite', async table => {
    table.clear(); table.put({ slot: GENERATION, value: crypto.randomUUID() });
  });
}
