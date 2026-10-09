import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AtlasContentActions } from '../app/App';
import { createOperationHistoryClient, type OperationHistoryRead } from '../api/operation-history-client';
import { createGeometryClient, type GeometryRead } from '../api/geometry-client';
import type { ReadyView } from '../app/types';
import type { ModelContextPort } from '../webmcp/ports';
import type { QuantityAdmissionPort } from '../webmcp/quantity/tool';
import { QuantityHandoffLeaf } from '../webmcp/quantity/QuantityHandoff';
import type { PinnedFileClient } from '../api/pinned-file-client';
import type { NetworkRelationsClient } from '../api/network-relations-client';
import { projectView } from './adapters/read';
import { StoreProvider } from './state/store';
import { NativeActions } from './components/NativeActions';
import { App } from './App';
import type { TopologyClient } from '../api/topology-client';
import { TopologyProvider } from './topology/TopologyProvider';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/atlas.css';
import './styles/panels.css';
import './styles/integration.css';
import './styles/topology.css';

/** The existing session/view/stock owners remain above this presentation seam. */
export function LanternHost({ view, actions, nativeContent, quantityWebMcp, pinnedFiles, networkRelations, topology }: {
  view: ReadyView; actions: AtlasContentActions; nativeContent: ReactNode;
  quantityWebMcp?: { readonly admission: QuantityAdmissionPort; readonly modelContext: ModelContextPort };
  /** Optional local HomeBox file consumer; its actions are explicit user reads. */
  pinnedFiles?: PinnedFileClient;
  /** Optional saved Network relations reader; each page is an explicit user read. */
  networkRelations?: NetworkRelationsClient;
  /** Optional reviewed Atlas topology reader, scoped independently of source parentage. */
  topology?: TopologyClient;
}) {
  const client = useMemo(() => createGeometryClient(), []);
  const historyClient = useMemo(() => createOperationHistoryClient(), []);
  const session = actions.session?.expiresAt;
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
  const projection = useMemo(() => projectView(view, current, currentHistory, loadMoreOperations, includeArchived), [view, current, currentHistory, loadMoreOperations, includeArchived]);
  const archiveVisibility = useMemo(() => ({ included: includeArchived, setIncluded: (included: boolean) => {
    if (renderedHistoryScope.current.view !== view || renderedHistoryScope.current.session !== session) return;
    setArchive({ view, session, included });
  } }), [view, session, includeArchived]);
  const ports = useMemo(() => ({ ...actions, nativeContent, archiveVisibility, ...(pinnedFiles ? { pinnedFiles } : {}), ...(networkRelations ? { networkRelations } : {}) }), [actions, nativeContent, archiveVisibility, pinnedFiles, networkRelations]);
  return <StoreProvider key={projection.house.id} projection={projection} actions={ports}>
    <TopologyProvider client={topology}><App /></TopologyProvider>
    <NativeActions />
    {quantityWebMcp && actions.quantity && <QuantityHandoffLeaf client={actions.quantity} admission={quantityWebMcp.admission} modelContext={quantityWebMcp.modelContext} />}
    {actions.notice && <p className="lantern-reload-notice" role="status">{actions.notice}</p>}
  </StoreProvider>;
}
