/** SYNTHETIC visual fixture for the canonical model viewer. Generated data
 * only: no fetch, endpoint, native host, publisher output or household data. */
import { StrictMode, Suspense, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LazyCanonicalModelViewer } from '../../src/lantern/canonical-ifc/lazy';
import { sessionMemory } from '../../src/lantern/canonical-ifc/selection';
import { SYNTHETIC_FIXTURES, type SyntheticFixtureKey } from './synthetic-publication';
import '../../src/lantern/styles/fonts.css';
import '../../src/lantern/styles/tokens.css';
import '../../src/lantern/styles/app.css';
import '../../src/lantern/styles/atlas.css';
import './fixture.css';

const keys = Object.keys(SYNTHETIC_FIXTURES) as SyntheticFixtureKey[];
const initialKey = (): SyntheticFixtureKey => {
  const value = new URLSearchParams(location.search).get('fixture');
  return keys.find(key => key === value) ?? 'a';
};
const memory = sessionMemory();

function Fixture() {
  const [key, setKey] = useState(initialKey);
  const [mount, setMount] = useState(0);
  // One immutable presentation object per fixture choice, as a host would hold per publication.
  const presentation = useMemo(() => SYNTHETIC_FIXTURES[key].make(), [key]);
  const choose = (next: SyntheticFixtureKey) => {
    setKey(next);
    const url = new URL(location.href); url.searchParams.set('fixture', next); history.replaceState(null, '', url);
  };
  return <main className="lantern-host cifc-fixture">
    <header className="cifc-fixture-head">
      <div>
        <h1>SYNTHETIC canonical model fixture</h1>
        <p>Generated data only. Publication source not connected; backend contract pending.</p>
      </div>
      <div className="cifc-fixture-controls" role="group" aria-label="Fixture">
        {keys.map(option => <button key={option} type="button" className="chip-btn" aria-pressed={option === key} onClick={() => choose(option)}>
          {SYNTHETIC_FIXTURES[option].label}</button>)}
        <button type="button" className="chip-btn" onClick={() => setMount(value => value + 1)}>Remount viewer</button>
      </div>
    </header>
    <Suspense fallback={<p role="status">Loading viewer…</p>}>
      <LazyCanonicalModelViewer key={mount} presentation={presentation} memory={memory} />
    </Suspense>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
