/** SYNTHETIC fixture for the public local model review mount. Generated files,
 * records and sources only; no fetch, API route, native host, upload or
 * household data. `?bridge=none` mounts without a provider: electrical review
 * stays unavailable and the page shows that no read or open was requested. */
import { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { mountLocalModelReview, type LocalModelReviewProps, type ReviewSessionOwner } from '../../src/lantern/source-models/review-mount';
import { REVIEW_TARGETS, reviewFiles, syntheticBridge, type SyntheticBridgeLog } from './synthetic-review';
import { StageTimings } from '../stage-timings/StageTimings';
import '../../src/lantern/styles/fonts.css';
import '../../src/lantern/styles/tokens.css';
import '../../src/lantern/styles/app.css';
import './fixture.css';

globalThis.fetch = async () => new Response(null, { status: 404 });
const withBridge = new URLSearchParams(location.search).get('bridge') !== 'none';

// One synthetic session owner: "End session" replaces its token.
let token: object = Object.freeze({});
const sessionListeners = new Set<() => void>();
const session: ReviewSessionOwner = {
  current: () => token,
  subscribe(changed) { sessionListeners.add(changed); return () => { sessionListeners.delete(changed); }; },
};
const endSession = () => { token = Object.freeze({}); for (const changed of [...sessionListeners]) changed(); };

const log: SyntheticBridgeLog = { opens: 0, reads: 0 };
const logListeners = new Set<() => void>();
let logSnapshot = '';
const logText = () => `${log.reads} reads, ${log.opens} source opens`;
setInterval(() => { const next = logText(); if (next !== logSnapshot) { logSnapshot = next; for (const changed of logListeners) changed(); } }, 250);

const options = withBridge ? { createElectricalBridge: syntheticBridge(log), electricalTargets: REVIEW_TARGETS, session } : { session };
const review = mountLocalModelReview(document.getElementById('review')!, { files: [], ...options } satisfies LocalModelReviewProps);

function Controls() {
  const [loaded, setLoaded] = useState(false);
  const calls = useSyncExternalStore(changed => { logListeners.add(changed); return () => { logListeners.delete(changed); }; }, () => logSnapshot || logText());
  const load = () => { void reviewFiles().then(files => { review.render({ files, ...options }); setLoaded(true); }); };
  return <header className="lantern-host review-fixture-head">
    <h1>Synthetic model review</h1>
    <p>Generated house with two occurrences of one room, a shared documentary record and an unmodeled scope.
      {withBridge ? ' A fixture bridge wraps the neutral documentary provider.' : ' No electrical provider is connected.'}</p>
    <div className="review-fixture-controls">
      <button type="button" className="chip-btn" onClick={load}>{loaded ? 'Replace with new copies' : 'Load generated sample'}</button>
      <button type="button" className="chip-btn" disabled={!loaded} onClick={endSession}>End session</button>
      <button type="button" className="chip-btn" disabled={!loaded} onClick={() => { review.render({ files: [], ...options }); setLoaded(false); }}>Clear files</button>
      <span role="status">Fixture bridge: {calls}</span>
    </div>
  </header>;
}
createRoot(document.getElementById('controls')!).render(<>
  <Controls />
  <div className="lantern-host review-fixture-timings"><StageTimings areas={['model', 'source']} title="Model and source stage timings" /></div>
</>);
window.addEventListener('pagehide', () => review.unmount(), { once: true });
