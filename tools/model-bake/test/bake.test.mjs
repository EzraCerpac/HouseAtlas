import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { admitInViewer, bindInViewer } from '../src/admission.mjs';
import { bakeDetail, bakeOverview } from '../src/bake.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localMatrix, maxScale, multiply, readAccessor, readGlb, writeGlb } from '../src/glb.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Generated house-like master: an exact room-pick box and slab, a dense flat
 * wall (structure), a dense sphere (context) drawn by two nodes and clipped
 * terrain exported as triangle soup with sub-millimetre seams (context).
 * Options add an unused mesh before the slab, an accessor nothing reads, and
 * node `semanticRole` extras; `thin` adds a house chain and garden gravel, both
 * made of separate 5 mm cubes, a strip thinner than the weld distance, and a
 * patch whose many slivers weld away. */
export function syntheticMaster({ dead = false, unusedMesh = false, extras = false, thin = false } = {}) {
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

  // Separate 5 mm cubes: 40 chain links on a line, 60 gravel stones on the ground.
  const cubes = (count, at) => {
    const positions = [], indices = [];
    for (let c = 0; c < count; c++) {
      const [x, y, z] = at(c), base = positions.length / 3;
      for (let k = 0; k < 8; k++) positions.push(x + (box[k * 3] ? 0.005 : 0), y + (box[k * 3 + 1] ? 0.005 : 0), z + (box[k * 3 + 2] ? 0.005 : 0));
      indices.push(...boxIndices.map(i => base + i));
    }
    return [positions, indices];
  };
  // A 1 m strip 0.1 mm wide: welding at 0.5 mm folds every triangle away.
  const sliver = () => {
    const positions = [], indices = [];
    for (let i = 0; i <= 20; i++) positions.push(1 + i * 0.05, 2, 0.5, 1 + i * 0.05, 2, 0.5001);
    for (let i = 0; i < 20; i++) indices.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
    return [positions, indices];
  };
  // A flat 10 x 10 grid (200 triangles) plus 1,800 slivers shorter than the weld:
  // welding leaves 200 triangles, yet the floor is a hundredth of all 2,000.
  const fringe = () => {
    const positions = [], indices = [];
    for (let j = 0; j <= 10; j++) for (let i = 0; i <= 10; i++) positions.push(3 + i * 0.05, 0.5 + j * 0.05, 2.5);
    for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) { const a = j * 11 + i; indices.push(a, a + 1, a + 12, a, a + 12, a + 11); }
    for (let k = 0; k < 1800; k++) {
      const base = positions.length / 3, x = 3 + (k % 40) * 0.0125, y = 0.5 + Math.floor(k / 40) * 0.0111;
      positions.push(x, y, 2.6, x + 0.0001, y, 2.6, x, y + 0.0001, 2.6);
      indices.push(base, base + 1, base + 2);
    }
    return [positions, indices];
  };
  const named = [
    ['RoomPick', primitive(box, boxIndices), 'room-pick'],
    ...(unusedMesh ? [['Retired', primitive(box, boxIndices), null]] : []),
    ['Slab', primitive(slab, [0, 2, 1, 0, 3, 2]), 'slab'],
    ['Wall', primitive(wall, wallIndices), 'structure'],
    ['Lamp', primitive(sphere, sphereIndices, normals), 'context'],
    ['Terrain', primitive(soup, soupIndices), 'context'],
    ...(thin ? [['Chain', primitive(...cubes(40, c => [2, 1 + c * 0.012, 1])), 'context'],
      ['Sliver', primitive(...sliver()), 'context'],
      ['Fringe', primitive(...fringe()), 'context'],
      ['Gravel', primitive(...cubes(60, c => [-4 + (c % 10) * 0.3, -0.45, 6 + Math.floor(c / 10) * 0.3])), 'context']] : []),
  ];
  if (dead) add(new Float32Array(1024), 'VEC3', 5126);
  const meshIndex = name => named.findIndex(([n]) => n === name);
  const role = name => named[meshIndex(name)][2];
  // Terrain is site context: bound to no level.
  const levelIds = name => ['Terrain', 'Gravel'].includes(name) ? [] : ['l0'];
  const node = (name, extra = {}) => ({ mesh: meshIndex(name), name, ...extra, ...(extras ? { extras: { semanticRole: role(name), levelIds: levelIds(name) } } : {}) });
  const json = {
    asset: { version: '2.0', generator: 'synthetic' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'House', children: thin ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [1, 2, 3, 4, 5, 6] }, node('RoomPick'), node('Slab'), node('Wall'),
      { ...node('Lamp'), name: 'LampA', translation: [1, 1.5, 1] }, { ...node('Lamp'), name: 'LampB', translation: [3, 1.5, 2] }, node('Terrain'),
      ...(thin ? [node('Chain'), node('Sliver'), node('Fringe'), node('Gravel')] : [])],
    meshes: named.map(([name, p]) => ({ name, primitives: [p] })), accessors, bufferViews: views, buffers: [{ byteLength: length }],
  };
  const bin = new Uint8Array(length); let at = 0;
  for (const part of parts) { bin.set(part, at); at += part.byteLength; }
  const glb = writeGlb(json, bin);
  const binding = (name, nodeIndex) => ({ artifactId: 'model', nodeIndex, meshIndex: meshIndex(name), primitiveIndices: [0],
    buildingId: 'b', levelIds: levelIds(name), spaceOccurrenceId: role(name) === 'room-pick' ? 'o1' : null, role: role(name) });
  const companion = { profile: 'houseatlas.unified-atlas-publication.v1', original: { sha256: sha256(glb), bytes: glb.byteLength },
    meshBindings: [binding('RoomPick', 1), binding('Slab', 2), binding('Wall', 3), binding('Lamp', 4), binding('Lamp', 5), binding('Terrain', 6),
      ...(thin ? [binding('Chain', 7), binding('Sliver', 8), binding('Fringe', 9), binding('Gravel', 10)] : [])] };
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
const trianglesIn = glb => { const { json } = readGlb(glb); return json.meshes.flatMap(m => m.primitives).reduce((sum, p) => sum + json.accessors[p.indices].count / 3, 0); };
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
  const welding = result.report.weldDisplacementMetres;
  assert.ok(Math.abs(welding - 0.0005 * Math.sqrt(3)) < 1e-12);
  assert.ok(result.report.structureErrorMetres - welding < 0.001);
  assert.ok(row(result, 'Wall').bakedTriangles < 28_800 / 20);
  // The terrain soup collapses once its seams are welded; as site context it takes four times the error.
  assert.equal(row(result, 'Terrain').site, true); assert.equal(row(result, 'Lamp').site, false);
  assert.ok(Math.abs((result.report.siteErrorMetres - welding) - (result.report.contextErrorMetres - welding) * 4) < 1e-12);
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
  assert.equal(row(result, 'Terrain').site, true); assert.equal(row(result, 'Lamp').site, false);
  assert.ok(drawnTriangles(result.glb) <= 20_000);
});

