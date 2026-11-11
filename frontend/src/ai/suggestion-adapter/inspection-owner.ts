import type { InspectionBinding, ReviewIdentity, SuggestionSessionOwner } from './session';
import type { NativeDocumentBinding } from '../../lantern/scans/native-document-types';
import type { NativeEvidenceDocumentClient } from '../../lantern/scans/native-evidence-document-types';
import type { SourceAssetPin, SourceDocumentReader } from '../../lantern/source-documents/types';

export type InspectionLocation = { readonly kind: 'record' }
  | { readonly kind: 'page'; readonly page: number; readonly pageCount: number }
  | { readonly kind: 'text-range'; readonly start: number; readonly end: number; readonly textLength: number };
export interface ExactInspectionBinding extends InspectionBinding { readonly evidenceRef: string; readonly location: InspectionLocation }
export type InspectionTarget =
  /** Original admitted record assertion/metadata, never generated prose. */
  | { readonly kind: 'record'; readonly text: string }
  /** Only an original owner can establish this association and asset pin. */
  | { readonly kind: 'native-source'; readonly documentId: string; readonly documentRevision: number; readonly asset: SourceAssetPin }
  | { readonly kind: 'native-evidence'; readonly evidenceId: string; readonly evidenceRevision: number; readonly asset: SourceAssetPin };
export interface InspectionMapEntry { readonly binding: ExactInspectionBinding; readonly target: InspectionTarget }
/** Private authenticated input-owner allocation. Copying a disclosure/model
 * result into this shape does not authenticate it. No public map ingestion. */
export interface InspectionSnapshot extends ReviewIdentity {
  readonly accountKey: string;
  readonly nativeBinding: NativeDocumentBinding;
  readonly entries: readonly InspectionMapEntry[];
}
export interface InspectionInputs extends Pick<SuggestionSessionOwner, 'recheck'> {
  current(): InspectionSnapshot | null;
  /** Every account, scope, source, access gap or allocation replacement is
   * published synchronously, including a replacement with equal field values. */
  subscribe(changed: () => void): () => void;
}
export type InspectionView = {
  readonly binding: ExactInspectionBinding;
  /** Abort clears the host's view/canvas synchronously, including during mount. */
  readonly signal: AbortSignal;
} & ({ readonly kind: 'record' | 'text-range'; getText(): string | null }
  | { readonly kind: 'pdf'; readonly initialPage: number; readonly pageCount: number;
      getBlob(): Blob | null; getDownloadUrl(): string | null });
export interface SuggestionInspectionOptions {
  readonly inputs: InspectionInputs;
  /** Borrow existing createNativeSourceDocumentReader and
   * createNativeEvidenceDocumentClient instances, bound to the SAME original
   * nativeBinding as inputs. No client is fabricated from model identifiers. */
  readonly sourceDocuments?: SourceDocumentReader;
  readonly evidenceDocuments?: NativeEvidenceDocumentClient;
  /** Synchronous owned presentation, returning its synchronous cleanup. PDF
   * hosts must use a canvas renderer (e.g. SourcePdfView), the exact initialPage
   * and signal; never an iframe or navigation to a source/model URL. */
  present(view: InspectionView): () => void;
  readonly objectUrls?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
}
export const INSPECTION_LIMITS = Object.freeze({ entries: 4096, mapBytes: 1_048_576, recordBytes: 4096, originalBytes: 10_485_760,
  textScalars: 262_144, rangeScalars: 16_384, pages: 100_000, deadlineMs: 60_000 });
