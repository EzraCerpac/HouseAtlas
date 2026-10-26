/** Persistent scan-asset cache: verified scan derivative bytes only, in this
 * origin's IndexedDB, separate from unsent capture drafts. No session, token,
 * credential, descriptor or other API response is stored. Records are named by
 * SHA-256 digests of the signed-in actor, workspace and home and of the exact
 * offered derivative, so neither identity nor scope is readable from them.
 * Holding a record grants nothing: the reader uses one only after a freshly
 * authorized descriptor offers that exact derivative, and only if its bytes
 * still match the offered digest. Every operation is best effort; unavailable
 * storage or a failed transaction falls back to reading from the server. */

export const SCAN_CACHE_DATABASE = 'houseatlas-scan-asset-cache-v1';
/** Bounds this cache's share of origin storage. Records unused this long are
 * removed; the oldest used records give way first. */
export const SCAN_CACHE_LIMITS = Object.freeze({
  entries: 16, bytes: 64 * 1024 * 1024, entryBytes: 8 * 1024 * 1024, unusedMs: 30 * 24 * 60 * 60 * 1000,
});
export type ScanCacheLimits = Readonly<Record<keyof typeof SCAN_CACHE_LIMITS, number>>;

export interface NativeGeometryScanCache {
  /** Establish this handle's generation before a fresh authorized mesh read. */
  ready(): Promise<void>;
  /** Bytes stored for exactly this partition and derivative key, or null. */
  read(partition: string, key: string): Promise<Uint8Array | null>;
  /** Queues a copy of verified bytes; replaces other versions in the same slot. */
  write(partition: string, slot: string, key: string, bytes: Uint8Array): void;
  /** Optional single-record exchange: exact raw preimage and durable generation
   * must still match in the write transaction. Null expects a missing record.
   * Failure changes no record; callers must not fall back to a blind write. */
  compareExchange?(partition: string, slot: string, key: string, expected: Uint8Array | null, bytes: Uint8Array): Promise<boolean>;
  remove(partition: string, key: string): void;
  /** Deletes every record, for sign-out. */
  clear(): Promise<void>;
  /** Settles queued work, then closes this page's connection. */
  close(): Promise<void>;
}

const ENTRIES = 'entries', BLOBS = 'blobs', CONTROL = 'control', deadlineMs = 10_000;
interface Entry { readonly id: string; readonly partition: string; readonly slot: string; readonly bytes: number; readonly usedAt: number }
interface Blob { readonly id: string; readonly data: ArrayBuffer }

async function digest(...parts: readonly string[]): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
const quota = (error: unknown) => (error as { name?: unknown } | null)?.name === 'QuotaExceededError';
function entry(value: unknown, limits: ScanCacheLimits): value is Entry {
  const row = value as Partial<Entry> | null;
  return !!row && typeof row.id === 'string' && typeof row.partition === 'string' && typeof row.slot === 'string'
    && Number.isSafeInteger(row.bytes) && row.bytes! > 0 && row.bytes! <= limits.entryBytes && Number.isFinite(row.usedAt);
}
function ask<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Scan cache request failed'));
  });
}
function transaction<T>(db: IDBDatabase, mode: IDBTransactionMode,
  body: (entries: IDBObjectStore, blobs: IDBObjectStore, control: IDBObjectStore) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction([ENTRIES, BLOBS, CONTROL], mode);
    let value: T, failure: unknown;
    const timer = setTimeout(() => {
      failure ??= new Error('Scan cache did not complete');
      try { tx.abort(); } catch { /* Completion handlers settle. */ }
    }, deadlineMs);
    tx.oncomplete = () => { clearTimeout(timer); resolve(value); };
    // A quota failure surfaces as the transaction's own error.
    tx.onabort = () => { clearTimeout(timer); reject(tx.error ?? failure ?? new Error('Scan cache transaction aborted')); };
    body(tx.objectStore(ENTRIES), tx.objectStore(BLOBS), tx.objectStore(CONTROL)).then(result => { value = result; }, error => {
      failure = error;
      try { tx.abort(); } catch { /* Already finished. */ }
    });
  });
}

export function openNativeGeometryScanCache(factory: IDBFactory | undefined,
  options: { readonly limits?: Partial<ScanCacheLimits> } = {}): NativeGeometryScanCache {
  return openVerifiedByteCache(factory, SCAN_CACHE_DATABASE, SCAN_CACHE_LIMITS, options.limits);
}

/** The same bounded, generation-fenced byte store under another database name
 * and published bounds; the unified Atlas model cache shares this owner. */
