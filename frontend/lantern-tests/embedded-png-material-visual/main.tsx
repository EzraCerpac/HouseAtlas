import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MeshLayer } from '../../src/lantern/canonical-ifc/MeshLayer';
import { makeProjection, prepareMeshes, type PreparedMesh } from '../../src/lantern/canonical-ifc/geometry';
import { box, buildGlb } from '../canonical-ifc-visual/standard-glb-sample';
import { generatedMaterialGlb } from '../embedded-png-material-fixture';
import { loadStandardGlb } from '../../src/lantern/canonical-ifc/standard-glb';

function Sample({ mesh, title, selected = false, dim = 0, ghost = false }: { mesh: PreparedMesh; title: string; selected?: boolean; dim?: number; ghost?: boolean }) {
  const [failure, setFailure] = useState('');
  const meshes = useMemo(() => [mesh], [mesh]);
  const projection = useMemo(() => makeProjection({ yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 },
    { min: [-.1, -.1, -.1], max: [1.1, 1.1, .1] }, { width: 320, height: 300 }, 0), []);
  return <section><h2>{title}</h2><MeshLayer meshes={meshes} projection={projection} rules={{ visibleFloors: 'all', clipY: null }}
    currentFloorId={null} selectedOccurrenceId={null} contextOccurrenceIds={[]} tints={new Map()} hidden={false}
    sourceColors sourceMaterials ambient={.3} twoSided light={[.4, .4, .8246211251]} selectedKeys={selected ? new Set([mesh.meshKey]) : new Set()}
    dims={new Map([[mesh.meshKey, dim]])} ghosts={ghost ? new Map([[mesh.meshKey, null]]) : new Map()} hiddenKeys={ghost ? new Set([mesh.meshKey]) : new Set()}
    onUnavailable={setFailure} /><output>{failure}</output></section>;
}
// Camera sorting and the admitted map streams through the same production
// renderer. This mode reuses the existing fixture entry and browser case.
const panes = prepareMeshes([
  { meshKey: 'red-near', floorId: null, occurrenceId: null, sourceNight: 'glazing', sourceBaseColor: [1, .01, .01, .7], sourceRoughness: .9,
    positions: new Float32Array([0, 0, .4, 1, 0, .4, 0, 1, .4, 1, 1, .4]), indices: new Uint32Array([0, 1, 2, 1, 3, 2]) },
  { meshKey: 'blue-far', floorId: null, occurrenceId: null, sourceNight: 'glazing', sourceBaseColor: [.01, .01, 1, .7], sourceRoughness: .9,
    positions: new Float32Array([0, 0, -.4, 1, 0, -.4, 0, 1, -.4, 1, 1, -.4]), indices: new Uint32Array([0, 1, 2, 1, 3, 2]) },
]);
function GlassSample({ meshes, title, yaw = 0, toggle = false }: { meshes: readonly PreparedMesh[]; title: string; yaw?: number; toggle?: boolean }) {
  const [failure, setFailure] = useState(''), [materials, setMaterials] = useState(true);
  const projection = useMemo(() => makeProjection({ yaw, pitch: 0, zoom: 1, panX: 0, panY: 0 },
    { min: [-.1, -.1, -.5], max: [1.1, 1.1, .5] }, { width: 320, height: 300 }, 0), [yaw]);
  const glazingKeys = useMemo(() => new Set(meshes.map(mesh => mesh.meshKey)), [meshes]);
  return <section><h2>{title}</h2><MeshLayer meshes={meshes} projection={projection} rules={{ visibleFloors: 'all', clipY: null }}
    currentFloorId={null} selectedOccurrenceId={null} contextOccurrenceIds={[]} tints={new Map()} hidden={false}
    sourceColors sourceMaterials={materials} ambient={1} twoSided light={[0, 1, 0]} glazingKeys={glazingKeys}
    daylight={{ direct: 0, night: false, lamp: 0, tint: [1, 1, 1], sunTint: [1, 1, 1], lampTint: [1, 1, 1] }}
    onUnavailable={setFailure} /><output>{failure}</output>
    {toggle && <button id="toggle-glass-materials" onClick={() => setMaterials(value => !value)}>Toggle glass material maps</button>}</section>;
}
function GlassFixture({ mesh }: { mesh: PreparedMesh }) {
  const textured = useMemo(() => [{ ...mesh, sourceNight: 'glazing' as const, sourceRoughness: .9 }], [mesh]);
  const reversed = useMemo(() => [...panes].reverse(), []);
  return <main><GlassSample title="Red pane in front" meshes={panes} />
    <GlassSample title="Same panes in reversed source order" meshes={reversed} />
    <GlassSample title="Orbit to the blue pane" meshes={panes} yaw={180} />
    <GlassSample title="Admitted maps on glass" meshes={textured} toggle /></main>;
}

