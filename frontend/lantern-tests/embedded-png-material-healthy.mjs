// Explicit generated positive cases. No browser, socket, native host, private
// model, external transport, security controls or automatic test discovery.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
assert.equal(process.version, 'v26.10.0');
globalThis.fetch = () => { throw new Error('Generated material tests forbid external fetch'); };
const cases = ['slots', 'image-sharing', 'png-filters', 'png-adam7', 'accounting-1024', 'four-maps-1024', 'legacy-geometry', 'gpu-owner', 'precedence'];
assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--case'); assert(cases.includes(process.argv[3]), 'Select one explicit healthy case');
const selected = process.argv[3], frontend = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-embedded-material-'));
let h;
try {
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(join(frontend, 'lantern-tests/embedded-png-material-fixture.ts'))};\n`
    + [['standard-glb', 'loadStandardGlb'], ['glb-preflight', 'readGlbContainer,preflightGltf,STANDARD_GLB_LIMITS'], ['embedded-png-material', 'admitRgbPng,decodeRgbPng,admitEmbeddedPngMaterials,rgbaMipBytes,EMBEDDED_PNG_LIMITS'],
      ['geometry', 'prepareMeshes,makeProjection,sourceMeshColor,pick'], ['gpu-budget', 'materialGpuResources'], ['mesh-appearance', 'writeAppearance,STATE_FLOATS,MeshPass']].map(([file, names]) => `export { ${names} } from ${JSON.stringify(join(frontend, 'src/lantern/canonical-ifc/' + file))};`).join('\n'));
  const built = await build({ root: frontend, configFile: false, logLevel: 'silent',
    build: { write: false, target: 'node26', lib: { entry, formats: ['es'] }, rolldownOptions: { external: ['react/jsx-runtime'], output: { codeSplitting: false } }, minify: false } });
  const output = Array.isArray(built) ? built[0] : built;
  const path = join(scratch, 'case.mjs'); writeFileSync(path, output.output.find(row => row.type === 'chunk' && row.isEntry).code
    .replaceAll(JSON.stringify('react/jsx-runtime'), JSON.stringify(pathToFileURL(join(frontend, 'node_modules/react/jsx-runtime.js')).href)));
  h = await import(pathToFileURL(path).href);
} finally { rmSync(scratch, { recursive: true, force: true }); }
const signal = () => new AbortController().signal;
const load = async size => { const fixture = await h.generatedMaterialGlb(size), original = fixture.bytes.slice();
  const loaded = await h.loadStandardGlb(fixture.bytes, 'generated', signal(), undefined, { embeddedPngMaterials: true });
  assert.deepEqual(fixture.bytes, original, 'material admission and loading preserve the supplied GLB bytes'); return { fixture, loaded }; };
if (selected === 'png-filters' || selected === 'png-adam7') {
  for (const filter of [0, 1, 2, 3, 4]) {
    const generated = await h.generatedRgbPng(9, 7, selected === 'png-adam7', filter, 0, filter % 2 === 0);
    const admitted = h.admitRgbPng(generated.png), decoded = await h.decodeRgbPng(admitted, signal());
    assert.equal(decoded.width, 9); assert.equal(decoded.height, 7); assert.deepEqual(decoded.rgba, generated.rgba);
    assert(admitted.scratchBytes <= h.EMBEDDED_PNG_LIMITS.scratch);
  }
} else if (selected === 'accounting-1024') {
  const { fixture, loaded } = await load(1024), container = h.readGlbContainer(fixture.bytes);
  const plain = h.preflightGltf(container), plan = h.admitEmbeddedPngMaterials(container, plain);
  assert.equal(plan.images.length, 3); assert.equal(plan.rgbaBytes, 12_582_912);
  assert.equal(plan.images.reduce((n, image) => n + image.mipBytes, 0), 16_777_212);
  assert.equal(h.rgbaMipBytes(1024, 1024), 5_592_404);
  assert.equal(plan.attributeBytes, 3 * 36 * 2); assert.equal(plan.expandedAttributeBytes, 3 * 36 * 2);
  assert.equal(plan.preparedBytes, plain.work.outputBytes + plan.attributeBytes + plan.expandedAttributeBytes + plan.encodedBytes + plan.rgbaBytes + plan.scratchBytes);
  assert.equal(loaded.work.outputBytes, plan.preparedBytes);
  assert.equal(loaded.work.gpuBytes, plain.work.triangles * 72 + plan.expandedAttributeBytes + 16_777_212);
  assert.equal(h.materialGpuResources(loaded.meshes, true).bytes, loaded.work.gpuBytes);
  assert(plan.encodedBytes <= 4_194_304 && plan.scratchBytes <= 8_388_608 && plan.preparedBytes <= 100_663_296 && plan.gpuBytes <= 67_108_864);
} else if (selected === 'four-maps-1024') {
  // More images than one material's three slots; the tier budget, not a count, decides.
  const fixture = await h.generatedMaterialGlb(1024, false, 4), container = h.readGlbContainer(fixture.bytes);
  const plain = h.preflightGltf(container), plan = h.admitEmbeddedPngMaterials(container, plain);
  assert.equal(plan.images.length, 4); assert.equal(plan.rgbaBytes, 4 * 4_194_304);
  assert.equal(plan.gpuBytes, plain.work.triangles * 72 + plan.expandedAttributeBytes + 4 * h.rgbaMipBytes(1024, 1024));
  const loaded = await h.loadStandardGlb(fixture.bytes, 'four-maps', signal(), undefined, { embeddedPngMaterials: true });
  assert.equal(h.materialGpuResources(loaded.meshes, true).bytes, loaded.work.gpuBytes);
  assert.throws(() => h.admitEmbeddedPngMaterials(container, plain, { ...h.STANDARD_GLB_LIMITS, gpuBytes: 16 * 1_048_576 }),
    /needs 2\d\.\d MiB of GPU memory \(4 texture resources 21\.3 MiB, geometry 0\.0 MiB\); this quality tier allows 16\.0 MiB/);
} else if (selected === 'image-sharing') {
  const fixture = await h.generatedMaterialGlb(3, true), container = h.readGlbContainer(fixture.bytes);
  const plain = h.preflightGltf(container), plan = h.admitEmbeddedPngMaterials(container, plain);
  assert.equal(plan.images.length, 1); assert.equal(plan.rgbaBytes, 3 * 5 * 4);
  const loaded = await h.loadStandardGlb(fixture.bytes, 'sharing', signal(), undefined, { embeddedPngMaterials: true });
  const m = loaded.meshes[0].sourceMaterial;
  assert.strictEqual(m.baseColorTexture.image, m.normalTexture.image);
  assert.strictEqual(m.normalTexture, m.metallicRoughnessTexture);
  assert.notStrictEqual(m.baseColorTexture, m.normalTexture, 'sRGB and data roles require distinct GPU resources');
  assert.equal(h.materialGpuResources(loaded.meshes, true).textures.size, 2);
  assert.equal(plan.gpuBytes, plain.work.triangles * 72 + plan.expandedAttributeBytes + 2 * h.rgbaMipBytes(3, 5));
} else if (selected === 'slots') {
  const { fixture, loaded } = await load(3);
  assert.equal(loaded.meshes.length, 4);
  const first = loaded.meshes[0], material = first.sourceMaterial;
  assert.deepEqual(material.baseColor, [.8, .6, .4, 1]); assert.equal(material.metallic, .3); assert.equal(material.roughness, .7); assert.equal(material.doubleSided, true);
  assert.equal(material.baseColorTexture.colorRole, 'srgb'); assert.equal(material.normalTexture.colorRole, 'data'); assert.equal(material.metallicRoughnessTexture.colorRole, 'data');
  for (const [slot, at] of [['baseColorTexture', 0], ['normalTexture', 1], ['metallicRoughnessTexture', 2]]) assert.deepEqual(material[slot].image.rgba, fixture.images[at].rgba);
  assert.strictEqual(loaded.meshes[2].sourceMaterial, material, 'reused node keeps exact owner resources');
  assert.equal(first.vertices.byteLength, 72); assert.equal(first.materialVertices.byteLength, 108);
  assert.deepEqual(Array.from(first.materialVertices.slice(0, 2)), [0, 0]);
  assert.deepEqual(Array.from(loaded.meshes[2].materialVertices).filter((_, i) => i % 9 < 2), [0, 0, 0, 1, 1, 0], 'UVs follow the existing reflected winding');
  for (let corner = 0; corner < 3; corner++) {
    assert.equal(loaded.meshes[2].materialVertices[corner * 9 + 8], -1);
    assert(Math.abs(loaded.meshes[2].materialVertices[corner * 9 + 4] + 1) < 1e-6);
  }
  assert.equal(loaded.meshes[1].sourceMaterial, undefined, 'untextured primitive retains legacy appearance');
  assert.deepEqual(loaded.meshes[1].sourceBaseColor, [.2, .4, .6, .25], 'untextured BLEND retains its original factor');
} else if (selected === 'legacy-geometry') {
  const { fixture, loaded } = await load(3), plain = await h.loadStandardGlb(fixture.bytes, 'generated', signal());
  assert.deepEqual(loaded.drawn, plain.drawn); assert.deepEqual(loaded.counts, plain.counts);
  for (let i = 0; i < plain.meshes.length; i++) { assert.deepEqual(loaded.meshes[i].vertices, plain.meshes[i].vertices); assert.deepEqual(loaded.meshes[i].bounds, plain.meshes[i].bounds); assert.equal(plain.meshes[i].sourceMaterial, undefined); assert.equal(plain.meshes[i].materialVertices, undefined); }
  const projection = h.makeProjection({ yaw: 15, pitch: 35, zoom: 1, panX: 0, panY: 0 }, { min: [0, 0, 0], max: [6, 3, 1] }, { width: 640, height: 480 }, 0);
  for (let x = 10; x < 640; x += 23) for (let y = 10; y < 480; y += 29) assert.deepEqual(h.pick(loaded.meshes, projection, { visibleFloors: 'all', clipY: null }, x, y), h.pick(plain.meshes, projection, { visibleFloors: 'all', clipY: null }, x, y));
  assert.equal(h.materialGpuResources(plain.meshes, false).bytes, plain.counts.triangles * 72);
} else if (selected === 'gpu-owner') {
  // One reservation per mesh set: each exact image/colour-role pair once, before any GPU resource exists.
  const { loaded } = await load(3), reservation = h.materialGpuResources(loaded.meshes, true);
  assert.equal(reservation.textures.size, 3, 'shared nodes reserve each exact texture resource once');
  assert.deepEqual([...reservation.textures.values()].map(texture => texture.colorRole).sort(), ['data', 'data', 'srgb']);
  assert.equal(reservation.bytes, loaded.work.gpuBytes);
  assert.equal(h.materialGpuResources(loaded.meshes, false).textures.size, 0, 'callers without materials reserve no textures');
} else {
  // Per-mesh state table read by the shaders: source maps never displace selection or cutaway.
  const { loaded } = await load(3), meshes = loaded.meshes, first = meshes[0];
  const props = { rules: { visibleFloors: 'all', clipY: null }, currentFloorId: null, selectedOccurrenceId: null, contextOccurrenceIds: [], tints: new Map(),
    sourceColors: true, sourceMaterials: true, twoSided: true, ghosts: new Map([[first.meshKey, null]]),
    ...(selected === 'precedence' ? { selectedKeys: new Set([first.meshKey]) } : {}) };
  const table = new Float32Array(meshes.length * h.STATE_FLOATS), frame = h.writeAppearance(meshes, props, table);
  const at = (index, offset) => table[index * h.STATE_FLOATS + offset];
  const textured = meshes.map((_, index) => at(index, 24));
  assert.deepEqual(textured, selected === 'precedence' ? [0, 0, 1, 0] : [1, 0, 1, 0], 'textured primitives use their maps unless selected');
  assert.equal(at(1, 7), 1, 'untextured BLEND keeps its source colour on the plain path');
  assert.equal(at(0, 21), 1, 'the cutaway is flagged for the veil pass, which never samples source maps');
  assert(frame.ghosts && frame.passes.has(h.MeshPass.Unbound));
  if (selected === 'precedence') assert.deepEqual([at(0, 0), at(0, 1), at(0, 2)].map(v => Math.round(v * 255)), [255, 210, 94], 'explicit selection takes the lantern tone');
}
console.log(`PASS ${selected}: generated embedded-PNG material contract; no browser/GPU pixel or device qualification`);
