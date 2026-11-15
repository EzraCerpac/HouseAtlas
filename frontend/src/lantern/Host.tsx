import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { shownView, type RefreshHostPort, type RefreshToken, type Withheld } from './homebox-withheld.ts';
import type { AtlasContentActions } from '../app/App';
import { createOperationHistoryClient, type OperationHistoryRead } from '../api/operation-history-client';
import { createGeometryClient, type GeometryRead } from '../api/geometry-client';
import type { ReadyView } from '../app/types';
import type { ModelContextPort } from '../webmcp/ports';
import type { QuantityAdmissionPort } from '../webmcp/quantity/tool';
import type { PinnedFileClient } from '../api/pinned-file-client';
import type { HomeboxOriginalsPort } from './homebox-originals/types';
import type { NetworkRelationsClient } from '../api/network-relations-client';
import { projectView } from './adapters/read';
import { StoreProvider } from './state/store';
import { NativeActions } from './components/NativeActions';
import { App } from './App';
import type { NativePlaceClient } from '../api/native-place-client';
import type { TopologyClient } from '../api/topology-client';
import { TopologyProvider, useTopology } from './topology/TopologyProvider';
import { useOutboxSynced } from '../outbox/index.ts';
import { PLACE_CREATE, PLACE_NAME } from '../outbox/kinds.ts';
import type { NativeEvidenceDocumentClient } from './scans/native-evidence-document-types';
import { SourcePortsContext, type SourceModelPort } from './source-ports';
import type { SourceDocumentsPort } from './source-documents/types';
import type { ElectricalLibraryPort } from './electrical-library/types';
import type { HouseAcquisitionPort } from '../offline/acquisition-types';
import { SaveHouseCopy } from '../offline/SaveHouseCopy';
import { fmtLocalClock } from './components/ui';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/atlas.css';
import './styles/panels.css';
import './styles/integration.css';
import './styles/topology.css';

// The assistant handoff mounts only in WebMCP browsers; others never download it.
const QuantityHandoffLeaf = lazy(() => import('../webmcp/quantity/QuantityHandoff').then(m => ({ default: m.QuantityHandoffLeaf })));

