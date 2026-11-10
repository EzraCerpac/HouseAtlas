// Generated CPU geometry and observational-counter contracts only. No browser,
// GPU, listener, native state or household input is exercised.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseAst, transformWithOxc } from 'vite';

const frameFile = new URL('../src/lantern/canonical-ifc/after-next-frame.ts', import.meta.url);
const frameCode = (await transformWithOxc(readFileSync(frameFile, 'utf8'), frameFile.pathname,
  { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false })).code;
const { afterNextFrame } = await import('data:text/javascript;base64,' + Buffer.from(frameCode).toString('base64'));

// Controlled browser scheduling ports exercise the actual scene-yield owner.
// No browser, GPU, wall-clock wait or real MessageChannel is needed.
test('scene yields settle and release scheduling owners when hidden or abandoned', async () => {
  const names = ['document', 'requestAnimationFrame', 'cancelAnimationFrame', 'MessageChannel'];
  const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const doc = new EventTarget(), frames = new Map(), messages = [];
  let next = 0, ports = 0;
  doc.hidden = false;
  Object.assign(globalThis, {
    document: doc,
    requestAnimationFrame(callback) { const id = ++next; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    MessageChannel: class {
      constructor() {
        this.port1 = { onmessage: null, close() { ports--; } };
        this.port2 = { close() { ports--; }, postMessage: () => messages.push(() => this.port1.onmessage?.()) };
        ports += 2;
      }
    },
  });
  try {
    const normal = afterNextFrame();
    assert.equal(frames.size, 1);
    frames.values().next().value();
    assert.equal(frames.size, 0);
    assert.equal(ports, 2);
    messages.shift()(); await normal;
    assert.equal(ports, 0, 'both message ports close after a frame');

    const controller = new AbortController(), reason = new Error('scene replaced');
    const abandoned = afterNextFrame(controller.signal);
    assert.equal(frames.size, 1);
    controller.abort(reason);
    await assert.rejects(abandoned, error => error === reason);
    assert.equal(frames.size, 0, 'abort cancels a suspended RAF without needing visibility');
    assert.equal(ports, 0);

    const hidden = afterNextFrame();
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(frames.size, 0, 'hiding replaces a suspended RAF with a message task');
    messages.shift()(); await hidden;
    assert.equal(ports, 0);

    const late = new AbortController(), inTask = afterNextFrame(late.signal);
    assert.equal(ports, 2);
    late.abort(reason);
    await assert.rejects(inTask, error => error === reason);
    assert.equal(ports, 0, 'abort also releases an already queued message');
    messages.shift()();
    doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(ports, 0, 'late callbacks and retired visibility listeners cannot reopen work');
    await assert.rejects(afterNextFrame(late.signal), error => error === reason);
    assert.equal(ports, 0);
  } finally {
    names.forEach((name, index) => originals[index]
      ? Object.defineProperty(globalThis, name, originals[index]) : Reflect.deleteProperty(globalThis, name));
  }
});

/** Parse syntax with the already locked Vite export. Literal/comment text is data,
 * while imports (including dynamic/re-export forms) and require calls are dependencies.
 * This is a source-contract guard, not execution or a sandbox/data-flow proof. */
function runtimeDependencies(source) {
  const dependencies = [];
  const propertyName = node => node?.computed
    ? node.property?.type === 'Literal' ? node.property.value : null
    : node?.property?.name;
  const requireReference = node => node?.type === 'Identifier' ? node.name === 'require'
    : node?.type === 'ChainExpression' || node?.type === 'ParenthesizedExpression' ? requireReference(node.expression)
    : node?.type === 'SequenceExpression' ? requireReference(node.expressions.at(-1))
    : node?.type === 'MemberExpression' ? propertyName(node) === 'require'
      || propertyName(node) === 'resolve' && requireReference(node.object) : false;
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportDeclaration' || node.type === 'ImportExpression'
      || ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source)
      || (node.type === 'CallExpression' && (node.callee?.type === 'Import' || requireReference(node.callee)))) {
      dependencies.push(node.type);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(parseAst(source)); // Parse errors refuse; they are never treated as dependency-free.
  return dependencies;
}

