import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { admitInViewer } from '../src/admission.mjs';
import { bakeOverview } from '../src/bake.mjs';
import { readAccessor, readGlb, writeGlb } from '../src/glb.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Generated house-like master: an exact room-pick box and slab, a dense flat
 * wall (structure), a dense sphere (context) drawn by two nodes and clipped
 * terrain exported as triangle soup with sub-millimetre seams (context).
 * Options add an unused mesh before the slab, an accessor nothing reads, and
 * node `semanticRole` extras. */
export function syntheticMaster({ dead = false, unusedMesh = false, extras = false } = {}) {
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
  // Gently sloped terrain, 100 x 100 cells, every triangle with its own three
  // vertices and corners jittered by up to 0.05 mm, as cell-clipped exports are.
  const soup = [], soupIndices = [], m = 100, jitter = (i, j, k) => ((i * 7919 + j * 104729 + k * 1299709) % 101 - 50) * 1e-6;
  const ground = (i, j, k) => [-5 + 20 * i / m + jitter(i, j, k), -0.5 + 0.02 * i + jitter(j, i, k), 5 + 20 * j / m + jitter(k, j, i)];
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++)
    for (const tri of [[[i, j], [i + 1, j], [i + 1, j + 1]], [[i, j], [i + 1, j + 1], [i, j + 1]]])
      tri.forEach(([x, z], k) => { soup.push(...ground(x, z, k)); soupIndices.push(soupIndices.length); });

  const named = [
    ['RoomPick', primitive(box, boxIndices), 'room-pick'],
    ...(unusedMesh ? [['Retired', primitive(box, boxIndices), null]] : []),
    ['Slab', primitive(slab, [0, 2, 1, 0, 3, 2]), 'slab'],
    ['Wall', primitive(wall, wallIndices), 'structure'],
    ['Lamp', primitive(sphere, sphereIndices, normals), 'context'],
    ['Terrain', primitive(soup, soupIndices), 'context'],
  ];
  if (dead) add(new Float32Array(1024), 'VEC3', 5126);
  const meshIndex = name => named.findIndex(([n]) => n === name);
  const role = name => named[meshIndex(name)][2];
  const node = (name, extra = {}) => ({ mesh: meshIndex(name), name, ...extra, ...(extras ? { extras: { semanticRole: role(name) } } : {}) });
  const json = {
    asset: { version: '2.0', generator: 'synthetic' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'House', children: [1, 2, 3, 4, 5, 6] }, node('RoomPick'), node('Slab'), node('Wall'),
      { ...node('Lamp'), name: 'LampA', translation: [1, 1.5, 1] }, { ...node('Lamp'), name: 'LampB', translation: [3, 1.5, 2] }, node('Terrain')],
    meshes: named.map(([name, p]) => ({ name, primitives: [p] })), accessors, bufferViews: views, buffers: [{ byteLength: length }],
  };
  const bin = new Uint8Array(length); let at = 0;
  for (const part of parts) { bin.set(part, at); at += part.byteLength; }
  const glb = writeGlb(json, bin);
  const binding = (name, nodeIndex) => ({ artifactId: 'model', nodeIndex, meshIndex: meshIndex(name), primitiveIndices: [0],
    buildingId: 'b', levelIds: ['l0'], spaceOccurrenceId: role(name) === 'room-pick' ? 'o1' : null, role: role(name) });
  const companion = { profile: 'houseatlas.unified-atlas-publication.v1', original: { sha256: sha256(glb), bytes: glb.byteLength },
    meshBindings: [binding('RoomPick', 1), binding('Slab', 2), binding('Wall', 3), binding('Lamp', 4), binding('Lamp', 5), binding('Terrain', 6)] };
  return { glb, companion };
}

const mesh = (glb, name) => { const { json } = readGlb(glb); return json.meshes.findIndex(m => m.name === name); };
const positionsOf = (glb, name) => { const { json, bin } = readGlb(glb); return readAccessor(json, bin, json.meshes[mesh(glb, name)].primitives[0].attributes.POSITION); };
const trianglesOf = (glb, name) => { const { json, bin } = readGlb(glb); return readAccessor(json, bin, json.meshes[mesh(glb, name)].primitives[0].indices).length / 3; };
const drawnTriangles = glb => {
  const { json, bin } = readGlb(glb);
  return json.nodes.filter(node => node.mesh !== undefined)
    .reduce((sum, node) => sum + readAccessor(json, bin, json.meshes[node.mesh].primitives[0].indices).length / 3, 0);
};
const row = (result, name) => result.report.primitives.find(p => p.name === name);

