import { openVerifiedByteCache, type NativeGeometryScanCache, type ScanCacheLimits } from './native-geometry-scan-cache';

/** Persistent unified Atlas cache: the last verified scene envelope for each
 * publication and overview manifest, the model bytes it pins, and the overlay
 * records last projected for that scene, in this origin's IndexedDB. Records
 * are partitioned by the signed-in actor and home and named by digests, as in
 * the scan cache, and sign-out deletes them all.
 * Holding a record grants nothing. Model bytes stand in for a GET only after a
 * fresh scene pins their exact digest; a stored scene is shown only as the
 * last loaded copy while the fresh read runs, and stored overlay records only
 * while no current overlay frame is held. No session, token, descriptor header,
 * native document or other API response is stored. Every operation is best effort.
 * A non-secret canonical-actor witness selects the last-copy pointer. A stale
 * read can keep bytes in its own partition, but cannot select another account's
 * offline copy or restore a pointer from before an account change. */

export const ATLAS_CACHE_DATABASE = 'houseatlas-atlas-model-cache-v1';
const MiB = 1024 * 1024;
/** Room for models, scenes, overlays and display metadata. The actor witness
 * counts within these bounds; older content gives way before that witness. */
export const ATLAS_CACHE_LIMITS: ScanCacheLimits = Object.freeze({
  entries: 10, bytes: 96 * MiB, entryBytes: 33 * MiB, unusedMs: 30 * 24 * 60 * 60 * 1000,
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
  /** The overlay records stored for exactly this scene, as their kept bytes. Display only. */
  overlays(publicationId: string, revision: string, semanticsSha256: string): Promise<Uint8Array<ArrayBuffer> | null>;
  keepOverlays(publicationId: string, revision: string, semanticsSha256: string, bytes: Uint8Array): void;
}

export function openUnifiedAtlasStore(factory: IDBFactory | undefined, limits?: Partial<ScanCacheLimits>): NativeGeometryScanCache {
  return openVerifiedByteCache(factory, ATLAS_CACHE_DATABASE, ATLAS_CACHE_LIMITS, limits,
    { partition: LAST_PARTITION, key: ACTOR_KEY });
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

/** The actor, home and publication whose scene the live app last read fresh on this device. */
export interface LastAtlasPointer {
  readonly actorId: string; readonly workspaceId: string; readonly homeId: string;
  readonly publicationId: string; readonly manifestSha256: string;
  readonly actorRevision: string;
}
/** Display ownership only, issued after a canonical session observation.
 * Neither field authenticates a session or authorizes a live operation. */
export interface AtlasCacheActor { readonly actorId: string; readonly revision: string }
const LAST_PARTITION = JSON.stringify(['unified-atlas-last']), ACTOR_KEY = 'actor';
const POINTER_FIELDS = ['actorId', 'workspaceId', 'homeId', 'publicationId', 'manifestSha256', 'actorRevision'] as const;
const pointerKey = (actor: AtlasCacheActor) => JSON.stringify(['pointer', actor.actorId, actor.revision]);
function parseAtlasActor(bytes: Uint8Array | null): AtlasCacheActor | null {
  if (!bytes) return null;
  try {
    const row: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!row || typeof row !== 'object' || !('actorId' in row) || !('revision' in row)
      || typeof row.actorId !== 'string' || row.actorId === '' || typeof row.revision !== 'string' || row.revision === '') return null;
    return Object.freeze({ actorId: row.actorId, revision: row.revision });
  } catch { return null; }
}
async function readAtlasActor(store: NativeGeometryScanCache): Promise<AtlasCacheActor | null> {
  return parseAtlasActor(await store.read(LAST_PARTITION, ACTOR_KEY));
}

/** Call only for a completed canonical session result, never a pending/offline
 * session read. Null withdraws display ownership. Preserve the witness for the
 * same actor; returning after another actor requires a new revision and fresh
 * scene. No cookie, CSRF, session DTO or live authority is persisted. */
export async function observeUnifiedAtlasActor(store: NativeGeometryScanCache, actorId: string | null,
  isCurrent: () => boolean = () => true): Promise<AtlasCacheActor | null> {
  await store.ready();
  if (!store.compareExchange) return null;
  const previous = await store.read(LAST_PARTITION, ACTOR_KEY);
  const current = parseAtlasActor(previous);
  if (!isCurrent()) return null;
  if (actorId !== null && current?.actorId === actorId) return current;
  const actor = actorId === null || actorId === '' ? null : { actorId, revision: crypto.randomUUID() };
  const bytes = new TextEncoder().encode(JSON.stringify(actor));
  if (!await store.compareExchange(LAST_PARTITION, ACTOR_KEY, ACTOR_KEY, previous, bytes)) return null;
  // Retire the known prior pointer; a late old writer may recreate only its
  // obsolete revision key. A failed exchange removes nothing. All metadata
  // still shares the store's fixed bounds.
  if (current) store.remove(LAST_PARTITION, pointerKey(current));
  // A later account observation may already have replaced this successful
  // exchange. Do not return its obsolete allocation or retry over that actor.
  const observed = await readAtlasActor(store);
  return isCurrent() && actor && observed?.actorId === actor.actorId && observed.revision === actor.revision ? observed : null;
}

/** The newest pointer and that actor and home's cache, or null. Like every
 * stored record it grants nothing: the scene and model it leads to are
 * admitted and hashed again before they are shown. */
export async function readLastAtlas(store: NativeGeometryScanCache): Promise<{ readonly pointer: LastAtlasPointer; readonly cache: UnifiedAtlasCache } | null> {
  const actor = await readAtlasActor(store);
  if (!actor) return null;
  const record = await store.read(LAST_PARTITION, pointerKey(actor));
  if (!record) return null;
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(record)); } catch { return null; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!POINTER_FIELDS.every(field => typeof row[field] === 'string' && row[field] !== '')) return null;
  const pointer = Object.freeze(Object.fromEntries(POINTER_FIELDS.map(field => [field, row[field]]))) as unknown as LastAtlasPointer;
  if (pointer.actorId !== actor.actorId || pointer.actorRevision !== actor.revision) return null;
  const current = await readAtlasActor(store);
  if (current?.actorId !== actor.actorId || current.revision !== actor.revision) return null;
  return { pointer, cache: createUnifiedAtlasCache(store, pointer, actor) };
}

