import { fullFormats } from 'ajv-formats/dist/formats.js';
import { ExactDecimal, isExactDecimal } from '../src/numeric/decimal';
import { parseLosslessJson, type LosslessJson } from '../src/numeric/lossless-json';
import type { NativeDocumentBinding } from '../src/lantern/scans/native-document-types';
import type { SourceAssetPin, SourceDate, SourceDocument, SourceDocumentFrame, SourceDocumentMime, SourceDocumentPage,
  SourceDocumentReader, SourceFrame, SourcePreviewLineage, SourceProvenance } from '../src/lantern/source-documents/types';

export interface NativeSourceDocumentReaderOptions {
  getBinding(): NativeDocumentBinding | null;
  /** Every replacement or gap must be published synchronously. */
  subscribeBinding(changed: () => void): () => void;
  /** The actual canonical HTTPS native host origin, with no path. */
  readonly origin: string;
  readonly transport?: typeof fetch;
}
export const SOURCE_DOCUMENT_LIMITS = Object.freeze({
  bytes: 10_485_760, listBytes: 2 * 1024 * 1024, readBytes: 128 * 1024, headerBytes: 8192, frameHeader: 4096,
  chunks: 8192, depth: 16, nodes: 65_536, stringUnits: 8192, readMs: 15000, pageSize: 50,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const TEXT = /^[^\u0000-\u001f\u007f-\u009f]+$/;
const SOURCE_URL = /^https:\/\/[^/?#@\s]+(?:[/?][^#]*)?$/;
const ORIGINAL_MIMES: readonly SourceDocumentMime[] = ['application/geo+json', 'application/city+json', 'application/json',
  'image/tiff', 'application/pdf', 'image/png'];
const ORIGINAL_STATES = ['available', 'unavailable', 'access-revoked', 'stale', 'quarantined'] as const;
const PREVIEW_STATES = [...ORIGINAL_STATES, 'not-qualified'] as const;
const MAX_TIMER = 2_147_483_647, MAX_REVISION = 9_007_199_254_740_991;
type Row = { [key: string]: LosslessJson };
type Scope = NativeDocumentBinding['scope'];

export class SourceDocumentReadError extends Error {
  constructor(readonly status: number | null = null) {
    super('Source document is unavailable for the current view');
    this.name = 'SourceDocumentReadError';
  }
}
function need(condition: unknown): asserts condition { if (!condition) throw new SourceDocumentReadError(); }

// Closed decoding of the generated v2 Document schema. Every object must have
// exactly its schema keys; numbers stay exact until proven inside their bounds.
function closed(value: LosslessJson | undefined, keys: readonly string[]): Row {
  need(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value));
  const own = Object.keys(value);
  need(own.length === keys.length && keys.every(key => Object.hasOwn(value, key)));
  return value;
}
function text(value: LosslessJson | undefined): string {
  need(typeof value === 'string' && TEXT.test(value) && [...value].length <= 4096); return value;
}
const optionalText = (value: LosslessJson | undefined) => value === null ? null : text(value);
function oneOf<T extends string>(value: LosslessJson | undefined, allowed: readonly T[]): T {
  need(typeof value === 'string' && (allowed as readonly string[]).includes(value)); return value as T;
}
function uuid(value: LosslessJson | undefined): string { need(typeof value === 'string' && UUID.test(value)); return value; }
function sha(value: LosslessJson | undefined): string { need(typeof value === 'string' && SHA.test(value)); return value; }
function integer(value: LosslessJson | undefined, minimum: number, maximum: number): number {
  need(isExactDecimal(value) && value.isInteger && value.compare(ExactDecimal.parse(String(minimum))) >= 0
    && value.compare(ExactDecimal.parse(String(maximum))) <= 0);
  const result = value.toSafeInteger(); need(result !== undefined); return result;
}
/** The contract's own string formats (Ajv full mode), so schema-valid recorded
 * values such as leap seconds pass and keep their original text. Only session
 * expiry, below, is clock arithmetic. */
function format(name: 'date-time' | 'date', value: string): boolean {
  const check: unknown = fullFormats[name];
  return typeof check === 'object' && check !== null && 'validate' in check && !('async' in check && check.async === true)
    && typeof check.validate === 'function' && check.validate(value) === true;
}
function instant(value: LosslessJson | undefined): string { need(typeof value === 'string' && format('date-time', value)); return value; }
function pin(value: LosslessJson | undefined): SourceAssetPin {
  const row = closed(value, ['assetId', 'revision', 'sha256', 'bytes']);
  return Object.freeze({ assetId: uuid(row.assetId), revision: integer(row.revision, 1, MAX_REVISION), sha256: sha(row.sha256),
    bytes: integer(row.bytes, 1, SOURCE_DOCUMENT_LIMITS.bytes) });
}
const samePin = (a: SourceAssetPin, b: SourceAssetPin) => a.assetId === b.assetId && a.revision === b.revision
  && a.sha256 === b.sha256 && a.bytes === b.bytes;
function sourceDate(value: LosslessJson | undefined): SourceDate | null {
  if (value === null) return null;
  const row = closed(value, ['value', 'precision']), precision = oneOf(row.precision, ['year', 'day', 'instant'] as const);
  const date = precision === 'instant' ? instant(row.value) : text(row.value);
  need(precision !== 'year' || /^[0-9]{4}$/.test(date)); need(precision !== 'day' || format('date', date));
  return Object.freeze({ value: date, precision });
}
function extent(value: LosslessJson | undefined): readonly string[] | null {
  if (value === null) return null;
  need(Array.isArray(value) && (value.length === 4 || value.length === 6));
  return Object.freeze(value.map(item => { need(isExactDecimal(item)); return item.token; }));
}
function sourceFrame(value: LosslessJson | undefined): SourceFrame {
  const row = closed(value, ['crs', 'axes', 'linearUnit', 'extent']);
  need(Array.isArray(row.axes) && row.axes.length <= 3);
  return Object.freeze({ crs: optionalText(row.crs), axes: Object.freeze(row.axes.map(text)),
    linearUnit: optionalText(row.linearUnit), extent: extent(row.extent) });
}
function provenance(value: LosslessJson | undefined): SourceProvenance {
  const row = closed(value, ['agency', 'url', 'license', 'retrievedAt', 'published', 'observed', 'frame', 'custodyReceiptSha256']);
  const license = closed(row.license, ['status', 'reference']);
  const url = optionalText(row.url);
  need(url === null || (SOURCE_URL.test(url) && URL.canParse(url)));
  return Object.freeze({ agency: text(row.agency), url,
    license: Object.freeze({ status: oneOf(license.status, ['unknown', 'permitted', 'restricted'] as const), reference: optionalText(license.reference) }),
    retrievedAt: instant(row.retrievedAt), published: sourceDate(row.published), observed: sourceDate(row.observed),
    frame: sourceFrame(row.frame), custodyReceiptSha256: sha(row.custodyReceiptSha256) });
}
function lineage(value: LosslessJson | undefined): SourcePreviewLineage | null {
  if (value === null) return null;
  const row = closed(value, ['asset', 'inputs', 'renderer', 'rendererVersion', 'rendererConfigSha256',
    'qualificationReceiptSha256', 'sourceCropExtent', 'description']);
  need(Array.isArray(row.inputs) && row.inputs.length === 1);
  return Object.freeze({ asset: pin(row.asset), inputs: Object.freeze(row.inputs.map(pin)), renderer: text(row.renderer),
    rendererVersion: text(row.rendererVersion), rendererConfigSha256: sha(row.rendererConfigSha256),
    qualificationReceiptSha256: sha(row.qualificationReceiptSha256), sourceCropExtent: extent(row.sourceCropExtent),
    description: text(row.description) });
}
function sameScope(value: LosslessJson | undefined, scope: Scope): void {
  const row = closed(value, ['workspaceId', 'homeId']);
  need(row.workspaceId === scope.workspaceId && row.homeId === scope.homeId);
}
function documentRead(value: LosslessJson | undefined, scope: Scope): SourceDocument {
  const row = closed(value, ['profile', 'scope', 'document', 'availability']);
  need(row.profile === 'houseatlas.geodata-document-read.v2'); sameScope(row.scope, scope);
  const record = closed(row.document, ['schemaVersion', 'recordType', 'recordId', 'workspaceId', 'homeId', 'revision',
    'lifecycle', 'createdAt', 'updatedAt', 'lastAuditId', 'payload']);
  need(isExactDecimal(record.schemaVersion) && record.schemaVersion.token === '2' && record.recordType === 'geodata-document'
    && record.workspaceId === scope.workspaceId && record.homeId === scope.homeId);
  const payload = closed(record.payload, ['profile', 'title', 'original', 'provenance', 'preview']);
  need(payload.profile === 'houseatlas.geodata-document.v2');
  const availability = closed(row.availability, ['original', 'preview']);
  return Object.freeze({ scope: Object.freeze({ workspaceId: scope.workspaceId, homeId: scope.homeId }),
    documentId: uuid(record.recordId), revision: integer(record.revision, 1, MAX_REVISION),
    lifecycle: oneOf(record.lifecycle, ['active', 'tombstoned'] as const), createdAt: instant(record.createdAt),
    updatedAt: instant(record.updatedAt), lastAuditId: uuid(record.lastAuditId), title: text(payload.title),
    original: pin(payload.original), provenance: provenance(payload.provenance), preview: lineage(payload.preview),
    availability: Object.freeze({ original: oneOf(availability.original, ORIGINAL_STATES),
      preview: oneOf(availability.preview, PREVIEW_STATES) }) });
}

/** Rejects duplicate keys and bounds the whole graph before the lossless parser
 * sees it (that parser is last-wins). Response numbers never reach JSON.parse. */
function preflight(source: string, guard: () => void): void {
  let offset = 0, nodes = 0;
  const space = () => { while (offset < source.length && ' \r\n\t'.includes(source[offset]!)) offset++; };
  const string = (): string => {
    need(source[offset] === '"'); const start = offset++; let escaped = false;
    while (offset < source.length) {
      const ch = source[offset++]!; need(offset - start <= SOURCE_DOCUMENT_LIMITS.stringUnits * 6 + 2);
      if (!escaped && ch === '"') {
        const result: unknown = JSON.parse(source.slice(start, offset));
        need(typeof result === 'string' && result.length <= SOURCE_DOCUMENT_LIMITS.stringUnits); return result;
      }
      escaped = !escaped && ch === '\\';
    }
    throw new SourceDocumentReadError();
  };
  const value = (depth: number): void => {
    need(++nodes <= SOURCE_DOCUMENT_LIMITS.nodes && depth <= SOURCE_DOCUMENT_LIMITS.depth); if (nodes % 1024 === 0) guard(); space();
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
    while (offset < source.length && /[0-9.eE+-]/.test(source[offset]!)) offset++;
    need(offset > start); ExactDecimal.parse(source.slice(start, offset));
  };
  value(0); space(); need(offset === source.length); guard();
}
function parse(bytes: Uint8Array, guard: () => void): LosslessJson {
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  preflight(source, guard); const value = parseLosslessJson(source); guard(); return value;
}
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const base64url = (bytes: Uint8Array) => base64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
/** RFC 8785 serialization for the frame's closed value set: objects, strings and
 * non-negative integers. Anything else is not a canonical frame. */
function canonical(value: LosslessJson): string {
  if (typeof value === 'string') return JSON.stringify(value);
  need(value !== null && typeof value === 'object');
  if (isExactDecimal(value)) { need(/^(0|[1-9][0-9]*)$/.test(value.token)); return value.token; }
  need(!Array.isArray(value));
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
}
function byteFrame(header: string | null, guard: () => void): { readonly raw: Row; readonly asset: SourceAssetPin; readonly mime: SourceDocumentMime } {
  need(header !== null && header.length <= SOURCE_DOCUMENT_LIMITS.frameHeader && /^[A-Za-z0-9_-]+$/.test(header) && header.length % 4 !== 1);
  const bytes = Uint8Array.from(atob(header.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
  need(base64url(bytes) === header);
  const value = parse(bytes, guard);
  need(canonical(value) === new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const raw = closed(value, ['profile', 'scope', 'documentId', 'documentRevision', 'mode', 'asset', 'measuredContentType']);
  need(raw.profile === 'houseatlas.geodata-document-bytes.v2');
  return { raw, asset: pin(raw.asset), mime: oneOf(raw.measuredContentType, ORIGINAL_MIMES) };
}
function discard(response: Response): void { void response.body?.cancel().catch(() => undefined); }
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => { signal.removeEventListener('abort', stop); reject(signal.reason ?? new SourceDocumentReadError()); };
    signal.addEventListener('abort', stop, { once: true });
    promise.then(value => { signal.removeEventListener('abort', stop); resolve(value); },
      error => { signal.removeEventListener('abort', stop); reject(error); });
    if (signal.aborted) stop();
  });
}
function contentLength(response: Response, limit: number): number | null {
  const token = response.headers.get('content-length');
  need(token === null || (/^(0|[1-9][0-9]{0,19})$/.test(token) && ExactDecimal.parse(token).compare(ExactDecimal.parse(String(limit))) <= 0));
  return token === null ? null : Number(token); // proven below the small byte bound
}
async function receive(response: Response, limit: number, length: number | null, signal: AbortSignal, guard: () => void): Promise<Uint8Array<ArrayBuffer>> {
  guard(); const reader = response.body?.getReader(); need(reader);
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true }); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      guard(); const next = await abortable(reader.read(), signal); guard(); if (next.done) break;
      need(next.value instanceof Uint8Array && chunks.length < SOURCE_DOCUMENT_LIMITS.chunks && next.value.byteLength <= limit - size);
      size += next.value.byteLength; chunks.push(new Uint8Array(next.value));
    }
    need(length === null || size === length); const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
