import type { ModelOverviewSelection } from '../src/lantern/source-models/overview-types';
import { admitAtlasScene, ATLAS_LIMITS } from '../src/lantern/unified-atlas/scene';
import { AtlasReadError, type AtlasReadFailure, type StoredAtlasRead, type UnifiedAtlasRead } from '../src/lantern/unified-atlas/types';
import type { UnifiedAtlasCache } from './unified-atlas-cache';

/** Opt-in unified Atlas read for the selected overview publication: one
 * scene envelope, then its pinned model bytes for the same selection revision.
 * Same-origin HTTPS, no cache, no redirect, exact type/length/digest, and the
 * host's current selection, session and expiry are checked around every step.
 * A missing companion is reported as absent; nothing else is substituted.
 * With `cache`, the scene is always read afresh, but model bytes stored for
 * the exact digest that fresh scene pins are used instead of a second GET, and
 * every verified read is kept for the next start. */
export const UNIFIED_ATLAS_READ_LIMITS = Object.freeze({ headers: 16 * 1024, chunks: 16_384, ms: 30_000 });
const JSON_MIME = 'application/json', MODEL_MIME = 'model/gltf-binary';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, SHA = /^[0-9a-f]{64}$/;
function fail(reason: AtlasReadFailure): never { throw new AtlasReadError(reason); }
function need(ok: unknown, reason: AtlasReadFailure = 'unavailable'): asserts ok { if (!ok) fail(reason); }
const base64 = (bytes: Uint8Array) => { let text = ''; for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000)); return btoa(text); };
const hex = (bytes: Uint8Array) => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');

/** Owns the response body from the first check: any refusal cancels it. */
async function receive(response: Response, cap: number, expected: number | null, signal: AbortSignal, guard: () => void): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader(); need(reader);
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    const length = response.headers.get('content-length');
    need(length === null || (/^(0|[1-9][0-9]{0,9})$/.test(length) && Number(length) <= cap), 'too-large');
    need(expected === null || length === String(expected));
    for (;;) {
      guard(); const part = await reader.read(); guard(); if (part.done) break;
      need(chunks.length < UNIFIED_ATLAS_READ_LIMITS.chunks);
      need(part.value.byteLength <= cap - size, 'too-large');
      size += part.value.byteLength; chunks.push(part.value.slice());
    }
    need((length === null || Number(length) === size) && (expected === null || expected === size));
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; } return bytes;
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

/** A local lookup slower than this is skipped in favour of the network. */
export const CACHE_LOOKUP_MS = 3_000;
/** A slow or failing local store never delays the network read for long. */
function lookup<T>(pending: Promise<T | null>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([pending.catch(() => null), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), CACHE_LOOKUP_MS); })])
    .finally(() => clearTimeout(timer));
}

/** The last verified read of this exact publication and overview manifest,
 * from local storage only, for display while the fresh read runs. It is
 * admitted against the selection exactly as a fresh envelope is, and its model
 * must hash to the digest it pins; anything else is null, never an error. */
export async function readCachedUnifiedAtlas(options: {
  readonly selection: ModelOverviewSelection; readonly signal: AbortSignal; readonly cache: UnifiedAtlasCache;
}): Promise<StoredAtlasRead | null> {
  const { selection, cache, signal } = options;
  try {
    const stored = await lookup(cache.scene(selection.publicationId, selection.manifestSha256)); signal.throwIfAborted();
    if (!stored) return null;
    let json: unknown;
    try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stored.envelope)); } catch { return null; }
    const scene = admitAtlasScene(json, { scope: selection.scope, publicationId: selection.publicationId }, stored.envelope.byteLength);
    if (stored.entryBuildingId !== null && !scene.buildings.some(building => building.buildingId === stored.entryBuildingId)) return null;
    const model = await lookup(cache.model(scene.model.sha256, scene.model.bytes)); signal.throwIfAborted();
    if (!model || model.byteLength !== scene.model.bytes
      || hex(new Uint8Array(await crypto.subtle.digest('SHA-256', model))) !== scene.model.sha256) return null;
    const envelopeSha256 = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', stored.envelope))); signal.throwIfAborted();
    return { scene, model, entryBuildingId: stored.entryBuildingId, envelopeSha256, storedAt: stored.storedAt };
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