test('refuses a companion that pins other bytes and a budget it cannot meet', async () => {
  const { glb, companion } = syntheticMaster();
  await assert.rejects(bakeOverview(glb, { ...companion, original: { sha256: '0'.repeat(64), bytes: 1 } }), /does not pin/);
  await assert.rejects(bakeOverview(glb, companion, { triangles: 10, maxError: 0.001 }), /Cannot reach 10 triangles/);
  // Welding alone may move a vertex 0.87 mm, more than a 0.5 mm cap allows.
  await assert.rejects(bakeOverview(glb, companion, { triangles: 20_000, maxError: 0.0005 }), /leaves no room under --max-error/);
});

test('never empties a primitive, even when whole parts are below the error', async () => {
  const { glb, companion } = syntheticMaster({ thin: true });
  const result = await bakeOverview(glb, companion, { triangles: 1_450, maxError: 0.5 });
  // The viewer refuses an empty buffer view, so every primitive keeps at least
  // four triangles (or all of them), house chain and garden gravel included.
  for (const p of result.report.primitives) assert.ok(p.bakedTriangles >= Math.min(4, p.triangles), `${p.name} kept ${p.bakedTriangles}`);
  assert.ok(result.report.contextErrorMetres > 0.005, `bake error ${result.report.contextErrorMetres} m is above the 5 mm parts`);
  assert.ok(row(result, 'Chain').changed && row(result, 'Gravel').changed);
  assert.ok(trianglesOf(result.glb, 'Sliver') >= 4);
  // The floor is a hundredth of the authored 2,000 triangles, not of what welding left.
  assert.ok(row(result, 'Fringe').bakedTriangles >= 20, `Fringe kept ${row(result, 'Fringe').bakedTriangles}`);
  await admitInViewer(result.glb);
});