const hex = (digest: ArrayBuffer) => [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');

interface Owner { readonly sessionIdentity: object; readonly scopeAllocation: Scope; readonly scope: Scope; readonly expiresAt: string; readonly expiry: number }
interface Live { readonly owner: Owner; readonly generation: number; blob: Blob | null; readonly listeners: Set<() => void> }

/** Explicit GET reads of native v2 source Documents for the current canonical
 * session and completed view scope. One leased byte frame at a time; no write,
 * persistent cache, object URL, source URL request or retry. */
export function createNativeSourceDocumentReader(options: NativeSourceDocumentReaderOptions): SourceDocumentReader {
  const parsed = new URL(options.origin); need(parsed.protocol === 'https:' && parsed.origin === options.origin && !parsed.username && !parsed.password);
  const origin = parsed.origin, transport = options.transport ?? globalThis.fetch;
  let owner: Owner | null = null, active: Live | null = null, pending: AbortController | null = null, generation = 0, disposed = false;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const metadataReads = new Set<AbortController>(), ownerListeners = new Set<() => void>();
  const frames = new WeakMap<SourceDocumentFrame, Live>();
  const notify = (callback: () => void) => { try { callback(); } catch { /* Notify every subscriber even if one throws. */ } };
  const invalidate = (): number => {
    // Reserve this operation's generation before external abort/listener callbacks.
    const reserved = ++generation, previous = active, request = pending; active = null; pending = null;
    if (previous) previous.blob = null;
    request?.abort(new SourceDocumentReadError());
    if (previous) { const listeners = [...previous.listeners]; previous.listeners.clear(); for (const callback of listeners) notify(callback); }
    return reserved;
  };
  const clearExpiry = () => { if (expiryTimer !== undefined) clearTimeout(expiryTimer); expiryTimer = undefined; };
  const dropOwner = () => {
    const had = owner !== null; owner = null; clearExpiry();
    for (const read of [...metadataReads]) read.abort(new SourceDocumentReadError());
    const reserved = invalidate();
    if (had) for (const callback of [...ownerListeners]) notify(callback);
    return reserved;
  };
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
      expiresAt: latest.expiresAt, expiry: Date.parse(latest.expiresAt) });
    scheduleExpiry(); for (const callback of [...ownerListeners]) notify(callback); return owner;
  };
  const unsubscribe = options.subscribeBinding(() => { if (!disposed) { dropOwner(); observe(); } }); observe();
  const current = (live: Live | undefined): live is Live => !!live && !disposed && observe() === live.owner
    && active === live && generation === live.generation && live.blob !== null;

  const base = (found: Owner) => `/api/atlas/documents/v2/workspaces/${found.scope.workspaceId}/homes/${found.scope.homeId}/documents`;
  /** One same-origin GET with credentials, no-store and redirect rejection. */
  const send = async (path: string, query: string, accept: string, signal: AbortSignal, guard: () => void) => {
    guard(); const url = new URL(path + query, origin);
    need(url.origin === origin && url.pathname === path && url.search === query && !url.hash);
    const response = await transport(url.href, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      mode: 'same-origin', headers: { Accept: accept, Origin: origin }, signal });
    try {
      guard(); if (response.status !== 200) throw new SourceDocumentReadError(response.status);
      need(!response.redirected && response.type !== 'opaque' && response.type !== 'opaqueredirect' && (response.url === '' || response.url === url.href));
      let total = 0;
      for (const [key, value] of response.headers) {
        total += new TextEncoder().encode(key).byteLength + new TextEncoder().encode(value).byteLength;
        need(total <= SOURCE_DOCUMENT_LIMITS.headerBytes);
      }
      return response;
    } catch (error) { discard(response); throw error; }
  };
  const json = async (path: string, query: string, limit: number, signal: AbortSignal, guard: () => void) => {
    const response = await send(path, query, 'application/json', signal, guard);
    try {
      need(response.headers.get('content-type') === 'application/json');
      return parse(await receive(response, limit, contentLength(response, limit), signal, guard), guard);
    } catch (error) { discard(response); throw error; }
  };
  /** Metadata reads share the owner fence; a gap or replacement aborts them. */
  const metadata = async <T>(signal: AbortSignal, read: (found: Owner, signal: AbortSignal, guard: () => void) => Promise<T>): Promise<T> => {
    const found = observe(); signal.throwIfAborted(); need(found);
    const controller = new AbortController(), deadline = performance.now() + SOURCE_DOCUMENT_LIMITS.readMs;
    const abort = () => controller.abort(signal.reason); metadataReads.add(controller);
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    const timer = setTimeout(() => controller.abort(new SourceDocumentReadError()), SOURCE_DOCUMENT_LIMITS.readMs);
    const guard = () => { controller.signal.throwIfAborted(); need(performance.now() < deadline && observe() === found); };
    try { const value = await abortable(read(found, controller.signal, guard), controller.signal); guard(); return value; }
    catch (error) { signal.throwIfAborted(); throw error instanceof SourceDocumentReadError ? error : new SourceDocumentReadError(); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort); metadataReads.delete(controller); controller.abort(); }
  };
  const readDocument = async (found: Owner, documentId: string, signal: AbortSignal, guard: () => void) => {
    const document = documentRead(await json(`${base(found)}/${documentId}`, '', SOURCE_DOCUMENT_LIMITS.readBytes, signal, guard), found.scope);
    need(document.documentId === documentId); guard(); return document;
  };

  const open = async (mode: 'original' | 'preview', documentId: string, expectedRevision: number, signal: AbortSignal): Promise<SourceDocumentFrame> => {
    const found = observe(), reserved = invalidate(); signal.throwIfAborted(); need(found && generation === reserved);
    need(UUID.test(documentId) && Number.isSafeInteger(expectedRevision) && expectedRevision >= 1);
    const controller = new AbortController(), deadline = performance.now() + SOURCE_DOCUMENT_LIMITS.readMs;
    const abort = () => controller.abort(signal.reason); pending = controller;
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    const timer = setTimeout(() => controller.abort(new SourceDocumentReadError()), SOURCE_DOCUMENT_LIMITS.readMs);
    const guard = () => { controller.signal.throwIfAborted(); need(performance.now() < deadline && observe() === found && generation === reserved); };
    const work = async () => {
      const before = await readDocument(found, documentId, controller.signal, guard);
      need(before.revision === expectedRevision && before.availability[mode] === 'available');
      let expected = before.original;
      if (mode === 'preview') {
        // A qualified preview derives from exactly this Document's original pin.
        need(before.preview !== null && samePin(before.preview.inputs[0]!, before.original)); expected = before.preview.asset;
      }
      const response = await send(`${base(found)}/${documentId}/${mode}`, `?expectedRevision=${expectedRevision}`,
        mode === 'preview' ? 'image/png' : '*/*', controller.signal, guard);
      let bytes: Uint8Array<ArrayBuffer>, mime: SourceDocumentMime;
      try {
        const frame = byteFrame(response.headers.get('x-atlas-document-frame'), guard), headers = response.headers;
        sameScope(frame.raw.scope, found.scope);
        need(frame.raw.documentId === documentId && integer(frame.raw.documentRevision, 1, MAX_REVISION) === expectedRevision
          && frame.raw.mode === mode && samePin(frame.asset, expected) && (mode === 'original' || frame.mime === 'image/png'));
        const cache = (headers.get('cache-control') ?? '').split(',').map(token => token.trim().toLowerCase());
        need(headers.get('content-type') === frame.mime && headers.get('x-content-type-options') === 'nosniff'
          && cache.includes('no-store') && cache.includes('private')
          && new RegExp(`^${mode === 'original' ? 'attachment' : 'inline'}(;|$)`).test(headers.get('content-disposition') ?? '')
          && headers.get('content-digest') === `sha-256=:${base64(Uint8Array.from(expected.sha256.match(/../g)!, pair => parseInt(pair, 16)))}:`);
        const length = contentLength(response, SOURCE_DOCUMENT_LIMITS.bytes); need(length === expected.bytes);
        bytes = await receive(response, expected.bytes, length, controller.signal, guard); mime = frame.mime;
      } catch (error) { discard(response); throw error; }
      guard(); need(bytes.byteLength === expected.bytes && hex(await crypto.subtle.digest('SHA-256', bytes)) === expected.sha256); guard();
      // Recheck the same Document after delivery; any change withholds the bytes.
      const after = await readDocument(found, documentId, controller.signal, guard);
      need(JSON.stringify(after) === JSON.stringify(before));
      const frame: SourceDocumentFrame = Object.freeze({ lease: Object.freeze({}), documentId, documentRevision: expectedRevision,
        mode, asset: expected, measuredContentType: mime });
      const live: Live = { owner: found, generation: reserved, blob: new Blob([bytes], { type: mime }), listeners: new Set() };
      guard(); frames.set(frame, live); active = live; return frame;
    };
    try { guard(); const frame = await abortable(work(), controller.signal); guard(); return frame; }
    catch (error) {
      if (generation === reserved) invalidate(); signal.throwIfAborted();
      throw error instanceof SourceDocumentReadError ? error : new SourceDocumentReadError();
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', abort); if (pending === controller) pending = null; controller.abort();
    }
  };

  return Object.freeze({
    owner: () => observe(),
    subscribeOwner: (changed: () => void) => { ownerListeners.add(changed); return () => { ownerListeners.delete(changed); }; },
    list: (cursor: string | null, signal: AbortSignal) => metadata(signal, async (found, inner, guard): Promise<SourceDocumentPage> => {
      if (cursor !== null) text(cursor);
      const query = `?${new URLSearchParams({ limit: String(SOURCE_DOCUMENT_LIMITS.pageSize), ...(cursor === null ? {} : { cursor }) })}`;
      const row = closed(await json(base(found), query, SOURCE_DOCUMENT_LIMITS.listBytes, inner, guard), ['profile', 'scope', 'documents', 'nextCursor']);
      need(row.profile === 'houseatlas.geodata-document-list.v2' && Array.isArray(row.documents)
        && row.documents.length <= SOURCE_DOCUMENT_LIMITS.pageSize);
      sameScope(row.scope, found.scope);
      const documents = row.documents.map(item => documentRead(item, found.scope));
      const nextCursor = optionalText(row.nextCursor);
      need(new Set(documents.map(item => item.documentId)).size === documents.length && (nextCursor === null || nextCursor !== cursor));
      return Object.freeze({ documents: Object.freeze(documents), nextCursor });
    }),
    get: (documentId: string, signal: AbortSignal) => metadata(signal, (found, inner, guard) => {
      need(UUID.test(documentId)); return readDocument(found, documentId, inner, guard);
    }),
    openOriginal: (documentId: string, expectedRevision: number, signal: AbortSignal) => open('original', documentId, expectedRevision, signal),
    openPreview: (documentId: string, expectedRevision: number, signal: AbortSignal) => open('preview', documentId, expectedRevision, signal),
    isCurrent: (frame: SourceDocumentFrame) => current(frames.get(frame)),
    getBlob: (frame: SourceDocumentFrame) => { const live = frames.get(frame); return current(live) ? live.blob : null; },
    subscribeInvalidation: (frame: SourceDocumentFrame, changed: () => void) => {
      const live = frames.get(frame); if (!current(live)) { notify(changed); return () => undefined; }
      const listeners = live.listeners;
      listeners.add(changed); if (!current(live)) { listeners.delete(changed); notify(changed); }
      return () => { live.listeners.delete(changed); };
    },
    release: (frame: SourceDocumentFrame) => { const live = frames.get(frame); if (current(live)) invalidate(); },
    dispose: () => { if (disposed) return; dropOwner(); disposed = true; ownerListeners.clear(); unsubscribe(); },
  });
}
