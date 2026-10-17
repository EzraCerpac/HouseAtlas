import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { generateSavedPack } from './generated-pack';
import { createSavedHouseStore } from '../../src/offline/store';
import { verifySavedShell } from '../../src/offline/shell';
function Fixture() {
  const store = useMemo(() => createSavedHouseStore(globalThis.indexedDB), []);
  const [status, setStatus] = useState('No generated fixture saved in this page.'), [busy, setBusy] = useState(false);
  useEffect(() => () => { void store.close(); }, [store]);
  const save = async (mode: 'complete' | 'partial', historical = false, finalInteraction = false) => {
    setBusy(true); setStatus('Verifying public shell…');
    try {
      const shell = await verifySavedShell();
      if (!shell.ready || !shell.buildId) throw new Error('Production public shell must be verified before Save.');
      const generated = await generateSavedPack(mode, shell.buildId, historical, false, false, false, false, finalInteraction);
      const stage = await store.begin(generated.house);
      for (const pin of generated.house.resources) await store.put(stage, pin, generated.resources.get(pin.sha256)!);
      const saved = await store.activate(stage);
      setStatus(`Saved ${finalInteraction ? 'final interaction' : historical ? 'historical closure' : mode} generated copy. Capture ${saved.capturedAt}. Local revision ${saved.localRevision}. Snapshot ${saved.snapshotId}. Public shell ${saved.shellBuildId}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Save unavailable.'); }
    finally { setBusy(false); }
  };
  return <main style={{ maxWidth: 720, margin: '2rem auto', padding: '1rem', fontFamily: 'sans-serif' }}>
    <h1>Generated saved Atlas fixture</h1><p>Generated records only. Save writes a retained copy through the production IndexedDB store.</p>
    <button disabled={busy} onClick={() => void save('complete')}>Save complete generated copy</button>{' '}
    <button disabled={busy} onClick={() => void save('complete', true)}>Save historical closure generated copy</button>{' '}
    <button disabled={busy} onClick={() => void save('partial')}>Save partial generated copy</button>
    <button disabled={busy} onClick={() => void save('complete', true, true)}>Save final interaction generated copy</button>
    <p role="status" style={{ overflowWrap: 'anywhere' }}>{status}</p>
    <a href="/saved/index.html">Open production saved Atlas</a>
    <button onClick={() => { void store.close().then(() => setStatus('Fixture store closed.')); }} disabled={busy}>Close fixture store</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
