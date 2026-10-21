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
const cases = ['slots', 'image-sharing', 'png-filters', 'png-adam7', 'accounting-1024', 'legacy-geometry', 'gpu-owner', 'precedence'];
assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--case'); assert(cases.includes(process.argv[3]), 'Select one explicit healthy case');
const selected = process.argv[3], frontend = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-embedded-material-'));
let h;
try {
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(join(frontend, 'lantern-tests/embedded-png-material-fixture.ts'))};\nexport { resetEffects, runEffects } from ${JSON.stringify(join(frontend, 'lantern-tests/embedded-material-react.mjs'))};\n`
    + [['standard-glb', 'loadStandardGlb'], ['glb-preflight', 'readGlbContainer,preflightGltf'], ['embedded-png-material', 'admitRgbPng,decodeRgbPng,admitEmbeddedPngMaterials,rgbaMipBytes,EMBEDDED_PNG_LIMITS'],
      ['geometry', 'prepareMeshes,makeProjection,sourceMeshColor,pick'], ['MeshLayer', 'MeshLayer,materialGpuResources']].map(([file, names]) => `export { ${names} } from ${JSON.stringify(join(frontend, 'src/lantern/canonical-ifc/' + file))};`).join('\n'));
  const built = await build({ root: frontend, configFile: false, logLevel: 'silent', resolve: { alias: [{ find: /^react$/, replacement: join(frontend, 'lantern-tests/embedded-material-react.mjs') }] },
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
} else {
  const { loaded } = await load(3);
  // Execute the actual MeshLayer effect/draw/cleanup against a generated GL
  // recorder. This validates upload and precedence calls, not GPU pixels.
  const state = { next: 0, shaders: [], buffers: [], textures: [], deletedTextures: [], deletedBuffers: [], uploads: [], draws: [], uniforms: {}, attributes: new Map(), frames: new Map(), bound: null, textureUnit: 0 };
  const constants = ['NO_ERROR','VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','ARRAY_BUFFER','STATIC_DRAW','FLOAT','TRIANGLES','TEXTURE0','TEXTURE_2D','TEXTURE_MAG_FILTER','TEXTURE_MIN_FILTER','LINEAR','LINEAR_MIPMAP_LINEAR','TEXTURE_WRAP_S','TEXTURE_WRAP_T','REPEAT','RGBA','RGBA8','SRGB8_ALPHA8','UNSIGNED_BYTE','MAX_TEXTURE_IMAGE_UNITS','MAX_TEXTURE_SIZE','UNPACK_FLIP_Y_WEBGL','UNPACK_PREMULTIPLY_ALPHA_WEBGL','UNPACK_COLORSPACE_CONVERSION_WEBGL','NONE','COLOR_BUFFER_BIT','DEPTH_BUFFER_BIT','DEPTH_TEST','LEQUAL','CULL_FACE','BLEND','POLYGON_OFFSET_FILL','ONE','ONE_MINUS_SRC_ALPHA'];
  const gl = Object.fromEntries(constants.map((name, i) => [name, i]));
  for (const name of ['viewport','clearColor','clearDepth','depthMask','clear','enable','depthFunc','disable','useProgram','enableVertexAttribArray','disableVertexAttribArray','vertexAttrib2f','vertexAttrib3f','vertexAttrib4f','polygonOffset','blendFunc','attachShader','linkProgram','compileShader','pixelStorei','texParameteri','generateMipmap']) gl[name] = () => {};
  gl.createShader = kind => { const shader = { id: ++state.next, kind }; state.shaders.push(shader); return shader; };
  gl.shaderSource = (shader, text) => { shader.source = text; };
  gl.getShaderParameter = gl.getProgramParameter = () => true; gl.createProgram = () => ({ id: ++state.next });
  gl.getAttribLocation = (_, name) => ({ position: 0, normal: 1, materialUv: 2, shadingNormal: 3, materialTangent: 4 })[name];
  gl.getUniformLocation = (_, name) => name;
  for (const name of ['uniform1f','uniform1i','uniform2f','uniform3f','uniform4f']) gl[name] = (key, ...values) => { state.uniforms[key] = values; };
  gl.createBuffer = () => { const b = { id: ++state.next }; state.buffers.push(b); return b; }; gl.bindBuffer = (_, b) => { state.bound = b; };
  gl.bufferData = (_, data) => { state.bound.data = data; }; gl.vertexAttribPointer = (at, size, type, normalized, stride, offset) => state.attributes.set(at, { size, stride, offset });
  gl.createTexture = () => { const t = { id: ++state.next }; state.textures.push(t); return t; }; gl.bindTexture = (_, t) => { state.boundTexture = t; };
  gl.activeTexture = value => { state.textureUnit = value - gl.TEXTURE0; };
  gl.texImage2D = (...args) => state.uploads.push({ texture: state.boundTexture, args });
  gl.getParameter = key => key === gl.MAX_TEXTURE_IMAGE_UNITS ? 16 : key === gl.MAX_TEXTURE_SIZE ? 4096 : 0;
  gl.getError = () => gl.NO_ERROR; gl.isContextLost = () => false;
  gl.deleteTexture = t => state.deletedTextures.push(t); gl.deleteBuffer = b => state.deletedBuffers.push(b); gl.deleteShader = gl.deleteProgram = () => {};
  gl.drawArrays = () => state.draws.push({ material: state.uniforms.useMaterial?.[0], hasBase: state.uniforms.hasBase?.[0], hasNormal: state.uniforms.hasNormal?.[0], hasMetalRough: state.uniforms.hasMetalRough?.[0], alpha: state.uniforms.alpha?.[0], factor: state.uniforms.materialFactor, metallic: state.uniforms.metallicFactor?.[0], roughness: state.uniforms.roughnessFactor?.[0], position: state.attributes.get(0), normal: state.attributes.get(1) });
  const contexts = [], canvas = { width: 1, height: 1, clientWidth: 640, clientHeight: 480, addEventListener() {}, removeEventListener() {}, getContext(kind) { contexts.push(kind); return gl; } };
  const saved = new Map(['document','window','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { document: { hidden: false, addEventListener() {}, removeEventListener() {} }, window: { devicePixelRatio: 1 }, ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame(fn) { const id = ++state.next; state.frames.set(id, fn); return id; }, cancelAnimationFrame(id) { state.frames.delete(id); } });
  try {
    const meshes = loaded.meshes, first = meshes[0];
    const props = { meshes, projection: h.makeProjection({ yaw: 15, pitch: 35, zoom: 1, panX: 0, panY: 0 }, { min: [0, 0, 0], max: [6, 3, 1] }, { width: 640, height: 480 }, 0),
      rules: { visibleFloors: 'all', clipY: null }, currentFloorId: null, selectedOccurrenceId: null, contextOccurrenceIds: [], tints: new Map(), hidden: false,
      sourceColors: true, sourceMaterials: true, twoSided: true, ghosts: new Map([[first.meshKey, null]]), onUnavailable(message) { assert.fail(message); } };
    if (selected === 'precedence') props.selectedKeys = new Set([first.meshKey]);
    h.resetEffects(canvas); h.MeshLayer(props); const cleanups = h.runEffects();
    for (const fn of state.frames.values()) fn(); state.frames.clear();
    assert.deepEqual(contexts, ['webgl2']); assert.equal(state.textures.length, 3, 'shared nodes upload each exact texture resource once');
    assert.equal(state.uploads[0].args[2], gl.SRGB8_ALPHA8); assert.equal(state.uploads[1].args[2], gl.RGBA8); assert.equal(state.uploads[2].args[2], gl.RGBA8);
    assert.equal(state.uploads[0].args[3], 3); assert.equal(state.uploads[0].args[4], 5);
    assert(state.draws.length >= meshes.length + 1);
    const textured = state.draws.filter(draw => draw.material === 1); assert.equal(textured.length, selected === 'precedence' ? 1 : 2);
    assert(textured.every(draw => draw.hasBase === 1 && draw.hasNormal === 1 && draw.hasMetalRough === 1 && draw.metallic === .3 && draw.roughness === .7));
    assert(state.draws.every(draw => draw.position.stride === 24 && draw.normal.stride === 24 && draw.normal.offset === 12));
    assert.equal(state.draws[1].material, 0, 'untextured BLEND stays on the legacy shader path');
    assert.equal(state.draws[1].alpha, 1, 'legacy BLEND continues rendering opaque');
    assert.equal(state.draws.at(-1).material, 0, 'ghost precedence disables source maps');
    if (selected === 'precedence') assert.equal(state.draws[0].material, 0, 'explicit selection precedes source material');
    assert(state.shaders.every(shader => shader.source.startsWith('#version 300 es\n')));
    assert(state.shaders.some(shader => shader.source.includes('roughnessFactor*mr.g') && shader.source.includes('metallicFactor*mr.b')));
    for (const cleanup of cleanups) cleanup();
    assert.deepEqual(state.deletedTextures, state.textures); assert.equal(new Set(state.deletedTextures).size, 3);
    assert.equal(state.deletedBuffers.length, state.buffers.length); assert.equal(state.frames.size, 0);
  } finally { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
}
console.log(`PASS ${selected}: generated embedded-PNG material contract; no browser/GPU pixel or device qualification`);