// Fixed synthetic receivers isolate distance attenuation in the production shader.
// A closed bulb stays omni; the nearby metal receives light but never emits.
function LampSample({ height, metal, enabled }: { height: number; metal: boolean; enabled: boolean }) {
  const [failure, setFailure] = useState('');
  const meshes = useMemo(() => {
    const bulb = box([-.05, height - .05, -.05], [.05, height + .05, .05]);
    return prepareMeshes([
      { meshKey: 'receiver', floorId: null, occurrenceId: null, sourceBaseColor: [.6, .6, .6, 1],
        positions: new Float32Array([-1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, 1]), indices: new Uint32Array([0, 2, 1, 1, 2, 3]),
        sourceMaterial: { baseColor: [.6, .6, .6, 1], metallic: metal ? .8 : 0, roughness: .5, doubleSided: true },
        sourceAttributes: { uv: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), normal: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
          tangent: new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]) } },
      { meshKey: 'bulb', floorId: null, occurrenceId: null, sourceNight: 'emitter', sourceBaseColor: [1, 1, 1, 1],
        positions: Float32Array.from(bulb.positions), indices: Uint32Array.from(bulb.indices) },
    ]);
  }, [height, metal]);
  // Frame the receiver rather than the bulb, which remains in the renderer's depth bounds.
  const projection = useMemo(() => makeProjection({ yaw: 0, pitch: 60, zoom: 1, panX: 0, panY: 0 },
    { min: [-1.1, -.01, -1.1], max: [1.1, .01, 1.1] }, { width: 320, height: 300 }, 0), []);
  return <section data-lamp-height={height} data-bulb-omni={meshes[1]!.aim === undefined}
    data-receiver-emitter={meshes[0]!.sourceNight === 'emitter'}>
    <h2>{metal ? 'Nearby receiving metal' : 'Paving receiver'} · {height} m</h2>
    <MeshLayer meshes={meshes} projection={projection} rules={{ visibleFloors: 'all', clipY: null }}
      currentFloorId={null} selectedOccurrenceId={null} contextOccurrenceIds={[]} tints={new Map()} hidden={false}
      sourceColors sourceMaterials ambient={.4} twoSided light={[0, 1, 0]} emitterKeys={new Set(enabled ? ['bulb'] : [])}
      daylight={{ direct: 0, night: true, lamp: 1, tint: [.5, .5, .5], sunTint: [1, 1, 1], lampTint: [1, 1, 1] }}
      onUnavailable={setFailure} /><output>{failure}</output>
  </section>;
}
function LampFixture() {
  const [enabled, setEnabled] = useState(false);
  return <><button id="toggle-lamp" aria-pressed={enabled} onClick={() => setEnabled(value => !value)}>Toggle synthetic emitter</button>
    <main>{[1, 6, 10, 12].map(height => <LampSample key={height} height={height} metal={height === 1} enabled={enabled} />)}</main></>;
}

