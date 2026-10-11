import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SceneControls } from '../../src/lantern/scans/presentation/SceneControls';

function SceneControlsKeyboardCheck() {
  const [overlay, setOverlay] = useState<'spaces' | 'electrical' | 'network'>('spaces');
  return (
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
  );
}

createRoot(document.getElementById('root')!).render(<SceneControlsKeyboardCheck />);