const file = new URL('../src/lantern/canonical-ifc/geometry.ts', import.meta.url);
const { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
  { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
assert.deepEqual(runtimeDependencies(code), [], 'Geometry CPU module must have no runtime dependencies');
const { prepareMeshes } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);

test('dependency guard parses actual syntax and allows literal/comment phase labels', () => {
  const data = [
    'export const phase = "module-import";',
    "const text = 'require(\"./literal.cjs\")'; const other = `import(\"./literal.js\")`;",
    String.raw`const pattern = /require\s*\(/; // import "./comment.js";`,
    '/* require("./comment.cjs"); import("./comment.js"); */ export const value = 1;',
    'export const origin = import.meta.url;',
  ];
  for (const source of data) assert.deepEqual(runtimeDependencies(source), [], source);
  const dependencies = [
    'import "./runtime.js";',
    'import value from "./runtime.js";',
    'import { value } from "./runtime.js";',
    'const value = import("./runtime.js");',
    'export { value } from "./runtime.js";',
    'export * from "./runtime.js";',
    'const value = require("./runtime.cjs");',
    'module.require("./runtime.cjs");',
    'require.resolve("./runtime.cjs");',
    'globalThis["require"]("./runtime.cjs");',
    'require?.("./runtime.cjs");',
    '(0, require)("./runtime.cjs");',
    'const value = `${require("./runtime.cjs")}`;',
  ];
  for (const source of dependencies) assert(runtimeDependencies(source).length > 0, source);
  assert.throws(() => runtimeDependencies('import {'), 'malformed source must refuse');
});

// Frozen pre-optimization implementation from d22eec71488d170509f4cbcad614b7f99789b249,
// geometry.ts SHA256 943ee4a2ae3241c1e4c0fe4d85bfb6c8e3b7f9c0ef74fa82c700ebd5880ce9f1.
function original(meshes, binding = mesh => mesh.occurrenceId) {
  return meshes.map(mesh => {
    const triangles = mesh.indices.length / 3, vertices = new Float32Array(triangles * 18);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const p = mesh.positions, at = (t, corner) => mesh.indices[t * 3 + corner] * 3;
    for (let t = 0; t < triangles; t++) {
      const a = at(t, 0), b = at(t, 1), c = at(t, 2);
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (length > 0) { nx /= length; ny /= length; nz /= length; } else { nx = 0; ny = 1; nz = 0; }
      for (const [corner, index] of [a, b, c].entries()) {
        const o = (t * 3 + corner) * 6;
        vertices[o] = p[index]; vertices[o + 1] = p[index + 1]; vertices[o + 2] = p[index + 2];
        vertices[o + 3] = nx; vertices[o + 4] = ny; vertices[o + 5] = nz;
        for (let axis = 0; axis < 3; axis++) { const v = p[index + axis]; if (v < min[axis]) min[axis] = v; if (v > max[axis]) max[axis] = v; }
      }
    }
    return { meshKey: mesh.meshKey, floorId: mesh.floorId, occurrenceId: binding(mesh), vertices, triangles,
      ...(mesh.sourceBaseColor ? { sourceBaseColor: mesh.sourceBaseColor } : {}),
      yRange: [min[1], max[1]], bounds: { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] } };
  });
}

function mesh(positions, indices, metadata = {}) {
  return { meshKey: 'generated', floorId: null, occurrenceId: null,
    positions: Float32Array.from(positions), indices: Uint32Array.from(indices), ...metadata };
}
function equivalent(inputs, binding) {
  const expected = original(inputs, binding), actual = prepareMeshes(inputs, binding);
  assert.equal(actual.length, expected.length);
  for (let at = 0; at < actual.length; at++) {
    assert.deepEqual(bytes(actual[at].vertices), bytes(expected[at].vertices), 'exact interleaved position/normal bytes');
    assert.deepEqual(actual[at], expected[at], 'identity, colour, order, bounds and range');
  }
  return actual;
}

test('triangle permutations retain winding, corner order and exact flat normal bytes', () => {
  const positions = [-0, 0, 0, 2, 0, 0, 0, 3, 0, 99999, -99999, 99999];
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const prepared = equivalent(permutations.map((indices, at) => mesh(positions, indices, { meshKey: `winding-${at}` })));
  assert.deepEqual(prepared[0].bounds, { min: [-0, 0, 0], max: [2, 3, 0] }, 'unused vertex excluded');
  assert(Object.is(prepared[0].vertices[0], -0), 'signed zero remains in output');
  assert.equal(prepared[0].vertices[5], 1); assert.equal(prepared[1].vertices[5], -1);
});