export class SuggestionInspectionUnavailable extends Error {
  constructor() { super('This exact source is unavailable for the current review'); this.name = 'SuggestionInspectionUnavailable'; }
}
function need(value: unknown): asserts value { if (!value) throw new SuggestionInspectionUnavailable(); }
const notify = (callback: () => void) => { try { callback(); } catch { /* Complete every owned cleanup. */ } };
const uuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
const integer = (n: number, min: number, max: number) => Number.isSafeInteger(n) && n >= min && n <= max;
function location(value: unknown): InspectionLocation {
  need(value && typeof value === 'object' && !Array.isArray(value));
  const v = value as Record<string, unknown>;
  const exact = (...keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
  if (v.kind === 'record') { need(exact('kind')); return Object.freeze({ kind: 'record' }); }
  if (v.kind === 'page') {
    const page = v.page as number, pageCount = v.pageCount as number;
    need(exact('kind', 'page', 'pageCount') && integer(pageCount, 1, INSPECTION_LIMITS.pages) && integer(page, 1, pageCount));
    return Object.freeze({ kind: 'page', page, pageCount });
  }
  const start = v.start as number, end = v.end as number, textLength = v.textLength as number;
  need(v.kind === 'text-range' && exact('kind', 'start', 'end', 'textLength')
    && integer(textLength, 1, INSPECTION_LIMITS.textScalars) && integer(start, 0, textLength - 1)
    && integer(end, start + 1, textLength) && end - start <= INSPECTION_LIMITS.rangeScalars);
  return Object.freeze({ kind: 'text-range', start, end, textLength });
}
function binding(value: InspectionBinding): ExactInspectionBinding {
  need(value && Object.keys(value).length === 4 && ['inputRef', 'version', 'evidenceRef', 'location'].every(k => Object.hasOwn(value, k)));
  need(typeof value.inputRef === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value.inputRef)
    && typeof value.evidenceRef === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value.evidenceRef)
    && typeof value.version === 'string' && !!value.version.trim() && new TextEncoder().encode(value.version).length <= 256);
  return Object.freeze({ inputRef: value.inputRef, version: value.version, evidenceRef: value.evidenceRef, location: location(value.location) });
}
const key = (b: ExactInspectionBinding) => JSON.stringify([b.inputRef, b.version, b.evidenceRef, b.location]);
function pin(value: SourceAssetPin): SourceAssetPin {
  need(value && uuid(value.assetId) && integer(value.revision, 1, Number.MAX_SAFE_INTEGER)
    && /^[a-f0-9]{64}$/.test(value.sha256) && integer(value.bytes, 1, INSPECTION_LIMITS.originalBytes));
  return Object.freeze({ assetId: value.assetId, revision: value.revision, sha256: value.sha256, bytes: value.bytes });
}
const samePin = (a: SourceAssetPin, b: SourceAssetPin) => a.assetId === b.assetId && a.revision === b.revision
  && a.sha256 === b.sha256 && a.bytes === b.bytes;
function entry(value: InspectionMapEntry): InspectionMapEntry {
  const b = binding(value.binding), t = value.target;
  if (t.kind === 'record') {
    need(b.location.kind === 'record' && typeof t.text === 'string' && !!t.text.trim()
      && new TextEncoder().encode(t.text).length <= INSPECTION_LIMITS.recordBytes);
    return Object.freeze({ binding: b, target: Object.freeze({ kind: 'record', text: t.text }) });
  }
  need(b.location.kind !== 'record'); // Metadata does not grant original-open authority.
  const asset = pin(t.asset);
  if (t.kind === 'native-source') {
    need(uuid(t.documentId) && integer(t.documentRevision, 1, Number.MAX_SAFE_INTEGER) && b.location.kind === 'page');
    return Object.freeze({ binding: b, target: Object.freeze({ kind: t.kind, documentId: t.documentId, documentRevision: t.documentRevision, asset }) });
  }
  need(t.kind === 'native-evidence' && uuid(t.evidenceId) && integer(t.evidenceRevision, 1, Number.MAX_SAFE_INTEGER));
  return Object.freeze({ binding: b, target: Object.freeze({ kind: t.kind, evidenceId: t.evidenceId, evidenceRevision: t.evidenceRevision, asset }) });
}
function wait<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new SuggestionInspectionUnavailable()); };
    signal.addEventListener('abort', abort, { once: true });
    work.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}
interface Held {
  readonly generation: number; readonly controller: AbortController;
  readonly cleanups: Set<() => void>; text: string | null; blob: Blob | null; url: string | null;
  leaseCurrent(): boolean;
}
/** One isolated inspection consumer per authenticated input-owner allocation.
 * Maps are copied privately, never constructed from the click's correlation
 * data. Replacement retires this consumer permanently (including ABA). No
 * request to a provider URL, retry, mutation, new store or source extraction. */
