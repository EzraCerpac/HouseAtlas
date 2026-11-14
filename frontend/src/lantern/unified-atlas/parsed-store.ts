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

// Bumped by every removal, so a write that was already under way does not bring a copy back.
let generation = 0;
async function inTable<T>(factory: IDBFactory, mode: IDBTransactionMode, act: (table: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(PARSED_STORE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(TABLE, { keyPath: 'slot' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(TABLE, mode), request = act(transaction.objectStore(TABLE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

/** The store for one signed-in actor and home. A removal ends it: nothing it
 * keeps afterwards, or had under way, is written or left behind. */
export function openParsedStore(owner: { readonly actorId: string; readonly workspaceId: string; readonly homeId: string },
  host: ParsedStoreHost = browserHost()): ParsedStore {
  const partition = JSON.stringify([owner.actorId, owner.workspaceId, owner.homeId]), opened = generation;
  return Object.freeze({
    async read(sha256: string, bytes: number, loader: string) {
      if (!host.indexedDB) return null;
      const row: unknown = await inTable(host.indexedDB, 'readonly', table => table.get(SLOT));
      if (!row || typeof row !== 'object') return null;
      const { owner: stored, sha256: digest, bytes: length, loader: build, glb } = row as Record<string, unknown>;
      if (stored !== partition || digest !== sha256 || length !== bytes || build !== loader || !glb || typeof glb !== 'object') return null;
      const { drawn, meshes, work } = glb as Partial<StandardGlb>;
      return Array.isArray(drawn) && Array.isArray(meshes) && drawn.length === meshes.length && work && typeof work === 'object' ? glb as StandardGlb : null;
    },
    keep(sha256: string, bytes: number, loader: string, glb: StandardGlb) {
      const factory = host.indexedDB;
      if (!factory || opened !== generation) return;
      const size = meshBuffers(glb.meshes).reduce((total, buffer) => total + buffer.byteLength, 0);
      void (async () => {
        const estimate = await host.storage?.estimate?.();
        if (estimate?.quota === undefined || estimate.usage === undefined
          || estimate.quota - estimate.usage < size + PARSED_STORE_HEADROOM || opened !== generation) return;
        await inTable(factory, 'readwrite', table => table.put({ slot: SLOT, owner: partition, sha256, bytes, loader, glb }));
        if (opened !== generation) await inTable(factory, 'readwrite', table => table.clear());
      })().catch(() => undefined);
    },
  });
}

/** Remove the stored copy: sign-out. */
export async function clearParsedStore(host: ParsedStoreHost = browserHost()): Promise<void> {
  ++generation;
  if (host.indexedDB) await inTable(host.indexedDB, 'readwrite', table => table.clear());
}
