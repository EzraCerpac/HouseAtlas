// Generated positive CPU geometry cases only. No browser, listener, native
// state, source admission, failure injection or household input is exercised.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformWithOxc } from 'vite';

const file = new URL('../src/lantern/canonical-ifc/geometry.ts', import.meta.url);
const { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
  { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
assert(!/\b(?:import|require)\s*\(?/.test(code), 'Geometry CPU module must have no runtime imports');
const { prepareMeshes } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);

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