// The materials below are serialized into a generated GLB, so emitter/glass
// classification follows the same loader path as a selected model.
async function lampGlassMeshes(glass: boolean, signal: AbortSignal): Promise<readonly PreparedMesh[]> {
  const shade = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], indices: [0, 1, 2, 1, 3, 2] };
  const bytes = buildGlb({ nodes: [{ mesh: 0 }, { mesh: 1 }, { mesh: 2 }, { mesh: 3 }], roots: [0, 1, 2, 3],
    meshes: [shade, box([.2, .2, -.2], [.8, .8, -.19]), box([1.1, .2, 1.5], [1.6, .8, 1.51]), box([-.7, .2, -1.51], [-.2, .8, -1.5])],
    patch(json) {
      json.materials = [
        { emissiveFactor: [1, .35, .1], alphaMode: glass ? 'BLEND' : 'OPAQUE', pbrMetallicRoughness: { baseColorFactor: [.12, .12, .12, glass ? .2 : 1] } },
        { pbrMetallicRoughness: { baseColorFactor: [.05, .1, .9, 1] } },
        { pbrMetallicRoughness: { baseColorFactor: [.5, .5, .5, 1] } },
        { pbrMetallicRoughness: { baseColorFactor: [.5, .5, .5, 1] } },
      ];
      (json.meshes as { primitives: { material?: number }[] }[]).forEach((mesh, index) => { mesh.primitives[0]!.material = index; });
    } });
  const loaded = await loadStandardGlb(bytes, glass ? 'glass-lamp' : 'opaque-lamp', signal);
  const shadeMesh = loaded.meshes[0];
  if (!shadeMesh || shadeMesh.sourceNight !== 'emitter' || (shadeMesh.sourceGlass === true) !== glass || !shadeMesh.aim)
    throw new Error('Generated lamp material classification or beam direction was not retained');
  return loaded.meshes;
}
function GlassLampSample({ meshes, label, night, marker, emitting }: { meshes: readonly PreparedMesh[]; label: string; night: boolean; marker: boolean; emitting: boolean }) {
  const [failure, setFailure] = useState('');
  const projection = useMemo(() => makeProjection({ yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 },
    { min: [-.8, -.1, -1.6], max: [1.7, 1.1, 1.6] }, { width: 320, height: 300 }, 0), []);
  const shade = meshes[0]!, markerMesh = meshes[1]!;
  const point = (x: number, z: number) => projection.project(x, .5, z).slice(0, 2).join(',');
  return <section data-glass-lamp={label} data-marker={point(.5, -.2)} data-front={point(1.35, 1.5)} data-back={point(-.45, -1.5)}><h2>{label}</h2><MeshLayer meshes={meshes} projection={projection}
    rules={{ visibleFloors: 'all', clipY: null }} currentFloorId={null} selectedOccurrenceId={null} contextOccurrenceIds={[]}
    tints={new Map()} hidden={false} sourceColors ambient={.4} twoSided light={[0, 0, 1]}
    hiddenKeys={marker ? new Set() : new Set([markerMesh.meshKey])}
    glazingKeys={shade.sourceGlass ? new Set([shade.meshKey]) : new Set()}
    emitterKeys={emitting ? new Set([shade.meshKey]) : new Set()}
    daylight={{ direct: night ? 0 : 1, night, lamp: night ? 1 : 0, tint: night ? [.5, .5, .5] : [1, 1, 1], sunTint: [1, 1, 1], lampTint: [1, 1, 1] }}
    onUnavailable={setFailure} /><output>{failure}</output></section>;
}
function GlassLampFixture() {
  const [glass, setGlass] = useState<readonly PreparedMesh[] | null>(null), [opaque, setOpaque] = useState<readonly PreparedMesh[] | null>(null);
  const [failure, setFailure] = useState(''), [marker, setMarker] = useState(true), [emitting, setEmitting] = useState(true);
  useEffect(() => { const controller = new AbortController();
    void Promise.all([lampGlassMeshes(true, controller.signal), lampGlassMeshes(false, controller.signal)]).then(([a, b]) => { setGlass(a); setOpaque(b); }).catch(error => { if (!controller.signal.aborted) setFailure(String(error)); });
    return () => controller.abort(); }, []);
  return <><output>{failure}</output><button id="lamp-marker" aria-pressed={marker} onClick={() => setMarker(value => !value)}>Toggle marker</button>
    <button id="lamp-emission" aria-pressed={emitting} onClick={() => setEmitting(value => !value)}>Toggle emission</button>
    {glass && opaque && <main>{[[glass, 'glass-day', false], [opaque, 'opaque-day', false], [glass, 'glass-night', true], [opaque, 'opaque-night', true]].map(([meshes, label, night]) =>
      <GlassLampSample key={label as string} meshes={meshes as readonly PreparedMesh[]} label={label as string} night={night as boolean} marker={marker} emitting={emitting} />)}</main>}</>;
}

