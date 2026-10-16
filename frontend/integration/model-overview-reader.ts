import { parseLosslessJson, type LosslessJson } from '../src/numeric/lossless-json';
import { isExactDecimal } from '../src/numeric/decimal';
import type { ModelOverviewAsset, ModelOverviewSelection } from '../src/lantern/source-models/overview-types';

const PROFILE = 'houseatlas.model-overview-read.v1', MIME = 'model/gltf-binary';
export const MODEL_OVERVIEW_LIMITS = Object.freeze({ descriptor: 128 * 1024, bytes: 32 * 1024 * 1024, headers: 16 * 1024, chunks: 8192, ms: 15000 });
type Row = { [key: string]: LosslessJson };
const SHA = /^[0-9a-f]{64}$/;
function need(value: unknown): asserts value { if (!value) throw new Error('Saved model is unavailable for the current home'); }
function row(value: LosslessJson | undefined, keys: readonly string[]): Row {
  need(value && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value));
  need(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))); return value;
}
function text(value: LosslessJson | undefined, max: number): string {
  need(typeof value === 'string' && [...value].length > 0 && [...value].length <= max && !/[\u0000-\u001f\u007f]/.test(value)); return value;
}
function sha(value: LosslessJson | undefined): string { need(typeof value === 'string' && SHA.test(value)); return value; }
function bytesCount(value: LosslessJson | undefined): number {
  need(isExactDecimal(value) && /^[1-9][0-9]{0,7}$/.test(value.token));
  const count = value.toSafeInteger(); need(count !== undefined && count <= MODEL_OVERVIEW_LIMITS.bytes); return count;
}
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const hex = (bytes: Uint8Array) => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
const canonical = (value: LosslessJson): string => {
  if (typeof value === 'string') return JSON.stringify(value);
  need(value && typeof value === 'object');
  if (isExactDecimal(value)) { need(/^(0|[1-9][0-9]*)$/.test(value.token)); return value.token; }
  need(!Array.isArray(value));
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
};
function parse(bytes: Uint8Array): LosslessJson { return parseLosslessJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
function scope(value: LosslessJson | undefined, selected: ModelOverviewSelection): void {
  const found = row(value, ['workspaceId', 'homeId']);
  need(found.workspaceId === selected.scope.workspaceId && found.homeId === selected.scope.homeId);
}
function selectedPins(value: Row, selected: ModelOverviewSelection): void {
  need(value.publicationId === selected.publicationId && value.manifestSha256 === selected.manifestSha256); scope(value.scope, selected);
}
function original(value: LosslessJson | undefined, keys: readonly string[]) {
  const asset = row(value, keys); need(asset.contentType === MIME);
  return { sha256: sha(asset.sha256), bytes: bytesCount(asset.bytes), raw: asset };
}
async function receive(response: Response, cap: number, expected: number | null, signal: AbortSignal, guard: () => void): Promise<Uint8Array<ArrayBuffer>> {
  const length = response.headers.get('content-length');
  need(length === null || (/^(0|[1-9][0-9]{0,8})$/.test(length) && Number(length) <= cap));
  need(expected === null || length === String(expected));
  const reader = response.body?.getReader(); need(reader);
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      guard(); const part = await reader.read(); guard(); if (part.done) break;
      need(chunks.length < MODEL_OVERVIEW_LIMITS.chunks && part.value.byteLength <= cap - size);
      size += part.value.byteLength; chunks.push(part.value.slice());
    }
    need((length === null || Number(length) === size) && (expected === null || expected === size));
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; } return bytes;
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

/** Fresh read per selected owner. No persistent cache, public URL or fallback
 * publication. The standard renderer independently admits the resulting Blob. */
