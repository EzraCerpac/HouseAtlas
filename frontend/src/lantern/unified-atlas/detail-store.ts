/** Full quality's detail model, kept on this device between launches in its
 * own Cache Storage cache: at up to 256 MiB it is outside the IndexedDB Atlas
 * cache's budget. One copy at most, named by the actor and home it was read
 * for and the SHA-256 the scene pins. Holding it grants nothing: it stands in
 * for the GET only after a fresh scene pins that digest, and the reader hashes
 * it again before it is drawn. Storing a new copy drops every other one, so a
 * new release replaces the old. Only devices that read the detail write here.
 * Sign-out and Settings remove it. Every operation is best effort. */
export const DETAIL_STORE_NAME = 'houseatlas-atlas-detail-v1';
const MiB = 1024 * 1024;
/** Space a stored copy must leave free in the origin's quota, so the Atlas
 * cache (96 MiB) and the offline shell are never squeezed out by it. */
export const DETAIL_STORE_HEADROOM = 128 * MiB;
const BYTES = 'x-houseatlas-detail-bytes';

export interface DetailStore {
  /** The stored bytes for this digest and length, unverified, or null. */
  read(sha256: string, bytes: number): Promise<Uint8Array<ArrayBuffer> | null>;
  /** Keep verified bytes. They are copied before this returns, so the caller may hand them on. */
  keep(sha256: string, bytes: Uint8Array<ArrayBuffer>): void;
  /** Drop a copy that failed its digest. */
  forget(sha256: string): void;
}
/** Where the store lives; tests pass their own. */
export interface DetailStoreHost {
  readonly caches?: CacheStorage | undefined; readonly storage?: StorageManager | undefined;
  readonly locks?: LockManager | undefined; readonly origin: string;
}
const browserHost = (): DetailStoreHost => ({
  caches: typeof caches === 'undefined' ? undefined : caches,
  storage: typeof navigator === 'undefined' ? undefined : navigator.storage,
  locks: typeof navigator === 'undefined' ? undefined : navigator.locks,
  origin: typeof location === 'undefined' ? 'https://houseatlas.invalid' : location.origin,
});

const listeners = new Set<() => void>();
const changed = () => { for (const listener of listeners) listener(); };
// Bumped by every removal, so a write that was already under way does not bring a copy back.
let generation = 0;
// Replacing a copy is one step at a time across tabs (Web Locks) and, without them, within this page.
let pending: Promise<unknown> = Promise.resolve();
function exclusive(locks: LockManager | undefined, task: () => Promise<void>): Promise<void> {
  if (locks) return locks.request(DETAIL_STORE_NAME, task);
  const run = pending.then(task, task); pending = run.catch(() => undefined); return run;
}

/** The store for one signed-in actor and home. */
export function openDetailStore(owner: { readonly actorId: string; readonly workspaceId: string; readonly homeId: string },
  host: DetailStoreHost = browserHost()): DetailStore {
  const partition = encodeURIComponent(JSON.stringify([owner.actorId, owner.workspaceId, owner.homeId]));
  const keyOf = (sha256: string) => new URL(`/.houseatlas/detail/${partition}/${sha256}`, host.origin).href;
  const open = async () => host.caches && await host.caches.has(DETAIL_STORE_NAME) ? host.caches.open(DETAIL_STORE_NAME) : null;
  return Object.freeze({
    async read(sha256: string, bytes: number) {
      const response = await (await open())?.match(keyOf(sha256));
      if (!response || response.headers.get(BYTES) !== String(bytes)) return null;
      const buffer = await response.arrayBuffer();
      return buffer.byteLength === bytes ? new Uint8Array(buffer) : null;
    },
    keep(sha256: string, bytes: Uint8Array<ArrayBuffer>) {
      const { caches: storage, storage: manager } = host;
      if (!storage) return;
      const body = new Blob([bytes]), length = bytes.byteLength, key = keyOf(sha256), started = generation;
      void exclusive(host.locks, async () => {
        const cache = await storage.open(DETAIL_STORE_NAME);
        // One copy: every stored entry gives way first, an earlier release's,
        // another account's, or this pin's own copy that its read refused.
        await Promise.all((await cache.keys()).map(request => cache.delete(request)));
        const estimate = await manager?.estimate?.();
        if (estimate?.quota === undefined || estimate.usage === undefined
          || estimate.quota - estimate.usage < length + DETAIL_STORE_HEADROOM || started !== generation) return;
        await cache.put(key, new Response(body, { headers: { 'content-type': 'model/gltf-binary', [BYTES]: String(length) } }));
        if (started !== generation) { await cache.delete(key); return; }
        // Ask once that the browser not clear it under storage pressure; a refusal changes nothing here.
        if (manager?.persisted && !await manager.persisted()) await manager.persist?.();
      }).catch(() => undefined).finally(changed);
    },
    forget(sha256: string) {
      void open().then(cache => cache?.delete(keyOf(sha256))).catch(() => undefined).finally(changed);
    },
  });
}

/** Bytes stored on this device, across every account and home. */
export async function storedDetailBytes(host: DetailStoreHost = browserHost()): Promise<number> {
  if (!host.caches || !await host.caches.has(DETAIL_STORE_NAME)) return 0;
  const cache = await host.caches.open(DETAIL_STORE_NAME);
  let total = 0;
  for (const request of await cache.keys()) total += Number((await cache.match(request))?.headers.get(BYTES)) || 0;
  return total;
}
/** Remove every stored copy: Settings and sign-out. */
export async function clearDetailStore(host: DetailStoreHost = browserHost()): Promise<void> {
  ++generation;
  // Under the same lock as replacement: a write another tab queued earlier
  // finishes first and is deleted here; none can recreate the copy afterwards.
  try { await exclusive(host.locks, async () => { await host.caches?.delete(DETAIL_STORE_NAME); }); } finally { changed(); }
}

/** Called after every keep, forget or removal. */
export function subscribeDetailStore(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
