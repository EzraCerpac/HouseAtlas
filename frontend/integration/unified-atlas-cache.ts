import { openVerifiedByteCache, type NativeGeometryScanCache, type ScanCacheLimits } from './native-geometry-scan-cache';

/** Persistent unified Atlas cache: the last verified scene envelope for each
 * publication and overview manifest, and the model bytes it pins, in this
 * origin's IndexedDB. Records are partitioned by the signed-in actor and home
 * and named by digests, as in the scan cache, and sign-out deletes them all.
 * Holding a record grants nothing. Model bytes stand in for a GET only after a
 * fresh scene pins their exact digest; a stored scene is shown only as the
 * last loaded copy while the fresh read runs. No session, token, descriptor
 * header or other API response is stored. Every operation is best effort. */

export const ATLAS_CACHE_DATABASE = 'houseatlas-atlas-model-cache-v1';
const MiB = 1024 * 1024;
/** Room for two models with their scenes; the oldest used records give way first. */
export const ATLAS_CACHE_LIMITS: ScanCacheLimits = Object.freeze({
  entries: 8, bytes: 96 * MiB, entryBytes: 33 * MiB, unusedMs: 30 * 24 * 60 * 60 * 1000,
});

export interface StoredAtlasScene {
  readonly envelope: Uint8Array<ArrayBuffer>;
  readonly entryBuildingId: string | null;
  /** When this page's predecessor kept the scene; display only. */
  readonly storedAt: string;
}
/** One actor and home's view of the persistent store. */
export interface UnifiedAtlasCache {
  scene(publicationId: string, manifestSha256: string): Promise<StoredAtlasScene | null>;
  model(sha256: string, bytes: number): Promise<Uint8Array<ArrayBuffer> | null>;
  keepScene(publicationId: string, manifestSha256: string, envelope: Uint8Array, envelopeSha256: string, entryBuildingId: string | null): void;
  keepModel(sha256: string, bytes: Uint8Array): void;
}

export function openUnifiedAtlasStore(factory: IDBFactory | undefined, limits?: Partial<ScanCacheLimits>): NativeGeometryScanCache {
  return openVerifiedByteCache(factory, ATLAS_CACHE_DATABASE, ATLAS_CACHE_LIMITS, limits);
}

const HEAD = 4;
/** Stored scene record: a 4-byte big-endian length, its UTF-8 JSON metadata, then the exact envelope bytes. */
function pack(meta: object, envelope: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(meta)), out = new Uint8Array(HEAD + head.byteLength + envelope.byteLength);
  new DataView(out.buffer).setUint32(0, head.byteLength); out.set(head, HEAD); out.set(envelope, HEAD + head.byteLength); return out;
}
function unpack(record: Uint8Array): { meta: Record<string, unknown>; envelope: Uint8Array<ArrayBuffer> } | null {
  if (record.byteLength < HEAD) return null;
  const length = new DataView(record.buffer, record.byteOffset, record.byteLength).getUint32(0);
  if (length > record.byteLength - HEAD) return null;
  try {
    const meta: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(record.subarray(HEAD, HEAD + length)));
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return null;
    return { meta: meta as Record<string, unknown>, envelope: record.slice(HEAD + length) };
  } catch { return null; }
}

/** Bind the store to the authenticated actor and home that every key is partitioned by. */
export function createUnifiedAtlasCache(store: NativeGeometryScanCache,
  owner: { readonly actorId: string; readonly workspaceId: string; readonly homeId: string }): UnifiedAtlasCache {
  const partition = JSON.stringify(['unified-atlas', owner.actorId, owner.workspaceId, owner.homeId]);
  const sceneKey = (publicationId: string, manifestSha256: string) => JSON.stringify(['scene', publicationId, manifestSha256]);
  // The scene this page knows is in the one scene slot, so an unchanged scene is not written again.
  let persisted: string | null = null;
  return Object.freeze({
    async scene(publicationId: string, manifestSha256: string) {
      const record = await store.read(partition, sceneKey(publicationId, manifestSha256));
      const parsed = record && unpack(record);
      if (!parsed) return null;
      const { meta, envelope } = parsed;
      if (meta.publicationId !== publicationId || meta.manifestSha256 !== manifestSha256 || typeof meta.storedAt !== 'string'
        || typeof meta.envelopeSha256 !== 'string' || !(meta.entryBuildingId === null || typeof meta.entryBuildingId === 'string')) return null;
      persisted = `${sceneKey(publicationId, manifestSha256)}/${meta.envelopeSha256}`;
      return { envelope, entryBuildingId: meta.entryBuildingId, storedAt: meta.storedAt };
    },
    async model(sha256: string, bytes: number) {
      const record = await store.read(partition, JSON.stringify(['model', sha256]));
      return record && record.byteLength === bytes ? new Uint8Array(record) : null;
    },
    keepScene(publicationId: string, manifestSha256: string, envelope: Uint8Array, envelopeSha256: string, entryBuildingId: string | null) {
      const key = sceneKey(publicationId, manifestSha256);
      if (persisted === `${key}/${envelopeSha256}`) return;
      persisted = `${key}/${envelopeSha256}`;
      // One slot: the newest scene for this home replaces earlier ones.
      store.write(partition, 'scene', key, pack({ publicationId, manifestSha256, envelopeSha256, entryBuildingId, storedAt: new Date().toISOString() }, envelope));
    },
    keepModel(sha256: string, bytes: Uint8Array) {
      store.write(partition, 'model', JSON.stringify(['model', sha256]), bytes);
    },
  });
}
