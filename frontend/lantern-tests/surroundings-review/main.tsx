// Generated fictional geometry only. A review surface for #439, not a phone
// performance test or evidence of the appearance of any household model.
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MeshLayer } from '../../src/lantern/canonical-ifc/MeshLayer';
import { makeProjection, prepareMeshes, type MeshInput } from '../../src/lantern/canonical-ifc/geometry';
import { GLOW_STOPS } from '../../src/lantern/canonical-ifc/mesh-appearance';
import { daylightAt, stageBackdrop } from '../../src/lantern/unified-atlas/daylight';
import { SURROUNDINGS_CLEAR, SURROUNDINGS_FAR, SURROUNDINGS_NEAR } from '../../src/lantern/unified-atlas/scene';
import { box } from '../canonical-ifc-visual/standard-glb-sample';

const inputs: MeshInput[] = [];
const add = (key: string, min: readonly [number, number, number], max: readonly [number, number, number], color: readonly [number, number, number, number]) => {
  const geometry = box(min, max);
  inputs.push({ meshKey: key, floorId: null, occurrenceId: null, sourceBaseColor: color,
    positions: Float32Array.from(geometry.positions), indices: Uint32Array.from(geometry.indices) });
};
add('house', [-6, 0, -5], [6, 6, 5], [.72, .62, .47, 1]);
add('roof', [-6.5, 6, -5.5], [6.5, 6.5, 5.5], [.4, .25, .2, 1]);
add('wing', [6, 0, -2], [9, 3, 4], [.8, .72, .6, 1]);
add('site-ground', [-80, -.35, -80], [80, -.1, 80], [.43, .5, .32, 1]);
for (let i = 0; i < 18; i++) {
  const angle = i * Math.PI * 2 / 18, radius = 15 + i % 3 * 13, x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
  add(`site-tree-${i}`, [x - 1.2, 0, z - 1.2], [x + 1.2, 3 + i % 4, z + 1.2], [.18, .32, .2, 1]);
}
const meshes = prepareMeshes(inputs), site = new Set(meshes.filter(mesh => mesh.meshKey.startsWith('site-')).map(mesh => mesh.meshKey));
const bounds = { min: [-6.5, 0, -5.5] as const, max: [9, 6.5, 5.5] as const };
const half = [(bounds.max[0] - bounds.min[0]) / 2, (bounds.max[2] - bounds.min[2]) / 2] as const;
const reach = Math.hypot(...half), near = Math.max(SURROUNDINGS_CLEAR, SURROUNDINGS_NEAR * reach);
const params = new URLSearchParams(location.search);
function Review() {
  const [night, setNight] = useState(params.get('hour') === 'night');
  const [phone, setPhone] = useState(params.get('frame') === 'phone');
  const [yaw, setYaw] = useState(30), [failure, setFailure] = useState('');
  const size = { width: phone ? 390 : 960, height: 640 };
  const daylight = useMemo(() => daylightAt(new Date(night ? '2026-06-21T23:00:00Z' : '2026-06-21T12:00:00Z'),
    { latitude: 51.48, longitude: 0, northDeg: 0 }), [night]);
  const projection = makeProjection({ yaw, pitch: 35, zoom: .75, panX: 0, panY: 0 }, bounds, size, 0);
  const backdrop = stageBackdrop(daylight.dusk), percent = (n: number) => `${100 * n}%`;
  const stops = GLOW_STOPS.map(stop => `color-mix(in srgb, ${backdrop.glow} ${percent(stop.alpha)}, transparent) ${percent(stop.at)}`).join(', ');
  const background = `radial-gradient(ellipse ${backdrop.glowRadii.map(percent).join(' ')} at ${backdrop.glowAt.map(percent).join(' ')}, ${stops}), linear-gradient(176deg, ${backdrop.top}, ${backdrop.bottom})`;
  const surroundings = { keys: site, center: [1.25, 0] as const, half, near,
    far: near + (SURROUNDINGS_FAR - SURROUNDINGS_NEAR) * Math.max(reach, SURROUNDINGS_CLEAR), ground: 0,
    lean: 1 / Math.tan(20 * Math.PI / 180), backdrop };
  return <>
    <h1>Synthetic surroundings comparison</h1>
    <p>Generated house, ground and trees. Both views use the same geometry, lighting and camera. Phone and desktop describe framing only.</p>
    <label>Hour <select value={night ? 'night' : 'day'} onChange={event => setNight(event.target.value === 'night')}><option value="day">Day</option><option value="night">Night</option></select></label>
    <label>Frame <select value={phone ? 'phone' : 'desktop'} onChange={event => setPhone(event.target.value === 'phone')}><option value="desktop">Desktop · 960 × 640</option><option value="phone">Phone · 390 × 640</option></select></label>
    <label>View angle <input type="range" min="0" max="360" value={yaw} onChange={event => setYaw(Number(event.target.value))} /></label>
    <output role="status">{failure}</output>
    <div className="pair">{[false, true].map(faded => <section key={String(faded)}>
      <h2>{faded ? 'After · surroundings fade' : 'Before · surroundings at full strength'}</h2>
      <div className="stage" data-review={faded ? 'after' : 'before'} style={{ ...size, background }}>
        <MeshLayer meshes={meshes} projection={projection} rules={{ visibleFloors: 'all', clipY: null }}
          currentFloorId={null} selectedOccurrenceId={null} contextOccurrenceIds={[]} tints={new Map()}
          hidden={false} twoSided sourceColors ambient={.55} light={daylight.toward} daylight={daylight}
          shelterKeys={new Set(['house', 'roof', 'wing'])} site={{ keys: site, tone: '#8b9979' }}
          surroundings={faded ? surroundings : undefined} onUnavailable={setFailure} />
      </div>
    </section>)}</div>
  </>;
}
createRoot(document.getElementById('root')!).render(<Review />);