test('bounds world stretch under a rotation inside a nonuniform scale', () => {
  const parent = localMatrix({ scale: [2, 1, 1] }), child = localMatrix({ rotation: [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)] });
  assert.ok(Math.abs(maxScale(multiply(parent, child)) - 2) < 1e-9);
  assert.ok(Math.abs(maxScale(localMatrix({ scale: [0.5, 3, 1], rotation: [0.2, 0.3, 0.1, Math.sqrt(1 - 0.14)] })) - 3) < 1e-9);
});

test('the command line never overwrites its inputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'model-bake-'));
  try {
    const { glb, companion } = syntheticMaster();
    writeFileSync(join(dir, 'model.glb'), glb); writeFileSync(join(dir, 'atlas-scene.json'), JSON.stringify(companion));
    const cli = new URL('../bake.mjs', import.meta.url).pathname;
    assert.throws(() => execFileSync(process.execPath, [cli, '--model', join(dir, 'model.glb'), '--companion', join(dir, 'atlas-scene.json'),
      '--out', dir, '--triangles', '20000'], { stdio: 'pipe' }), /already exists/);
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'model.glb'))), glb);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** A flat 60 x 60 textured panel whose U wobbles along x (a non-affine
 * mapping), beside a dense untextured relief wall that sets the bake error. */
function texturedMaster() {
  const parts = [], accessors = [], views = [];
  let length = 0;
  const add = (array, type, componentType, extra = {}) => {
    const bytes = new Uint8Array(array.buffer.slice(0));
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.byteLength });
    parts.push(bytes); length += (bytes.byteLength + 3) & ~3;
    accessors.push({ bufferView: views.length - 1, componentType, count: array.length / { SCALAR: 1, VEC2: 2, VEC3: 3 }[type], type, ...extra });
    return accessors.length - 1;
  };
  const grid = (n, at, uv) => {
    const positions = [], uvs = [], indices = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { positions.push(...at(i / n, j / n)); uvs.push(...uv(i / n, j / n)); }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; indices.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1); }
    return { positions: Float32Array.from(positions), uvs: Float32Array.from(uvs), indices: Uint32Array.from(indices) };
  };
  const minMax = p => ({ min: [0, 1, 2].map(k => Math.min(...p.filter((_, i) => i % 3 === k))), max: [0, 1, 2].map(k => Math.max(...p.filter((_, i) => i % 3 === k))) });
  const panel = grid(60, (x, y) => [x * 2, y * 2, 1], (x, y) => [x + 0.05 * Math.sin(x * 40), y]);
  // Gentle 5 mm relief, so the bake error lands in millimetres.
  const wall = grid(120, (x, y) => [x * 4, y * 2.6, 0.005 * Math.sin(x * 40) * Math.sin(y * 40)], () => [0, 0]);
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const meshes = [
    { name: 'Panel', primitives: [{ attributes: { POSITION: add(panel.positions, 'VEC3', 5126, minMax([...panel.positions])), TEXCOORD_0: add(panel.uvs, 'VEC2', 5126) },
      indices: add(panel.indices, 'SCALAR', 5125), material: 0, mode: 4 }] },
    { name: 'Wall', primitives: [{ attributes: { POSITION: add(wall.positions, 'VEC3', 5126, minMax([...wall.positions])) }, indices: add(wall.indices, 'SCALAR', 5125), mode: 4 }] },
  ];
  views.push({ buffer: 0, byteOffset: length, byteLength: png.byteLength }); parts.push(png); length += (png.byteLength + 3) & ~3;
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }], nodes: [{ mesh: 0, name: 'Panel' }, { mesh: 1, name: 'Wall' }], meshes,
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }], textures: [{ source: 0 }], images: [{ bufferView: views.length - 1, mimeType: 'image/png' }],
    accessors, bufferViews: views, buffers: [{ byteLength: length }] };
  const bin = new Uint8Array(length); let at = 0;
  for (const part of parts) { bin.set(part, at); at += (part.byteLength + 3) & ~3; }
  return writeGlb(json, bin);
}

test('keeps textured primitives as authored', async () => {
  const glb = texturedMaster();
  const result = await bakeOverview(glb, null, { triangles: 8_000 });
  // The flat panel would cost no position error, yet its UVs are non-affine.
  assert.equal(row(result, 'Panel').changed, false);
  assert.equal(trianglesOf(result.glb, 'Panel'), trianglesOf(glb, 'Panel'));
  const { json, bin } = readGlb(result.glb), master = readGlb(glb);
  const uv = (g, at) => readAccessor(g.json, g.bin, g.json.meshes[0].primitives[0].attributes[at]);
  assert.deepEqual(uv({ json, bin }, 'TEXCOORD_0'), uv(master, 'TEXCOORD_0'));
  assert.equal(json.images.length, 1);
  assert.ok(row(result, 'Wall').changed);
});

