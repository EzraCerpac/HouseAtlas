import type { ModelOverviewSelection } from '../src/lantern/source-models/overview-types';
import { AtlasReadError, type AtlasReadFailure } from '../src/lantern/unified-atlas/types';
import type { UnifiedAtlasOverlayPublicationRoom, UnifiedAtlasOverlayReviewedRoomLinks,
  UnifiedAtlasOverlaySceneSelection } from './unified-atlas-overlay-source';

export const ATLAS_ROOM_LINKS_LIMITS = Object.freeze({ bytes: 1024 * 1024, links: 2048, headers: 16 * 1024, chunks: 16_384, ms: 30_000 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, SHA = /^[0-9a-f]{64}$/;
const OPAQUE = /^[A-Za-z0-9_.:-]{1,128}$/;
const fail = (reason: AtlasReadFailure): never => { throw new AtlasReadError(reason); };
function need(value: unknown, reason: AtlasReadFailure = 'invalid'): asserts value { if (!value) fail(reason); }
function row(value: unknown, keys: readonly string[]): Record<string, unknown> {
  need(value !== null && typeof value === 'object' && !Array.isArray(value));
  const object = value as Record<string, unknown>;
  need(Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key)));
  return object;
}
const text = (value: unknown, pattern: RegExp): string => { need(typeof value === 'string' && pattern.test(value)); return value; };

export interface UnifiedAtlasRoomLinksRead {
  readonly reviewedRoomLinks: UnifiedAtlasOverlayReviewedRoomLinks;
  /** Digest of the exact authenticated map bytes, separate from semantics SHA. */
  readonly sha256: string;
  /** Local monotonic completion time; never supplied by the server. */
  readonly checkedAt: number;
}

/** Passive read of the source owner's independently selected map. The map is
 * documentary input, not a current native grant; the overlay owner must still
 * qualify its actual association, identities, receipt and original documents. */
