import { useEffect, useMemo, useState } from 'react';
import UnifiedAtlas from '../lantern/unified-atlas/UnifiedAtlas';
import { createSavedHouseStore, type SavedHouse, type SavedHouseStore } from './store';
import { openSavedAtlasPresentation } from './saved-atlas-presentation';
import { SavedHouseManager } from './SavedHouseManager';
import { verifySavedShell, removeSavedShell, type SavedShellStatus } from './shell';
import '../lantern/styles/fonts.css';
import '../lantern/styles/tokens.css';
import '../lantern/styles/app.css';
import './saved-host.css';

type Allocation = NonNullable<Awaited<ReturnType<typeof openSavedAtlasPresentation>>>;
export function SavedAtlasHost({ store: supplied }: { readonly store?: SavedHouseStore }) {
  const store = useMemo(() => supplied ?? createSavedHouseStore(globalThis.indexedDB), [supplied]);
  const [house, setHouse] = useState<SavedHouse | null>(null), [allocation, setAllocation] = useState<Allocation | null>(null);
  const [error, setError] = useState<string | null>(null), [opening, setOpening] = useState(false);
  const [shell, setShell] = useState<SavedShellStatus>({ ready: false, buildId: null });
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)'), changed = () => setReduced(query.matches);
    query.addEventListener('change', changed); return () => query.removeEventListener('change', changed);
  }, []);
  useEffect(() => { let active = true;
    void verifySavedShell().then(status => { if (active) setShell(status); }, () => { if (active) setShell({ ready: false, buildId: null }); });
    return () => { active = false; };
  }, []);
  useEffect(() => () => { if (!supplied) void store.close(); }, [store, supplied]);
  useEffect(() => {
    const controller = new AbortController(); let owned: Allocation | null = null, closed = false;
    setAllocation(null); setError(null); setOpening(house !== null);
    if (house) void openSavedAtlasPresentation(store, house, controller.signal).then(port => {
      if (closed) { port?.dispose(); return; }
      owned = port; setAllocation(port); setOpening(false);
      if (!port) setError('This saved copy has no supported Atlas room map.');
    }, () => { if (!closed) { setOpening(false); setError('The saved Atlas is unavailable or changed. Open the retained copy again.'); } });
    return () => { closed = true; controller.abort(); owned?.dispose(); };
  }, [house, store]);
  // Withdrawal also removes the old stage before a different allocation opens.
  useEffect(() => allocation?.subscribe(() => {
    if (allocation.current() === null) { setAllocation(null); setError('The saved copy changed. Open the retained copy again.'); }
  }), [allocation]);
  const close = () => { allocation?.dispose(); setAllocation(null); setHouse(null); setError(null); };
  return <main className="lantern-host view-atlas saved-atlas-app">
    <header className="saved-header"><h1>Saved Atlas</h1><span role="status">{shell.ready ? 'Public shell verified' : 'Public shell not verified'}</span>
      {house && <button type="button" onClick={close}>Close saved Atlas</button>}
      <details><summary>Saved scope</summary><p>Atlas only. Full inventory and document navigation, editing and fresh downloads are unavailable here.</p>
        {shell.buildId && <><p>Public shell build <code>{shell.buildId}</code></p>
          <button type="button" onClick={() => { void removeSavedShell(shell.buildId!).then(() => setShell({ ready: false, buildId: null }), () => setError('The saved public shell could not be removed.')); }}>Remove saved public shell</button></>}</details>
    </header>
    <SavedHouseManager store={store} selected={house} onClose={close} onOpen={selected => { allocation?.dispose(); setAllocation(null); setHouse(structuredClone(selected)); }} />
    {opening && <p className="saved-message" role="status">Opening saved Atlas…</p>}
    {error && <p className="saved-message" role="alert">{error}</p>}
    {allocation && <>
      <details className="saved-coverage"><summary>Saved coverage: {allocation.saved.completeness} pack; {allocation.coverage.state} supported overlays</summary>
        <p>Captured <time dateTime={house!.capturedAt}>{house!.capturedAt}</time>. Historical records are not current native authorization.</p>
        <dl><div><dt>Local revision</dt><dd>{house!.localRevision}</dd></div><div><dt>Snapshot</dt><dd>{house!.snapshotId}</dd></div></dl>
        <ul>{allocation.coverage.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
        <p>{allocation.coverage.retained.inventory.length} retained inventory entities; {allocation.coverage.retained.documents.length} document metadata records. General navigation unavailable.</p>
      </details>
      <div className="saved-stage"><UnifiedAtlas port={allocation} environment={{ reducedMotion: reduced }} /></div>
    </>}
  </main>;
}
