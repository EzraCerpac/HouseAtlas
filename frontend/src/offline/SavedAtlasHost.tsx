import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import UnifiedAtlas from '../lantern/unified-atlas/UnifiedAtlas';
import { createSavedHouseStore, type SavedHouse, type SavedHouseStore } from './store';
import { openSavedAtlasPresentation } from './saved-atlas-presentation';
import { SavedHouseManager } from './SavedHouseManager';
import { verifySavedShell, removeSavedShell, type SavedShellStatus } from './shell';
import { createSavedCatalogAdapter, type SavedCatalogRead } from './saved-catalog';
import { readSavedPackSections } from './saved-pack-sections';
import { SavedCatalogView } from './SavedCatalogView';
import { useLiveHost } from './connection-probe';
import { useOutbox } from '../outbox';
import type { LiveAtlasPresentationPort } from '../lantern/unified-atlas/types';
import '../lantern/styles/fonts.css';
import '../lantern/styles/tokens.css';
import '../lantern/styles/app.css';
import './saved-host.css';
import './saved-catalog.css';
import '../styles/session.css';

/** The live entry with a query, which the root worker leaves to the network
 * without its offline timeout, so a slow but reachable host still opens. */
const LIVE_ENTRY = '/?live';

/** The Atlas the live app last read on this device, opened from its own
 * cache when no saved copy is open: what an offline launch shows first. */
export interface LastAtlasCopy {
  readonly port: LiveAtlasPresentationPort;
  readonly storedAt: string;
  /** Withdraws the copy when sign-out (in any tab) has removed it. */
  recheck(): void;
  close(): Promise<void>;
}

type Allocation = NonNullable<Awaited<ReturnType<typeof openSavedAtlasPresentation>>>;
export interface SavedCatalogSelection {
  readonly read: SavedCatalogRead;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
}
interface SelectionSink {
  clear(): void;
  house(house: SavedHouse): void;
  catalog(selection: SavedCatalogSelection): void;
  atlas(port: Allocation | null): void;
  catalogError(): void;
  atlasError(): void;
  missing(): void;
}

/** One selected key, with a new allocation on every committed-store notice.
 * Retirement is synchronous; neither React state nor the next effect owns it. */
export function mountSavedSelection(store: SavedHouseStore, key: string, sink: SelectionSink) {
  type Owner = { controller: AbortController; read: SavedCatalogRead | null; atlas: Allocation | null };
  let current: Owner | null = null, disposed = false;
  const retire = () => {
    const old = current; current = null;
    if (old) {
      const { controller, atlas: owned } = old;
      controller.abort(); owned?.dispose(); old.read?.withdraw();
    }
    sink.clear();
  };
  const refresh = () => {
    retire(); if (disposed) return;
    const owner: Owner = { controller: new AbortController(), read: null, atlas: null };
    current = owner;
    const signal = owner.controller.signal;
    const isCurrent = () => !disposed && current === owner && !signal.aborted;
    void store.list().then(houses => {
      if (!isCurrent()) return;
      const selected = houses.find(house => house.key === key);
      if (!selected) { retire(); sink.missing(); return; }
      const house = structuredClone(selected); sink.house(house);
      if (!isCurrent()) return;
      // Catalog admission is independent of optional model/Atlas admission.
      void readSavedPackSections(store, house, signal)
        .then(sections => { signal.throwIfAborted(); return createSavedCatalogAdapter(store).read(sections, signal); })
        .then(read => {
          if (!isCurrent()) { read.withdraw(); return; }
          owner.read = read; sink.catalog({ read, signal, isCurrent });
        }, () => { if (isCurrent()) sink.catalogError(); });
      void openSavedAtlasPresentation(store, house, signal).then(port => {
        if (!isCurrent()) { port?.dispose(); return; }
        owner.atlas = port; sink.atlas(port);
      }, () => { if (isCurrent()) sink.atlasError(); });
    }, () => { if (isCurrent()) { retire(); sink.missing(); } });
  };
  const stop = store.subscribe(refresh); refresh();
  return { dispose() { if (disposed) return; disposed = true; stop(); retire(); } };
}