/** Bind the store to the authenticated actor and home that every key is partitioned by. */
export function createUnifiedAtlasCache(store: NativeGeometryScanCache,
  owner: { readonly actorId: string; readonly workspaceId: string; readonly homeId: string },
  actor: AtlasCacheActor | null = null): UnifiedAtlasCache {
  const partition = JSON.stringify(['unified-atlas', owner.actorId, owner.workspaceId, owner.homeId]);
  const sceneKey = (publicationId: string, manifestSha256: string) => JSON.stringify(['scene', publicationId, manifestSha256]);
  const overlaysKey = (publicationId: string, revision: string, semanticsSha256: string) =>
    JSON.stringify(['overlays', publicationId, revision, semanticsSha256]);
  // The scene this page knows is in the one scene slot, so an unchanged scene is not written again.
  let persisted: string | null = null, pointed: string | null = null;
  return Object.freeze({
    async scene(publicationId: string, manifestSha256: string) {
      const record = await store.read(partition, sceneKey(publicationId, manifestSha256));
      const parsed = record && unpack(record);
      if (!parsed) return null;
      const { meta, envelope } = parsed;
      if (meta.publicationId !== publicationId || meta.manifestSha256 !== manifestSha256 || typeof meta.storedAt !== 'string'
        || typeof meta.envelopeSha256 !== 'string' || !(meta.entryBuildingId === null || typeof meta.entryBuildingId === 'string')) return null;
      // Stored bytes must still be the envelope the server sent; anything else is neither shown nor kept.
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', envelope));
      if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== meta.envelopeSha256) return null;
      persisted = `${sceneKey(publicationId, manifestSha256)}/${meta.envelopeSha256}`;
      return { envelope, entryBuildingId: meta.entryBuildingId, storedAt: meta.storedAt };
    },
    async model(sha256: string, bytes: number) {
      const record = await store.read(partition, JSON.stringify(['model', sha256]));
      return record && record.byteLength === bytes ? new Uint8Array(record) : null;
    },
    keepScene(publicationId: string, manifestSha256: string, envelope: Uint8Array, envelopeSha256: string, entryBuildingId: string | null) {
      const key = sceneKey(publicationId, manifestSha256);
      // Only a canonical actor witness can select an offline display. Its own
      // pointer key prevents a late A read from replacing B's selected copy.
      if (actor?.actorId === owner.actorId) {
        const pointer = JSON.stringify({ actorId: owner.actorId, workspaceId: owner.workspaceId, homeId: owner.homeId,
          publicationId, manifestSha256, actorRevision: actor.revision });
        if (pointed !== pointer) { pointed = pointer; const key = pointerKey(actor); store.write(LAST_PARTITION, key, key, new TextEncoder().encode(pointer)); }
      }
      if (persisted === `${key}/${envelopeSha256}`) return;
      persisted = `${key}/${envelopeSha256}`;
      // One slot: the newest scene for this home replaces earlier ones.
      store.write(partition, 'scene', key, pack({ publicationId, manifestSha256, envelopeSha256, entryBuildingId, storedAt: new Date().toISOString() }, envelope));
    },
    keepModel(sha256: string, bytes: Uint8Array) {
      store.write(partition, 'model', JSON.stringify(['model', sha256]), bytes);
    },
    async overlays(publicationId: string, revision: string, semanticsSha256: string) {
      const record = await store.read(partition, overlaysKey(publicationId, revision, semanticsSha256));
      const parsed = record && unpack(record);
      // The reader checks the records themselves; these pins only name the scene.
      return parsed && parsed.meta.publicationId === publicationId && parsed.meta.revision === revision
        && parsed.meta.semanticsSha256 === semanticsSha256 ? parsed.envelope : null;
    },
    keepOverlays(publicationId: string, revision: string, semanticsSha256: string, bytes: Uint8Array) {
      // One slot: the newest scene's overlays replace earlier ones.
      store.write(partition, 'overlays', overlaysKey(publicationId, revision, semanticsSha256), pack({ publicationId, revision, semanticsSha256 }, bytes));
    },
  });
}