/** The frontend's generated unified Atlas publication (three buildings, split
 * levels, shared slabs, rooms on two floors, overlays), loaded the way the
 * lantern tests load it. */
async function syntheticAtlas() {
  const file = new URL('../../../frontend/lantern-tests/unified-atlas/synthetic-atlas.ts', import.meta.url);
  const { transformWithOxc } = await import(createRequire(new URL('../../../frontend/package.json', import.meta.url)).resolve('vite'));
  const { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname, { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  const { buildSyntheticAtlas } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const { glb, companionBytes } = await buildSyntheticAtlas({ workspaceId: '00000000-0000-4000-8000-000000000800', homeId: '00000000-0000-4000-8000-000000000801' });
  return { glb, companion: JSON.parse(new TextDecoder().decode(companionBytes)) };
}

/** Splits every triangle into four, `times` times, in place: the same nodes,
 * meshes and primitive slots with 4^times the triangles, so the bake has real
 * work on a publication whose selectors must still bind. */
function densify(glb, times) {
  const { json, bin } = readGlb(glb), parts = [], accessors = [], views = [];
  let length = 0;
  const add = (array, type, componentType, extra = {}) => {
    const bytes = new Uint8Array(array.buffer.slice(0));
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.byteLength });
    parts.push(bytes); length += bytes.byteLength;
    accessors.push({ bufferView: views.length - 1, componentType, count: array.length / { SCALAR: 1, VEC3: 3 }[type], type, ...extra });
    return accessors.length - 1;
  };
  for (const mesh of json.meshes) mesh.primitives = mesh.primitives.map(primitive => {
    const positions = [...readAccessor(json, bin, primitive.attributes.POSITION)];
    let indices = [...readAccessor(json, bin, primitive.indices)];
    for (let round = 0; round < times; round++) {
      const midpoints = new Map(), next = [];
      const mid = (a, b) => {
        const key = a < b ? `${a}/${b}` : `${b}/${a}`;
        if (!midpoints.has(key)) { midpoints.set(key, positions.length / 3); for (let c = 0; c < 3; c++) positions.push((positions[a * 3 + c] + positions[b * 3 + c]) / 2); }
        return midpoints.get(key);
      };
      for (let t = 0; t < indices.length; t += 3) {
        const [a, b, c] = indices.slice(t, t + 3), ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      }
      indices = next;
    }
    const { min, max } = json.accessors[primitive.attributes.POSITION];
    return { ...primitive, attributes: { POSITION: add(Float32Array.from(positions), 'VEC3', 5126, { min, max }) }, indices: add(Uint32Array.from(indices), 'SCALAR', 5125) };
  });
  const out = new Uint8Array(length); let at = 0;
  for (const part of parts) { out.set(part, at); at += part.byteLength; }
  return writeGlb({ ...json, accessors, bufferViews: views, buffers: [{ byteLength: length }] }, out);
}

// Selection, floors and exploded views key off these: the same primitive slots,
// roles, buildings, levels and pick occurrences, in the same order.
const identity = model => model.parts.map(part => [part.mesh.meshKey, part.role, part.buildingId, part.levelIds, part.levelId, part.occurrenceId]);
const boundTriangles = model => model.parts.reduce((sum, part) => sum + part.mesh.triangles, 0);

