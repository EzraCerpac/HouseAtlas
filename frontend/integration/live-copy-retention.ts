import type { ElectricalLibraryReader, ElectricalLibraryFrame } from '../src/lantern/electrical-library/types';
import type { NativeEvidenceDocumentFrame } from '../src/lantern/scans/native-evidence-document-types';
import type { ReadyView } from '../src/app/types';
import type { AtlasSessionInfo } from '../src/app/session';
import type { SourceDocumentsPort, SourceDocument, SourceDocumentFrame, SourceDocumentReader } from '../src/lantern/source-documents/types';
import type { OfflineHomeboxAttachmentRefV1, OfflineHomeboxPinV1, OfflineElectricalPinV1, OfflineElectricalBuildingV1, OfflineCatalogItemV1, OfflineCatalogV1, OfflineDocumentPinV1, OfflineResult, OfflineBackend, OfflineAtlasReferenceV1, OfflineReadPort } from '../src/offline/live-copy-types';
import { createLiveCopyOwner, LIVE_COPY_LIMITS, electricalPinBytes, validElectricalPin, validHomeboxRef, listsAttachment, type LiveCopyActor, type LiveCopyHome } from '../src/offline/live-copy-owner';
import { openLiveCopyBackend } from '../src/offline/live-copy-indexeddb';
import type { HomeboxOriginalFrame, HomeboxOriginalReader, HomeboxOriginalOpenResult, HomeboxOriginalSource,
  HomeboxRetentionAttempt, HomeboxRetentionReconciliation } from '../src/lantern/homebox-originals/types';