export async function readModelOverview(options: {
  readonly selection: ModelOverviewSelection; readonly signal: AbortSignal; readonly origin: string;
  readonly isCurrent: () => boolean; readonly transport?: typeof fetch;
}): Promise<ModelOverviewAsset> {
  const { selection, isCurrent } = options, origin = new URL(options.origin);
  need(origin.origin === options.origin && origin.protocol === 'https:' && !origin.username && !origin.password);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  need(uuid.test(selection.scope.workspaceId) && uuid.test(selection.scope.homeId) && uuid.test(selection.publicationId)
    && SHA.test(selection.manifestSha256));
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(MODEL_OVERVIEW_LIMITS.ms)]);
  const guard = () => { signal.throwIfAborted(); need(isCurrent() && Date.parse(selection.expiresAt) > Date.now()); };
  const path = `/api/atlas/models/v1/workspaces/${selection.scope.workspaceId}/homes/${selection.scope.homeId}/overview`;
  const get = async (href: string, mime: string) => {
    guard(); const response = await (options.transport ?? fetch)(new URL(href, origin).href, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, headers: { Accept: mime },
    });
    try {
      guard(); let headerBytes = 0; response.headers.forEach((value, key) => { headerBytes += value.length + key.length; });
      need(headerBytes <= MODEL_OVERVIEW_LIMITS.headers && response.status === 200 && !response.redirected
        && (!response.url || response.url === new URL(href, origin).href)
        && response.headers.get('content-type')?.split(';')[0]?.trim() === mime
        && response.headers.get('cache-control') === 'private, no-store'
        && response.headers.get('x-content-type-options') === 'nosniff'); return response;
    } catch (error) { void response.body?.cancel().catch(() => undefined); throw error; }
  };
  const response = await get(path, 'application/json');
  const descriptor = row(parse(await receive(response, MODEL_OVERVIEW_LIMITS.descriptor, null, signal, guard)),
    ['profile', 'scope', 'publicationId', 'manifestSha256', 'label', 'qualification', 'frame', 'components', 'sourceNote', 'original']);
  guard(); need(descriptor.profile === PROFILE && descriptor.qualification === 'provisional-overview'); selectedPins(descriptor, selection);
  const frame = row(descriptor.frame, ['linearUnit', 'upAxis', 'placement', 'physicalRegistration']);
  need(frame.linearUnit === 'm' && frame.upAxis === 'Y' && frame.placement === 'baked-in-asset' && frame.physicalRegistration === null);
  const label = text(descriptor.label, 128);
  need(descriptor.sourceNote === null || (typeof descriptor.sourceNote === 'string' && [...descriptor.sourceNote].length <= 2048));
  const sourceNote = descriptor.sourceNote;
  need(Array.isArray(descriptor.components) && descriptor.components.length <= 256);
  const ids = new Set<string>();
  const components = descriptor.components.map<ModelOverviewAsset['components'][number]>(value => {
    const component = row(value, ['id', 'kind', 'label']), id = text(component.id, 128);
    need(/^[A-Za-z0-9_.-]+$/.test(id) && !ids.has(id)); ids.add(id);
    need(component.kind === 'building' || component.kind === 'plot' || component.kind === 'context');
    return { id, kind: component.kind, label: text(component.label, 128) };
  });
  const asset = original(descriptor.original, ['contentType', 'sha256', 'bytes', 'href']);
  const href = `${path}/${selection.publicationId}/original?expectedSha256=${asset.sha256}`;
  need(asset.raw.href === href);
  const body = await get(href, MIME);
  try {
    const encoded = body.headers.get('x-atlas-model-frame');
    need(encoded && encoded.length <= 8192 && /^[A-Za-z0-9_-]+$/.test(encoded) && encoded.length % 4 !== 1);
    const frameBytes = Uint8Array.from(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
    need(base64(frameBytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') === encoded);
    const decoded = parse(frameBytes); need(canonical(decoded) === new TextDecoder().decode(frameBytes));
    const wire = row(decoded, ['profile', 'scope', 'publicationId', 'manifestSha256', 'original']);
    need(wire.profile === 'houseatlas.model-overview-bytes.v1'); selectedPins(wire, selection);
    const pin = original(wire.original, ['contentType', 'sha256', 'bytes']); need(pin.sha256 === asset.sha256 && pin.bytes === asset.bytes);
    const bytes = await receive(body, asset.bytes, asset.bytes, signal, guard);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); guard();
    need(hex(digest) === asset.sha256 && body.headers.get('content-digest') === `sha-256=:${base64(digest)}:`);
    return { blob: new Blob([bytes], { type: MIME }), label, publicationId: selection.publicationId, sourceNote, components };
  } catch (error) { void body.body?.cancel().catch(() => undefined); throw error; }
}