test('a baked publication binds in the viewer with every identity intact', async () => {
  const atlas = await syntheticAtlas(), glb = densify(atlas.glb, 3);
  const companion = { ...atlas.companion, original: { sha256: sha256(glb), bytes: glb.byteLength } };
  const before = await bindInViewer(glb, companion);
  const result = await bakeOverview(glb, companion, { triangles: Math.floor(trianglesIn(glb) * 0.6) });
  // Room-pick and slab parts are locked; structure, roof and context are simplified.
  assert.ok(result.report.primitives.filter(p => p.changed).length >= 5, 'the bake simplified the densified parts');
  // The baked companion is a new revision: it pins the new bytes and nothing else changes.
  assert.deepEqual({ ...result.companion, original: null }, { ...companion, original: null });
  const after = await bindInViewer(result.glb, result.companion);
  assert.deepEqual(identity(after), identity(before));
  assert.deepEqual([...after.selectable].sort(), [...before.selectable].sort());
  assert.deepEqual([...after.pickParts.keys()].sort(), [...before.pickParts.keys()].sort());
  assert.deepEqual([...after.levelsByBuilding.entries()], [...before.levelsByBuilding.entries()]);
  // Room-pick primitives are locked, so picking hits exactly the authored shapes.
  for (const [occurrence, parts] of before.pickParts) assert.deepEqual(after.pickParts.get(occurrence).map(part => part.mesh.triangles), parts.map(part => part.mesh.triangles));
  // An unclaimed primitive is refused, not drawn without identity.
  await assert.rejects(bindInViewer(result.glb, { ...result.companion, meshBindings: result.companion.meshBindings.slice(1) }));
});

test('the detail keeps every master triangle and binds with the overview companion', async () => {
  const atlas = await syntheticAtlas(), glb = densify(atlas.glb, 3);
  const companion = { ...atlas.companion, original: { sha256: sha256(glb), bytes: glb.byteLength } };
  const overview = await bakeOverview(glb, companion, { triangles: Math.floor(trianglesIn(glb) * 0.6) });
  const detail = await bakeDetail(glb, companion);
  assert.equal(trianglesIn(detail.glb), trianglesIn(glb));
  // One companion serves both tiers: the detail differs only in its own pin.
  assert.deepEqual({ ...detail.companion, original: null }, { ...overview.companion, original: null });
  const light = await bindInViewer(overview.glb, overview.companion);
  const full = await bindInViewer(overview.glb, overview.companion, detail.glb);
  assert.deepEqual(identity(full), identity(light));
  assert.deepEqual([...full.selectable].sort(), [...light.selectable].sort());
  assert.ok(boundTriangles(full) > boundTriangles(light), 'the Full tier draws the unsimplified master');
  assert.equal(boundTriangles(full), detail.drawnTriangles);
  assert.equal(boundTriangles(await bindInViewer(glb, companion)), detail.drawnTriangles);
});

/** Adds float vertex attributes (all 0.5) to a mesh's first primitive, the
 * way exporters write vertex colours and spare UV sets. */
function paint(glb, name, attributes) {
  const { json, bin } = readGlb(glb), primitive = json.meshes[mesh(glb, name)].primitives[0];
  const count = json.accessors[primitive.attributes.POSITION].count, parts = [bin];
  let length = (bin.byteLength + 3) & ~3;
  for (const [attribute, type] of Object.entries(attributes)) {
    const values = new Float32Array(count * { VEC2: 2, VEC4: 4 }[type]).fill(0.5), bytes = new Uint8Array(values.buffer);
    json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.byteLength });
    json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5126, count, type });
    primitive.attributes[attribute] = json.accessors.length - 1;
    parts.push({ at: length, bytes }); length += bytes.byteLength;
  }
  const out = new Uint8Array(length); out.set(bin);
  for (const part of parts.slice(1)) out.set(part.bytes, part.at);
  json.buffers = [{ byteLength: length }];
  return writeGlb(json, out);
}

test('drops vertex attributes the server refuses, also where nothing is simplified', async () => {
  const glb = paint(paint(texturedMaster(), 'Wall', { COLOR_0: 'VEC4', TEXCOORD_0: 'VEC2' }), 'Panel', { COLOR_0: 'VEC4', TEXCOORD_1: 'VEC2' });
  const detail = await bakeDetail(glb, null), { json } = readGlb(detail.glb);
  const attributes = name => Object.keys(json.meshes[mesh(detail.glb, name)].primitives[0].attributes).sort();
  // An untextured primitive keeps only its position; a textured one keeps its UVs.
  assert.deepEqual(attributes('Wall'), ['POSITION']);
  assert.deepEqual(attributes('Panel'), ['POSITION', 'TEXCOORD_0']);
  assert.deepEqual(row(detail, 'Wall').droppedAttributes, ['COLOR_0', 'TEXCOORD_0']);
  assert.deepEqual(row(detail, 'Panel').droppedAttributes, ['COLOR_0', 'TEXCOORD_1']);
  for (const name of ['Wall', 'Panel']) {
    assert.deepEqual(positionsOf(detail.glb, name), positionsOf(glb, name));
    assert.equal(trianglesOf(detail.glb, name), trianglesOf(glb, name));
  }
});

