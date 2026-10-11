import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SceneControls } from '../../src/lantern/scans/presentation/SceneControls';
import '../../src/lantern/styles/fonts.css';
import '../../src/lantern/styles/tokens.css';
import '../../src/lantern/styles/app.css';
import '../../src/lantern/styles/atlas.css';
import '../../src/lantern/styles/panels.css';
import '../../src/lantern/styles/integration.css';
import '../../src/lantern/styles/topology.css';
import '../../src/lantern/scans/presentation/scene.css';

function SceneControlsKeyboardCheck() {
  const [overlay, setOverlay] = useState<'spaces' | 'electrical' | 'network'>('spaces');
  return (
    <div className="lantern-host app">
      <main>
        <h1>Scene overlay keyboard check</h1>
        <p>Tab to an overlay button, then use Space or Enter to change the pressed state.</p>
        <SceneControls
          floors={[]}
          selectedFloorKey=""
          onFloorChange={() => {}}
          mode="plan"
          onModeChange={() => {}}
          exploded={false}
          onExplodedChange={() => {}}
          yaw={0}
          onYawChange={() => {}}
          pitch={36}
          onPitchChange={() => {}}
          zoom={1}
          onZoomChange={() => {}}
          overlay={overlay}
          onOverlayChange={setOverlay}
          onReset={() => {}}
        />
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<SceneControlsKeyboardCheck />);