test('degenerate, empty, small and far-coordinate geometry preserves edge behavior', () => {
  const prepared = equivalent([
    mesh([1, 2, 3], [0, 0, 0]),
    mesh([0, 0, 0, 1, 1, 1, 2, 2, 2], [0, 1, 2]),
    mesh([], []),
    mesh([99999, 99999, 99999], []),
    mesh([0, 0, 0, 1e-38, 0, 0, 0, 1e-38, 0], [0, 1, 2]),
    mesh([-1e6, 1e6, -1e6, -999999.875, 1e6, -1e6, -1e6, 999999.875, -1e6], [0, 2, 1]),
  ]);
  assert.deepEqual([...prepared[0].vertices.slice(3, 6)], [0, 1, 0]);
  assert.deepEqual([...prepared[1].vertices.slice(3, 6)], [0, 1, 0]);
  assert.deepEqual(prepared[2].yRange, [Infinity, -Infinity]);
  assert.deepEqual(prepareMeshes([]), []);
});

test('generated indexed meshes retain byte equivalence across deterministic irregular triangles', () => {
  let state = 0x51ce;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const inputs = Array.from({ length: 128 }, (_, at) => {
    const positions = Array.from({ length: 48 * 3 }, () => (random() - .5) * 2000);
    const indices = Array.from({ length: 64 * 3 }, () => Math.floor(random() * 48));
    return mesh(positions, indices, { meshKey: `generated-${at}`, floorId: at % 2 ? 'level-b' : null,
      occurrenceId: at % 3 ? `occ-${at}` : null,
      ...(at % 2 ? { sourceBaseColor: Object.freeze([0, .25, 1, .5]) } : {}) });
  });
  equivalent(inputs);
});

test('bindings, source colours, input views and independent result buffers remain owned', () => {
  const positions = Float32Array.from([999, 999, 999, -0, 0, 0, 2, 0, 0, 0, 3, 0, 999, 999, 999]);
  const indices = Uint32Array.from([999, 0, 1, 2, 999]);
  const colour = Object.freeze([.1, .2, .3, 0]);
  const input = mesh([], [], { meshKey: 'same-buffer-a', floorId: 'explicit-floor', occurrenceId: 'source-occ',
    sourceBaseColor: colour, positions: positions.subarray(3, 12), indices: indices.subarray(1, 4) });
  const other = { ...input, meshKey: 'same-buffer-b' }, inputs = [input, other];
  const beforePositions = Buffer.from(bytes(positions)), beforeIndices = Buffer.from(bytes(indices));
  const seen = [], bound = prepareMeshes(inputs, value => { seen.push(value); return value === input ? 'bound-occ' : null; });
  assert.deepEqual(seen, inputs); assert.strictEqual(seen[0], input); assert.strictEqual(seen[1], other);
  equivalent(inputs, value => value === input ? 'bound-occ' : null);
  assert.equal(bound[0].occurrenceId, 'bound-occ'); assert.equal(bound[1].occurrenceId, null);
  assert.strictEqual(bound[0].sourceBaseColor, colour); assert.strictEqual(bound[1].sourceBaseColor, colour);
  assert.equal(bound[0].floorId, 'explicit-floor');
  const again = prepareMeshes(inputs), saved = Buffer.from(bytes(bound[1].vertices));
  assert.notStrictEqual(bound[0].vertices.buffer, input.positions.buffer);
  assert.notStrictEqual(bound[0].vertices.buffer, bound[1].vertices.buffer);
  assert.notStrictEqual(bound[0].vertices.buffer, again[0].vertices.buffer);
  bound[0].vertices.fill(42);
  assert.deepEqual(bytes(positions), beforePositions); assert.deepEqual(bytes(indices), beforeIndices);
  assert.deepEqual(bytes(bound[1].vertices), saved); assert.deepEqual(bytes(again[0].vertices), saved);
});

// The actual opt-in diagnostics module is pure: a fake clock and renderer verify
// attribution and hook ownership without compiling a shader or drawing anything.
const observationFile = new URL('../src/lantern/canonical-ifc/scene-build-observation.ts', import.meta.url);
const observationCode = (await transformWithOxc(readFileSync(observationFile, 'utf8'), observationFile.pathname,
  { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false })).code;
assert.deepEqual(runtimeDependencies(observationCode), [], 'Observation module must have no runtime dependencies');
const { SceneBuildObservation } = await import('data:text/javascript;base64,' + Buffer.from(observationCode).toString('base64'));