test('folds vertex colours into the material colour before dropping them', async () => {
  const glb = paint(paint(texturedMaster(), 'Wall', { COLOR_0: 'VEC4' }), 'Panel', { COLOR_0: 'VEC4' });
  for (const result of [await bakeDetail(glb, null), await bakeOverview(glb, null)]) {
    const { json } = readGlb(result.glb), material = name => json.materials[json.meshes[mesh(result.glb, name)].primitives[0].material];
    // No material: the colour alone. A textured material keeps its map, now tinted.
    assert.deepEqual(material('Wall').pbrMetallicRoughness, { baseColorFactor: [0.5, 0.5, 0.5, 1] });
    assert.deepEqual(material('Panel').pbrMetallicRoughness, { baseColorTexture: { index: 0 }, baseColorFactor: [0.5, 0.5, 0.5, 1] });
    assert.deepEqual(row(result, 'Wall').foldedVertexColour, [0.5, 0.5, 0.5]);
  }
});

test('weighs folded vertex colours by area and reads normalized bytes', async () => {
  // Two triangles of area 1/2 (green) and 3/2 (red), each sharing no vertex.
  const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 3, 0, 1, 0, 1, 1]);
  const colours = Uint8Array.from([0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
  const bin = new Uint8Array(positions.byteLength + colours.byteLength);
  bin.set(new Uint8Array(positions.buffer)); bin.set(colours, positions.byteLength);
  const glb = writeGlb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.5] } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, material: 0 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 6, type: 'VEC3', min: [0, 0, 0], max: [3, 1, 1] },
      { bufferView: 1, componentType: 5121, normalized: true, count: 6, type: 'VEC4' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }, { buffer: 0, byteOffset: positions.byteLength, byteLength: colours.byteLength }],
    buffers: [{ byteLength: bin.byteLength }] }, bin);
  const { json } = readGlb((await bakeDetail(glb, null)).glb);
  // Alpha stays the material's own: the viewer draws opaque surfaces.
  assert.deepEqual(json.materials[json.meshes[0].primitives[0].material].pbrMetallicRoughness.baseColorFactor, [0.75, 0.25, 0, 0.5]);
  assert.deepEqual(Object.keys(json.meshes[0].primitives[0].attributes), ['POSITION']);
});

test('the Full tier admits what the overview refuses', async () => {
  // 700,000 triangles over one shared triangle: over the overview's 600,000.
  const triangles = 700_000, positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices = new Uint32Array(triangles * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i % 3;
  const bin = new Uint8Array(positions.byteLength + indices.byteLength);
  bin.set(new Uint8Array(positions.buffer)); bin.set(new Uint8Array(indices.buffer), positions.byteLength);
  const glb = writeGlb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }, { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength }],
    buffers: [{ byteLength: bin.byteLength }] }, bin);
  await assert.rejects(admitInViewer(glb), /geometry/);
  assert.equal((await admitInViewer(glb, 'detail')).triangles, triangles);
});

test('the command line writes the detail beside the overview', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'model-bake-'));
  try {
    const atlas = await syntheticAtlas(), glb = densify(atlas.glb, 2);
    writeFileSync(join(dir, 'master.glb'), glb);
    writeFileSync(join(dir, 'master.json'), JSON.stringify({ ...atlas.companion, original: { sha256: sha256(glb), bytes: glb.byteLength } }));
    const out = join(dir, 'out'), cli = new URL('../bake.mjs', import.meta.url).pathname;
    execFileSync(process.execPath, [cli, '--model', join(dir, 'master.glb'), '--companion', join(dir, 'master.json'), '--out', out, '--detail',
      '--triangles', String(Math.floor(trianglesIn(glb) * 0.6))], { stdio: 'pipe' });
    assert.deepEqual(readdirSync(out).sort(), ['atlas-scene.json', 'bake-report.json', 'detail.glb', 'model.glb']);
    const report = JSON.parse(readFileSync(join(out, 'bake-report.json'), 'utf8')), detail = readFileSync(join(out, 'detail.glb'));
    // The report carries the publication.json `detail` pin.
    assert.deepEqual({ file: report.detail.file, contentType: report.detail.contentType, sha256: report.detail.sha256, bytes: report.detail.bytes },
      { file: 'detail.glb', contentType: 'model/gltf-binary', sha256: sha256(detail), bytes: detail.byteLength });
    assert.equal(report.detail.viewerBinding.boundPrimitives, report.viewerBinding.boundPrimitives);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
