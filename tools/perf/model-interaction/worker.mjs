import assert from 'node:assert/strict';
import { modules } from './source.mjs';
import { PROFILE, scenario } from './fixtures.mjs';
import { allocations, row, timing } from './measure.mjs';

assert.equal(process.version, 'v26.10.0');
assert.equal(process.env.NODE_ENV, 'production');
assert.equal(typeof globalThis.gc, 'function');
const observed = new Map();
const { geometry, preflight, standard, sample } = await modules(process.argv[2], observed);
const results = [];
for (const count of PROFILE.sizes) {
  const input = await scenario(sample, count), signal = new AbortController().signal;
  const load = () => standard.loadStandardGlb(input.bytes, 'generated', signal);
  const checkLoad = glb => {
    assert.equal(glb.counts.triangles, count * 12); assert.equal(glb.meshes.length, count);
    assert.equal(glb.counts.metadataOnlyNodes, input.rooms);
    assert(glb.meshes.every(mesh => mesh.occurrenceId === null && mesh.floorId === null));
  };
  const glb = await load(); checkLoad(glb);
  const bounds = geometry.drawnBounds(glb.meshes, [], null);
  const middle = Math.floor(count / 2), x = (middle % input.side) * 1.2, z = Math.floor(middle / input.side) * 1.2;
  const pose = { yaw: PROFILE.yaw, pitch: PROFILE.pitch, zoom: 1, panX: 0, panY: 0 };
  const viewport = { width: PROFILE.viewport[0], height: PROFILE.viewport[1] };
  const projection = geometry.makeProjection(pose, bounds, viewport, 0), point = projection.project(x, 1, z);
  const planProjection = geometry.makeProjection({ ...pose, pitch: 90 }, bounds, viewport, 1), planPoint = planProjection.project(x, 0, z);
  const operations = [
    ['frontend.standard_glb.load_ms', load, checkLoad],
    ['frontend.standard_glb.preflight_ms', () => preflight.preflightGltf(preflight.readGlbContainer(input.bytes)),
      value => assert.equal(value.work.triangles, count * 12)],
    ['frontend.mesh.pick_ms', () => geometry.pick(glb.meshes, projection, { visibleFloors: 'all', clipY: null }, point[0], point[1]),
      value => { assert.equal(value.kind, 'display-only'); assert.equal(value.meshKey, glb.drawn[middle].meshKey); }],
    ['frontend.room.plan_pick_ms', () => geometry.planPick(input.plan, 'generated-floor', 0, planProjection, planPoint[0], planPoint[1]),
      value => assert.equal(value, `plan-room-${middle}`)],
  ];
  const metrics = [];
  for (const [id, fn, check] of operations) metrics.push(await timing(id, fn, check));
  const allocationMetrics = [];
  for (const [id, fn, check] of operations) allocationMetrics.push(await allocations(id.replace(/_ms$/, '_sampled_js_bytes'), fn, check));
  const samplingBaseline = await allocations('harness.empty_sampled_js_bytes', () => null, value => assert.equal(value, null));
  metrics.push(row('frontend.standard_glb.prepared_bytes', 'bytes', [glb.meshes.reduce((sum, mesh) => sum + mesh.vertices.byteLength, 0)]));
  results.push({ fixture: input.facts, metrics, allocationMetrics, samplingBaseline });
}
process.stdout.write(JSON.stringify({ results, sourceFiles: [...observed].map(([path, sha256]) => ({ path, sha256 })) }));