test('build observations preserve promise/result identity and report inclusive wall phases', async () => {
  let now = 0, complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const marker = {}, calls = [];
  const backend = { createRenderPipeline(...args) { calls.push([this, args]); return marker; } };
  const renderer = { backend, compileAsync(...args) { assert.equal(this, renderer);
    assert.equal(backend.createRenderPipeline(...args), marker); return pending; } };
  const originalCompile = Object.getOwnPropertyDescriptor(renderer, 'compileAsync');
  const originalCreate = Object.getOwnPropertyDescriptor(backend, 'createRenderPipeline');
  const seen = new SceneBuildObservation(() => now);
  seen.phase('module-import'); now = 3; seen.phase('renderer-init');
  const waited = seen.wait(); now = 5; waited(); now = 8;
  seen.watch(renderer); seen.phase('scene-graph'); seen.phase('direct-preparation');
  assert.equal(renderer.compileAsync('synthetic'), pending, 'original promise identity');
  assert.deepEqual(calls, [[backend, ['synthetic']]], 'original this and arguments');
  now = 12; complete(marker); assert.equal(await pending, marker);
  now = 15; seen.finishBuild();
  const finishDraw = seen.firstDraw(); now = 18;
  assert.equal(backend.createRenderPipeline('first draw'), marker);
  finishDraw();
  const report = seen.snapshot(), phase = name => report.phases.find(row => row.name === name);
  assert.equal(report.buildWallMs, 15);
  assert.equal(phase('module-import').wallMs, 3);
  assert.deepEqual([phase('renderer-init').wallMs, phase('renderer-init').waitMs], [5, 2], 'wait is a subset');
  for (const name of ['module-import', 'adapter-and-renderer-construction', 'renderer-init']) {
    assert.deepEqual([phase(name).compileCalls, phase(name).compileWallMs, phase(name).creationRequests],
      [null, null, null], name + ': later hooks cannot make unobserved work zero');
  }
  assert.deepEqual([phase('scene-graph').compileCalls, phase('scene-graph').compileWallMs,
    phase('scene-graph').creationRequests], [0, 0, 0], 'complete hook coverage can truthfully observe zero');
  assert.deepEqual([phase('direct-preparation').wallMs, phase('direct-preparation').compileCalls,
    phase('direct-preparation').compileWallMs, phase('direct-preparation').creationRequests], [7, 1, 4, 1]);
  assert.deepEqual([report.firstDrawCpuMs, report.firstDrawCreationRequests], [3, 1]);
  assert.equal(report.compileCounter, 'observed'); assert.equal(report.creationCounter, 'observed');
  assert.deepEqual(Object.getOwnPropertyDescriptor(renderer, 'compileAsync'), originalCompile);
  assert.deepEqual(Object.getOwnPropertyDescriptor(backend, 'createRenderPipeline'), originalCreate);
  assert.equal(seen.firstDraw(), undefined, 'no second observation or hook installation');
});

test('observation refusals stay unknown and cleanup preserves errors and newer owners', async () => {
  let now = 0;
  const error = new Error('synthetic compiler rejection'), rejected = Promise.reject(error);
  const backend = Object.freeze({ createRenderPipeline() { return 1; } });
  const prototype = { compileAsync() { return rejected; } };
  const renderer = Object.assign(Object.create(prototype), { backend });
  const seen = new SceneBuildObservation(() => now); seen.phase('effect-preparation'); seen.watch(renderer);
  assert.equal(renderer.compileAsync(), rejected);
  now = 4; await assert.rejects(rejected, value => value === error);
  seen.finishBuild(); seen.close();
  assert.equal(Object.hasOwn(renderer, 'compileAsync'), false, 'inherited method restored');
  const report = seen.snapshot();
  assert.equal(report.creationCounter, 'unavailable');
  assert(report.phases.every(row => row.creationRequests === null), 'unsupported is never a zero/cache-hit claim');
  assert.equal(report.firstDrawCpuMs, null, 'no fake rendered frame');
  const another = new SceneBuildObservation(() => now), owned = { compileAsync() { throw error; } };
  another.phase('direct-preparation'); another.watch(owned);
  assert.throws(() => owned.compileAsync(), value => value === error, 'same synchronous error');
  const replacement = () => Promise.resolve();
  owned.compileAsync = replacement; another.close();
  assert.equal(owned.compileAsync, replacement, 'cleanup does not overwrite a newer hook');
  assert.equal(another.snapshot().compileCounter, 'incomplete');
});