test('bakes to the budget with one shared error and locked footprints', async () => {
  const { glb, companion } = syntheticMaster();
  const before = drawnTriangles(glb);
  assert.ok(before > 100_000, `master has ${before} drawn triangles`);
  const result = await bakeOverview(glb, companion, { triangles: 20_000 });
  const after = drawnTriangles(result.glb);
  assert.ok(after <= 20_000, `overview has ${after} drawn triangles`);
  assert.equal(after, result.report.overview.drawnTriangles);
  assert.ok(result.report.contextErrorMetres > 0 && result.report.contextErrorMetres < 0.05);

  // Same nodes, meshes and primitive slots, so companion selectors stay valid.
  const master = readGlb(glb).json, baked = readGlb(result.glb).json;
  assert.deepEqual(baked.nodes, master.nodes);
  assert.deepEqual(baked.meshes.map(m => [m.name, m.primitives.length]), master.meshes.map(m => [m.name, m.primitives.length]));

  // Room-pick and slab keep their exact positions and triangles.
  for (const name of ['RoomPick', 'Slab']) {
    assert.deepEqual(positionsOf(result.glb, name), positionsOf(glb, name));
    assert.equal(row(result, name).changed, false); assert.equal(row(result, name).bakedTriangles, row(result, name).triangles);
  }
  // The flat wall loses nearly all its triangles at a sub-millimetre error.
  assert.ok(result.report.structureErrorMetres < 0.001);
  assert.ok(row(result, 'Wall').bakedTriangles < 28_800 / 20);
  // The terrain soup collapses once its seams are welded.
  assert.ok(row(result, 'Terrain').bakedTriangles < 20_000 / 5, `terrain kept ${row(result, 'Terrain').bakedTriangles}`);

  // Simplification keeps source vertices: every baked position is a master position.
  for (const name of ['Wall', 'Lamp', 'Terrain']) {
    const source = new Set(), positions = positionsOf(glb, name), out = positionsOf(result.glb, name);
    for (let v = 0; v < positions.length; v += 3) source.add(`${positions[v]},${positions[v + 1]},${positions[v + 2]}`);
    for (let v = 0; v < out.length; v += 3) assert.ok(source.has(`${out[v]},${out[v + 1]},${out[v + 2]}`));
  }
  // Untextured simplified primitives keep positions only; the viewer derives flat normals.
  assert.deepEqual(Object.keys(baked.meshes[mesh(result.glb, 'Lamp')].primitives[0].attributes), ['POSITION']);

  // The companion pins the overview bytes; bindings are unchanged.
  assert.deepEqual(result.companion.original, { sha256: sha256(result.glb), bytes: result.glb.byteLength });
  assert.deepEqual(result.companion.meshBindings, companion.meshBindings);

  // The installed viewer's own preflight admits the overview.
  const work = await admitInViewer(result.glb);
  assert.equal(work.triangles, after);
});

test('keeps a master that already fits as authored and drops what nothing reads', async () => {
  const { glb, companion } = syntheticMaster({ dead: true, unusedMesh: true });
  const result = await bakeOverview(glb, companion, { triangles: 1_000_000 });
  assert.equal(result.report.contextErrorMetres, 0);
  assert.ok(result.report.primitives.every(p => !p.changed));
  // The unused mesh is gone, later mesh indices shift down and the bindings follow them.
  assert.deepEqual(result.report.unusedMeshesDropped, [1]);
  const baked = readGlb(result.glb).json;
  assert.deepEqual(baked.meshes.map(m => m.name), ['RoomPick', 'Slab', 'Wall', 'Lamp', 'Terrain']);
  assert.deepEqual(baked.nodes.filter(n => n.mesh !== undefined).map(n => baked.meshes[n.mesh].name), ['RoomPick', 'Slab', 'Wall', 'Lamp', 'Lamp', 'Terrain']);
  assert.deepEqual(result.companion.meshBindings.map(b => baked.meshes[b.meshIndex].name), ['RoomPick', 'Slab', 'Wall', 'Lamp', 'Lamp', 'Terrain']);
  // Every remaining accessor is read, so the dead accessor and its bytes are gone.
  assert.ok(result.report.overview.binBytes < result.report.master.binBytes - 1024 * 4);
  for (const name of ['RoomPick', 'Slab', 'Wall', 'Lamp', 'Terrain']) {
    assert.deepEqual(positionsOf(result.glb, name), positionsOf(glb, name));
    assert.equal(trianglesOf(result.glb, name), trianglesOf(glb, name));
  }
  await admitInViewer(result.glb);
});

test('reads roles from node extras when there is no companion', async () => {
  const { glb } = syntheticMaster({ extras: true });
  const result = await bakeOverview(glb, null, { triangles: 20_000 });
  assert.equal(result.report.rolesFrom, 'node-extras');
  assert.equal(result.companion, null);
  for (const name of ['RoomPick', 'Slab']) {
    assert.equal(row(result, name).role, name === 'Slab' ? 'slab' : 'room-pick');
    assert.deepEqual(positionsOf(result.glb, name), positionsOf(glb, name));
  }
  assert.equal(row(result, 'Wall').role, 'structure');
  assert.ok(drawnTriangles(result.glb) <= 20_000);
});

test('refuses a companion that pins other bytes and a budget it cannot meet', async () => {
  const { glb, companion } = syntheticMaster();
  await assert.rejects(bakeOverview(glb, { ...companion, original: { sha256: '0'.repeat(64), bytes: 1 } }), /does not pin/);
  await assert.rejects(bakeOverview(glb, companion, { triangles: 10, maxError: 0.001 }), /Cannot reach 10 triangles/);
});
