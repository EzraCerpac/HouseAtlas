import { ExactDecimal, isExactDecimal } from '../src/numeric/decimal';
import { parseLosslessJson, stringifyLosslessJson, type LosslessJson } from '../src/numeric/lossless-json';
import { createExactStockResultValidator, exactStockSafeInteger } from '../src/numeric/schema-validator';
import type { NativeDocumentAsset, NativeDocumentBinding, NativeDocumentExpected, NativeDocumentFrame,
  NativeDocumentMime, NativeDocumentReadClient } from '../src/lantern/scans/native-document-types';

export interface NativeDocumentReadOptions {
  getBinding(): NativeDocumentBinding | null;
  /** Every replacement or gap must be published synchronously. */
  subscribeBinding(changed: () => void): () => void;
  /** The actual canonical HTTPS native host origin, with no path. */
  readonly origin: string;
  readonly transport?: typeof fetch;
}
export const NATIVE_DOCUMENT_READ_LIMITS = Object.freeze({
  bytes: 10 * 1024 * 1024, metadataBytes: 128 * 1024, headerBytes: 8192,
  chunks: 8192, depth: 16, nodes: 4096, stringLength: 4096, readMs: 15000,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const MIMES: readonly NativeDocumentMime[] = ['application/pdf', 'image/jpeg', 'image/png', 'text/plain'];
const MAX_TIMER = 2_147_483_647;
const ZERO = ExactDecimal.parse('0'), ONE = ExactDecimal.parse('1');
const MAX_BYTES = ExactDecimal.parse(String(NATIVE_DOCUMENT_READ_LIMITS.bytes));
const MAX_REVISION = ExactDecimal.parse('9007199254740991');
type Row = { [key: string]: LosslessJson };

export class NativeDocumentReadError extends Error {
  constructor(readonly status: number | null = null) {
    super('Original document is unavailable for the current view');
    this.name = 'NativeDocumentReadError';
  }
}
function need(condition: unknown): asserts condition { if (!condition) throw new NativeDocumentReadError(); }
function row(value: LosslessJson | undefined): Row {
  need(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value)); return value;
}
function text(value: LosslessJson | undefined): string { need(typeof value === 'string'); return value; }
function integer(value: unknown, minimum: ExactDecimal, maximum: ExactDecimal): ExactDecimal {
  need(isExactDecimal(value) && value.isInteger && value.compare(minimum) >= 0 && value.compare(maximum) <= 0); return value;
}
function expectedTuple(input: NativeDocumentExpected): NativeDocumentExpected {
  need(input && typeof input === 'object');
  const { assetId, sha256, contentType, byteSize: size, revision: retainedRevision } = input;
  need(typeof assetId === 'string' && UUID.test(assetId) && typeof sha256 === 'string' && SHA.test(sha256) && MIMES.includes(contentType));
  const byteSize = integer(size, ZERO, MAX_BYTES);
  const revision = retainedRevision === undefined ? undefined : integer(retainedRevision, ONE, MAX_REVISION);
  return Object.freeze({ assetId, sha256, contentType, byteSize,
    ...(revision === undefined ? {} : { revision }) });
}
function sameAsset(a: NativeDocumentAsset, b: NativeDocumentAsset): boolean {
  return a.assetId === b.assetId && a.revision.compare(b.revision) === 0 && a.byteSize.compare(b.byteSize) === 0
    && a.sha256 === b.sha256 && a.contentType === b.contentType && a.purpose === b.purpose && a.previewPolicy === b.previewPolicy
    && a.sourceLicense.status === b.sourceLicense.status && a.sourceLicense.reference === b.sourceLicense.reference
    && a.evidenceIds.length === b.evidenceIds.length && a.evidenceIds.every((id, index) => id === b.evidenceIds[index]);
}

/** Preflight rejects duplicate keys and bounds the whole graph before the
 * existing lossless parser/closed Stock validator sees it. Only bounded JSON
 * string tokens use JSON.parse; response numbers never pass through it. */
function preflight(source: string, guard: () => void): void {
  let offset = 0, nodes = 0;
  const space = () => { while (offset < source.length && ' \r\n\t'.includes(source[offset]!)) offset++; };
  const string = (): string => {
    need(source[offset] === '"'); const start = offset++; let escaped = false;
    while (offset < source.length) {
      const ch = source[offset++]!; need(offset - start <= NATIVE_DOCUMENT_READ_LIMITS.stringLength * 6 + 2);
      if (!escaped && ch === '"') {
        const result: unknown = JSON.parse(source.slice(start, offset));
        need(typeof result === 'string' && result.length <= NATIVE_DOCUMENT_READ_LIMITS.stringLength); return result;
      }
      if (!escaped && ch === '\\') escaped = true; else escaped = false;
    }
    throw new NativeDocumentReadError();
  };
  const value = (depth: number): void => {
    need(++nodes <= NATIVE_DOCUMENT_READ_LIMITS.nodes && depth <= NATIVE_DOCUMENT_READ_LIMITS.depth); guard(); space();
    const ch = source[offset];
    if (ch === '"') { string(); return; }
    if (ch === '{') {
      offset++; space(); const keys = new Set<string>(); if (source[offset] === '}') { offset++; return; }
      for (;;) {
        const key = string(); need(!keys.has(key)); keys.add(key); space(); need(source[offset++] === ':');
        value(depth + 1); space(); const end = source[offset++]; if (end === '}') return; need(end === ','); space();
      }
    }
    if (ch === '[') {
      offset++; space(); if (source[offset] === ']') { offset++; return; }
      for (;;) { value(depth + 1); space(); const end = source[offset++]; if (end === ']') return; need(end === ','); }
    }
    for (const literal of ['true', 'false', 'null']) if (source.startsWith(literal, offset)) { offset += literal.length; return; }
    const start = offset;
    while (offset < source.length && /[0-9.eE+\-]/.test(source[offset]!)) offset++;
    need(offset > start); ExactDecimal.parse(source.slice(start, offset));
  };
  value(0); space(); need(offset === source.length); guard();
}
function decodeAsset(bytes: Uint8Array, expected: NativeDocumentExpected, scope: NativeDocumentBinding['scope'],
  validator: ReturnType<typeof createExactStockResultValidator>, guard: () => void): NativeDocumentAsset {
  guard(); const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  preflight(source, guard); const raw = parseLosslessJson(source); guard();
  need(validator.validateNativeRead('atlas.asset.get', raw)); guard();
  const root = row(raw), resolved = row(root.resolvedScope), data = row(root.data);
  // This GET's requestId is generated by the server, not a browser request ID.
  need(root.commandId === 'atlas.asset.get' && root.status === 'read' && root.replayed === false
    && resolved.workspaceId === scope.workspaceId && resolved.homeId === scope.homeId
    && data.sourceStatus === 'current' && data.nextCursor === null && Array.isArray(data.records) && data.records.length === 1);
  const record = row(data.records[0]), target = row(record.target), payload = row(record.payload);
  need(target.authority === 'atlas' && target.recordType === 'asset' && target.recordId === expected.assetId
    && record.lifecycle === 'active' && payload.owner === 'atlas' && payload.availability === 'available'
    && (payload.purpose === 'evidence-original' || payload.purpose === 'geometry-original')
    && (payload.previewPolicy === 'safe-rendered' || payload.previewPolicy === 'download-only')
    && payload.contentType === expected.contentType && payload.sha256 === expected.sha256);
  const revision = integer(record.revision, ONE, MAX_REVISION), byteSize = integer(payload.byteSize, ZERO, MAX_BYTES);
  need(byteSize.compare(expected.byteSize) === 0 && (expected.revision === undefined || revision.compare(expected.revision) === 0));
  const license = row(payload.sourceLicense);
  need(license.status === 'unknown' || license.status === 'permitted' || license.status === 'restricted');
  need(Array.isArray(payload.evidenceIds)); guard();
  return Object.freeze({ assetId: expected.assetId, revision, byteSize, contentType: expected.contentType, sha256: expected.sha256,
    purpose: payload.purpose, previewPolicy: payload.previewPolicy,
    sourceLicense: Object.freeze({ status: license.status, reference: license.reference === null ? null : text(license.reference) }),
    evidenceIds: Object.freeze(payload.evidenceIds.map(text)) });
}
function discard(response: Response): void { void response.body?.cancel().catch(() => undefined); }
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => { signal.removeEventListener('abort', stop); reject(signal.reason ?? new NativeDocumentReadError()); };
    signal.addEventListener('abort', stop, { once: true });
    promise.then(value => { signal.removeEventListener('abort', stop); resolve(value); },
      error => { signal.removeEventListener('abort', stop); reject(error); });
    if (signal.aborted) stop();
  });
}
function headers(response: Response, url: string, mime: string, limit: number, expectedLength: number | null): number | null {
  need(response.status === 200 && !response.redirected && response.type !== 'opaque' && response.type !== 'opaqueredirect'
    && (response.url === '' || response.url === url) && response.headers.get('content-type') === mime);
  let total = 0;
  for (const [key, value] of response.headers) {
    total += new TextEncoder().encode(key).byteLength + new TextEncoder().encode(value).byteLength;
    need(total <= NATIVE_DOCUMENT_READ_LIMITS.headerBytes);
  }
  const token = response.headers.get('content-length');
  need(token === null || (/^(0|[1-9][0-9]{0,19})$/.test(token) && ExactDecimal.parse(token).compare(ExactDecimal.parse(String(limit))) <= 0));
  const length = token === null ? null : Number(token); // proven below the small byte bound
  need(expectedLength === null || length === expectedLength); return length;
}
async function receive(response: Response, limit: number, length: number | null, signal: AbortSignal, guard: () => void): Promise<Uint8Array<ArrayBuffer>> {
  guard(); const reader = response.body?.getReader(); need(reader);
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true }); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      guard(); const next = await abortable(reader.read(), signal); guard(); if (next.done) break;
      need(next.value instanceof Uint8Array && chunks.length < NATIVE_DOCUMENT_READ_LIMITS.chunks && next.value.byteLength <= limit - size);
      size += next.value.byteLength; chunks.push(new Uint8Array(next.value));
    }
    need(length === null || size === length); const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { guard(); bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
interface Owner {
  readonly sessionIdentity: object; readonly scopeAllocation: NativeDocumentBinding['scope'];
  readonly scope: NativeDocumentBinding['scope']; readonly expiresAt: string; readonly expiry: number;
}
interface Live { readonly owner: Owner; readonly generation: number;
  blob: Blob | null; readonly listeners: Set<() => void>; }

/** Only explicit reads of the current native original; no issuance, mutation,
 * storage-key handling, persistent byte cache or object URL creation. */
export function createNativeDocumentReadClient(options: NativeDocumentReadOptions): NativeDocumentReadClient {
  const parsed = new URL(options.origin); need(parsed.protocol === 'https:' && parsed.origin === options.origin && !parsed.username && !parsed.password);
  const origin = parsed.origin, transport = options.transport ?? globalThis.fetch, validator = createExactStockResultValidator();
  let owner: Owner | null = null, active: Live | null = null, pending: AbortController | null = null, generation = 0, disposed = false;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const frames = new WeakMap<NativeDocumentFrame, Live>();
  const notify = (callback: () => void) => { try { callback(); } catch { /* Notify every subscriber even if one throws. */ } };
  const invalidate = (): number => {
    // Reserve this operation's generation before external abort/listener callbacks.
    const reserved = ++generation, previous = active, request = pending; active = null; pending = null;
    if (previous) previous.blob = null;
    request?.abort(new NativeDocumentReadError());
    if (previous) { const listeners = [...previous.listeners]; previous.listeners.clear(); for (const callback of listeners) notify(callback); }
    return reserved;
  };
  const clearExpiry = () => { if (expiryTimer !== undefined) clearTimeout(expiryTimer); expiryTimer = undefined; };
  const dropOwner = () => { owner = null; clearExpiry(); return invalidate(); };
  const binding = (): NativeDocumentBinding | null => {
    try {
      const found = options.getBinding();
      return found && typeof found === 'object' && typeof found.sessionIdentity === 'object' && found.sessionIdentity !== null && found.scope
        && UUID.test(found.scope.workspaceId) && UUID.test(found.scope.homeId) && typeof found.expiresAt === 'string'
        && Number.isFinite(Date.parse(found.expiresAt)) && Date.parse(found.expiresAt) > Date.now() ? found : null;
    } catch { return null; }
  };
  const matches = (found: NativeDocumentBinding, captured: Owner) => found.sessionIdentity === captured.sessionIdentity
    && found.scope === captured.scopeAllocation && found.scope.workspaceId === captured.scope.workspaceId
    && found.scope.homeId === captured.scope.homeId && found.expiresAt === captured.expiresAt;
  const scheduleExpiry = () => {
    clearExpiry(); if (disposed || !owner) return;
    const remaining = owner.expiry - Date.now(); if (remaining <= 0) { dropOwner(); return; }
    expiryTimer = setTimeout(() => { expiryTimer = undefined; observe(); scheduleExpiry(); }, Math.min(remaining + 1, MAX_TIMER));
  };
  const observe = (): Owner | null => {
    if (disposed) return null;
    const found = binding();
    if (!found) { if (owner || active || pending) dropOwner(); return null; }
    if (owner && matches(found, owner)) return owner;
    const reserved = dropOwner();
    // Invalidation may reenter the host or start a newer read. Never restore an
    // older binding after callbacks, even if its original scope strings match.
    const latest = binding();
    if (disposed || generation !== reserved || !latest || latest.sessionIdentity !== found.sessionIdentity
      || latest.scope !== found.scope || latest.expiresAt !== found.expiresAt
      || latest.scope.workspaceId !== found.scope.workspaceId || latest.scope.homeId !== found.scope.homeId) return null;
    owner = Object.freeze({ sessionIdentity: latest.sessionIdentity, scopeAllocation: latest.scope,
      scope: Object.freeze({ workspaceId: latest.scope.workspaceId, homeId: latest.scope.homeId }),
      expiresAt: latest.expiresAt, expiry: Date.parse(latest.expiresAt) }); scheduleExpiry(); return owner;
  };
  const unsubscribe = options.subscribeBinding(() => { if (!disposed) { dropOwner(); observe(); } }); observe();
  const current = (live: Live | undefined): live is Live => !!live && !disposed && observe() === live.owner
    && active === live && generation === live.generation && live.blob !== null;
  const loadOriginal = async (input: NativeDocumentExpected, signal: AbortSignal): Promise<NativeDocumentFrame> => {
    const found = observe(), reserved = invalidate(); signal.throwIfAborted(); need(found && generation === reserved);
    const expected = expectedTuple(input), byteSize = exactStockSafeInteger(expected.byteSize);
    need(observe() === found && generation === reserved); signal.throwIfAborted();
    const controller = new AbortController(), deadline = performance.now() + NATIVE_DOCUMENT_READ_LIMITS.readMs;
    const abort = () => controller.abort(signal.reason); pending = controller;
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    const timer = setTimeout(() => controller.abort(new NativeDocumentReadError()), NATIVE_DOCUMENT_READ_LIMITS.readMs);
    const guard = () => { controller.signal.throwIfAborted(); need(performance.now() < deadline && observe() === found && generation === reserved); };
    const get = async (path: string, mime: string, limit: number, length: number | null) => {
      guard(); const url = new URL(path, origin); need(url.origin === origin && url.pathname === path && !url.search && !url.hash);
      const response = await transport(url.href, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        mode: 'same-origin', headers: { Accept: mime, Origin: origin }, signal: controller.signal });
      try {
        guard(); if (response.status !== 200) throw new NativeDocumentReadError(response.status);
        const declared = headers(response, url.href, mime, limit, length);
        guard(); const bytes = await receive(response, limit, declared, controller.signal, guard); guard(); return bytes;
      } catch (error) { discard(response); throw error; }
    };
    const work = async () => {
      const recordPath = `/api/atlas/stock/v3/workspaces/${found.scope.workspaceId}/homes/${found.scope.homeId}/records/asset/${expected.assetId}`;
      guard(); const before = await get(recordPath, 'application/json', NATIVE_DOCUMENT_READ_LIMITS.metadataBytes, null); guard();
      const asset = decodeAsset(before, expected, found.scope, validator, guard);
      // The owner digest is over the canonical descriptor, not the file SHA.
      const descriptor = stringifyLosslessJson({ assetId: asset.assetId, kind: 'atlas-asset' });
      guard(); const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(descriptor)); guard();
      const descriptorSha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      const path = `/api/atlas/media/${found.scope.workspaceId}/${found.scope.homeId}/${descriptorSha256}/download`;
      guard(); const original = await get(path, asset.contentType, NATIVE_DOCUMENT_READ_LIMITS.bytes, byteSize); guard();
      guard(); const hash = await crypto.subtle.digest('SHA-256', original); guard();
      need([...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('') === asset.sha256);
      // Recheck the same genuine record after delivery; no retry or discovery.
      guard(); const after = await get(recordPath, 'application/json', NATIVE_DOCUMENT_READ_LIMITS.metadataBytes, null); guard();
      need(sameAsset(asset, decodeAsset(after, expected, found.scope, validator, guard))); guard();
      const frame: NativeDocumentFrame = Object.freeze({ lease: Object.freeze({}), asset });
      const live: Live = { owner: found, generation: reserved, blob: new Blob([original], { type: asset.contentType }), listeners: new Set() };
      guard(); frames.set(frame, live); active = live; return frame;
    };
    try { guard(); const frame = await abortable(work(), controller.signal); guard(); return frame; }
    catch (error) {
      if (generation === reserved) invalidate(); signal.throwIfAborted();
      if (error instanceof NativeDocumentReadError) throw error; throw new NativeDocumentReadError();
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', abort); if (pending === controller) pending = null; controller.abort();
    }
  };
  return Object.freeze({ loadOriginal,
    isCurrent: (frame: NativeDocumentFrame) => current(frames.get(frame)),
    getBlob: (frame: NativeDocumentFrame) => { const live = frames.get(frame); return current(live) ? live.blob : null; },
    subscribeInvalidation: (frame: NativeDocumentFrame, changed: () => void) => {
      const live = frames.get(frame); if (!current(live)) { notify(changed); return () => undefined; }
      const listeners = live.listeners;
      listeners.add(changed); if (!current(live)) { listeners.delete(changed); notify(changed); }
      return () => { live.listeners.delete(changed); };
    },
    release: (frame: NativeDocumentFrame) => { const live = frames.get(frame); if (current(live)) invalidate(); },
    dispose: () => { if (disposed) return; disposed = true; dropOwner(); unsubscribe(); },
  });
}