test('phase counters remain unknown across a pre-hook segment and the report keeps actions outside scrolling text', async () => {
  let now = 0;
  const seen = new SceneBuildObservation(() => now);
  const backend = { createRenderPipeline() {} }, renderer = { backend, compileAsync: () => Promise.resolve() };
  seen.phase('renderer-init'); now = 2; seen.watch(renderer);
  seen.phase('renderer-init'); now = 4; seen.finishBuild(); seen.close();
  const row = seen.snapshot().phases.find(item => item.name === 'renderer-init');
  assert.equal(row.wallMs, 4);
  assert.deepEqual([row.compileCalls, row.compileWallMs, row.creationRequests], [null, null, null],
    'a partially observed repeated phase stays unknown');

  const reportFile = new URL('../src/lantern/canonical-ifc/render-probe.ts', import.meta.url);
  const reportCode = (await transformWithOxc(readFileSync(reportFile, 'utf8'), reportFile.pathname,
    { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false })).code;
  assert.deepEqual(runtimeDependencies(reportCode), [], 'Report builder must have no runtime dependencies');
  const { showProbeReport } = await import('data:text/javascript;base64,' + Buffer.from(reportCode).toString('base64'));
  const element = tag => ({ tag, style: {}, dataset: {}, children: [], attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...children) { this.children.push(...children); }, addEventListener() {}, remove() {} });
  const body = element('body'), prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { body, createElement: element } });
    showProbeReport('fictional phase observations');
    assert.equal(body.children.length, 1);
    const panel = body.children[0], [text, actions] = panel.children;
    assert.equal(panel.attributes.role, 'dialog');
    assert.match(panel.style.cssText, /max-height:calc\(100vh - 16px\)/);
    assert.match(panel.style.cssText, /max-height:calc\(100dvh - 16px\)/);
    assert.match(panel.style.cssText, /display:flex;flex-direction:column;overflow:hidden/);
    assert.equal(text.tag, 'pre'); assert.equal(text.textContent, 'fictional phase observations');
    assert.match(text.style.cssText, /min-height:0;flex:1 1 auto;overflow:auto/);
    assert.match(actions.style.cssText, /flex:0 0 auto/);
    assert.deepEqual(actions.children.map(item => item.textContent), ['Copy', 'Close']);
    assert(!text.children.length, 'action buttons are not inside the scrolling phase text');
  } finally {
    if (prior) Object.defineProperty(globalThis, 'document', prior); else delete globalThis.document;
  }
});

// Transaction boundaries in the actual helper, using the locked Three CPU
// QuadMesh/NodeMaterial/RendererUtils and explicit synthetic renderer/effects.
// compileAsync below is a controlled promise: no shader, GPU, frame or browser
// is exercised, and these controls establish no prepared-pipeline cache result.
const effectThreeURL = import.meta.resolve('three/webgpu');
const effectThree = await import(effectThreeURL);
const effectFile = new URL('../src/lantern/canonical-ifc/prepare-effect-pipelines.ts', import.meta.url);
const effectCode = (await transformWithOxc(readFileSync(effectFile, 'utf8'), effectFile.pathname,
  { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false })).code;
assert.deepEqual(runtimeDependencies(effectCode), ['ImportDeclaration'], 'Only the locked Three runtime import remains');
assert(effectCode.includes(JSON.stringify('three/webgpu')), 'Expected the actual helper dependency');
const { prepareEffectPipelines, PreparationRefused } = await import('data:text/javascript;base64,'
  + Buffer.from(effectCode.replaceAll(JSON.stringify('three/webgpu'), JSON.stringify(effectThreeURL))).toString('base64'));

function effectDeferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function effectFixture() {
  const state = { target: { name: 'original target' }, cube: 2, mip: 3, ratio: 1.25,
    renderObject: () => {}, mrt: { name: 'original MRT' }, clear: [.1, .2, .3], alpha: .4, scissor: true };
  const cache = new Map();
  const nativeGet = function(target = null, mrt = null, depth = 0) {
    if (!cache.has(target)) cache.set(target, new Map());
    const targets = cache.get(target);
    if (!targets.has(mrt)) targets.set(mrt, new Map());
    const levels = targets.get(mrt);
    if (!levels.has(depth)) levels.set(depth, { target, mrt, depth });
    return levels.get(depth);
  };
  const contexts = Object.create({ get: nativeGet });
  const nodes = Array.from({ length: 4 }, (_, index) => {
    const updateBefore = () => { throw new Error('A real effect update must not run in this fixture'); };
    const node = Object.assign(Object.create({ updateBefore }), { updateBeforeType: `generated-${index}` });
    if (index === 0) Object.defineProperty(node, 'updateBefore', { value: updateBefore, configurable: true, writable: true, enumerable: true });
    return node;
  });
  const materials = Array.from({ length: 4 }, () => {
    const material = new effectThree.NodeMaterial(); material.fragmentNode = { generated: true }; return material;
  });
  const quads = materials.slice(0, 3).map(material => new effectThree.QuadMesh(material));
  quads[0].frustumCulled = false;
  const culling = new Map(quads.map(quad => [quad, quad.frustumCulled]));
  const vertices = new Map(materials.map(material => [material, material.vertexNode]));
  const historyTarget = new effectThree.RenderTarget(1, 1), aoTarget = new effectThree.RenderTarget(1, 1);
  const calls = [];
  let onCompile = () => Promise.resolve();
  const renderer = {
    _renderContexts: contexts, toneMapping: 84, outputColorSpace: 'generated-display-space', xr: { enabled: true }, autoClear: false,
    getRenderTarget: () => state.target,
    setRenderTarget(target, cube = 0, mip = 0) { state.target = target; state.cube = cube; state.mip = mip; },
    getActiveCubeFace: () => state.cube, getActiveMipmapLevel: () => state.mip,
    getRenderObjectFunction: () => state.renderObject, setRenderObjectFunction(value) { state.renderObject = value; },
    getPixelRatio: () => state.ratio, setPixelRatio(value) { state.ratio = value; },
    getMRT: () => state.mrt, setMRT(value) { state.mrt = value; },
    getClearColor(value) { return value.setRGB(...state.clear); }, getClearAlpha: () => state.alpha,
    setClearColor(value, alpha = state.alpha) { state.clear = value === 0 ? [0, 0, 0] : [value.r, value.g, value.b]; state.alpha = alpha; },
    getScissorTest: () => state.scissor, setScissorTest(value) { state.scissor = value; },
    compileAsync(quad, camera) {
      assert.equal(camera, quad.camera);
      const index = calls.length, depth = index === 1 || index === 2 ? 1 : 0;
      const target = [null, historyTarget, aoTarget, null][index];
      assert.equal(state.target, target);
      assert.equal(contexts.get(target, state.mrt), nativeGet(target, state.mrt, depth), 'Exact target/depth context identity');
      assert.equal(renderer.toneMapping, effectThree.NoToneMapping);
      assert.equal(renderer.outputColorSpace, effectThree.ColorManagement.workingColorSpace);
      assert.equal(renderer.xr.enabled, false);
      assert.notEqual(quad.material.vertexNode, vertices.get(quad.material), 'Actual fullscreen vertex setup is used for compilation');
      assert.equal(quad.frustumCulled, false);
      for (const node of nodes) assert.equal(node.updateBefore(), false, 'Effect updates are deferred only inside compilation');
      if (!culling.has(quad)) culling.set(quad, true); // The helper creates the actual default AO QuadMesh.
      calls.push(quad);
      return onCompile(quad, index);
    },
  };
  const output = quad => ({ renderer, _quadMesh: quad,
    _contextData: { onBeforePipelineCallbacks: [], onAfterPipelineCallbacks: [] }, _update() {} });
  const history = Object.assign(nodes[3], { count: 0, async prepareQuad(compile) { await compile(quads[2], historyTarget); } });
  const effects = { pipeline: output(quads[0]), relit: output(quads[1]),
    occlusion: Object.assign(nodes[2], { _material: materials[3], _aoRenderTarget: aoTarget }), history, passes: nodes.slice(0, 2) };
  const snapshot = () => ({ renderer: effectThree.RendererUtils.saveRendererState(renderer), xr: renderer.xr.enabled });
  let expectedState = snapshot();
  let expectedHooks = nodes.map(node => Object.getOwnPropertyDescriptor(node, 'updateBefore'));
  const contextDescriptor = Object.getOwnPropertyDescriptor(contexts, 'get');
  const restored = () => {
    assert.deepEqual(snapshot(), expectedState, 'Every renderer value, including outer output state, is restored');
    assert.deepEqual(Object.getOwnPropertyDescriptor(contexts, 'get'), contextDescriptor, 'Inherited context method is restored');
    assert.equal(contexts.get, nativeGet);
    nodes.forEach((node, index) => {
      assert.deepEqual(Object.getOwnPropertyDescriptor(node, 'updateBefore'), expectedHooks[index], 'Exact own/inherited update hook descriptor restored');
      assert.equal(node.updateBeforeType, `generated-${index}`, 'Runtime dependency type is unchanged');
    });
    for (const [material, vertex] of vertices) assert.equal(material.vertexNode, vertex);
    for (const [quad, culled] of culling) assert.equal(quad.frustumCulled, culled);
  };
  return { renderer, effects, nodes, contexts, calls, restored,
    onCompile(value) { onCompile = value; },
    observeCurrentState() { expectedState = snapshot(); },
    observeCurrentHooks() { expectedHooks = nodes.map(node => Object.getOwnPropertyDescriptor(node, 'updateBefore')); },
    close() { for (const material of materials) material.dispose(); historyTarget.dispose(); aoTarget.dispose(); },
  };
}

