import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MeshLayer } from '../../src/lantern/canonical-ifc/MeshLayer';
import { makeProjection, type PreparedMesh } from '../../src/lantern/canonical-ifc/geometry';
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
function Fixture() {
  const [mesh, setMesh] = useState<PreparedMesh | null>(null), [failure, setFailure] = useState('');
  useEffect(() => { const controller = new AbortController(); void (async () => {
    try { const fixture = await generatedMaterialGlb(64); const loaded = await loadStandardGlb(fixture.bytes, 'generated-visual', controller.signal, undefined, { embeddedPngMaterials: true });
      controller.signal.throwIfAborted(); setMesh(loaded.meshes[0]!);
    } catch (error) { if (!controller.signal.aborted) setFailure(String(error)); }
  })(); return () => controller.abort(); }, []);
  return <><output>{failure}</output>{mesh ? <main><Sample title="Base colour, normal and metallic/roughness" mesh={mesh} />
    <Sample title="Selected" mesh={mesh} selected /><Sample title="Dimmed" mesh={mesh} dim={.65} /><Sample title="Ghost" mesh={mesh} ghost /></main> : <p>Preparing generated samples…</p>}</>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
