import type { ElectricalLibraryReader, ElectricalLibraryFrame } from '../src/lantern/electrical-library/types';
import type { NativeEvidenceDocumentFrame } from '../src/lantern/scans/native-evidence-document-types';
import type { ReadyView } from '../src/app/types';
import type { AtlasSessionInfo } from '../src/app/session';
import type { SourceDocumentsPort, SourceDocument, SourceDocumentFrame, SourceDocumentReader } from '../src/lantern/source-documents/types';
import type { OfflineHomeboxAttachmentRefV1, OfflineHomeboxPinV1, OfflineElectricalPinV1, OfflineElectricalBuildingV1, OfflineCatalogItemV1, OfflineCatalogV1, OfflineDocumentPinV1, OfflineResult, OfflineBackend, OfflineAtlasReferenceV1, OfflineReadPort } from '../src/offline/live-copy-types';
import { createLiveCopyOwner, LIVE_COPY_LIMITS, electricalPinBytes, validElectricalPin, validHomeboxRef, listsAttachment, type LiveCopyActor, type LiveCopyHome } from '../src/offline/live-copy-owner';
import { openLiveCopyBackend } from '../src/offline/live-copy-indexeddb';

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
  if (channel) channel.onmessage = () => owner.refreshCopies();
  const recheckCopies = () => owner.refreshCopies();
  options.events?.addEventListener('focus', recheckCopies); options.events?.addEventListener('visibilitychange', recheckCopies);
  const outcomeListeners = new Set<() => void>();
  let actor: LiveCopyActor | null = null, observed: AtlasSessionInfo | null = null, generation = 0;
  let lastResult: OfflineResult<unknown> = { status: 'missing' };
  const remember = <T>(result: OfflineResult<T>): OfflineResult<T> => { lastResult = result; for (const cb of [...outcomeListeners]) { try { cb(); } catch { /* outcome remains available */ } } return result; };
  async function observe(session: AtlasSessionInfo | null, current: () => boolean) {
    const attempt = ++generation; actor = null; observed = null;
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
  const homeboxSent = new WeakMap<AtlasSessionInfo, Set<string>>();
  const homeboxKey = (ref: OfflineHomeboxAttachmentRefV1) => JSON.stringify([ref.sourceInstanceId, ref.collectionId, ref.entityId, ref.attachmentId]);
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
      generation++; actor = null; observed = null; return remember(await owner.clear());
    } },
    observe,
    lastResult: () => lastResult,
    /** Synchronous retirement on sign-out/host replacement, even before lazy deletion. */
    retire() { generation++; actor = null; observed = null; owner.invalidate(); },
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
      const session = options.state().session;
      return !!session && homeboxSent.get(session)?.has(homeboxKey(ref)) === true;
    },
    /** One borrowed HomeBox original for an exact stored-file association in the current live view.
     * The reader module loads lazily; unknown transport outcomes report 'uncertain' and are never replayed. */
    async retainHomeboxOriginal(ref: OfflineHomeboxAttachmentRefV1, signal: AbortSignal): Promise<OfflineResult<OfflineHomeboxPinV1>> {
      const b = binding(); if (b.status !== 'ok') return remember(b);
      const { session, view } = options.state();
      if (!session || !view || !validHomeboxRef(ref)) return remember({ status: 'invalid' });
      if (!listsAttachment(view, ref)) return remember({ status: 'missing' });
      // Claim synchronously, before any await, so concurrent calls for one session/association cannot both send.
      let sent = homeboxSent.get(session); if (!sent) { sent = new Set<string>(); homeboxSent.set(session, sent); }
      const key = homeboxKey(ref), claimed = sent;
      if (claimed.has(key)) return remember({ status: 'uncertain' });
      claimed.add(key); let dispatched = false;
      try {
        const { readHomeboxOriginal } = await import('../src/offline/homebox-original-reader');
        if (signal.aborted || !b.value.current()) { claimed.delete(key); return remember({ status: signal.aborted ? 'aborted' : 'retired' }); }
        // The server spends admission before provider I/O; from here the claim is never released after a send.
        dispatched = true;
        const read = await readHomeboxOriginal({ scope: view.scope, ref, signal, ...(options.homeboxTransport ? { transport: options.homeboxTransport } : {}) });
        if (read.status === 'unavailable' && !read.sent) claimed.delete(key);
        if (!b.value.current()) return remember({ status: 'retired' });
        if (read.status !== 'ok') return remember({ status: read.status === 'unknown' ? 'uncertain' : read.status });
        const result = await owner.keepHomeboxDocument(b.value.home, read.pin, read.bytes, signal);
        return remember(result.status === 'ok' ? { status: 'ok', value: read.pin } : result);
      } catch {
        if (!dispatched) claimed.delete(key);
        return remember({ status: signal.aborted ? 'aborted' : b.value.current() ? 'unavailable' : 'retired' });
      }
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
    close() { generation++; actor = null; observed = null; owner.close(); outcomeListeners.clear();
      options.events?.removeEventListener('focus', recheckCopies); options.events?.removeEventListener('visibilitychange', recheckCopies);
      if (channel) { channel.onmessage = null; channel.close(); } },
  };
}
export type LiveCopyRetention = ReturnType<typeof createLiveCopyRetention>;
