import { ExactDecimal, isExactDecimal } from '../src/numeric/decimal';
import { parseLosslessJson, stringifyLosslessJson, type LosslessJson } from '../src/numeric/lossless-json';
import { createExactStockResultValidator } from '../src/numeric/schema-validator';
import { createEvidenceClient, isEvidenceId, type EvidenceRead } from '../src/api/evidence-client';
import { createNativeDocumentReadClient } from './native-document-read-client';
import type { NativeDocumentAsset, NativeDocumentBinding, NativeDocumentExpected, NativeDocumentFrame,
  NativeDocumentMime } from '../src/lantern/scans/native-document-types';
import type { NativeEvidenceDocumentClient, NativeEvidenceDocumentFrame } from '../src/lantern/scans/native-evidence-document-types';

export interface NativeEvidenceDocumentOptions {
  getBinding(): NativeDocumentBinding | null;
  /** Every session, scope, or allocation replacement is signalled synchronously. */
  subscribeBinding(changed: () => void): () => void;
  readonly origin: string;
  readonly transport?: typeof fetch;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const MAX_ORIGINAL = 10 * 1024 * 1024;
const MAX_META = 128 * 1024;
const MAX_HEADER = 8192;
const MAX_CHUNKS = 8192;
const DEADLINE_MS = 60_000;
const MIMES: readonly NativeDocumentMime[] = ['application/pdf', 'image/jpeg', 'image/png', 'text/plain'];
const ZERO = ExactDecimal.parse('0'), ONE = ExactDecimal.parse('1');
const MAX_SIZE = ExactDecimal.parse(String(MAX_ORIGINAL));
const MAX_REVISION = ExactDecimal.parse('9007199254740991');
type Row = { [key: string]: LosslessJson };
interface Owner { readonly sessionIdentity: object; readonly allocation: NativeDocumentBinding['scope'];
  readonly workspaceId: string; readonly homeId: string; readonly expiresAt: string; }
interface Live { readonly owner: Owner; readonly generation: number; readonly frame: NativeEvidenceDocumentFrame; readonly original: NativeDocumentFrame;
  blob: Blob | null; readonly listeners: Set<() => void>; }

export class NativeEvidenceDocumentError extends Error {
  constructor() { super('Current native evidence original is unavailable'); this.name = 'NativeEvidenceDocumentError'; }
}
function need(value: unknown): asserts value { if (!value) throw new NativeEvidenceDocumentError(); }
function row(value: LosslessJson | undefined): Row {
  need(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value)); return value;
}
function integer(value: LosslessJson | undefined, minimum: ExactDecimal, maximum: ExactDecimal): ExactDecimal {
  need(isExactDecimal(value) && value.isInteger && value.compare(minimum) >= 0 && value.compare(maximum) <= 0); return value;
}
function owned(binding: NativeDocumentBinding | null): Owner | null {
  if (!binding || !binding.sessionIdentity || typeof binding.sessionIdentity !== 'object'
    || !UUID.test(binding.scope?.workspaceId) || !UUID.test(binding.scope?.homeId)
    || !Number.isFinite(Date.parse(binding.expiresAt)) || Date.parse(binding.expiresAt) <= Date.now()) return null;
  return { sessionIdentity: binding.sessionIdentity, allocation: binding.scope,
    workspaceId: binding.scope.workspaceId, homeId: binding.scope.homeId, expiresAt: binding.expiresAt };
}
function sameBinding(binding: NativeDocumentBinding | null, owner: Owner): boolean {
  return !!binding && binding.sessionIdentity === owner.sessionIdentity && binding.scope === owner.allocation
    && binding.scope.workspaceId === owner.workspaceId && binding.scope.homeId === owner.homeId
    && binding.expiresAt === owner.expiresAt && Date.parse(owner.expiresAt) > Date.now();
}
function assetRecord(raw: LosslessJson, assetId: string, owner: Owner,
  validator: ReturnType<typeof createExactStockResultValidator>): NativeDocumentAsset {
  need(validator.validateNativeRead('atlas.asset.get', raw));
  const envelope = row(raw), scope = row(envelope.resolvedScope), data = row(envelope.data);
  need(envelope.commandId === 'atlas.asset.get' && envelope.status === 'read' && envelope.replayed === false
    && scope.workspaceId === owner.workspaceId && scope.homeId === owner.homeId
    && data.sourceStatus === 'current' && data.nextCursor === null && Array.isArray(data.records) && data.records.length === 1);
  const record = row(data.records[0]), target = row(record.target), payload = row(record.payload);
  need(target.authority === 'atlas' && target.recordType === 'asset' && target.recordId === assetId
    && record.lifecycle === 'active' && payload.owner === 'atlas' && payload.purpose === 'evidence-original'
    && payload.availability === 'available' && typeof payload.sha256 === 'string' && SHA.test(payload.sha256)
    && typeof payload.contentType === 'string' && MIMES.includes(payload.contentType as NativeDocumentMime)
    && (payload.previewPolicy === 'safe-rendered' || payload.previewPolicy === 'download-only'));
  const revision = integer(record.revision, ONE, MAX_REVISION), byteSize = integer(payload.byteSize, ZERO, MAX_SIZE);
  const license = row(payload.sourceLicense);
  need((license.status === 'unknown' || license.status === 'permitted' || license.status === 'restricted')
    && (license.reference === null || typeof license.reference === 'string') && Array.isArray(payload.evidenceIds)
    && payload.evidenceIds.every(value => typeof value === 'string' && UUID.test(value)));
  return Object.freeze({ assetId, revision, byteSize, contentType: payload.contentType as NativeDocumentMime,
    sha256: payload.sha256, purpose: 'evidence-original', previewPolicy: payload.previewPolicy,
    sourceLicense: Object.freeze({ status: license.status, reference: license.reference }),
    evidenceIds: Object.freeze([...payload.evidenceIds]) }) as NativeDocumentAsset;
}
function sameAsset(a: NativeDocumentAsset, b: NativeDocumentAsset): boolean {
  return a.assetId === b.assetId && a.revision.compare(b.revision) === 0 && a.byteSize.compare(b.byteSize) === 0
    && a.sha256 === b.sha256 && a.contentType === b.contentType && a.purpose === b.purpose
    && a.previewPolicy === b.previewPolicy && a.sourceLicense.status === b.sourceLicense.status
    && a.sourceLicense.reference === b.sourceLicense.reference && a.evidenceIds.length === b.evidenceIds.length
    && a.evidenceIds.every((id, index) => id === b.evidenceIds[index]);
}
function assetReference(read: EvidenceRead, evidenceId: string): { assetId: string; revision: number } {
  need(read.status === 'ready' && read.sourceStatus === 'current' && read.record.lifecycle === 'active'
    && read.record.target.recordId === evidenceId && read.record.target.authority === 'atlas'
    && read.record.target.recordType === 'evidence');
  const references = read.record.payload.references;
  need(references.length === 1 && references[0]?.kind === 'atlas-asset' && UUID.test(references[0].assetId));
  return { assetId: references[0].assetId, revision: read.record.revision };
}
function exactResponse(response: Response, url: string, mime: string, bound: number, disposition: 'inline' | null): number | null {
  need(response.status === 200 && !response.redirected && response.type !== 'opaque' && response.type !== 'opaqueredirect'
    && (response.url === '' || response.url === url) && response.headers.get('content-type') === mime);
  if (disposition) need(response.headers.get('content-disposition')?.startsWith(`${disposition};`) === true);
  let headerBytes = 0;
  for (const [key, value] of response.headers) {
    headerBytes += new TextEncoder().encode(key).byteLength + new TextEncoder().encode(value).byteLength;
    need(headerBytes <= MAX_HEADER);
  }
  const length = response.headers.get('content-length');
  need(length === null || (/^(0|[1-9][0-9]{0,19})$/.test(length) && Number(length) <= bound));
  return length === null ? null : Number(length);
}
async function receive(response: Response, signal: AbortSignal, bound: number, declared: number | null, guard: () => void): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader(); need(reader);
  const stop = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', stop, { once: true });
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      guard();
      const result = await abortable(reader.read(), signal); guard();
      if (result.done) break;
      need(result.value instanceof Uint8Array && chunks.length < MAX_CHUNKS && result.value.byteLength <= bound - length);
      length += result.value.byteLength; chunks.push(new Uint8Array(result.value));
    }
    guard(); need(declared === null || declared === length);
    const output = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { guard(); output.set(chunk, offset); offset += chunk.byteLength; }
    guard(); return output;
  } catch (error) { stop(); throw error; }
  finally { signal.removeEventListener('abort', stop); reader.releaseLock(); }
}
function png(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return bytes.length >= 33 && signature.every((value, index) => bytes[index] === value)
    && bytes[12] === 73 && bytes[13] === 72 && bytes[14] === 68 && bytes[15] === 82;
}
function notify(callback: () => void): void { try { callback(); } catch { /* Notify every listener. */ } }
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => { signal.removeEventListener('abort', stop); reject(signal.reason ?? new NativeEvidenceDocumentError()); };
    signal.addEventListener('abort', stop, { once: true });
    promise.then(value => { signal.removeEventListener('abort', stop); resolve(value); },
      error => { signal.removeEventListener('abort', stop); reject(error); });
    if (signal.aborted) stop();
  });
}

