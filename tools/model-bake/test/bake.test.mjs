import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { admitInViewer } from '../src/admission.mjs';
import { bakeOverview } from '../src/bake.mjs';
import { readAccessor, readGlb, writeGlb } from '../src/glb.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Generated house-like master: an exact room-pick box and slab, a dense flat
 * wall (structure), and a dense sphere (context) drawn by two nodes. */
export function syntheticMaster({ orphan = false } = {}) {
  const parts = [], accessors = [], views = [];
  let length = 0;
  const add = (array, type, componentType, extra = {}) => {
    const bytes = new Uint8Array(array.buffer.slice(0));
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.byteLength });
    parts.push(bytes); length += bytes.byteLength;
    accessors.push({ bufferView: views.length - 1, componentType, count: array.length / { SCALAR: 1, VEC3: 3 }[type], type, ...extra });
    return accessors.length - 1;
  };
  const bounds = positions => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    positions.forEach((v, i) => { min[i % 3] = Math.min(min[i % 3], v); max[i % 3] = Math.max(max[i % 3], v); });
    return { min, max };
  };
  const primitive = (positions, indices, normals) => {
    const p = Float32Array.from(positions);
    const attributes = { POSITION: add(p, 'VEC3', 5126, bounds(p)) };
    if (normals) attributes.NORMAL = add(Float32Array.from(normals), 'VEC3', 5126);
    return { attributes, indices: add(Uint32Array.from(indices), 'SCALAR', 5125), mode: 4 };
  };
  // Room-pick box 4 x 3 x 2.6 m.
  const box = [0, 0, 0, 4, 0, 0, 4, 0, 3, 0, 0, 3, 0, 2.6, 0, 4, 2.6, 0, 4, 2.6, 3, 0, 2.6, 3];
  const boxIndices = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  const slab = [0, -0.2, 0, 4, -0.2, 0, 4, -0.2, 3, 0, -0.2, 3];
  // Flat wall grid: 120 x 120 cells in the X/Y plane at z = 0.
  const wall = [], wallIndices = [], n = 120;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) wall.push(4 * i / n, 2.6 * j / n, 0);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i; wallIndices.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
  }
  // Sphere with split seam vertices and normals, radius 0.3 m.
  const sphere = [], normals = [], sphereIndices = [], rings = 150, segments = 150;
  for (let r = 0; r <= rings; r++) for (let s = 0; s <= segments; s++) {
    const theta = Math.PI * r / rings, phi = 2 * Math.PI * s / segments;
    const nx = Math.sin(theta) * Math.cos(phi), ny = Math.cos(theta), nz = Math.sin(theta) * Math.sin(phi);
    sphere.push(0.3 * nx, 0.3 * ny, 0.3 * nz); normals.push(nx, ny, nz);
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segments; s++) {
    const a = r * (segments + 1) + s, b = a + segments + 1;
    if (r > 0) sphereIndices.push(a, b, a + 1);
    if (r < rings - 1) sphereIndices.push(a + 1, b, b + 1);
  }
  const meshes = [
    { name: 'RoomPick', primitives: [primitive(box, boxIndices)] },
    { name: 'Slab', primitives: [primitive(slab, [0, 2, 1, 0, 3, 2])] },
    { name: 'Wall', primitives: [primitive(wall, wallIndices)] },
    { name: 'Lamp', primitives: [primitive(sphere, sphereIndices, normals)] },
  ];
  if (orphan) add(new Float32Array(1024), 'VEC3', 5126);
  const json = {
    asset: { version: '2.0', generator: 'synthetic' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'House', children: [1, 2, 3, 4, 5] }, { mesh: 0, name: 'RoomPick' }, { mesh: 1, name: 'Slab' },
      { mesh: 2, name: 'Wall' }, { mesh: 3, name: 'LampA', translation: [1, 1.5, 1] }, { mesh: 3, name: 'LampB', translation: [3, 1.5, 2] }],
    meshes, accessors: orphan ? accessors.slice(0, -1) : accessors, bufferViews: views, buffers: [{ byteLength: length }],
  };
  const bin = new Uint8Array(length); let at = 0;
  for (const part of parts) { bin.set(part, at); at += part.byteLength; }
  const glb = writeGlb(json, bin);
  const binding = (meshIndex, nodeIndex, role) => ({ artifactId: 'model', nodeIndex, meshIndex, primitiveIndices: [0],
    buildingId: 'b', levelIds: ['l0'], spaceOccurrenceId: role === 'room-pick' ? 'o1' : null, role });
  const companion = { profile: 'houseatlas.unified-atlas-publication.v1', original: { sha256: sha256(glb), bytes: glb.byteLength },
    meshBindings: [binding(0, 1, 'room-pick'), binding(1, 2, 'slab'), binding(2, 3, 'structure'), binding(3, 4, 'context'), binding(3, 5, 'context')] };
  return { glb, companion };
}