export function openVerifiedByteCache(factory: IDBFactory | undefined, database: string, published: ScanCacheLimits,
  overrides: Partial<ScanCacheLimits> = {}): NativeGeometryScanCache {
  // Overrides may only tighten the published bounds.
  const tighter = overrides;
  const limits: ScanCacheLimits = Object.freeze({
    entries: Math.min(published.entries, tighter.entries ?? Infinity),
    bytes: Math.min(published.bytes, tighter.bytes ?? Infinity),
    entryBytes: Math.min(published.entryBytes, tighter.entryBytes ?? Infinity),
    unusedMs: Math.min(published.unusedMs, tighter.unusedMs ?? Infinity),
  });
  let connection: Promise<IDBDatabase> | null = null, unavailable = !factory, closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  // One operation at a time keeps recency and bounds exact across reads and writes.
  const enqueue = <T>(operation: () => Promise<T>, fallback: T): Promise<T> => {
    const next = queue.then(() => unavailable || closed ? fallback : operation()).catch(() => fallback);
    queue = next; return next;
  };
  const connect = (): Promise<IDBDatabase> => connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = factory!.open(database, 2); } catch (error) { unavailable = true; reject(error); return; }
    let settled = false;
    const stop = (error: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer); connection = null; unavailable = true; reject(error);
    };
    const timer = setTimeout(() => stop(new Error('Scan cache did not open')), deadlineMs);
    request.onerror = () => stop(request.error ?? new Error('Scan cache is unavailable'));
    request.onblocked = () => stop(new Error('Scan cache is blocked'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CONTROL)) db.createObjectStore(CONTROL, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      // Release this connection for a future schema upgrade in another page.
      db.onversionchange = () => { db.close(); connection = null; };
      if (settled) { db.close(); return; }
      settled = true; clearTimeout(timer); resolve(db);
    };
  });

  // Establish this handle's durable generation before hashing or queueing any
  // writes. Clear rotates it atomically with deletion. Other handles retain
  // their old generation and cannot read or repopulate the cleared cache;
  // a newly opened handle can join the new generation after fresh authority.
  let generation: string | null = null;
  const ready = factory ? connect().then(db => transaction(db, 'readwrite', async (_entries, _blobs, control) => {
    const record = await ask(control.get('generation')) as { value?: unknown } | undefined;
    const value = typeof record?.value === 'string' ? record.value : crypto.randomUUID();
    if (!record) control.put({ id: 'generation', value });
    return value;
  })).then(value => { generation = value; }, () => { unavailable = true; }) : Promise.resolve();
  const matches = async (control: IDBObjectStore, expected: string | null) => {
    const record = await ask(control.get('generation')) as { value?: unknown } | undefined;
    return expected !== null && record?.value === expected;
  };

  const removeRows = (entries: IDBObjectStore, blobs: IDBObjectStore, id: string) => { entries.delete(id); blobs.delete(id); };
  // Strictly increasing recency, even within one millisecond or across pages.
  const stamp = (rows: readonly unknown[]) => rows.reduce<number>((latest, row) => entry(row, limits)
    && row.usedAt < Date.now() + 60_000 ? Math.max(latest, row.usedAt + 1) : latest, Date.now());
  const load = async (partitionId: string, id: string): Promise<Uint8Array | null> => transaction(await connect(), 'readwrite', async (entries, blobs, control) => {
    if (!await matches(control, generation)) return null;
    const row: unknown = await ask(entries.get(id));
    if (row === undefined) return null;
    const blob = await ask(blobs.get(id)) as Blob | undefined;
    if (!entry(row, limits) || row.partition !== partitionId || !(row.usedAt + limits.unusedMs > Date.now())
      || !blob || !(blob.data instanceof ArrayBuffer) || blob.data.byteLength !== row.bytes) {
      removeRows(entries, blobs, id); return null;
    }
    entries.put({ ...row, usedAt: stamp(await ask(entries.getAll())) } satisfies Entry);
    return new Uint8Array(blob.data);
  });
  const storeRows = async (entries: IDBObjectStore, blobs: IDBObjectStore,
    partitionId: string, slotId: string, id: string, data: ArrayBuffer) => {
    const rows: unknown[] = await ask(entries.getAll()), now = Date.now(), kept: Entry[] = [];
    const usedAt = stamp(rows);
    // Contents in an unknown shape are dropped as a whole.
    if (!rows.every(row => entry(row, limits))) { entries.clear(); blobs.clear(); }
    else for (const row of rows as Entry[]) {
      // Expired, replaced and superseded versions of this slot go first.
      if (!(row.usedAt + limits.unusedMs > now) || row.id === id || (row.partition === partitionId && row.slot === slotId)) {
        removeRows(entries, blobs, row.id); continue;
      }
      kept.push(row);
    }
    kept.sort((a, b) => a.usedAt - b.usedAt);
    let total = kept.reduce((sum, row) => sum + row.bytes, 0);
    while (kept.length && (kept.length >= limits.entries || total + data.byteLength > limits.bytes)) {
      const oldest = kept.shift()!; removeRows(entries, blobs, oldest.id); total -= oldest.bytes;
    }
    blobs.put({ id, data } satisfies Blob);
    entries.put({ id, partition: partitionId, slot: slotId, bytes: data.byteLength, usedAt } satisfies Entry);
  };
  const store = async (partitionId: string, slotId: string, id: string, data: ArrayBuffer, expected: string | null) => transaction(await connect(), 'readwrite', async (entries, blobs, control) => {
    if (!await matches(control, expected)) return;
    await storeRows(entries, blobs, partitionId, slotId, id, data);
  });
  /** Frees the least recently used half of this cache's records (at least one). */
  const shrink = async (expected: string | null) => transaction(await connect(), 'readwrite', async (entries, blobs, control) => {
    if (!await matches(control, expected)) return false;
    const rows = (await ask(entries.getAll()) as unknown[]).filter(row => entry(row, limits)).sort((a, b) => a.usedAt - b.usedAt);
    for (const row of rows.slice(0, Math.max(1, Math.ceil(rows.length / 2)))) removeRows(entries, blobs, row.id);
    return rows.length > 0;
  });
  const empty = async () => {
    const next = crypto.randomUUID();
    await transaction(await connect(), 'readwrite', async (entries, blobs, control) => {
      entries.clear(); blobs.clear(); control.put({ id: 'generation', value: next });
    });
    generation = next;
  };

  return Object.freeze({
    ready: () => ready,
    read: (partition: string, key: string) => enqueue(async () => {
      await ready;
      const [partitionId, id] = await Promise.all([digest(partition), digest(partition, key)]);
      return load(partitionId, id);
    }, null),
    write(partition: string, slot: string, key: string, bytes: Uint8Array) {
      // Capture synchronously: a write called before initialization must not
      // acquire a generation established after another page has cleared it.
      const expected = generation;
      if (expected === null || bytes.byteLength === 0 || bytes.byteLength > limits.entryBytes || bytes.byteLength > limits.bytes) return;
      const data = bytes.slice().buffer;
      void enqueue(async () => {
        const [partitionId, slotId, id] = await Promise.all([digest(partition), digest(partition, slot), digest(partition, key)]);
        try { await store(partitionId, slotId, id, data, expected); return; } catch (error) { if (!quota(error)) throw error; }
        // Origin storage is fuller than this cache's own bound: give way in
        // halves, oldest used first, until the record fits or nothing is left.
        while (await shrink(expected)) {
          try { await store(partitionId, slotId, id, data, expected); return; } catch (error) { if (!quota(error)) throw error; }
        }
      }, undefined);
    },
    compareExchange(partition: string, slot: string, key: string, expected: Uint8Array | null, bytes: Uint8Array) {
      const expectedGeneration = generation;
      if (expectedGeneration === null || bytes.byteLength === 0 || bytes.byteLength > limits.entryBytes || bytes.byteLength > limits.bytes
        || (expected !== null && expected.byteLength > limits.entryBytes)) return Promise.resolve(false);
      const previous = expected?.slice() ?? null, data = bytes.slice().buffer;
      return enqueue(async () => {
        const [partitionId, slotId, id] = await Promise.all([digest(partition), digest(partition, slot), digest(partition, key)]);
        return transaction(await connect(), 'readwrite', async (entries, blobs, control) => {
          if (!await matches(control, expectedGeneration)) return false;
          const row: unknown = await ask(entries.get(id));
          const blob = await ask(blobs.get(id)) as Blob | undefined;
          if (previous === null) {
            if (row !== undefined || blob !== undefined) return false;
          } else {
            if (!entry(row, limits) || row.partition !== partitionId || row.slot !== slotId || !(row.usedAt + limits.unusedMs > Date.now())
              || !blob || !(blob.data instanceof ArrayBuffer) || blob.data.byteLength !== row.bytes || row.bytes !== previous.byteLength) return false;
            const current = new Uint8Array(blob.data);
            if (!current.every((value, index) => value === previous[index])) return false;
          }
          // The preimage, generation and replacement share this transaction;
          // another handle cannot change the witness between them. Existing
          // bounds and eviction apply, and any quota/abort fails the exchange.
          await storeRows(entries, blobs, partitionId, slotId, id, data);
          return true;
        });
      }, false);
    },
    remove(partition: string, key: string) {
      void enqueue(async () => {
        await ready;
        const id = await digest(partition, key);
        await transaction(await connect(), 'readwrite', async (entries, blobs, control) => {
          if (await matches(control, generation)) removeRows(entries, blobs, id);
        });
      }, undefined);
    },
    clear: () => enqueue(async () => { await ready; await empty(); }, undefined),
    close: async () => {
      await ready;
      await enqueue(async () => undefined, undefined);
      closed = true;
      const open = connection; connection = null;
      if (open) await open.then(db => db.close(), () => undefined);
    },
  });
}
