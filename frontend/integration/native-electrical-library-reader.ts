import { isExactDecimal } from '../src/numeric/decimal';
import { stringifyLosslessJson, type LosslessJson } from '../src/numeric/lossless-json';
import { projectElectricalLibrary } from '../src/lantern/electrical-library/project';
import type { ElectricalLibraryFrame, ElectricalLibraryReader, ElectricalLibraryRead } from '../src/lantern/electrical-library/types';
import type { NativeEvidenceDocumentClient, NativeEvidenceDocumentFrame } from '../src/lantern/scans/native-evidence-document-types';
import { nativeSceneAssociationPayloadDigest, readNativeOverlayAssociation, readNativeOverlayAssociationHead,
  readNativeOverlayBuildingEvidence, type SceneAssociationContext } from './native-scene-association-client';
import { readDocumentarySupport, documentaryReferences } from './native-scene-documentary-support';
import { readNativeOverlayDetails } from './native-scene-source-client';

export interface NativeElectricalLibraryOptions {
  getContext(): SceneAssociationContext | null;
  subscribeContext(changed: () => void): () => void;
  /** Every call must return a fresh native owner using the same current host
   * session/scope binding. Never pass the shared Atlas drawing client. */
  createDocuments(): NativeEvidenceDocumentClient;
  readonly transport?: typeof fetch;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEAD_INTERVAL = 10_000, READ_MS = 8_000, MAX_AGE = 20_000;
function need(value: unknown): asserts value { if (!value) throw new Error('Current electrical documents are unavailable'); }
function row(value: LosslessJson | undefined): Record<string, LosslessJson> {
  need(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value)); return value;
}
function text(value: LosslessJson | undefined): string { need(typeof value === 'string'); return value; }
function integer(value: LosslessJson | undefined) { need(isExactDecimal(value) && value.isInteger); return value; }
const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(n => n.toString(16).padStart(2, '0')).join('');
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => { signal.removeEventListener('abort', stop); reject(signal.reason ?? new Error('Drawing read stopped')); };
    signal.addEventListener('abort', stop, { once: true });
    promise.then(value => { signal.removeEventListener('abort', stop); resolve(value); }, error => { signal.removeEventListener('abort', stop); reject(error); });
    if (signal.aborted) stop();
  });
}
function stamp(context: SceneAssociationContext): string {
  return JSON.stringify([context.session.actorId, context.session.csrfToken, context.session.expiresAt,
    context.view.scope.workspaceId, context.view.scope.homeId, context.admission?.revision ?? null,
    context.admission?.commandIds ?? null]);
}

/** Passive current native evidence discovery. There is no model/geometry or
 * Document v2 dependency, native write, upload, fallback URL or stored grant. */
