import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MeshLayer } from '../../src/lantern/canonical-ifc/MeshLayer';
import { makeProjection, prepareMeshes, type PreparedMesh } from '../../src/lantern/canonical-ifc/geometry';
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
createRoot(document.getElementById('root')!).render(<Fixture />);
