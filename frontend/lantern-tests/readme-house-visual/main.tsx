/** Generated public geometry presentation. No native admission or physical claim. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseMeshProfile } from '../../src/lantern/scans/mesh-profile';
import { HouseScanScene } from '../../src/lantern/scans/presentation/HouseScanScene';
import type { SceneOverlay } from '../../src/lantern/scans/presentation/types';
import fixture from './fixture.json';
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
function Demo() {
  const [overlay, setOverlay] = useState<SceneOverlay>('spaces');
  return <div className="lantern-host" style={{ padding: 24, background: '#eee9df' }}>
    <h1>SYNTHETIC house geometry</h1>
    <p>Generated meshes · physical scale and floor alignment unverified · no room associations.</p>
    <HouseScanScene active viewKey="synthetic-readme-house" floors={floors} rooms={[]}
      overlay={overlay} onOverlayChange={setOverlay} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Demo />);