type State = { readonly session: AtlasSessionInfo | null; readonly view: ReadyView | null };
/** Stable data-only host owner. No UI, network at construction, authority recovery or outbox configuration. */
export function createLiveCopyRetention(options: {
  readonly factory: IDBFactory | undefined; readonly backend?: OfflineBackend; readonly state: () => State;
  readonly documents: () => SourceDocumentsPort;
  readonly atlasReference?: (identity: { readonly actorId: string; readonly scope: Readonly<{ workspaceId: string; homeId: string }> },
    signal: AbortSignal) => Promise<OfflineAtlasReferenceV1 | null>;
  readonly storage?: Pick<StorageManager, 'estimate' | 'persisted' | 'persist'>;
  readonly events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  readonly channel?: { postMessage(value: string): void; close(): void; onmessage: ((event: MessageEvent) => void) | null };
  /** Same-origin transport for the HomeBox offline-original GET; defaults to fetch, never configured from storage. */
  readonly homeboxTransport?: typeof fetch;
}) {
  const channel = options.channel;
  const owner = createLiveCopyOwner(options.backend ?? openLiveCopyBackend(options.factory), {
    ...(options.storage ? { storage: options.storage } : {}),
    changed: () => channel?.postMessage('changed'),
  });
  if (channel) channel.onmessage = () => { owner.refreshCopies(); refreshHomeboxOriginals(); };
  const recheckCopies = () => { owner.refreshCopies(); refreshHomeboxOriginals(); };
  options.events?.addEventListener('focus', recheckCopies); options.events?.addEventListener('visibilitychange', recheckCopies);
  const outcomeListeners = new Set<() => void>();
  let actor: LiveCopyActor | null = null, observed: AtlasSessionInfo | null = null, generation = 0;
  let lastResult: OfflineResult<unknown> = { status: 'missing' };
  const remember = <T>(result: OfflineResult<T>): OfflineResult<T> => { lastResult = result; for (const cb of [...outcomeListeners]) { try { cb(); } catch { /* outcome remains available */ } } return result; };
  async function observe(session: AtlasSessionInfo | null, current: () => boolean) {
    const attempt = ++generation; actor = null; observed = null;
    refreshHomeboxOriginals();
    const result = await owner.observeActor(session?.actorId ?? null, () => attempt === generation && current());
    if (result.status === 'ok' && attempt === generation && current()) { actor = result.value; observed = session; }
    return remember(result);
  }
  function binding(): OfflineResult<{ home: LiveCopyHome; current: () => boolean }> {
    const { session, view } = options.state();
    if (!actor || !observed || session !== observed || !view || view.status !== 'ready'
      || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) return { status: 'retired' };
    const attempt = generation;
    const current = () => {
      const latest = options.state();
      return attempt === generation && latest.session === session && latest.view === view && observed === session
        && Date.parse(session.expiresAt) > Date.now();
    };
    const result = owner.bindHome(actor, view.scope, current);
    return result.status === 'ok' ? { status: 'ok', value: { home: result.value, current } } : result;
  }
  // Sent HomeBox reads per actual session allocation. Any sent outcome (including unknown) is never repeated
  // automatically for that association, even with a fresh requestId; nothing here persists.
  type Claim = { state: 'reserved-unsent' | 'in-flight' | 'sent-success' | 'definitive-refusal' | 'sent-unknown' };
  const homeboxSent = new WeakMap<AtlasSessionInfo, Map<string, Claim>>();
  const homeboxKey = (scope: ReadyView['scope'], ref: OfflineHomeboxAttachmentRefV1) => JSON.stringify([
    scope.workspaceId, scope.homeId, ref.sourceInstanceId, ref.collectionId, ref.entityId, ref.attachmentId]);
  const safeCurrent = (current: () => boolean) => { try { return current(); } catch { return false; } };
  const lifetimes = new Set<{ current(): boolean; stop(): void }>();
  function refreshHomeboxOriginals() {
    for (const life of [...lifetimes]) if (!safeCurrent(life.current)) life.stop();
  }
  // Actual session expiry only; no producer snapshot window or provider-membership lease.
  function track(current: () => boolean, expiry: number, stop: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined, ended = false;
    const remove = () => { if (timer !== undefined) clearTimeout(timer); lifetimes.delete(life); };
    const life = { current, stop() { if (!ended) { ended = true; remove(); stop(); } } };
    const arm = () => {
      if (!safeCurrent(current)) { life.stop(); return; }
      timer = setTimeout(arm, Math.min(2_147_483_647, Math.max(1, expiry - Date.now())));
    };
    lifetimes.add(life); arm();
    return () => { ended = true; remove(); };
  }
  interface FrameRecord {
    readonly frame: HomeboxOriginalFrame; readonly reader: object;
    readonly ref: Readonly<OfflineHomeboxAttachmentRefV1>; readonly pin: Readonly<OfflineHomeboxPinV1>;
    readonly binding: Readonly<{ session: AtlasSessionInfo; view: ReadyView; actorId: string;
      scope: Readonly<ReadyView['scope']>; actor: LiveCopyActor; current: () => boolean }>;
    readonly notify: () => void;
    readonly stopTracking: () => void;
    blob: Blob | null; ui: boolean; storage: boolean; retired: boolean;
    storageController?: AbortController; attempt?: HomeboxRetentionAttempt;
  }
  const frames = new WeakMap<HomeboxOriginalFrame, FrameRecord>();
  function cleanupFrame(record: FrameRecord) {
    if (!record.ui && !record.storage) { record.blob = null; record.stopTracking(); }
  }
  function retireFrame(record: FrameRecord) {
    if (record.retired) return;
    record.retired = true; record.ui = false; record.storageController?.abort(); cleanupFrame(record); record.notify();
  }
  const frameCurrent = (record: FrameRecord) => !record.retired && safeCurrent(record.binding.current);
  async function acquireHomebox(refInput: OfflineHomeboxAttachmentRefV1, signal: AbortSignal,
    reader: object, additionalCurrent: () => boolean, notify: () => void): Promise<HomeboxOriginalOpenResult> {
    const b = binding(); if (b.status !== 'ok') return { status: 'retired' };
    const { session, view } = options.state(), originalActor = actor;
    if (!session || !view || !originalActor || !validHomeboxRef(refInput)) return { status: 'invalid' };
    const ref = Object.freeze({ ...refInput }), scope = Object.freeze({ ...view.scope });
    if (!listsAttachment(view, ref)) return { status: 'missing' };
    const expiry = Date.parse(session.expiresAt);
    const current = () => b.value.current() && Date.now() < expiry && safeCurrent(additionalCurrent);
    if (signal.aborted || !current()) return { status: signal.aborted ? 'aborted' : 'retired' };
    let claims = homeboxSent.get(session);
    if (!claims) { claims = new Map(); homeboxSent.set(session, claims); }
    const key = homeboxKey(scope, ref), prior = claims.get(key);
    if (prior) return prior.state === 'reserved-unsent' || prior.state === 'in-flight' ? { status: 'busy' }
      : { status: 'spent', outcome: prior.state === 'sent-success' ? 'success' : prior.state === 'sent-unknown' ? 'unknown' : 'definitive-refusal' };
    const claim: Claim = { state: 'reserved-unsent' }; claims.set(key, claim);
    const controller = new AbortController(), cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    let record: FrameRecord | undefined;
    const untrack = track(current, expiry, () => { controller.abort(); if (record) retireFrame(record); });
    try {
      const { readHomeboxOriginal } = await import('../src/offline/homebox-original-reader');
      if (signal.aborted || controller.signal.aborted || !current()) {
        claims.delete(key); return { status: signal.aborted ? 'aborted' : 'retired' };
      }
      claim.state = 'in-flight';
      const read = await readHomeboxOriginal({ scope, ref, signal: controller.signal,
        ...(options.homeboxTransport ? { transport: options.homeboxTransport } : {}) });
      if (read.status === 'unavailable' && !read.sent) claims.delete(key);
      else claim.state = read.status === 'ok' ? 'sent-success' : read.status === 'unknown' ? 'sent-unknown' : 'definitive-refusal';
      if (controller.signal.aborted || !current()) return { status: signal.aborted ? 'aborted' : 'retired' };
      if (read.status !== 'ok') return { status: read.status };
      const pin = Object.freeze({ ...read.pin });
      const frame = Object.freeze({}) as HomeboxOriginalFrame;
      record = { frame, reader, ref, pin, binding: Object.freeze({ session, view, actorId: session.actorId, scope, actor: originalActor, current }), notify, stopTracking: untrack,
        blob: new Blob([read.bytes.slice(0)], { type: pin.contentType ?? 'application/octet-stream' }), ui: true, storage: false, retired: false };
      frames.set(frame, record); return { status: 'ok', frame };
    } catch {
      if (claim.state === 'reserved-unsent') claims.delete(key);
      else if (claim.state === 'in-flight') claim.state = 'sent-unknown';
      return { status: !current() ? 'retired' : claim.state === 'sent-unknown' ? 'unknown' : signal.aborted ? 'aborted' : 'unavailable' };
    } finally { signal.removeEventListener('abort', cancel); if (!record) untrack(); }
  }
  function retainHomeboxFrame(record: FrameRecord): HomeboxRetentionAttempt {
    if (record.attempt) return record.attempt;
    const controller = new AbortController(); record.storageController = controller; record.storage = true;
    const current = () => record.storage && !controller.signal.aborted && record.blob !== null && frameCurrent(record);
    const work = async (): Promise<OfflineResult<Readonly<OfflineHomeboxPinV1>>> => {
      try {
        const blob = record.blob;
        if (!blob || !current()) return { status: 'retired' };
        const bytes = await blob.arrayBuffer();
        if (!current() || record.blob !== blob) return { status: 'retired' };
        const home = owner.bindHome(record.binding.actor, record.binding.scope, current);
        if (home.status !== 'ok') return home;
        const stored = await owner.keepHomeboxDocument(home.value, record.pin, bytes, controller.signal);
        return stored.status === 'ok' ? { status: 'ok', value: record.pin } : stored;
      } catch { return { status: current() ? 'unavailable' : 'retired' }; }
    };
    // The operation owns its signal, not the UI. The existing storage deadline is not increased.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<OfflineResult<Readonly<OfflineHomeboxPinV1>>>(resolve => {
      timer = setTimeout(() => { resolve({ status: 'uncertain' }); controller.abort(); }, 10_000);
    });
    const result = Promise.race([work(), deadline]).then(outcome => {
      if (outcome.status === 'integrity' || outcome.status === 'retired' || !frameCurrent(record)) retireFrame(record);
      return outcome;
    }).finally(() => { if (timer !== undefined) clearTimeout(timer); record.storage = false; cleanupFrame(record); });
    const attempt: HomeboxRetentionAttempt = Object.freeze({ result,
      async reconcile(signal: AbortSignal): Promise<HomeboxRetentionReconciliation> {
        const current = () => !signal.aborted && frameCurrent(record);
        const fail = (): HomeboxRetentionReconciliation => ({ status: signal.aborted ? 'aborted' : 'retired' });
        if (!current()) return fail();
        try {
          const copy = await owner.readLast(signal); if (!current()) return fail();
          if (copy.status !== 'ok') {
            if (copy.status === 'integrity' || copy.status === 'retired') { retireFrame(record); return { status: copy.status }; }
            return { status: 'unresolved' };
          }
          const identity = await owner.copyIdentity(copy.value.handle, signal); if (!current()) return fail();
          if (identity.status !== 'ok' || identity.value.actorId !== record.binding.actorId
            || identity.value.scope.workspaceId !== record.binding.scope.workspaceId || identity.value.scope.homeId !== record.binding.scope.homeId) {
            retireFrame(record); return fail();
          }
          const held = await owner.homeboxStatus(copy.value.handle, record.ref, signal); if (!current()) return fail();
          if (held.status !== 'ok') {
            if (held.status === 'integrity' || held.status === 'retired') { retireFrame(record); return { status: held.status }; }
            return { status: 'unresolved' };
          }
          if (held.value.availability === 'failed-integrity') { retireFrame(record); return { status: 'integrity' }; }
          if (held.value.availability !== 'held') return { status: 'unresolved' };
          const heldPin = held.value.pin;
          if (!Object.keys(record.pin).every(key => record.pin[key as keyof OfflineHomeboxPinV1]
            === heldPin[key as keyof OfflineHomeboxPinV1])) return { status: 'unresolved' };
          const bytes = await owner.readHomeboxDocument(copy.value.handle, record.pin, signal); if (!current()) return fail();
          if (bytes.status === 'integrity' || bytes.status === 'retired') { retireFrame(record); return { status: bytes.status }; }
          return bytes.status === 'ok' ? { status: 'held', pin: record.pin } : { status: 'unresolved' };
        } catch { return current() ? { status: 'unavailable' } : fail(); }
      },
    });
    record.attempt = attempt; return attempt;
  }
  function createHomeboxOriginalReader(view: ReadyView, source: HomeboxOriginalSource): OfflineResult<HomeboxOriginalReader> {
    const b = binding(), identity = source.getBindingIdentity();
    if (b.status !== 'ok' || options.state().view !== view || !identity) return { status: 'retired' };
    const scope = Object.freeze({ ...view.scope }), bound = source.getBindingScope(identity);
    if (!bound || bound.workspaceId !== scope.workspaceId || bound.homeId !== scope.homeId) return { status: 'retired' };
    const token = {}, listeners = new Set<() => void>(), borrows = new Set<HomeboxOriginalFrame>(), pending = new Set<AbortController>();
    let disposed = false, retired = false;
    const current = () => {
      const latest = source.getBindingScope(identity);
      return !retired && b.value.current() && source.getBindingIdentity() === identity
        && latest?.workspaceId === scope.workspaceId && latest.homeId === scope.homeId;
    };
    const notify = () => { for (const cb of [...listeners]) { try { cb(); } catch { /* notification is not authority */ } } };
    const untrack = track(current, Date.parse(options.state().session!.expiresAt), () => {
      retired = true; for (const request of pending) request.abort();
      for (const frame of borrows) { const record = frames.get(frame); if (record) retireFrame(record); } notify();
    });
    const release = (frame: HomeboxOriginalFrame) => {
      const record = frames.get(frame); if (!record || record.reader !== token) return;
      record.ui = false; borrows.delete(frame); cleanupFrame(record);
    };
    const admitted = (frame: HomeboxOriginalFrame) => {
      const record = frames.get(frame);
      return !disposed && record?.reader === token && record.ui && frameCurrent(record) ? record : null;
    };
    return { status: 'ok', value: {
      scope,
      async open(refInput, signal) {
        if (disposed || !current()) return { status: 'retired' };
        if (!validHomeboxRef(refInput)) return { status: 'invalid' };
        const ref = Object.freeze({ ...refInput });
        if (!listsAttachment(view, ref)) return { status: 'missing' };
        const listed = view.entries.flatMap(entry => entry.source.sourceKind === 'homebox-entity'
          && entry.source.sourceInstanceId === ref.sourceInstanceId && entry.source.collectionId === ref.collectionId && entry.source.externalId === ref.entityId
          ? entry.attachments.filter(a => a.kind === 'stored-file' && a.attachmentId === ref.attachmentId) : []);
        // A hint can refuse scheduling; it never admits received bytes.
        if (listed.some(a => {
          if (a.byteSize === null || a.byteSize === undefined || !/^[0-9]+$/.test(a.byteSize)) return false;
          const digits = a.byteSize.replace(/^0+/, '') || '0';
          return digits.length > 8 || Number(digits) > 10_485_760;
        })) return { status: 'limit' };
        const request = new AbortController(), cancel = () => request.abort();
        pending.add(request); signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) request.abort();
        try {
          const discovery = await source.discover(identity, request.signal);
          if (disposed || !current() || request.signal.aborted) return { status: signal.aborted ? 'aborted' : 'retired' };
          if (discovery.scope.workspaceId !== scope.workspaceId || discovery.scope.homeId !== scope.homeId
            || !discovery.installedSources.some(row => row.workspaceId === scope.workspaceId && row.homeId === scope.homeId
              && row.key.sourceKind === 'homebox-entity' && row.key.sourceInstanceId === ref.sourceInstanceId
              && row.key.collectionId === ref.collectionId && row.key.externalId === ref.entityId)) return { status: 'unavailable' };
          const opened = await acquireHomebox(ref, request.signal, token, current, notify);
          if (opened.status === 'ok') {
            if (disposed || !current() || request.signal.aborted) { release(opened.frame); return { status: 'retired' }; }
            borrows.add(opened.frame);
          }
          return opened;
        } catch { return { status: !current() || disposed ? 'retired' : signal.aborted ? 'aborted' : 'unavailable' }; }
        finally { signal.removeEventListener('abort', cancel); pending.delete(request); }
      },
      isCurrent: frame => admitted(frame) !== null,
      getBlob: frame => admitted(frame)?.blob ?? null,
      subscribe(changed) { if (disposed) return () => {}; listeners.add(changed); return () => { listeners.delete(changed); }; },
      retain(frame) {
        const record = admitted(frame); return record ? { status: 'ok', value: retainHomeboxFrame(record) } : { status: 'retired' };
      },
      release,
      dispose() { if (disposed) return; disposed = true; untrack(); for (const request of pending) request.abort();
        for (const frame of [...borrows]) release(frame); listeners.clear(); },
    } };
  }
  const metadata = (row: SourceDocument): OfflineCatalogItemV1 => ({
    documentId: row.documentId, documentRevision: row.revision, title: row.title, lifecycle: row.lifecycle,
    assetId: row.original.assetId, assetRevision: row.original.revision, sha256: row.original.sha256,
    bytes: row.original.bytes, recordedAvailability: row.availability.original,
  });
  /** Explicit authorized enumeration; no partial catalog is constructed from a single open. */
  async function retainCatalog(signal: AbortSignal, additionalCurrent: () => boolean = () => true): Promise<OfflineResult<OfflineCatalogV1>> {
    const b = binding(); if (b.status !== 'ok') return remember(b);
    const retired = () => signal.aborted || !b.value.current() || !additionalCurrent();
    let reader: Awaited<ReturnType<SourceDocumentsPort['createReader']>> | null = null;
    try {
      reader = await options.documents().createReader();
      if (retired()) return remember({ status: signal.aborted ? 'aborted' : 'retired' });
      const identity = reader.owner(); if (!identity) return remember({ status: 'retired' });
      const rows: OfflineCatalogItemV1[] = [], cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const page = await reader.list(cursor, signal);
        if (retired() || reader.owner() !== identity) return remember({ status: signal.aborted ? 'aborted' : 'retired' });
        rows.push(...page.documents.map(metadata));
        if (rows.length > LIVE_COPY_LIMITS.documents) return remember({ status: 'limit' });
        cursor = page.nextCursor;
        if (cursor !== null) { if (cursors.has(cursor)) return remember({ status: 'integrity' }); cursors.add(cursor); }
      } while (cursor !== null);
      const catalog: OfflineCatalogV1 = { version: 1, capturedAt: new Date().toISOString(), completeness: 'captured-complete', documents: rows };
      if (!actor || retired()) return remember({ status: signal.aborted ? 'aborted' : 'retired' });
      const live = owner.bindHome(actor, options.state().view!.scope, () => !retired() && reader!.owner() === identity);
      if (live.status !== 'ok') return remember(live);
      const result = await owner.keepCatalog(live.value, catalog, signal);
      return remember(result.status === 'ok' ? { status: 'ok', value: catalog } : result);
    } catch { return remember({ status: signal.aborted ? 'aborted' : retired() ? 'retired' : 'unavailable' }); }
    finally { reader?.dispose(); }
  }
  return {
    read: { homeboxStatus: owner.homeboxStatus, readHomeboxDocument: owner.readHomeboxDocument, readElectricalCatalog: owner.readElectricalCatalog, electricalStatus: owner.electricalStatus, readElectricalDocument: owner.readElectricalDocument, readLast: owner.readLast, readCatalog: owner.readCatalog, readDocument: owner.readDocument, documentStatus: owner.documentStatus,
      async atlasReference(handle, signal) {
        const identity = await owner.copyIdentity(handle, signal); if (identity.status !== 'ok') return identity;
        try {
          const resolve: NonNullable<typeof options.atlasReference> = options.atlasReference ?? (async (selected, requestSignal) => {
            const module = await import('./unified-atlas-cache');
            requestSignal.throwIfAborted();
            const store = module.openUnifiedAtlasStore(options.factory);
            try {
              await store.ready(); requestSignal.throwIfAborted();
              const last = await module.readLastAtlas(store); requestSignal.throwIfAborted();
              const p = last?.pointer;
              if (!p || p.actorId !== selected.actorId || p.workspaceId !== selected.scope.workspaceId || p.homeId !== selected.scope.homeId) return null;
              return { version: 1 as const, scope: { workspaceId: p.workspaceId, homeId: p.homeId },
                publicationId: p.publicationId, manifestSha256: p.manifestSha256, atlasActorRevision: p.actorRevision };
            } finally { await store.close(); }
          });
          const reference = await resolve(identity.value, signal);
          const latest = await owner.copyIdentity(handle, signal); if (latest.status !== 'ok') return latest;
          if (reference && (reference.version !== 1 || reference.scope.workspaceId !== identity.value.scope.workspaceId
            || reference.scope.homeId !== identity.value.scope.homeId || typeof reference.publicationId !== 'string'
            || !reference.publicationId || reference.publicationId.length > 1024 || !/^[a-f0-9]{64}$/.test(reference.manifestSha256)
            || !reference.atlasActorRevision || reference.atlasActorRevision.length > 1024)) return { status: 'integrity' } as const;
          if (identity.value.actorRevision !== latest.value.actorRevision) return { status: 'retired' } as const;
          return { status: 'ok', value: reference } as const;
        } catch { return { status: signal.aborted ? 'aborted' : 'unavailable' } as const; }
      }, subscribe(changed: () => void) {
      outcomeListeners.add(changed); const unsubscribe = owner.subscribe(changed);
      return () => { outcomeListeners.delete(changed); unsubscribe(); };
    } } satisfies OfflineReadPort,
    storage: { status: owner.status, requestPersistence: owner.requestPersistence, clear: async () => {
      generation++; actor = null; observed = null; refreshHomeboxOriginals(); return remember(await owner.clear());
    } },
    observe,
    lastResult: () => lastResult,
    /** Synchronous retirement on sign-out/host replacement, even before lazy deletion. */
    retire() { generation++; actor = null; observed = null; refreshHomeboxOriginals(); owner.invalidate(); },
    createHomeboxOriginalReader,
    refreshHomeboxOriginals,
    async capture(view: ReadyView, signal: AbortSignal) {
      const b = binding(); if (b.status !== 'ok') return remember(b);
      if (options.state().view !== view) return remember({ status: 'retired' } as const);
      return remember(await owner.keepView(b.value.home, view, signal));
    },
    retainCatalog(signal: AbortSignal) { return retainCatalog(signal); },
    /** Pins come from a fresh exact native read and its still-current leased byte frame, never a title or cached URL. */
    async retainDocument(documentId: string, revision: number, signal: AbortSignal): Promise<OfflineResult<OfflineDocumentPinV1>> {
      const b = binding(); if (b.status !== 'ok') return remember(b);
      let reader: Awaited<ReturnType<SourceDocumentsPort['createReader']>> | null = null;
      let frame: SourceDocumentFrame | null = null;
      try {
        reader = await options.documents().createReader(); if (!b.value.current() || signal.aborted) return remember({ status: signal.aborted ? 'aborted' : 'retired' });
        const row = await reader.get(documentId, signal);
        if (!b.value.current() || row.documentId !== documentId || row.revision !== revision
          || row.lifecycle !== 'active' || row.availability.original !== 'available') return remember({ status: 'retired' });
        frame = await reader.openOriginal(documentId, revision, signal);
        const current = () => b.value.current() && !signal.aborted && reader!.isCurrent(frame!);
        if (!current()) return remember({ status: signal.aborted ? 'aborted' : 'retired' });
        if (frame.documentId !== documentId || frame.documentRevision !== revision || frame.mode !== 'original'
          || frame.asset.assetId !== row.original.assetId || frame.asset.revision !== row.original.revision
          || frame.asset.sha256 !== row.original.sha256 || frame.asset.bytes !== row.original.bytes) return remember({ status: 'integrity' });
        const blob = reader.getBlob(frame); if (!blob) return remember({ status: 'retired' });
        const bytes = await blob.arrayBuffer(); if (!current()) return remember({ status: signal.aborted ? 'aborted' : 'retired' });
        const pin: OfflineDocumentPinV1 = { documentId, documentRevision: revision, assetId: frame.asset.assetId,
          assetRevision: frame.asset.revision, sha256: frame.asset.sha256, bytes: frame.asset.bytes, contentType: frame.measuredContentType };
        // Capture the lease's currentness in a second home handle through final transaction completion.
        if (!actor) return remember({ status: 'retired' });
        const live = owner.bindHome(actor, row.scope, current); if (live.status !== 'ok') return remember(live);
        const result = await owner.keepDocument(live.value, pin, bytes, signal);
        return remember(result.status === 'ok' ? { status: 'ok', value: pin } : result);
      } catch { return remember({ status: signal.aborted ? 'aborted' : b.value.current() ? 'unavailable' : 'retired' }); }
      finally { if (frame) reader?.release(frame); reader?.dispose(); }
    },
    /** Borrows an already verified original; the caller alone owns its reader and lease. */
    async retainDocumentFrame(reader: SourceDocumentReader, frame: SourceDocumentFrame, document: SourceDocument,
      signal: AbortSignal): Promise<OfflineResult<OfflineDocumentPinV1>> {
      const b = binding(); if (b.status !== 'ok') return remember(b);
      const identity = reader.owner(), scope = options.state().view!.scope;
      const current = () => b.value.current() && !signal.aborted && identity !== null
        && reader.owner() === identity && reader.isCurrent(frame);
      const retired = (): OfflineResult<never> => ({ status: signal.aborted ? 'aborted' : 'retired' });
      try {
        if (!current()) return remember(retired());
        if (document.scope.workspaceId !== scope.workspaceId || document.scope.homeId !== scope.homeId
          || document.lifecycle !== 'active' || document.availability.original !== 'available'
          || frame.mode !== 'original' || frame.documentId !== document.documentId || frame.documentRevision !== document.revision
          || frame.asset.assetId !== document.original.assetId || frame.asset.revision !== document.original.revision
          || frame.asset.sha256 !== document.original.sha256 || frame.asset.bytes !== document.original.bytes)
          return remember({ status: 'integrity' });
        const blob = reader.getBlob(frame);
        if (!blob || !current()) return remember(retired());
        if (blob.size !== frame.asset.bytes || blob.type !== frame.measuredContentType) return remember({ status: 'integrity' });
        const pin: OfflineDocumentPinV1 = { documentId: document.documentId, documentRevision: document.revision,
          assetId: frame.asset.assetId, assetRevision: frame.asset.revision, sha256: frame.asset.sha256,
          bytes: frame.asset.bytes, contentType: frame.measuredContentType };
        const matches = (catalog: OfflineCatalogV1) => catalog.completeness === 'captured-complete'
          && catalog.documents.some(row => { const expected = metadata(document);
            return Object.keys(expected).every(key => row[key as keyof OfflineCatalogItemV1] === expected[key as keyof OfflineCatalogItemV1]); });
        let catalog: OfflineCatalogV1 | null = null;
        const copy = await owner.readLast(signal); if (!current()) return remember(retired());
        if (copy.status === 'ok') {
          const selected = await owner.copyIdentity(copy.value.handle, signal); if (!current()) return remember(retired());
          if (selected.status !== 'ok') return remember(selected);
          if (selected.value.actorId === options.state().session!.actorId && selected.value.scope.workspaceId === scope.workspaceId
            && selected.value.scope.homeId === scope.homeId) {
            const stored = await owner.readCatalog(copy.value.handle, signal); if (!current()) return remember(retired());
            if (stored.status === 'ok') catalog = stored.value;
            else if (stored.status !== 'missing') return remember(stored);
          }
        } else if (copy.status !== 'missing') return remember(copy);
        if (!catalog || !matches(catalog)) {
          const fresh = await retainCatalog(signal, current); if (!current()) return remember(retired());
          if (fresh.status !== 'ok') return remember(fresh);
          if (!matches(fresh.value)) return remember({ status: 'integrity' });
        }
        if (!current() || reader.getBlob(frame) !== blob) return remember(retired());
        const bytes = await blob.arrayBuffer();
        if (!current() || reader.getBlob(frame) !== blob || !actor) return remember(retired());
        const live = owner.bindHome(actor, document.scope, current); if (live.status !== 'ok') return remember(live);
        const result = await owner.keepDocument(live.value, pin, bytes, signal);
        return remember(result.status === 'ok' ? { status: 'ok', value: pin } : result);
      } catch { return remember(signal.aborted || !current() ? retired() : { status: 'unavailable' }); }
    },
    /** True when this session allocation already sent a read for the exact association. */
    homeboxSent(ref: OfflineHomeboxAttachmentRefV1): boolean {
      const { session, view } = options.state();
      return !!session && !!view && homeboxSent.get(session)?.has(homeboxKey(view.scope, ref)) === true;
    },
    /** One borrowed HomeBox original for an exact stored-file association in the current live view.
     * The reader module loads lazily; unknown transport outcomes report 'uncertain' and are never replayed. */
    async retainHomeboxOriginal(ref: OfflineHomeboxAttachmentRefV1, signal: AbortSignal,
      additionalCurrent: () => boolean = () => true): Promise<OfflineResult<OfflineHomeboxPinV1>> {
      const opened = await acquireHomebox(ref, signal, {}, additionalCurrent, () => {});
      if (opened.status !== 'ok') return remember({ status: opened.status === 'unknown' || opened.status === 'busy' || opened.status === 'spent'
        ? 'uncertain' : opened.status });
      const record = frames.get(opened.frame)!;
      // Bulk work follows the caller's cancellation; explicit UI storage has its own signal.
      const cancel = () => record.storageController?.abort();
      try {
        const attempt = retainHomeboxFrame(record);
        signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
        record.ui = false;
        return remember(await attempt.result);
      } finally { signal.removeEventListener('abort', cancel); record.ui = false; cleanupFrame(record); }
    },
    /** Confirmed absence retires only this building's local catalog membership.
     * Empty provenance grants no source access; original bytes remain subject to
     * catalog membership and the existing actor/home/transaction witnesses. */
    async retireElectricalLibrary(buildingId: string, signal: AbortSignal, current: () => boolean): Promise<OfflineResult<{ evicted: number }>> {
      const b = binding(); if (b.status !== 'ok') return remember(b);
      const live = () => !signal.aborted && b.value.current() && current();
      try {
        if (!live() || !actor) return remember({ status: signal.aborted ? 'aborted' : 'retired' });
        const home = owner.bindHome(actor, options.state().view!.scope, live);
        if (home.status !== 'ok') return remember(home);
        return remember(await owner.keepElectricalCatalog(home.value, {
          buildingId, capturedAt: new Date().toISOString(), provenance: null, documents: [],
        }, signal));
      } catch { return remember({ status: signal.aborted ? 'aborted' : 'unavailable' }); }
    },
    /** Captures one genuinely read building. The caller retains ownership of its reader/frame. */
    async retainElectricalLibrary(reader: ElectricalLibraryReader, frame: ElectricalLibraryFrame, signal: AbortSignal,
      retention: { readonly includeBytes?: boolean; readonly evidenceId?: string; readonly enabled?: () => boolean } = {}): Promise<OfflineResult<{ held: number; unavailable: number; bytes: number }>> {
      const b = binding(); if (b.status !== 'ok') return remember(b);
      const identity = reader.owner();
      const current = () => b.value.current() && reader.owner() === identity && identity !== null && reader.isCurrent(frame);
      const retired = (): OfflineResult<never> => ({ status: signal.aborted ? 'aborted' : 'retired' });
      let client: ReturnType<ElectricalLibraryReader['createDrawingClient']> | null = null;
      let opened: NativeEvidenceDocumentFrame | null = null;
      try {
        if (!current() || signal.aborted || !actor) return remember(retired());
        const scope = options.state().view!.scope;
        if (frame.scope.workspaceId !== scope.workspaceId || frame.scope.homeId !== scope.homeId) return remember({ status: 'integrity' });
        const live = owner.bindHome(actor, frame.scope, current); if (live.status !== 'ok') return remember(live);
        const documents = frame.documents.map(document => {
          const pin: OfflineElectricalPinV1 = { source: 'electrical-evidence', buildingId: frame.buildingId,
            evidenceId: document.evidenceId, evidenceRevision: document.evidenceRevision, assetId: document.assetId,
            assetRevision: document.assetRevision.token, byteSize: document.byteSize.token, sha256: document.sha256, contentType: 'application/pdf' };
          if (!validElectricalPin(pin)) throw new Error('Invalid electrical original pins');
          const pages = document.pages.map(page => {
            const reference = page.reference;
            if (reference.workspaceId !== frame.scope.workspaceId || reference.homeId !== frame.scope.homeId
              || reference.buildingId !== frame.buildingId || reference.evidenceId !== pin.evidenceId
              || reference.evidenceRevision !== pin.evidenceRevision || reference.assetId !== pin.assetId
              || reference.assetRevision.token !== pin.assetRevision || reference.byteSize.token !== pin.byteSize
              || reference.assetSha256 !== pin.sha256 || reference.sheetId !== page.sheet.id || reference.pdfPage !== page.sheet.pdfPage
              || reference.originalPhotoSha256 !== page.sheet.originalPhotoSha256 || reference.renderedPhotoSha256 !== page.sheet.renderedPhotoSha256)
              throw new Error('Electrical page correlation differs');
            return { sheetId: page.sheet.id, title: page.sheet.title, pdfPage: page.sheet.pdfPage, sourceDate: page.sheet.sourceDate,
              correlationId: reference.correlationId, correlationSha256: reference.correlationSha256,
              originalPhotoSha256: reference.originalPhotoSha256, renderedPhotoSha256: reference.renderedPhotoSha256 };
          });
          return { pin, pages };
        });
        const p = frame.provenance;
        const building: OfflineElectricalBuildingV1 = { buildingId: frame.buildingId, capturedAt: new Date().toISOString(), documents,
          provenance: p ? { historicalRoomMappingReceipt: { id: p.historicalRoomMappingReceipt.id, sha256: p.historicalRoomMappingReceipt.sha256 },
            fixtureLedgerSha256: p.fixtureLedgerSha256, supportOriginalSha256: p.supportOriginalSha256,
            currentNativeRoomReview: { id: p.currentNativeRoomReview.id, sha256: p.currentNativeRoomReview.sha256 } } : null };
        const catalogResult = await owner.keepElectricalCatalog(live.value, building, signal);
        if (catalogResult.status !== 'ok') return remember(catalogResult);
        const bytes = documents.reduce((sum, row) => sum + electricalPinBytes(row.pin), 0);
        let held = 0, unavailable = 0;
        const summary = () => ({ status: 'ok' as const, value: { held, unavailable, bytes } });
        if (retention.includeBytes === false || retention.enabled?.() === false) return remember(summary());
        const copy = await owner.readLast(signal); if (copy.status !== 'ok') return remember(copy);
        const [electrical, native, storage] = await Promise.all([owner.readElectricalCatalog(copy.value.handle, signal),
          owner.readCatalog(copy.value.handle, signal), owner.status(signal)]);
        if (electrical.status !== 'ok') return remember(electrical);
        if (storage.status !== 'ok') return remember(storage);
        if (native.status !== 'ok' && native.status !== 'missing') return remember(native);
        const allBytes = electrical.value.buildings.reduce((sum, row) => sum + row.documents.reduce((n, d) => n + electricalPinBytes(d.pin), 0), 0)
          + (native.status === 'ok' ? native.value.documents.filter(row => row.lifecycle === 'active').reduce((sum, row) => sum + row.bytes, 0) : 0);
        // Explicit opens may keep their selected original; automatic fill refuses budget churn.
        if (!retention.evidenceId && allBytes > storage.value.budgetBytes * 0.8) return remember(summary());
        client = reader.createDrawingClient(frame);
        for (const document of documents) {
          if (retention.evidenceId && document.pin.evidenceId !== retention.evidenceId) continue;
          if (!current() || signal.aborted) return remember(retired());
          if (retention.enabled?.() === false) break;
          const pin = document.pin, previous = await owner.electricalStatus(copy.value.handle, pin, signal);
          if (previous.status === 'ok' && previous.value.availability === 'held') { held++; continue; }
          if (previous.status !== 'ok' && previous.status !== 'missing' && previous.status !== 'integrity') return remember(previous);
          try { opened = await client.open(pin.evidenceId, signal); }
          catch {
            if (!current() || signal.aborted) return remember(retired());
            unavailable++; continue;
          }
          const byteCurrent = () => current() && opened !== null && client!.isCurrent(opened);
          if (!byteCurrent() || signal.aborted) return remember(retired());
          const asset = opened.asset;
          if (opened.mode !== 'original-download' || opened.evidenceId !== pin.evidenceId || opened.evidenceRevision !== pin.evidenceRevision
            || asset.assetId !== pin.assetId || asset.revision.token !== pin.assetRevision || asset.byteSize.token !== pin.byteSize
            || asset.sha256 !== pin.sha256 || asset.contentType !== 'application/pdf' || asset.purpose !== 'evidence-original')
            return remember({ status: 'integrity' });
          const blob = client.getBlob(opened);
          if (!blob || blob.size !== electricalPinBytes(pin) || blob.type !== 'application/pdf') return remember({ status: 'integrity' });
          const original = await blob.arrayBuffer();
          if (!byteCurrent() || signal.aborted || !actor) return remember(retired());
          const admitted = owner.bindHome(actor, frame.scope, byteCurrent); if (admitted.status !== 'ok') return remember(admitted);
          const result = await owner.keepElectricalDocument(admitted.value, pin, original, signal);
          client.release(opened); opened = null;
          if (result.status === 'ok') held++;
          else if (result.status === 'retired' || result.status === 'aborted' || result.status === 'uncertain') return remember(result);
          else unavailable++;
        }
        return remember(summary());
      } catch { return remember({ status: signal.aborted ? 'aborted' : current() ? 'integrity' : 'retired' }); }
      finally { if (opened) client?.release(opened); client?.dispose(); }
    },
    close() { generation++; actor = null; observed = null; refreshHomeboxOriginals(); owner.close(); outcomeListeners.clear();
      options.events?.removeEventListener('focus', recheckCopies); options.events?.removeEventListener('visibilitychange', recheckCopies);
      if (channel) { channel.onmessage = null; channel.close(); } },
  };
}
export type LiveCopyRetention = ReturnType<typeof createLiveCopyRetention>;