// Four otherwise identical fictional surfaces isolate the scalar in the
// production shader. The final surface exercises the shader's default fallback.
function ScalarSample({ factor, metallic, glass, legacy }: { factor: number; metallic: number; glass: boolean; legacy: boolean }) {
  const [failure, setFailure] = useState('');
  const meshes = useMemo(() => {
    // Give the translucent pane enough dark body to remain distinct from the
    // clear background at every scalar, without hiding its reflection response.
    const color = [glass ? .02 : .06, glass ? .02 : .06, glass ? .02 : .06, glass ? .5 : 1] as const;
    return prepareMeshes([{ meshKey: 'scalar', floorId: null, occurrenceId: null, sourceBaseColor: color,
      ...(glass ? { sourceNight: 'glazing' as const } : {}),
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
      sourceMaterial: { baseColor: color, metallic, roughness: .35, doubleSided: true, scalarOnly: true,
        ...(legacy ? {} : { specular: factor, hasSpecular: true }) } }]);
  }, [factor, metallic, glass, legacy]);
  const projection = useMemo(() => makeProjection({ yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 },
    { min: [-.1, -.1, -.1], max: [1.1, 1.1, .1] }, { width: 320, height: 300 }, 0), []);
  // The glass shader raises the reflected-light alignment to power 600 and
  // multiplies it by 3. A small offset reduces clipping that can compress the
  // encoded midpoint and endpoint into nearly the same pixel value.
  const light: [number, number, number] = glass ? [.08, 0, .99679486] : [0, 0, 1];
  return <section><h2>{legacy ? 'Shader fallback' : `Specular ${factor}`}</h2><MeshLayer meshes={meshes} projection={projection}
    rules={{ visibleFloors: 'all', clipY: null }} currentFloorId={null} selectedOccurrenceId={null} contextOccurrenceIds={[]}
    tints={new Map()} hidden={false} sourceColors sourceMaterials ambient={.2} twoSided light={light}
    glazingKeys={glass ? new Set(['scalar']) : new Set()}
    daylight={{ direct: 1, night: false, lamp: 0, tint: [1, 1, 1], sunTint: [1, 1, 1], lampTint: [1, 1, 1] }}
    onUnavailable={setFailure} /><output>{failure}</output></section>;
}
function ScalarFixture({ mode }: { mode: string }) {
  const glass = mode === 'glass' || mode === 'glass-metal', metallic = mode === 'metal' || mode === 'glass-metal' ? 1 : mode === 'mixed' ? .5 : 0;
  return <main>{[0, .5, 1, 1].map((factor, index) => <ScalarSample key={index} factor={factor} metallic={metallic}
    glass={glass} legacy={index === 3} />)}</main>;
}

function Fixture() {
  const [mesh, setMesh] = useState<PreparedMesh | null>(null), [failure, setFailure] = useState('');
  useEffect(() => { const controller = new AbortController(); void (async () => {
    try { const fixture = await generatedMaterialGlb(64); const loaded = await loadStandardGlb(fixture.bytes, 'generated-visual', controller.signal, undefined, { embeddedPngMaterials: true });
      controller.signal.throwIfAborted(); setMesh(loaded.meshes[0]!);
    } catch (error) { if (!controller.signal.aborted) setFailure(String(error)); }
  })(); return () => controller.abort(); }, []);
  return <><output>{failure}</output>{mesh ? new URLSearchParams(location.search).has('glass') ? <GlassFixture mesh={mesh} /> : <main><Sample title="Base colour, normal and metallic/roughness" mesh={mesh} />
    <Sample title="Selected" mesh={mesh} selected /><Sample title="Dimmed" mesh={mesh} dim={.65} /><Sample title="Ghost" mesh={mesh} ghost /></main> : <p>Preparing generated samples…</p>}</>;
}
const query = new URLSearchParams(location.search), scalar = query.get('scalar');
createRoot(document.getElementById('root')!).render(query.has('lamp-glass') ? <GlassLampFixture /> : scalar ? <ScalarFixture mode={scalar} /> : query.has('lamps') ? <LampFixture /> : <Fixture />);
