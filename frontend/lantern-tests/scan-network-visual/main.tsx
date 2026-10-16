/** SYNTHETIC responsiveness fixture: the actual LanternHost, NativeScanAtlas,
 * NativeSceneLayers and NetworkSceneLayer over fake in-page read ports that
 * answer after `?delay=` ms (default 400, clamped to 0–5000 so the mesh read
 * deadline is never reached). Choose a building for a cold load, then switch
 * buildings or refresh for warm loads; Alpha carries a scene source with
 * network records. Stage timings are listed below the host. No fetch, native
 * host, credential, write or household data. */
import { createRoot } from 'react-dom/client';
import { LanternHost } from '../../src/lantern/Host';
import type { ReadyView } from '../../src/app/types';
import { createSyntheticTopology, fixture, session } from '../topology-visual/synthetic-topology';
import { StageTimings } from '../stage-timings/StageTimings';
import { createSyntheticScanClient, createSyntheticSceneHost } from './synthetic-scan';
import './fixture.css';

globalThis.fetch = async () => new Response(null, { status: 404 });
const requested = Number(new URLSearchParams(location.search).get('delay') ?? 400);
const delay = Number.isFinite(requested) ? Math.min(5000, Math.max(0, requested)) : 400;

const root = createRoot(document.getElementById('root')!);
root.render(<LanternHost view={fixture.view as ReadyView}
  actions={{ reload: async () => true, switchHome: () => {}, busy: false, notice: '', session: { ...session, signOut: async () => {} } }}
  nativeContent={null} topology={createSyntheticTopology()}
  nativeGeometry={createSyntheticScanClient(fixture.scope, delay)} nativeScene={createSyntheticSceneHost(fixture.scope, delay)} />);
const timings = createRoot(document.getElementById('timings')!);
timings.render(<div className="lantern-host scan-fixture-timings"><StageTimings areas={['scan-atlas', 'network-scene']} /></div>);
window.addEventListener('pagehide', () => { root.unmount(); timings.unmount(); }, { once: true });