export async function readUnifiedAtlasRoomLinks(options: {
  readonly selection: ModelOverviewSelection;
  readonly sceneSelection: UnifiedAtlasOverlaySceneSelection;
  readonly publicationRooms: readonly UnifiedAtlasOverlayPublicationRoom[];
  readonly origin: string; readonly signal: AbortSignal; readonly isCurrent: () => boolean;
  readonly transport?: typeof fetch;
}): Promise<UnifiedAtlasRoomLinksRead | null> {
  const { selection, sceneSelection: scene } = options;
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(ATLAS_ROOM_LINKS_LIMITS.ms)]);
  let response: Response | null = null;
  try {
    const origin = new URL(options.origin);
    need(origin.origin === options.origin && origin.protocol === 'https:' && !origin.username && !origin.password);
    need(UUID.test(scene.workspaceId) && UUID.test(scene.homeId) && UUID.test(scene.publicationId)
      && SHA.test(scene.semanticsSha256) && OPAQUE.test(scene.revision)
      && scene.workspaceId === selection.scope.workspaceId && scene.homeId === selection.scope.homeId
      && scene.publicationId === selection.publicationId && SHA.test(selection.manifestSha256));
    const guard = () => { signal.throwIfAborted(); need(options.isCurrent() && Date.parse(selection.expiresAt) > Date.now(), 'stale'); };
    const path = `/api/atlas/models/v1/workspaces/${scene.workspaceId}/homes/${scene.homeId}/atlas/${scene.publicationId}/room-links`
      + `?expectedSemanticsSha256=${scene.semanticsSha256}&expectedSelectionRevision=${encodeURIComponent(scene.revision)}`;
    const url = new URL(path, origin).href;
    guard();
    response = await (options.transport ?? fetch)(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store',
      redirect: 'error', signal, headers: { Accept: 'application/json' } });
    guard();
    if (response.status === 404) { void response.body?.cancel().catch(() => undefined); return null; }
    need(response.status !== 409 && response.status !== 412, 'stale');
    let headers = 0; response.headers.forEach((value, key) => { headers += value.length + key.length; });
    const length = response.headers.get('content-length');
    need(headers <= ATLAS_ROOM_LINKS_LIMITS.headers && response.status === 200 && !response.redirected
      && (!response.url || response.url === url)
      && response.headers.get('content-type')?.split(';')[0]?.trim() === 'application/json'
      && response.headers.get('cache-control') === 'private, no-store'
      && response.headers.get('x-content-type-options') === 'nosniff', 'unavailable');
    need(length !== null && /^(0|[1-9][0-9]{0,6})$/.test(length) && Number(length) <= ATLAS_ROOM_LINKS_LIMITS.bytes, 'too-large');
    need(response.headers.get('x-atlas-selection-revision') === scene.revision, 'stale');
    const reader = response.body?.getReader(); need(reader, 'unavailable');
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    const chunks: Uint8Array[] = []; let size = 0;
    signal.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        guard(); const part = await reader.read(); guard(); if (part.done) break;
        need(chunks.length < ATLAS_ROOM_LINKS_LIMITS.chunks && part.value.byteLength <= ATLAS_ROOM_LINKS_LIMITS.bytes - size, 'too-large');
        chunks.push(part.value.slice()); size += part.value.byteLength;
      }
    } catch (error) { cancel(); throw error; }
    finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
    need(size === Number(length));
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); guard();
    const sha256 = [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
    need(response.headers.get('content-digest') === `sha-256=:${btoa(String.fromCharCode(...digest))}:`);
    need(response.headers.get('x-atlas-selection-revision') === scene.revision, 'stale');
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('invalid'); }
    const map = row(value, ['profile', 'workspaceId', 'homeId', 'publicationId', 'semanticsSha256', 'links']);
    need(map.profile === 'houseatlas.unified-atlas-room-links.v1' && map.workspaceId === scene.workspaceId && map.homeId === scene.homeId
      && map.publicationId === scene.publicationId && map.semanticsSha256 === scene.semanticsSha256
      && Array.isArray(map.links) && map.links.length <= ATLAS_ROOM_LINKS_LIMITS.links);
    const rooms = new Map(options.publicationRooms.map(room => [room.roomId, room]));
    need(rooms.size === options.publicationRooms.length);
    const roomIds = new Set<string>(), triples = new Set<string>();
    const links = map.links.map(item => {
      const link = row(item, ['roomId', 'nativePlaceId', 'packagePlaceKey', 'packagePlaceUuid']);
      const roomId = text(link.roomId, OPAQUE), nativePlaceId = text(link.nativePlaceId, UUID),
        packagePlaceKey = text(link.packagePlaceKey, OPAQUE), packagePlaceUuid = text(link.packagePlaceUuid, UUID);
      const triple = JSON.stringify([nativePlaceId, packagePlaceKey, packagePlaceUuid]);
      need(!roomIds.has(roomId) && !triples.has(triple) && rooms.get(roomId)?.nativePlaceId === nativePlaceId);
      roomIds.add(roomId); triples.add(triple);
      return Object.freeze({ roomId, nativePlaceId, packagePlaceKey, packagePlaceUuid });
    });
    const reviewedRoomLinks: UnifiedAtlasOverlayReviewedRoomLinks = Object.freeze({ profile: 'houseatlas.unified-atlas-room-links.v1',
      workspaceId: scene.workspaceId, homeId: scene.homeId, publicationId: scene.publicationId,
      semanticsSha256: scene.semanticsSha256, links: Object.freeze(links) });
    guard(); return Object.freeze({ reviewedRoomLinks, sha256, checkedAt: performance.now() });
  } catch (error) {
    void response?.body?.cancel().catch(() => undefined);
    if (error instanceof AtlasReadError || options.signal.aborted) throw error;
    throw new AtlasReadError('unavailable');
  }
}
