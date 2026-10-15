/** SYNTHETIC visual fixture for the canonical model viewer. Public generated
 * data only: no fetch, API route, native host, upload or household data.
 * The scene mode serves the checked-in two-floor-v2 snapshot bytes, bundled at
 * build time, through an owned fake port; its ready state is a mock. */
import { StrictMode, Suspense, useId, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LazyCanonicalModelViewer, LazyCanonicalSceneViewer, LazyLocalGlbPreview } from '../../src/lantern/canonical-ifc/lazy';
import type { CanonicalScenePort, SceneRequest } from '../../src/lantern/canonical-ifc/lazy';
import { sessionMemory } from '../../src/lantern/canonical-ifc/selection';
import { SYNTHETIC_FIXTURES, type SyntheticFixtureKey } from './synthetic-publication';
import sceneJson from '../../../docs/canonical-ifc/fixtures/two-floor-v2/scene-read.json?raw';
import semanticsJson from '../../../docs/canonical-ifc/fixtures/two-floor-v2/publication/semantics.json?raw';
import groundFeatures from '../../../docs/canonical-ifc/fixtures/two-floor-v2/publication/floors/2ff038c0-2e81-5cbe-95d4-59d3df81245a/floorplan.json?raw';
import groundSvg from '../../../docs/canonical-ifc/fixtures/two-floor-v2/publication/floors/2ff038c0-2e81-5cbe-95d4-59d3df81245a/floorplan.svg?raw';
import groundGlb from '../../../docs/canonical-ifc/fixtures/two-floor-v2/publication/floors/2ff038c0-2e81-5cbe-95d4-59d3df81245a/model.glb?url&inline';
import upperFeatures from '../../../docs/canonical-ifc/fixtures/two-floor-v2/publication/floors/ed6121fa-55c6-5ee1-9990-1285dccbc6af/floorplan.json?raw';
import upperSvg from '../../../docs/canonical-ifc/fixtures/two-floor-v2/publication/floors/ed6121fa-55c6-5ee1-9990-1285dccbc6af/floorplan.svg?raw';
import upperGlb from '../../../docs/canonical-ifc/fixtures/two-floor-v2/publication/floors/ed6121fa-55c6-5ee1-9990-1285dccbc6af/model.glb?url&inline';
import '../../src/lantern/styles/fonts.css';
import '../../src/lantern/styles/tokens.css';
import '../../src/lantern/styles/app.css';
import '../../src/lantern/styles/atlas.css';
import './fixture.css';

// Public synthetic two-floor-v2 scope (docs/canonical-ifc/fixtures/two-floor-v2).
const SCOPE = { workspaceId: 'eda986dc-80fc-584c-9350-ebcc4bd5d599', homeId: '5ac4b592-ed7c-5a17-a503-0eedb2477bb1',
  buildingId: 'ed098a05-48ae-5253-a1b8-214d4b82c8d6' } as const;
const PUBLICATION_ID = '1f8e08c7-366b-559d-81f7-cff3fe5e71a2';
const GROUND = '2ff038c0-2e81-5cbe-95d4-59d3df81245a', UPPER = 'ed6121fa-55c6-5ee1-9990-1285dccbc6af';
const PREFIX = `/api/atlas/ifc/v2/workspaces/${SCOPE.workspaceId}/homes/${SCOPE.homeId}/buildings/${SCOPE.buildingId}/publications/${PUBLICATION_ID}/`;

const text = (value: string) => new TextEncoder().encode(value);
const dataBytes = (url: string) => {
  const binary = atob(url.slice(url.indexOf(',') + 1));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};
/** Exact pinned href suffix -> exact fixture bytes. Anything else is refused. */
const ARTIFACTS: ReadonlyMap<string, () => Uint8Array> = new Map([
  ['artifacts/semantics', () => text(semanticsJson)],
  [`floors/${GROUND}/artifacts/glb`, () => dataBytes(groundGlb)],
  [`floors/${GROUND}/artifacts/floorplanFeatures`, () => text(groundFeatures)],
  [`floors/${GROUND}/artifacts/floorplan2d`, () => text(groundSvg)],
  [`floors/${UPPER}/artifacts/glb`, () => dataBytes(upperGlb)],
  [`floors/${UPPER}/artifacts/floorplanFeatures`, () => text(upperFeatures)],
  [`floors/${UPPER}/artifacts/floorplan2d`, () => text(upperSvg)],
]);
const sameScope = (request: SceneRequest) => request.scope.workspaceId === SCOPE.workspaceId && request.scope.homeId === SCOPE.homeId
  && request.scope.buildingId === SCOPE.buildingId && (request.publicationId === null || request.publicationId === PUBLICATION_ID);