/** A handoff chunk that fails to load leaves the tool unregistered and the Atlas mounted. */
class OptionalToolBoundary extends Component<{ readonly children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

/** The existing session/view/stock owners remain above this presentation seam. */
export function LanternHost({ view, actions, nativeContent, quantityWebMcp, pinnedFiles, homeboxOriginals, networkRelations, topology, nativePlaces, nativeEvidenceDocuments, sourceModels, sourceDocuments, sourceElectricalLibrary, houseAcquisition, offlineStorage }: {
  view: ReadyView; actions: AtlasContentActions; nativeContent: ReactNode;
  quantityWebMcp?: { readonly admission: QuantityAdmissionPort; readonly modelContext: ModelContextPort };
  /** Optional local HomeBox file consumer; its actions are explicit user reads. */
  pinnedFiles?: PinnedFileClient;
  /** Optional verified-copy action; ordinary issued-URL downloads remain separate. */
  homeboxOriginals?: HomeboxOriginalsPort;
  /** Optional saved Network relations reader; each page is an explicit user read. */
  networkRelations?: NetworkRelationsClient;
  /** Optional reviewed Atlas topology reader, scoped independently of source parentage. */
  topology?: TopologyClient;
  nativePlaces?: NativePlaceClient;
  nativeEvidenceDocuments?: NativeEvidenceDocumentClient;
  /** Optional house model publication (the unified Atlas) and site readers. */
  sourceModels?: SourceModelPort;
  /** Optional native v2 source Documents reader. */
  sourceDocuments?: SourceDocumentsPort;
  /** Optional electrical evidence discovery using existing native read authority. */
  sourceElectricalLibrary?: ElectricalLibraryPort;
  houseAcquisition?: HouseAcquisitionPort;
  offlineStorage?: ReactNode;
}) {
  const sources = useMemo(() => ({ ...(sourceModels ? { models: sourceModels } : {}), ...(sourceDocuments ? { documents: sourceDocuments } : {}), ...(sourceElectricalLibrary ? { electricalLibrary: sourceElectricalLibrary } : {}) }), [sourceModels, sourceDocuments, sourceElectricalLibrary]);
  const client = useMemo(() => createGeometryClient(), []);
  const historyClient = useMemo(() => createOperationHistoryClient(), []);
  const session = actions.session?.expiresAt;
  // Each successful read delivers a new view; a failed reload keeps the old one and its time.
  const [loaded, setLoaded] = useState(() => ({ view, at: Date.now() }));
  if (loaded.view !== view) setLoaded({ view, at: Date.now() });
  // Try again removes the notice while it reloads; a second failure returns focus to the button.
  const again = useRef<HTMLButtonElement>(null), retried = useRef(false);
  useEffect(() => {
    if (actions.busy || !retried.current) return;
    retried.current = false; if (actions.notice) again.current?.focus();
  }, [actions.busy, actions.notice]);
  const [archive, setArchive] = useState<{ view: ReadyView; session: typeof session; included: boolean } | null>(null);
  const includeArchived = archive?.view === view && archive.session === session ? archive.included : false;
  const [geometry, setGeometry] = useState<{ view: ReadyView; session: typeof session; read: GeometryRead } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void client.read(view.scope, controller.signal).then((read) => {
      if (!controller.signal.aborted) setGeometry({ view, session, read });
    }).catch(() => {
      if (!controller.signal.aborted) setGeometry({ view, session, read: { status: 'unavailable' } });
    });
    return () => controller.abort();
  }, [client, view, session]);
  const [history, setHistory] = useState<{ view: ReadyView; session: typeof session; read: OperationHistoryRead } | null>(null);
  const historyController = useRef<AbortController | null>(null);
  const renderedHistoryScope = useRef({ view, session });
  renderedHistoryScope.current = { view, session };
  useEffect(() => {
    const controller = new AbortController();
    historyController.current = controller;
    setHistory({ view, session, read: { status: 'loading' } });
    void historyClient.read(view.scope, controller.signal).then((read) => {
      if (!controller.signal.aborted && renderedHistoryScope.current.view === view && renderedHistoryScope.current.session === session)
        setHistory({ view, session, read });
    }).catch(() => {
      if (!controller.signal.aborted && renderedHistoryScope.current.view === view && renderedHistoryScope.current.session === session)
        setHistory({ view, session, read: { status: 'unavailable' } });
    }).finally(() => {
      if (historyController.current === controller) historyController.current = null;
    });
    return () => { historyController.current?.abort(); historyController.current = null; };
  }, [historyClient, view, session]);
  const loadMoreOperations = useCallback(() => {
    if (history?.view !== view || history.session !== session || history.read.status !== 'ready' || historyController.current) return;
    const prior = history.read;
    const cursor = prior.page.nextCursor;
    if (cursor === null) return;
    const controller = new AbortController();
    historyController.current = controller;
    const current = () => !controller.signal.aborted && renderedHistoryScope.current.view === view && renderedHistoryScope.current.session === session;
    setHistory({ view, session, read: { ...prior, loadingMore: true, moreUnavailable: false } });
    void historyClient.read(view.scope, controller.signal, cursor).then((read) => {
      if (!current()) return;
      if (read.status !== 'ready') { setHistory({ view, session, read }); return; }
      const earlierPages = [...(prior.earlierPages ?? []), prior.page];
      const eventIds = new Set(earlierPages.flatMap(page => page.entries.map(event => event.eventId)));
      if (read.page.entries.some(event => eventIds.has(event.eventId))
        || (read.page.nextCursor !== null && earlierPages.some(page => page.nextCursor === read.page.nextCursor)))
        throw new TypeError('Operation history continuation did not advance');
      setHistory({ view, session, read: { ...read, earlierPages } });
    }).catch(() => {
      if (current()) setHistory({ view, session, read: { ...prior, loadingMore: false, moreUnavailable: true } });
    }).finally(() => {
      if (historyController.current === controller) historyController.current = null;
    });
  }, [historyClient, history, view, session]);
  const currentHistory = history?.view === view && history.session === session ? history.read : { status: 'loading' as const };
  const current = geometry?.view === view && geometry.session === session ? geometry.read : { status: 'loading' as const };
  // A revocation recorded by an explicit refresh whose view re-read failed
  // withholds HomeBox entries of every later view of that home in the same
  // session, including one another reload delivered meanwhile.
  const [withheld, setWithheld] = useState<Withheld | null>(null);
  const shown = useMemo(() => shownView(view, session, withheld), [view, session, withheld]);
  // The explicit HomeBox refresh lives here, with the view it reconciles, so
  // closing the panel never drops its result; a home or session change does.
  const rendered = useRef<{ token: RefreshToken; reload: () => Promise<boolean> }>(null);
  rendered.current = { token: { workspaceId: view.scope.workspaceId, homeId: view.scope.homeId, session }, reload: actions.reload };
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [homeboxRefresh] = useState<RefreshHostPort>(() => ({
    live: () => mounted.current,
    current: () => rendered.current?.token ?? null,
    reload: () => rendered.current ? rendered.current.reload() : Promise.resolve(false),
    withhold: (token, on) => setWithheld(on ? { scope: { workspaceId: token.workspaceId, homeId: token.homeId }, session: token.session } : null),
  }));
  const projection = useMemo(() => projectView(shown, current, currentHistory, loadMoreOperations, includeArchived), [shown, current, currentHistory, loadMoreOperations, includeArchived]);
  const archiveVisibility = useMemo(() => ({ included: includeArchived, setIncluded: (included: boolean) => {
    if (renderedHistoryScope.current.view !== view || renderedHistoryScope.current.session !== session) return;
    setArchive({ view, session, included });
  } }), [view, session, includeArchived]);
  // Atlas tools exist only when there is a saved-copy action or native content to show.
  const toolsContent = useMemo(() => houseAcquisition || (nativeContent != null && nativeContent !== false && nativeContent !== '') ? <>{houseAcquisition && <SaveHouseCopy port={houseAcquisition} />}{nativeContent}</> : null, [houseAcquisition, nativeContent]);
  const ports = useMemo(() => ({ ...actions, loadedAt: loaded.at, offlineStorage, homeboxRefresh, nativeContent: toolsContent, archiveVisibility, ...(pinnedFiles ? { pinnedFiles } : {}), ...(homeboxOriginals ? { homeboxOriginals } : {}), ...(networkRelations ? { networkRelations } : {}) }), [actions, toolsContent, archiveVisibility, pinnedFiles, homeboxOriginals, networkRelations, houseAcquisition, offlineStorage, homeboxRefresh, loaded.at]);
  return <StoreProvider key={projection.house.id} projection={projection} actions={ports}>
    <TopologyProvider client={topology} nativePlaces={nativePlaces} nativeEvidenceDocuments={nativeEvidenceDocuments}><SourcePortsContext value={sources}><App /></SourcePortsContext><ReloadPlacesOnSync /></TopologyProvider>
    <NativeActions />
    {quantityWebMcp && actions.quantity && <OptionalToolBoundary><Suspense fallback={null}><QuantityHandoffLeaf client={actions.quantity} admission={quantityWebMcp.admission} modelContext={quantityWebMcp.modelContext} /></Suspense></OptionalToolBoundary>}
    {actions.notice && <div className="lantern-host lantern-reload-notice">
      <p role="status">{actions.notice} Shown information was loaded at {fmtLocalClock(loaded.at)}.</p>
      <button ref={again} type="button" className="btn btn-small" disabled={actions.busy} onClick={() => { retried.current = true; void actions.reload(); }}>Try again</button>
    </div>}
  </StoreProvider>;
}

const placeKinds = [PLACE_NAME, PLACE_CREATE];
/** Atlas places renamed or added offline show up once they reach the server. */
function ReloadPlacesOnSync() {
  useOutboxSynced(placeKinds, useTopology().reload);
  return null;
}
