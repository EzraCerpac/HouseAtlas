import type { ReadyView } from '../src/app/types';
import type { AtlasSessionInfo } from '../src/app/session';
import type { SourceDocumentsPort, SourceDocument, SourceDocumentFrame } from '../src/lantern/source-documents/types';
import type { OfflineCatalogItemV1, OfflineCatalogV1, OfflineDocumentPinV1, OfflineResult, OfflineBackend, OfflineAtlasReferenceV1, OfflineReadPort } from '../src/offline/live-copy-types';
import { createLiveCopyOwner, LIVE_COPY_LIMITS, type LiveCopyActor, type LiveCopyHome } from '../src/offline/live-copy-owner';
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
  const metadata = (row: SourceDocument): OfflineCatalogItemV1 => ({
    documentId: row.documentId, documentRevision: row.revision, title: row.title, lifecycle: row.lifecycle,
    assetId: row.original.assetId, assetRevision: row.original.revision, sha256: row.original.sha256,
    bytes: row.original.bytes, recordedAvailability: row.availability.original,
  });
  return {
    read: { readLast: owner.readLast, readCatalog: owner.readCatalog, readDocument: owner.readDocument, documentStatus: owner.documentStatus,
      async atlasReference(handle, signal) {
        const identity = await owner.copyIdentity(handle, signal); if (identity.status !== 'ok') return identity;
        if (!options.atlasReference) return { status: 'unavailable' } as const;
        try {
          const reference = await options.atlasReference(identity.value, signal);
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
    /** Explicit authorized enumeration, not a vault scan. No claim that it includes other sources. */
    async retainCatalog(signal: AbortSignal): Promise<OfflineResult<OfflineCatalogV1>> {
      const b = binding(); if (b.status !== 'ok') return remember(b);
      const retired = () => signal.aborted || !b.value.current();
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
        const result = await owner.keepCatalog(b.value.home, catalog, signal);
        return remember(result.status === 'ok' ? { status: 'ok', value: catalog } : result);
      } catch { return remember({ status: signal.aborted ? 'aborted' : retired() ? 'retired' : 'unavailable' }); }
      finally { reader?.dispose(); }
    },
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
    close() { generation++; actor = null; observed = null; owner.close(); outcomeListeners.clear();
      options.events?.removeEventListener('focus', recheckCopies); options.events?.removeEventListener('visibilitychange', recheckCopies);
      if (channel) { channel.onmessage = null; channel.close(); } },
  };
}
export type LiveCopyRetention = ReturnType<typeof createLiveCopyRetention>;