test('effect preparation restores every shared owner before all four direct-frame yields', async () => {
  const fixture = effectFixture(); let yields = 0;
  try {
    await prepareEffectPipelines(fixture.renderer, fixture.effects, async () => {
      yields++; fixture.restored(); assert.equal(fixture.effects.history.count, 0);
      assert.equal(fixture.calls.length, yields, 'Yield follows one settled compilation, never a pending one');
      // A direct frame may update renderer state; the next transaction must
      // snapshot this current owner rather than restore the initial build state.
      fixture.renderer.toneMapping = 84 + yields;
      fixture.renderer.outputColorSpace = `generated-direct-frame-${yields}`;
      fixture.renderer.xr.enabled = yields % 2 === 0;
      fixture.observeCurrentState();
    });
    assert.equal(yields, 4); assert.equal(fixture.calls.length, 4); fixture.restored();
  } finally { fixture.close(); }
});

test('effect preparation restores owners after synchronous and asynchronous compile failures', async () => {
  for (const synchronous of [true, false]) {
    const fixture = effectFixture(), failure = new Error('generated compiler failure'); let yielded = false;
    try {
      fixture.onCompile(() => { if (synchronous) throw failure; return Promise.reject(failure); });
      await assert.rejects(prepareEffectPipelines(fixture.renderer, fixture.effects, async () => { yielded = true; }), error => error === failure);
      assert.equal(yielded, false); assert.equal(fixture.calls.length, 1); fixture.restored();
    } finally { fixture.close(); }
  }
});

test('effect preparation restores owners before refusing callbacks introduced by compilation', async () => {
  const fixture = effectFixture(); let yielded = false;
  try {
    fixture.onCompile(() => { fixture.effects.pipeline._contextData.onAfterPipelineCallbacks.push(() => {}); return Promise.resolve(); });
    await assert.rejects(prepareEffectPipelines(fixture.renderer, fixture.effects, async () => { yielded = true; }), error => error instanceof PreparationRefused);
    assert.equal(yielded, false); fixture.restored();
  } finally { fixture.close(); }
});

test('effect preparation retains compilation ownership until a cancelled compile settles', async () => {
  const fixture = effectFixture(), entered = effectDeferred(), compiled = effectDeferred(), controller = new AbortController();
  const reason = new Error('generated replacement during compile'); let yields = 0;
  let run;
  try {
    fixture.onCompile(() => { entered.resolve(); return compiled.promise; });
    run = prepareEffectPipelines(fixture.renderer, fixture.effects, async () => { yields++; }, controller.signal);
    await Promise.race([entered.promise, run.then(() => assert.fail('Preparation finished before the controlled compile'))]);
    controller.abort(reason);
    assert.equal(yields, 0); assert(Object.hasOwn(fixture.contexts, 'get'), 'Pending compile still owns its context override');
    for (const node of fixture.nodes) assert.equal(node.updateBefore(), false);
    compiled.resolve(); await assert.rejects(run, error => error === reason);
    assert.equal(yields, 0); assert.equal(fixture.calls.length, 1); fixture.restored();
  } finally { compiled.resolve(); await run?.catch(() => undefined); fixture.close(); }
});

test('effect preparation cancellation in a restored yield starts no later compilation', async () => {
  const fixture = effectFixture(), controller = new AbortController(), reason = new Error('generated replacement during yield');
  let yields = 0;
  try {
    await assert.rejects(prepareEffectPipelines(fixture.renderer, fixture.effects, async () => {
      yields++; fixture.restored(); controller.abort(reason);
    }, controller.signal), error => error === reason);
    assert.equal(yields, 1); assert.equal(fixture.calls.length, 1); fixture.restored();
  } finally { fixture.close(); }
});

test('effect preparation preflights unsupported hooks and advanced history before mutation', async () => {
  for (const advancedHistory of [false, true]) {
    const fixture = effectFixture(); let yielded = false;
    try {
      if (advancedHistory) fixture.effects.history.count = 1;
      else { fixture.nodes[2].updateBefore = null; fixture.observeCurrentHooks(); }
      await assert.rejects(prepareEffectPipelines(fixture.renderer, fixture.effects, async () => { yielded = true; }), error => error instanceof PreparationRefused);
      assert.equal(fixture.calls.length, 0); assert.equal(yielded, false); fixture.restored();
    } finally { fixture.close(); }
  }
});