/** Owned in-page fake transport: no network, no API route, no writes. */
const scenePort: CanonicalScenePort = {
  transport: 'synthetic-fixture',
  owner: 'Synthetic fixture transport',
  async readScene(request, signal) {
    signal.throwIfAborted();
    if (!sameScope(request)) throw new Error('Out of fixture scope');
    return text(sceneJson);
  },
  async readArtifact(href, signal) {
    signal.throwIfAborted();
    const read = href.startsWith(PREFIX) ? ARTIFACTS.get(href.slice(PREFIX.length)) : undefined;
    if (!read) throw new Error('Unknown fixture artifact');
    return read();
  },
};
const sceneRequest: SceneRequest = { scope: SCOPE, publicationId: null, buildingLabel: 'Synthetic two-floor building' };

type Mode = SyntheticFixtureKey | 'scene' | 'local';
const generatedKeys = Object.keys(SYNTHETIC_FIXTURES) as SyntheticFixtureKey[];
const modes: readonly Mode[] = [...generatedKeys, 'scene', 'local'];
const MODE_LABEL: Readonly<Record<'scene' | 'local', string>> = { scene: 'Two-floor scene (fake port)', local: 'Local GLB file' };
const initialMode = (): Mode => {
  const value = new URLSearchParams(location.search).get('fixture');
  return modes.find(mode => mode === value) ?? 'a';
};
const memory = sessionMemory();

function Fixture() {
  const [mode, setMode] = useState(initialMode);
  const [mount, setMount] = useState(0);
  const choose = (next: Mode) => {
    setMode(next);
    const url = new URL(location.href); url.searchParams.set('fixture', next); history.replaceState(null, '', url);
  };
  return <main className="lantern-host cifc-fixture">
    <header className="cifc-fixture-head">
      <div>
        <h1>SYNTHETIC canonical model fixture</h1>
        <p>Public generated data only. No publication service is connected; ready and published states here are mock.</p>
      </div>
      <div className="cifc-fixture-controls" role="group" aria-label="Fixture">
        {modes.map(option => <button key={option} type="button" className="chip-btn" aria-pressed={option === mode} onClick={() => choose(option)}>
          {option === 'scene' || option === 'local' ? MODE_LABEL[option] : SYNTHETIC_FIXTURES[option].label}</button>)}
        <button type="button" className="chip-btn" onClick={() => setMount(value => value + 1)}>Remount viewer</button>
      </div>
    </header>
    <Suspense fallback={<p role="status">Loading viewer…</p>}>
      {mode === 'scene' ? <LazyCanonicalSceneViewer key={mount} port={scenePort} request={sceneRequest} memory={memory} />
        : mode === 'local' ? <LocalMode key={mount} />
        : <GeneratedMode key={`${mode}:${mount}`} fixture={mode} />}
    </Suspense>
  </main>;
}

function GeneratedMode({ fixture }: { readonly fixture: SyntheticFixtureKey }) {
  // One immutable presentation object per fixture choice, as a host would hold per publication.
  const presentation = useMemo(() => SYNTHETIC_FIXTURES[fixture].make(), [fixture]);
  return <LazyCanonicalModelViewer presentation={presentation} memory={memory} />;
}

/** Reads a chosen file in this tab only; nothing is uploaded or stored. */
function LocalMode() {
  const inputId = useId(), noteId = useId();
  const [file, setFile] = useState<File | null>(null);
  return <section className="cifc-fixture-local" aria-label="Local GLB preview">
    <div className="cifc-fixture-chooser">
      <label htmlFor={inputId}>Choose local GLB file</label>
      <input id={inputId} type="file" accept=".glb,model/gltf-binary" aria-describedby={noteId}
        onChange={event => setFile(event.currentTarget.files?.[0] ?? null)} />
      <p id={noteId}>Read in this browser only. Rooms, floors and alignment stay unavailable.</p>
    </div>
    <LazyLocalGlbPreview file={file} />
  </section>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
