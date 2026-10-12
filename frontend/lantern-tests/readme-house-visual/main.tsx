/** Generated public geometry presentation. No native admission or physical claim. */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseMeshProfile } from '../../src/lantern/scans/mesh-profile';
import { HouseScanScene } from '../../src/lantern/scans/presentation/HouseScanScene';
import type { SceneOverlay } from '../../src/lantern/scans/presentation/types';
import fixture from './fixture.json';
import { AtlasView } from '../../src/lantern/atlas/AtlasView';
import { fictionalHouse } from './house';
import { projectView } from '../../src/lantern/adapters/read';
import { StoreProvider, useStore } from '../../src/lantern/state/store';
import type { ReadyView } from '../../src/app/types';
import browsingFixture from '../core-read-visual/fixture.json';
import './demo.css';
import '../../src/lantern/styles/fonts.css';
import '../../src/lantern/styles/tokens.css';
import '../../src/lantern/styles/app.css';
import '../../src/lantern/styles/atlas.css';
import '../../src/lantern/styles/panels.css';
import '../../src/lantern/styles/integration.css';

// The actual lossless reader validates generated tokens. Fixed hash strings are
// synthetic metadata, not evidence of a source file or Magicplan conversion.
const profile = await parseMeshProfile(new TextEncoder().encode(JSON.stringify(fixture)), new AbortController().signal);
const floors = [
  { key: 'synthetic-lower', label: 'Synthetic lower floor', short: 'L0', profile },
  { key: 'synthetic-upper', label: 'Synthetic upper floor', short: 'L1', profile },
];
function MeshDemo() {
  const [overlay, setOverlay] = useState<SceneOverlay>('spaces');
  return <div className="lantern-host demo-mesh" style={{ padding: 24, background: '#eee9df' }}>
    <h1>SYNTHETIC house geometry</h1>
    <p>Generated meshes · physical scale and floor alignment unverified · no room associations.</p>
    <HouseScanScene active viewKey="synthetic-readme-house" floors={floors} rooms={[]}
      overlay={overlay} onOverlayChange={setOverlay} />
  </div>;
}
// The original authored house is explicitly fictional. Reuse the application's
// actual illustrated geometry path, not the prototype App or simulated writes.
const projection = { ...projectView(browsingFixture.view as ReadyView), house: fictionalHouse };
function IllustratedHouse() {
  const { state, dispatch, house } = useStore();
  useEffect(() => { dispatch({ type: 'floor', id: 'fl-g' }); }, [dispatch]);
  const room = state.selection?.kind === 'space' ? house.spaces.find(space => space.id === state.selection?.id) : null;
  return <div className="demo-grid">
    <AtlasView />
    <aside className="demo-details">
      <span className="demo-kicker">Original fictional Lantern house</span>
      <h1>Alder Row 14</h1>
      <p>Invented rooms, furniture and dimensions. No household data, native admission or connected writes.</p>
      <div className="demo-facts"><strong>3 illustrated floors</strong><span>Loft and outside remain unplanned.</span></div>
      <h2>{room?.name ?? 'Ground floor'}</h2>
      <p>{room ? 'Selected fictional room' : 'Select a room to inspect its fictional contents.'}</p>
      <ul className="demo-room-list">{house.spaces.filter(space => space.floorId === (room?.floorId ?? state.floorId) && space.kind !== 'stair').map(space => <li key={space.id}>
        <button type="button" aria-pressed={room?.id === space.id} onClick={() => dispatch({ type: 'select', sel: { kind: 'space', id: space.id } })}>{space.name}</button>
      </li>)}</ul>
      {room && <><h2>Fictional belongings</h2><ul>{house.items.filter(item => item.spaceId === room.id).map(item => <li key={item.id}>{item.name}</li>)}</ul></>}
    </aside>
  </div>;
}
function Demo() {
  const mesh = new URL(location.href).searchParams.get('renderer') === 'mesh';
  return <div className="lantern-host readme-demo">
    <header className="demo-header"><strong>HouseAtlas <span>Lantern</span></strong><span className="demo-badge">SYNTHETIC</span>
      <nav aria-label="Synthetic examples"><a href="./" aria-current={!mesh ? 'page' : undefined}>House model</a><a href="?renderer=mesh" aria-current={mesh ? 'page' : undefined}>Source meshes</a></nav>
    </header>
    {mesh ? <MeshDemo /> : <StoreProvider projection={projection} actions={{ reload: async () => false, switchHome: () => {}, nativeContent: null }}><IllustratedHouse /></StoreProvider>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Demo />);