export function createSuggestionInspectionOwner(options: SuggestionInspectionOptions) {
  const snapshot = options.inputs.current(); need(snapshot);
  const native = snapshot.nativeBinding, scope = native.scope;
  const session = native.sessionIdentity, workspaceId = scope.workspaceId, homeId = scope.homeId, expiresAt = native.expiresAt;
  const account = snapshot.accountKey, identity = Object.freeze({ proposalRevision: snapshot.proposalRevision, sourceSetRevision: snapshot.sourceSetRevision });
  need(typeof account === 'string' && !!account && uuid(workspaceId) && uuid(homeId) && session && typeof session === 'object'
    && /^[a-f0-9]{64}$/.test(identity.proposalRevision) && /^[a-f0-9]{64}$/.test(identity.sourceSetRevision)
    && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) > Date.now()
    && Array.isArray(snapshot.entries) && snapshot.entries.length <= INSPECTION_LIMITS.entries);
  const entries = new Map<string, InspectionMapEntry>();
  let mapBytes = 0;
  for (const raw of snapshot.entries) {
    const e = entry(raw), k = key(e.binding); mapBytes += new TextEncoder().encode(JSON.stringify(e)).length;
    need(!entries.has(k) && mapBytes <= INSPECTION_LIMITS.mapBytes); entries.set(k, e);
  }
  const urls = options.objectUrls ?? URL;
  let retired = false, disposed = false, generation = 0, held: Held | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const withdraw = () => {
    const reserved = ++generation, previous = held; held = null;
    if (previous) {
      previous.text = null; previous.blob = null;
      const url = previous.url; previous.url = null;
      previous.controller.abort(new SuggestionInspectionUnavailable());
      if (url) notify(() => urls.revokeObjectURL(url));
      const cleanups = [...previous.cleanups]; previous.cleanups.clear(); for (const cleanup of cleanups) notify(cleanup);
    }
    return reserved;
  };
  const current = () => {
    if (retired || disposed) return false;
    let now: InspectionSnapshot | null; try { now = options.inputs.current(); } catch { return false; }
    return now === snapshot && now.accountKey === account && now.proposalRevision === identity.proposalRevision
      && now.sourceSetRevision === identity.sourceSetRevision && now.nativeBinding === native
      && native.sessionIdentity === session && native.scope === scope && scope.workspaceId === workspaceId
      && scope.homeId === homeId && native.expiresAt === expiresAt && Date.parse(expiresAt) > Date.now();
  };
  const retire = () => {
    if (!retired) { retired = true; entries.clear(); if (expiryTimer !== undefined) clearTimeout(expiryTimer); withdraw(); }
  };
  const unsubscribe = options.inputs.subscribe(retire);
  // Expiry remains active for the displayed lease, not only while inspect awaits.
  const scheduleExpiry = () => {
    if (retired || disposed) return;
    const remaining = Date.parse(expiresAt) - Date.now();
    if (remaining <= 0) retire();
    else expiryTimer = setTimeout(scheduleExpiry, Math.min(remaining, 2_147_483_647));
  };
  scheduleExpiry();
  const inspect: SuggestionSessionOwner['inspect'] = async (wanted, requested, outer) => {
    const reserved = withdraw();
    need(current() && generation === reserved && wanted.proposalRevision === identity.proposalRevision
      && wanted.sourceSetRevision === identity.sourceSetRevision && !outer.aborted);
    const selected = entries.get(key(binding(requested))); need(selected);
    const h: Held = { generation: reserved, controller: new AbortController(), cleanups: new Set(), text: null, blob: null, url: null, leaseCurrent: () => true };
    held = h;
    const close = () => { if (held === h) withdraw(); };
    const guard = () => {
      const originalCurrent = current(); if (!originalCurrent) retire();
      const leaseCurrent = h.leaseCurrent();
      need(originalCurrent && leaseCurrent && held === h && generation === reserved && !h.controller.signal.aborted);
    };
    const live = () => { try { guard(); return true; } catch { close(); return false; } };
    const cleanup = (stop: () => void) => { if (held === h && !h.controller.signal.aborted) h.cleanups.add(stop); else notify(stop); };
    const abort = () => close(); outer.addEventListener('abort', abort, { once: true });
    cleanup(() => outer.removeEventListener('abort', abort)); if (outer.aborted) close();
    const timer = setTimeout(close, INSPECTION_LIMITS.deadlineMs);
    cleanup(() => clearTimeout(timer));
    const recheck = async () => {
      guard(); const status = await wait(options.inputs.recheck(identity, h.controller.signal), h.controller.signal); guard();
      if (status === 'stale' || status === 'withdrawn') retire();
      need(status === 'current'); guard();
    };
    try {
      await recheck();
      const target = selected.target, where = selected.binding.location;
      if (target.kind === 'record') h.text = target.text;
      else {
        let blob: Blob | null = null, mime = '';
        if (target.kind === 'native-source') {
          const reader = options.sourceDocuments; need(reader);
          const owner = reader.owner(); need(owner);
          cleanup(reader.subscribeOwner(retire)); guard(); need(reader.owner() === owner);
          const doc = await wait(reader.get(target.documentId, h.controller.signal), h.controller.signal); guard();
          need(doc.scope.workspaceId === workspaceId && doc.scope.homeId === homeId && doc.documentId === target.documentId
            && doc.revision === target.documentRevision && doc.lifecycle === 'active' && doc.availability.original === 'available'
            && samePin(doc.original, target.asset));
          const work = reader.openOriginal(target.documentId, target.documentRevision, h.controller.signal);
          void work.then(frame => { if (!live()) reader.release(frame); }, () => undefined);
          const frame = await wait(work, h.controller.signal);
          cleanup(() => reader.release(frame)); guard();
          need(reader.owner() === owner && reader.isCurrent(frame) && frame.mode === 'original' && frame.documentId === target.documentId
            && frame.documentRevision === target.documentRevision && samePin(frame.asset, target.asset));
          h.leaseCurrent = () => reader.owner() === owner && reader.isCurrent(frame);
          cleanup(reader.subscribeInvalidation(frame, close)); guard();
          blob = reader.getBlob(frame); mime = frame.measuredContentType;
        } else {
          const reader = options.evidenceDocuments; need(reader);
          const work = reader.open(target.evidenceId, h.controller.signal);
          void work.then(frame => { if (!live()) reader.release(frame); }, () => undefined);
          const frame = await wait(work, h.controller.signal);
          cleanup(() => reader.release(frame)); guard();
          need(reader.isCurrent(frame) && frame.evidenceId === target.evidenceId && frame.evidenceRevision === target.evidenceRevision
            && frame.mode === 'original-download' && frame.asset.assetId === target.asset.assetId
            && frame.asset.revision.toSafeInteger() === target.asset.revision && frame.asset.byteSize.toSafeInteger() === target.asset.bytes
            && frame.asset.sha256 === target.asset.sha256);
          h.leaseCurrent = () => reader.isCurrent(frame);
          cleanup(reader.subscribeInvalidation(frame, close)); guard();
          blob = reader.getBlob(frame); mime = frame.asset.contentType;
        }
        need(blob && blob.size === target.asset.bytes && blob.type === mime); guard();
        if (where.kind === 'text-range') {
          need(mime === 'text/plain');
          const bytes = await wait(blob.arrayBuffer(), h.controller.signal); guard();
          const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), scalars = Array.from(text);
          need(scalars.length === where.textLength); h.text = scalars.slice(where.start, where.end).join('');
        } else {
          need(where.kind === 'page' && mime === 'application/pdf'); h.blob = blob;
        }
      }
      // Recheck the original selected-input owner after the asynchronous byte
      // owner too. A newer native revision is never substituted for this pin.
      await recheck();
      const base = { binding: selected.binding, signal: h.controller.signal };
      let view: InspectionView;
      if (where.kind === 'page') {
        need(h.blob); const url = urls.createObjectURL(h.blob);
        if (!live()) { notify(() => urls.revokeObjectURL(url)); throw new SuggestionInspectionUnavailable(); }
        h.url = url;
        view = Object.freeze({ ...base, kind: 'pdf', initialPage: where.page, pageCount: where.pageCount,
          getBlob: () => live() ? h.blob : null, getDownloadUrl: () => live() ? h.url : null });
      } else view = Object.freeze({ ...base, kind: where.kind, getText: () => live() ? h.text : null });
      guard(); const stop = options.present(view); need(typeof stop === 'function'); cleanup(stop); guard();
      // The read deadline ends here; account expiry, external cancellation,
      // replacement and frame invalidation remain attached for the whole view.
      clearTimeout(timer);
    } catch {
      close(); throw new SuggestionInspectionUnavailable();
    }
  };
  return Object.freeze({ inspect, close: withdraw, dispose() {
    if (disposed) return; disposed = true; retire(); notify(unsubscribe); if (expiryTimer !== undefined) clearTimeout(expiryTimer);
  } });
}