test('effect preparation refuses history advanced in a safe window before another compile', async () => {
  const fixture = effectFixture(); let yields = 0;
  try {
    await assert.rejects(prepareEffectPipelines(fixture.renderer, fixture.effects, async () => {
      yields++; fixture.restored(); fixture.effects.history.count++;
    }), /Effect preparation advanced the history/);
    assert.equal(yields, 1); assert.equal(fixture.calls.length, 1); fixture.restored();
  } finally { fixture.close(); }
});

test('effect preparation restores earlier hooks after a partial replacement failure', async () => {
  const fixture = effectFixture(); let yielded = false;
  try {
    Object.defineProperty(fixture.nodes[3], 'updateBefore', { value: fixture.nodes[3].updateBefore, configurable: false });
    fixture.observeCurrentHooks();
    await assert.rejects(prepareEffectPipelines(fixture.renderer, fixture.effects, async () => { yielded = true; }), error => error instanceof TypeError && !(error instanceof PreparationRefused));
    assert.equal(fixture.calls.length, 0); assert.equal(yielded, false); fixture.restored();
  } finally { fixture.close(); }
});

// Exercise the actual scene callback with a synthetic lexical owner; no second
// callback implementation, scene build, RAF, camera or rendered frame is used.
const effectSceneSource = readFileSync(new URL('../src/lantern/canonical-ifc/mesh-scene.ts', import.meta.url), 'utf8');
const effectSliceStart = '        const nextEffectSlice = async () => {';
assert.equal(effectSceneSource.split(effectSliceStart).length, 2, 'One actual safe-yield callback owner');
const effectSliceAt = effectSceneSource.indexOf(effectSliceStart);
const effectSliceEnd = effectSceneSource.indexOf('\n        };', effectSliceAt);
assert(effectSliceEnd > effectSliceAt, 'Complete actual safe-yield callback declaration');
const effectSliceDeclaration = effectSceneSource.slice(effectSliceAt, effectSliceEnd + '\n        };'.length);
const effectOwnerCode = (await transformWithOxc(`export function sourceEffectSliceOwner(onStage, slice) {
  let holding = true;
  ${effectSliceDeclaration}
  return { nextEffectSlice, held: () => holding };
}`, 'generated-effect-slice-owner.ts', { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false })).code;
assert.deepEqual(runtimeDependencies(effectOwnerCode), [], 'Safe-yield owner has no hidden runtime dependency');
const { sourceEffectSliceOwner } = await import('data:text/javascript;base64,' + Buffer.from(effectOwnerCode).toString('base64'));

test('actual scene yield callback reacquires its guard on completion and either failure path', async () => {
  for (const outcome of ['complete', 'wait-rejected', 'notice-threw']) {
    const wait = effectDeferred(), failure = new Error(`generated ${outcome}`);
    let owner, notices = 0, waits = 0;
    owner = sourceEffectSliceOwner(() => {
      notices++; assert.equal(owner.held(), false, 'Current-frame notice occurs only in the released window');
      if (outcome === 'notice-threw') throw failure;
    }, { next() { waits++; assert.equal(owner.held(), false); return wait.promise; } });
    assert.equal(owner.held(), true);
    const running = owner.nextEffectSlice();
    if (outcome === 'notice-threw') {
      await assert.rejects(running, error => error === failure); assert.equal(waits, 0);
    } else {
      assert.equal(owner.held(), false, 'Guard remains released throughout the controlled restored wait');
      if (outcome === 'wait-rejected') {
        const rejected = assert.rejects(running, error => error === failure);
        wait.reject(failure); await rejected;
      } else { wait.resolve(); await running; }
      assert.equal(waits, 1);
    }
    assert.equal(notices, 1); assert.equal(owner.held(), true, 'Guard is reacquired before control returns to compilation');
  }
});

test('actual helper and scene callback open only restored direct-frame windows', async () => {
  const fixture = effectFixture(); let owner, notices = 0, waits = 0;
  try {
    owner = sourceEffectSliceOwner(() => {
      notices++; assert.equal(owner.held(), false); fixture.restored();
      assert.equal(fixture.effects.history.count, 0);
    }, { async next() {
      waits++; assert.equal(owner.held(), false); fixture.restored();
      assert.equal(fixture.effects.history.count, 0);
    } });
    fixture.onCompile(() => { assert.equal(owner.held(), true, 'Actual compile retains its scene guard'); return Promise.resolve(); });
    await prepareEffectPipelines(fixture.renderer, fixture.effects, owner.nextEffectSlice);
    assert.equal(notices, 4); assert.equal(waits, 4); assert.equal(fixture.calls.length, 4);
    assert.equal(owner.held(), true); fixture.restored(); assert.equal(fixture.effects.history.count, 0);
  } finally { fixture.close(); }
});