/** Explicit, read-only saved evidence resolver. Original bytes are verified by
 * the native document owner; only the media owner's SafeRendered PNG goes inline. */
export function createNativeEvidenceDocumentClient(options: NativeEvidenceDocumentOptions): NativeEvidenceDocumentClient {
  const parsed = new URL(options.origin); need(parsed.protocol === 'https:' && parsed.origin === options.origin && !parsed.username && !parsed.password);
  const origin = parsed.origin, transport = options.transport ?? globalThis.fetch;
  const original = createNativeDocumentReadClient(options);
  const evidence = createEvidenceClient(transport), validator = createExactStockResultValidator();
  let current: Live | null = null, pending: AbortController | null = null, disposed = false, generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const withdraw = (): number => {
    const reserved = ++generation; // Fence older opens before external abort and listener callbacks.
    if (timer !== undefined) clearTimeout(timer); timer = undefined;
    const previous = current, request = pending; current = null; pending = null;
    if (previous) previous.blob = null;
    request?.abort(new NativeEvidenceDocumentError());
    if (previous) {
      original.release(previous.original);
      const listeners = [...previous.listeners]; previous.listeners.clear();
      for (const listener of listeners) notify(listener);
    }
    return reserved;
  };
  const observed = (): NativeDocumentBinding | null => { try { return options.getBinding(); } catch { return null; } };
  const unsubscribe = options.subscribeBinding(withdraw);
  const active = (live: Live | null) => !!live && !disposed && current === live && generation === live.generation
    && live.blob !== null && sameBinding(observed(), live.owner) && original.isCurrent(live.original)
    && current === live && generation === live.generation;
  const read = async (path: string, mime: string, bound: number, disposition: 'inline' | null,
    signal: AbortSignal, guard: () => void): Promise<Uint8Array<ArrayBuffer>> => {
    guard(); const url = new URL(path, origin); need(url.origin === origin && url.pathname === path && !url.search && !url.hash);
    const exchange = transport(url.href, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      mode: 'same-origin', headers: { Accept: mime, Origin: origin }, signal });
    // A transport can ignore abort and resolve after the local wait has ended.
    void exchange.then(late => { if (signal.aborted) void late.body?.cancel().catch(() => undefined); }, () => undefined);
    const response = await abortable(exchange, signal);
    try {
      guard(); const length = exactResponse(response, url.href, mime, bound, disposition);
      const bytes = await receive(response, signal, bound, length, guard); guard(); return bytes;
    } catch (error) { void response.body?.cancel().catch(() => undefined); throw error; }
  };
  const open = async (evidenceId: string, outer: AbortSignal): Promise<NativeEvidenceDocumentFrame> => {
    const reserved = withdraw(); need(!disposed && generation === reserved && isEvidenceId(evidenceId)); outer.throwIfAborted();
    const owner = owned(observed()); need(owner && generation === reserved);
    const controller = new AbortController(); need(generation === reserved); pending = controller;
    const abort = () => controller.abort(outer.reason);
    outer.addEventListener('abort', abort, { once: true }); if (outer.aborted) abort();
    const due = performance.now() + DEADLINE_MS;
    const deadline = setTimeout(() => controller.abort(new NativeEvidenceDocumentError()), DEADLINE_MS);
    let retained: NativeDocumentFrame | null = null, lateOriginal: NativeDocumentFrame | null = null;
    let abandoned = false, published: NativeEvidenceDocumentFrame | null = null;
    const guard = () => {
      controller.signal.throwIfAborted();
      need(!disposed && generation === reserved && pending === controller && performance.now() < due);
      const binding = observed();
      need(generation === reserved && pending === controller && sameBinding(binding, owner));
    };
    try {
      guard(); const beforeEvidence = assetReference(await abortable(evidence.read({ workspaceId: owner.workspaceId, homeId: owner.homeId }, evidenceId, controller.signal), controller.signal), evidenceId); guard();
      const recordPath = `/api/atlas/stock/v3/workspaces/${owner.workspaceId}/homes/${owner.homeId}/records/asset/${beforeEvidence.assetId}`;
      const getAsset = async () => {
        guard(); const bytes = await read(recordPath, 'application/json', MAX_META, null, controller.signal, guard); guard();
        return assetRecord(parseLosslessJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)), beforeEvidence.assetId, owner, validator);
      };
      const beforeAsset = await getAsset(); guard();
      const expected: NativeDocumentExpected = { assetId: beforeAsset.assetId, contentType: beforeAsset.contentType,
        sha256: beforeAsset.sha256, byteSize: beforeAsset.byteSize, revision: beforeAsset.revision };
      const originalWork = original.loadOriginal(expected, controller.signal);
      // If the abort race rejects first, the owner can still settle with a frame.
      // Release that exact late lease instead of leaving its verified Blob active.
      void originalWork.then(frame => {
        if (abandoned || controller.signal.aborted || generation !== reserved || pending !== controller) original.release(frame);
        else lateOriginal = frame;
      }, () => undefined);
      retained = await abortable(originalWork, controller.signal); lateOriginal = null; guard();
      need(original.isCurrent(retained) && sameAsset(retained.asset, beforeAsset));
      let mode: NativeEvidenceDocumentFrame['mode'] = 'original-download';
      let blob = original.getBlob(retained); need(blob);
      if (beforeAsset.contentType === 'image/png' && beforeAsset.previewPolicy === 'safe-rendered') {
        const descriptor = stringifyLosslessJson({ assetId: beforeAsset.assetId, kind: 'atlas-asset' });
        const digest = await abortable(crypto.subtle.digest('SHA-256', new TextEncoder().encode(descriptor)), controller.signal); guard();
        const descriptorSha = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
        const path = `/api/atlas/media/${owner.workspaceId}/${owner.homeId}/${descriptorSha}/preview`;
        const bytes = await read(path, 'image/png', MAX_ORIGINAL, 'inline', controller.signal, guard); guard();
        need(png(bytes));
        // The renderer changes bytes. The original asset SHA is deliberately not a preview digest.
        blob = new Blob([bytes], { type: 'image/png' }); mode = 'inline-png';
      }
      const afterAsset = await getAsset(); guard(); need(sameAsset(beforeAsset, afterAsset));
      const afterEvidence = assetReference(await abortable(evidence.read({ workspaceId: owner.workspaceId, homeId: owner.homeId }, evidenceId, controller.signal), controller.signal), evidenceId); guard();
      need(afterEvidence.assetId === beforeEvidence.assetId && afterEvidence.revision === beforeEvidence.revision
        && original.isCurrent(retained)); guard();
      const frame: NativeEvidenceDocumentFrame = Object.freeze({ lease: Object.freeze({}), evidenceId, evidenceRevision: beforeEvidence.revision, asset: beforeAsset, mode });
      const live: Live = { owner, generation: reserved, frame, original: retained, blob, listeners: new Set() };
      current = live; pending = null; retained = null; published = frame;
      const remaining = Date.parse(owner.expiresAt) - Date.now(); need(remaining > 0);
      timer = setTimeout(withdraw, Math.min(remaining + 1, 2_147_483_647));
      const registered = live.original;
      original.subscribeInvalidation(registered, () => { if (current === live) withdraw(); });
      need(active(live)); return frame;
    } catch (error) {
      abandoned = true;
      if (retained) original.release(retained);
      else if (lateOriginal) original.release(lateOriginal);
      lateOriginal = null;
      if (pending === controller || (published && current?.frame === published)) withdraw();
      outer.throwIfAborted();
      if (error instanceof NativeEvidenceDocumentError) throw error;
      throw new NativeEvidenceDocumentError();
    } finally {
      clearTimeout(deadline); outer.removeEventListener('abort', abort);
      if (pending === controller) pending = null;
      controller.abort();
    }
  };
  return Object.freeze({ open,
    isCurrent: (frame: NativeEvidenceDocumentFrame) => active(current?.frame === frame ? current : null),
    getBlob: (frame: NativeEvidenceDocumentFrame) => active(current?.frame === frame ? current : null) ? current!.blob : null,
    subscribeInvalidation: (frame: NativeEvidenceDocumentFrame, changed: () => void) => {
      const live = current?.frame === frame ? current : null;
      if (!active(live)) { notify(changed); return () => undefined; }
      live!.listeners.add(changed); return () => { live!.listeners.delete(changed); };
    },
    release: (frame: NativeEvidenceDocumentFrame) => { if (current?.frame === frame) withdraw(); },
    dispose: () => { if (disposed) return; disposed = true; withdraw(); unsubscribe(); original.dispose(); },
  });
}