const primitivePositions = (glb, mesh) => { const { json, bin } = readGlb(glb); return readAccessor(json, bin, json.meshes[mesh].primitives[0].attributes.POSITION); };
const drawnTriangles = glb => {
  const { json, bin } = readGlb(glb);
  return json.nodes.filter(node => node.mesh !== undefined)
    .reduce((sum, node) => sum + readAccessor(json, bin, json.meshes[node.mesh].primitives[0].indices).length / 3, 0);
};

test('bakes to the budget with one shared error and locked footprints', async () => {
  const { glb, companion } = syntheticMaster();
  const before = drawnTriangles(glb);
  assert.ok(before > 100_000, `master has ${before} drawn triangles`);
  const result = await bakeOverview(glb, companion, { triangles: 20_000 });
  const after = drawnTriangles(result.glb);
  assert.ok(after <= 20_000, `overview has ${after} drawn triangles`);
  assert.equal(after, result.report.overview.drawnTriangles);
  assert.ok(result.report.contextErrorMetres > 0 && result.report.contextErrorMetres < 0.05);

  // Same node, mesh and primitive slots, so companion selectors stay valid.
  const master = readGlb(glb).json, baked = readGlb(result.glb).json;
  assert.deepEqual(baked.nodes, master.nodes);
  assert.deepEqual(baked.meshes.map(m => [m.name, m.primitives.length]), master.meshes.map(m => [m.name, m.primitives.length]));

  // Room-pick and slab keep their exact positions and triangles.
  for (const mesh of [0, 1]) {
    assert.deepEqual(primitivePositions(result.glb, mesh), primitivePositions(glb, mesh));
    const row = result.report.primitives.find(p => p.mesh === mesh);
    assert.equal(row.changed, false); assert.equal(row.bakedTriangles, row.triangles);
  }
  // The flat wall loses nearly all its triangles at a sub-millimetre error.
  assert.ok(result.report.structureErrorMetres < 0.001);
  assert.ok(result.report.primitives.find(p => p.mesh === 2).bakedTriangles < 28_800 / 20);

  // Edge collapse keeps source vertices: every baked position is a master position.
  for (const mesh of [2, 3]) {
    const source = new Set(), positions = primitivePositions(glb, mesh), out = primitivePositions(result.glb, mesh);
    for (let v = 0; v < positions.length; v += 3) source.add(`${positions[v]},${positions[v + 1]},${positions[v + 2]}`);
    for (let v = 0; v < out.length; v += 3) assert.ok(source.has(`${out[v]},${out[v + 1]},${out[v + 2]}`));
  }
  // Untextured simplified primitives keep positions only; the viewer derives flat normals.
  assert.deepEqual(Object.keys(baked.meshes[3].primitives[0].attributes), ['POSITION']);

  // The companion pins the overview bytes and nothing else changes.
  assert.deepEqual(result.companion.original, { sha256: sha256(result.glb), bytes: result.glb.byteLength });
  assert.deepEqual(result.companion.meshBindings, companion.meshBindings);

  // The installed viewer's own preflight admits the overview.
  const work = await admitInViewer(result.glb);
  assert.equal(work.triangles, after);
});

test('leaves a master that already fits unchanged apart from dropping orphan bytes', async () => {
  const { glb, companion } = syntheticMaster({ orphan: true });
  const result = await bakeOverview(glb, companion, { triangles: 1_000_000 });
  assert.equal(result.report.contextErrorMetres, 0);
  assert.ok(result.report.primitives.every(p => !p.changed));
  assert.equal(result.report.masterOrphanBytesDropped, 1024 * 4); assert.equal(result.report.replacedBytesDropped, 0);
  assert.equal(readGlb(result.glb).bin.byteLength, readGlb(glb).bin.byteLength - 1024 * 4);
  for (const mesh of [0, 1, 2, 3]) assert.deepEqual(primitivePositions(result.glb, mesh), primitivePositions(glb, mesh));
  await admitInViewer(result.glb);
});

test('refuses a companion that pins other bytes and a budget it cannot meet', async () => {
  const { glb, companion } = syntheticMaster();
  await assert.rejects(bakeOverview(glb, { ...companion, original: { sha256: '0'.repeat(64), bytes: 1 } }), /does not pin/);
  await assert.rejects(bakeOverview(glb, companion, { triangles: 10, maxError: 0.001 }), /Cannot reach 10 triangles/);
});