export function createNativeElectricalLibraryReader(options: NativeElectricalLibraryOptions): ElectricalLibraryReader {
  type Owned = { client: NativeEvidenceDocumentClient; frame: NativeEvidenceDocumentFrame | null;
    off: (() => void) | null; released: WeakSet<object> };
  type Owner = { token: object; context: SceneAssociationContext; stamp: string };
  type Attempt = { generation: number; owner: Owner; buildingId: string; controller: AbortController; sources: Owned[];
    drawings: Set<NativeEvidenceDocumentClient>; listeners: Set<() => void>; frame: ElectricalLibraryFrame | null;
    headAt: number; pdfAt: number | null; timer: ReturnType<typeof setTimeout> | null;
    expiry: ReturnType<typeof setTimeout> | null; offAbort: () => void; retired: boolean };
  const transport = options.transport ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const issued = new WeakSet<object>(), ownerListeners = new Set<() => void>();
  let binding: Owner | null = null, active: Attempt | null = null, disposed = false, generation = 0;
  const notify = (callbacks: Iterable<() => void>) => { for (const callback of [...callbacks]) { try { callback(); } catch { /* notify all owners */ } } };
  const release = (owned: Owned, frame: NativeEvidenceDocumentFrame) => {
    if (!owned.released.has(frame)) { owned.released.add(frame); owned.client.release(frame); }
  };
  const retire = (attempt: Attempt) => {
    if (attempt.retired) return;
    attempt.retired = true; if (active === attempt) active = null;
    const callbacks = [...attempt.listeners]; attempt.listeners.clear();
    attempt.controller.abort(); attempt.offAbort();
    if (attempt.timer !== null) clearTimeout(attempt.timer);
    if (attempt.expiry !== null) clearTimeout(attempt.expiry);
    for (const owned of attempt.sources) { owned.off?.(); owned.off = null; if (owned.frame) release(owned, owned.frame); owned.client.dispose(); }
    for (const client of [...attempt.drawings]) client.dispose(); attempt.drawings.clear();
    notify(callbacks);
  };
  const observe = (): Owner | null => {
    let context: SceneAssociationContext | null = null;
    try { context = disposed ? null : options.getContext(); } catch { /* unavailable host */ }
    if (!context || !context.sessionIdentity || !UUID.test(context.view.scope.workspaceId) || !UUID.test(context.view.scope.homeId)
      || !Number.isFinite(Date.parse(context.session.expiresAt)) || Date.parse(context.session.expiresAt) <= Date.now()) context = null;
    const same = context && binding && context.sessionIdentity === binding.context.sessionIdentity
      && context.session === binding.context.session && context.view === binding.context.view
      && context.view.scope === binding.context.view.scope && context.admission === binding.context.admission && stamp(context) === binding.stamp;
    if (same) return binding;
    if (!context && !binding) return null;
    // Publish the replacement binding before retirement can call a subscriber
    // that opens another read. Returning from callbacks must not overwrite it.
    const previous = active;
    binding = context ? { token: Object.freeze({}), context, stamp: stamp(context) } : null;
    if (previous) retire(previous);
    notify(ownerListeners); return binding;
  };
  const ownsAttempt = (attempt: Attempt) => !disposed && !attempt.retired && active === attempt
    && generation === attempt.generation && !attempt.controller.signal.aborted;
  const current = (attempt: Attempt): boolean => {
    if (!ownsAttempt(attempt) || observe() !== attempt.owner || !ownsAttempt(attempt)) return false;
    const sourcesCurrent = attempt.sources.every(source => !source.frame || source.client.isCurrent(source.frame));
    // Both the context and document-owner calls can synchronously notify their
    // consumers. Recheck ownership after those calls, not only before them.
    return sourcesCurrent && ownsAttempt(attempt)
      && (!attempt.frame || (Date.now() - attempt.headAt <= MAX_AGE && (attempt.pdfAt === null || Date.now() - attempt.pdfAt <= MAX_AGE)));
  };
  const guard = (attempt: Attempt) => { attempt.controller.signal.throwIfAborted(); need(current(attempt)); };
  const makeClient = () => { const client = options.createDocuments(); need(!issued.has(client)); issued.add(client); return client; };
  const offHost = options.subscribeContext(() => { observe(); });
  const read = async (buildingId: string, signal: AbortSignal): Promise<ElectricalLibraryRead> => {
    signal.throwIfAborted(); need(UUID.test(buildingId));
    const reserved = ++generation, previous = active;
    if (previous) retire(previous);
    const reservationCurrent = () => !disposed && generation === reserved && !signal.aborted;
    if (!reservationCurrent()) { signal.throwIfAborted(); return { status: 'unavailable', reason: 'selection-changed' }; }
    const owner = observe();
    if (!reservationCurrent()) { signal.throwIfAborted(); return { status: 'unavailable', reason: 'selection-changed' }; }
    if (!owner) return { status: 'unavailable', reason: 'current-source-unavailable' };
    const attempt: Attempt = { generation: reserved, owner, buildingId, controller: new AbortController(), sources: [], drawings: new Set(), listeners: new Set(),
      frame: null, headAt: 0, pdfAt: null, timer: null, expiry: null, offAbort: () => {}, retired: false };
    active = attempt;
    const stop = () => retire(attempt);
    signal.addEventListener('abort', stop, { once: true }); attempt.offAbort = () => signal.removeEventListener('abort', stop);
    if (signal.aborted) stop();
    attempt.expiry = setTimeout(stop, 75_000);
    const pin = () => guard(attempt), native = owner.context;
    const retain = async (document: Record<string, LosslessJson>) => {
      pin(); const client = makeClient();
      // A reentrant factory may have superseded this attempt before the new
      // client could be registered for retirement. Dispose that exact client.
      try { pin(); } catch (error) { client.dispose(); throw error; }
      const owned: Owned = { client, frame: null, off: null, released: new WeakSet() }; attempt.sources.push(owned);
      const opening = owned.client.open(text(document.evidenceId), attempt.controller.signal);
      void opening.then(frame => { if (attempt.retired || attempt.controller.signal.aborted) release(owned, frame); }, () => {});
      const frame = await abortable(opening, attempt.controller.signal); owned.frame = frame; pin();
      const off = owned.client.subscribeInvalidation(frame, stop); if (attempt.retired) { off(); pin(); } owned.off = off;
      need(frame.mode === 'original-download' && frame.evidenceId === document.evidenceId
        && frame.evidenceRevision === integer(document.evidenceRevision).toSafeInteger()
        && frame.asset.assetId === document.originalAssetId && frame.asset.revision.compare(integer(document.originalAssetRevision)) === 0
        && frame.asset.sha256 === document.originalSha256 && frame.asset.contentType === 'text/plain');
      const blob = owned.client.getBlob(frame);
      need(blob?.type === 'text/plain' && blob.size > 0 && blob.size <= 8 * 1024 * 1024 && frame.asset.byteSize.toSafeInteger() === blob.size);
      const bytes = new Uint8Array(await abortable(blob.arrayBuffer(), attempt.controller.signal)); pin();
      need(await digest(bytes) === document.originalSha256); pin(); return { bytes, frame };
    };
    const buildingHas = async (evidenceId: string, readSignal: AbortSignal) => {
      pin(); const present = await abortable(readNativeOverlayBuildingEvidence(native, buildingId, evidenceId, readSignal, pin, transport), readSignal);
      pin(); return present;
    };
    try {
      pin(); const association = await readNativeOverlayAssociation(native, buildingId, `electrical-library:${crypto.randomUUID()}`,
        attempt.controller.signal, pin, transport); pin();
      if (association.status !== 'available') { retire(attempt); return association; }
      const payload = row(association.payload); need(Array.isArray(payload.sourceDocuments));
      const documents = payload.sourceDocuments.map(value => row(value));
      const primaryPin = documents.find(document => document.role === 'primary-scene'), historicalPin = documents.find(document => document.role === 'documentary-sheet');
      need(primaryPin && historicalPin);
      const primary = await retain(primaryPin), historical = await retain(historicalPin); pin();
      let selection = association.selection;
      const support = await readDocumentarySupport(historical.bytes, pin); pin();
      if (support && support.originalSha256 === historicalPin.originalSha256 && text(payload.reviewStatement).endsWith(support.reviewMarker)
        && support.pdf.workspaceId === selection.workspaceId && support.pdf.homeId === selection.homeId && support.pdf.buildingId === buildingId) {
        const check = new AbortController(), forward = () => check.abort();
        attempt.controller.signal.addEventListener('abort', forward, { once: true }); const timer = setTimeout(forward, READ_MS);
        try {
          if (await buildingHas(support.pdf.evidenceId, check.signal)) {
            attempt.pdfAt = Date.now();
            selection = Object.freeze({ ...selection, drawingReferences: documentaryReferences(support, selection), drawingSupport: Object.freeze({
              evidenceId: historical.frame.evidenceId, evidenceRevision: historical.frame.evidenceRevision,
              assetId: historical.frame.asset.assetId, assetRevision: historical.frame.asset.revision,
              originalSha256: support.originalSha256, reviewMarker: support.reviewMarker }) });
          }
        } catch { pin(); /* Optional correlation remains unavailable; preserve sheet metadata. */ }
        finally { clearTimeout(timer); attempt.controller.signal.removeEventListener('abort', forward); check.abort(); }
      }
      let details = await readNativeOverlayDetails(selection, primary.bytes, historical.bytes, pin); pin();
      need(details.electricalFixtures.status === 'available');
      const final = await readNativeOverlayAssociation(native, buildingId, selection.viewKey, attempt.controller.signal, pin, transport); pin();
      need(final.status === 'available' && final.recordId === association.recordId && final.revision.compare(association.revision) === 0
        && stringifyLosslessJson(final.payload) === stringifyLosslessJson(association.payload));
      attempt.headAt = Date.now();
      // The association read cannot renew the separate PDF membership proof.
      if (attempt.pdfAt !== null && Date.now() - attempt.pdfAt > MAX_AGE) {
        attempt.pdfAt = null; selection = association.selection;
        details = await readNativeOverlayDetails(selection, primary.bytes, historical.bytes, pin); pin();
      }
      const projection = projectElectricalLibrary(selection, details);
      const expected = await abortable(nativeSceneAssociationPayloadDigest(association.payload), attempt.controller.signal); pin();
      const frame: ElectricalLibraryFrame = Object.freeze({ status: 'available', lease: Object.freeze({}),
        scope: Object.freeze({ workspaceId: selection.workspaceId, homeId: selection.homeId }), buildingId,
        ...projection, provenance: details.drawingProvenance ?? null });
      const checkHead = async () => {
        const check = new AbortController(), forward = () => check.abort();
        attempt.controller.signal.addEventListener('abort', forward, { once: true }); const timer = setTimeout(forward, READ_MS);
        try {
          pin(); const head = await readNativeOverlayAssociationHead(native, buildingId, check.signal, pin, transport); pin();
          need(head.status === 'available' && head.recordId === association.recordId && head.revision.compare(association.revision) === 0 && head.payloadSha256 === expected);
          const checkedAt = Date.now();
          if (attempt.pdfAt !== null) {
            for (const document of frame.documents) need(await buildingHas(document.evidenceId, check.signal));
            attempt.pdfAt = Date.now();
          }
          attempt.headAt = checkedAt; pin();
          attempt.timer = setTimeout(() => { void checkHead(); }, Math.max(0, HEAD_INTERVAL - (Date.now() - checkedAt)));
        } catch { retire(attempt); }
        finally { clearTimeout(timer); attempt.controller.signal.removeEventListener('abort', forward); check.abort(); }
      };
      pin(); attempt.frame = frame;
      if (attempt.expiry !== null) clearTimeout(attempt.expiry);
      attempt.expiry = setTimeout(stop, Math.min(2_147_483_647, Math.max(1, Date.parse(native.session.expiresAt) - Date.now() + 1)));
      attempt.timer = setTimeout(() => { void checkHead(); }, Math.max(0, HEAD_INTERVAL - (Date.now() - attempt.headAt)));
      pin(); return frame;
    } catch {
      const changed = !current(attempt); retire(attempt); signal.throwIfAborted();
      return { status: 'unavailable', reason: changed ? 'selection-changed' : 'current-source-unavailable' };
    }
  };
  const isCurrent = (frame: ElectricalLibraryFrame) => active?.frame === frame && current(active);
  return Object.freeze({ read, owner: () => observe()?.token ?? null,
    subscribeOwner(callback: () => void) { ownerListeners.add(callback); return () => { ownerListeners.delete(callback); }; }, isCurrent,
    subscribeInvalidation(frame: ElectricalLibraryFrame, callback: () => void) {
      if (!isCurrent(frame)) { callback(); return () => {}; }
      const listeners = active!.listeners; listeners.add(callback); return () => { listeners.delete(callback); };
    },
    createDrawingClient(frame: ElectricalLibraryFrame) {
      need(isCurrent(frame)); const attempt = active!, client = makeClient(); let ended = false;
      if (!isCurrent(frame)) { client.dispose(); throw new Error('Current electrical documents are unavailable'); }
      const owned: NativeEvidenceDocumentClient = { ...client, dispose() {
        if (ended) return; ended = true; attempt.drawings.delete(owned); client.dispose();
      } };
      attempt.drawings.add(owned); return owned;
    },
    release(frame: ElectricalLibraryFrame) { if (active?.frame === frame) retire(active); },
    dispose() { if (disposed) return; disposed = true; if (active) retire(active); binding = null; offHost(); notify(ownerListeners); ownerListeners.clear(); },
  });
}