export function SavedAtlasHost({ store: supplied, openLastCopy }: { readonly store?: SavedHouseStore;
  readonly openLastCopy?: (signal: AbortSignal) => Promise<LastAtlasCopy | null> }) {
  const store = useMemo(() => supplied ?? createSavedHouseStore(globalThis.indexedDB), [supplied]);
  const [house, setHouse] = useState<SavedHouse | null>(null), [allocation, setAllocation] = useState<Allocation | null>(null);
  const [error, setError] = useState<string | null>(null), [opening, setOpening] = useState(false);
  const [selectedHouse, setSelectedHouse] = useState<SavedHouse | null>(null);
  const [catalog, setCatalog] = useState<SavedCatalogSelection | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [view, setView] = useState<'atlas' | 'inventory' | 'documents'>('atlas');
  const mounted = useRef<ReturnType<typeof mountSavedSelection> | null>(null);
  const [shell, setShell] = useState<SavedShellStatus>({ ready: false, buildId: null });
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const live = useLiveHost();
  const [last, setLast] = useState<LastAtlasCopy | null>(null);
  useEffect(() => {
    if (!openLastCopy) return;
    const controller = new AbortController();
    let opened: LastAtlasCopy | null = null;
    void openLastCopy(controller.signal).then(copy => {
      if (controller.signal.aborted) { void copy?.close(); return; }
      opened = copy; setLast(copy);
    }, () => undefined);
    return () => { controller.abort(); void opened?.close(); };
  }, [openLastCopy]);
  // A withdrawn copy (signed out elsewhere) leaves the page for good.
  useEffect(() => last?.port.subscribe(() => { if (last.port.current() === null) { setLast(null); void last.close(); } }), [last]);
  // Edits made in the live app that are still waiting; the live app sends them.
  const { waiting } = useOutbox();
  const changes = waiting === 1 ? '1 change' : `${waiting} changes`;
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)'), changed = () => setReduced(query.matches);
    query.addEventListener('change', changed); return () => query.removeEventListener('change', changed);
  }, []);
  useEffect(() => { let active = true;
    void verifySavedShell().then(status => { if (active) setShell(status); }, () => { if (active) setShell({ ready: false, buildId: null }); });
    return () => { active = false; };
  }, []);
  useEffect(() => () => { if (!supplied) void store.close(); }, [store, supplied]);
  useLayoutEffect(() => {
    if (!house) return;
    const owner = mountSavedSelection(store, house.key, {
      clear() { setAllocation(null); setCatalog(null); setSelectedHouse(null); setError(null); setCatalogError(null); setOpening(true); },
      house(selected) { setSelectedHouse(selected); },
      catalog(selected) { setCatalog(selected); },
      atlas(port) { setAllocation(port); setOpening(false); if (!port) setError('This saved copy has no supported Atlas room map.'); },
      catalogError() { setCatalogError('The saved inventory and documents are unavailable or changed.'); },
      atlasError() { setOpening(false); setError('The saved Atlas is unavailable or changed. Open the retained copy again.'); },
      missing() { setOpening(false); setError('The selected saved copy is unavailable.'); setCatalogError('The selected saved copy is unavailable.'); },
    });
    mounted.current = owner;
    return () => { owner.dispose(); if (mounted.current === owner) mounted.current = null; };
  }, [house, store]);
  // Withdrawal also removes the old stage before a different allocation opens.
  useEffect(() => allocation?.subscribe(() => {
    if (allocation.current() === null) { setAllocation(null); setError('The saved copy changed. Open the retained copy again.'); }
  }), [allocation]);
  const close = () => { mounted.current?.dispose(); mounted.current = null; setAllocation(null); setCatalog(null); setSelectedHouse(null); setHouse(null); setError(null); setCatalogError(null); setOpening(false); };
  const changeView = (next: typeof view) => setView(next);
  return <main className="lantern-host view-atlas saved-atlas-app">
    <header className="saved-header"><h1>Saved Atlas</h1><span role="status">{shell.ready ? 'Public shell verified' : 'Public shell not verified'}</span>
      {live.reachable ? <a className="saved-live" href={LIVE_ENTRY}>{waiting > 0 ? `Connected · Open live to sync ${changes}` : 'Connected · Open live'}</a>
        : <button type="button" className="saved-live" onClick={live.check} disabled={live.checking} aria-live="polite">
          {live.checking ? 'Checking connection…' : live.reachable === false ? `Offline${waiting > 0 ? ` · ${changes} waiting` : ''} · Check connection` : 'Check connection'}</button>}
      {house && <button type="button" onClick={close}>Close saved Atlas</button>}
      <details><summary>Saved scope</summary><p>Captured Atlas, inventory and documents. Editing and fresh downloads happen in the live app; changes made there while offline are sent when you open it again.</p>
        {shell.buildId && <><p>Public shell build <code>{shell.buildId}</code></p>
          <button type="button" onClick={() => { void removeSavedShell(shell.buildId!).then(() => setShell({ ready: false, buildId: null }), () => setError('The saved public shell could not be removed.')); }}>Remove saved public shell</button></>}</details>
    </header>
    <SavedHouseManager store={store} selected={selectedHouse ?? house} onClose={close} onOpen={selected => { close(); setView('atlas'); setHouse(structuredClone(selected)); }} />
    {house && <nav className="saved-catalog-nav" aria-label="Saved views">
      <button type="button" aria-pressed={view === 'atlas'} onClick={() => changeView('atlas')}>Atlas</button>
      <button type="button" aria-pressed={view === 'inventory'} onClick={() => changeView('inventory')}>Inventory</button>
      <button type="button" aria-pressed={view === 'documents'} onClick={() => changeView('documents')}>Documents</button>
    </nav>}
    {view === 'atlas' && opening && <p className="saved-message" role="status">Opening saved Atlas…</p>}
    {view === 'atlas' && error && <p className="saved-message" role="alert">{error}</p>}
    {house && (view === 'inventory' || view === 'documents') && !catalog && <p className="saved-message" role={catalogError ? 'alert' : 'status'}>{catalogError ?? 'Opening saved catalog…'}</p>}
    {catalog && (view === 'inventory' || view === 'documents') && <SavedCatalogView key={view + catalog.read.catalog.localRevision} selection={catalog} section={view} />}
    {!house && last && <>
      <p className="saved-message" role="note">Last opened in the live app on this device. Open live when connected to update this copy.</p>
      <div className="saved-stage"><UnifiedAtlas port={last.port} environment={{ reducedMotion: reduced }} /></div>
    </>}
    {allocation && selectedHouse && <>
      <details className="saved-coverage" hidden={view !== 'atlas'}><summary>Saved coverage: {allocation.saved.completeness} pack; {allocation.coverage.state} supported overlays</summary>
        <p>Captured <time dateTime={selectedHouse.capturedAt}>{selectedHouse.capturedAt}</time>. Historical records are not current native authorization.</p>
        <dl><div><dt>Local revision</dt><dd>{selectedHouse.localRevision}</dd></div><div><dt>Snapshot</dt><dd>{selectedHouse.snapshotId}</dd></div></dl>
        <ul>{allocation.coverage.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
        <p>{allocation.coverage.retained.inventory.length} retained inventory entities; {allocation.coverage.retained.documents.length} document metadata records.</p>
      </details>
      <div className="saved-stage" hidden={view !== 'atlas'}><UnifiedAtlas port={allocation} environment={{ reducedMotion: reduced }} /></div>
    </>}
  </main>;
}