export async function readUnifiedAtlas(options: {
  readonly selection: ModelOverviewSelection; readonly signal: AbortSignal; readonly origin: string;
  readonly isCurrent: () => boolean; readonly transport?: typeof fetch; readonly cache?: UnifiedAtlasCache;
}): Promise<UnifiedAtlasRead> {
  const { selection, isCurrent } = options;
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(UNIFIED_ATLAS_READ_LIMITS.ms)]);
  try {
    const origin = new URL(options.origin);
    need(origin.origin === options.origin && origin.protocol === 'https:' && !origin.username && !origin.password);
    need(UUID.test(selection.scope.workspaceId) && UUID.test(selection.scope.homeId) && UUID.test(selection.publicationId)
      && SHA.test(selection.manifestSha256));
    const guard = () => { signal.throwIfAborted(); need(isCurrent() && Date.parse(selection.expiresAt) > Date.now(), 'stale'); };
    const path = `/api/atlas/models/v1/workspaces/${selection.scope.workspaceId}/homes/${selection.scope.homeId}/atlas`;
    const get = async (href: string, mime: string) => {
      guard(); const url = new URL(href, origin).href;
      const response = await (options.transport ?? fetch)(url, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, headers: { Accept: mime },
      });
      try {
        guard();
        need(response.status !== 404 || mime !== JSON_MIME, 'absent');
        need(response.status !== 409 && response.status !== 412, 'stale');
        let headerBytes = 0; response.headers.forEach((value, key) => { headerBytes += value.length + key.length; });
        need(headerBytes <= UNIFIED_ATLAS_READ_LIMITS.headers && response.status === 200 && !response.redirected
          && (!response.url || response.url === url)
          && response.headers.get('content-type')?.split(';')[0]?.trim() === mime
          && response.headers.get('cache-control') === 'private, no-store'
          && response.headers.get('x-content-type-options') === 'nosniff');
        return response;
      } catch (error) { void response.body?.cancel().catch(() => undefined); throw error; }
    };

    const descriptor = await get(`${path}?expectedManifestSha256=${selection.manifestSha256}`, JSON_MIME);
    const servedManifest = () => need(descriptor.headers.get('x-atlas-overview-manifest-sha256') === selection.manifestSha256, 'stale');
    // Pin the exact overview selected by this owner, independently of the
    // model, source and companion digests. Check before consuming its body.
    try { servedManifest(); } catch (error) { void descriptor.body?.cancel().catch(() => undefined); throw error; }
    const envelope = await receive(descriptor, ATLAS_LIMITS.envelopeBytes, null, signal, guard);
    let json: unknown;
    try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(envelope)); } catch { fail('invalid'); }
    // Every count, size and reference is admitted before the model is requested.
    const scene = admitAtlasScene(json, { scope: selection.scope, publicationId: selection.publicationId }, envelope.byteLength);
    const entryBuildingId = descriptor.headers.get('x-atlas-entry-building-id');
    need(entryBuildingId === null || scene.buildings.some(building => building.buildingId === entryBuildingId), 'invalid');
    servedManifest(); guard();
    const revision = scene.selection.revision;
    // The scene was served for the selection revision it names.
    need(descriptor.headers.get('x-atlas-selection-revision') === revision, 'stale');
    const href = `${path}/${selection.publicationId}/artifacts/model?expectedSha256=${scene.model.sha256}&expectedSelectionRevision=${encodeURIComponent(revision)}`;
    need(scene.model.href === href, 'invalid');
    const envelopeSha256 = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', envelope))); guard();
    const keepScene = () => options.cache?.keepScene(selection.publicationId, selection.manifestSha256, envelope, envelopeSha256, entryBuildingId);
    if (options.cache) {
      // Stored bytes stand in for the GET only when they hash to the digest this fresh scene pins.
      const stored = await lookup(options.cache.model(scene.model.sha256, scene.model.bytes)); guard();
      if (stored && stored.byteLength === scene.model.bytes && hex(new Uint8Array(await crypto.subtle.digest('SHA-256', stored))) === scene.model.sha256) {
        guard(); keepScene();
        return { scene, model: stored, entryBuildingId, envelopeSha256 };
      }
    }
    const body = await get(href, MODEL_MIME);
    try {
      // The model's served revision is checked before and after the byte work.
      const served = () => need(body.headers.get('x-atlas-selection-revision') === revision, 'stale');
      served();
      const bytes = await receive(body, scene.model.bytes, scene.model.bytes, signal, guard);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); guard();
      need(hex(digest) === scene.model.sha256 && body.headers.get('content-digest') === `sha-256=:${base64(digest)}:`, 'invalid');
      served(); guard();
      options.cache?.keepModel(scene.model.sha256, bytes); keepScene();
      return { scene, model: bytes, entryBuildingId, envelopeSha256 };
    } catch (error) { void body.body?.cancel().catch(() => undefined); throw error; }
  } catch (error) {
    if (error instanceof AtlasReadError) throw error;
    // The caller's own withdrawal stays an abort; a deadline or transport failure is unavailable.
    if (options.signal.aborted) throw error;
    throw new AtlasReadError('unavailable');
  }
}
