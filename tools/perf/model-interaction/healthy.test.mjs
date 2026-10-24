import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { modules } from './source.mjs';
import { scenario, sha256 } from './fixtures.mjs';
import { sampledBytes, summary } from './measure.mjs';
import { parseArgs, run } from './run.mjs';

const root = resolve(new URL('../../../', import.meta.url).pathname);
test('generated GLB and complete manifest retain identities and drawn transforms', async () => {
  const observed = new Map(), api = await modules(root, observed), input = await scenario(api.sample, 100);
  const duplicate = await scenario(api.sample, 100);
  assert.deepEqual(input.facts, duplicate.facts);
  const glb = await api.standard.loadStandardGlb(input.bytes, 'generated', new AbortController().signal);
  assert.equal(glb.counts.triangles, 1200); assert.equal(glb.counts.metadataOnlyNodes, 10);
  assert.equal(glb.meshes.reduce((sum, mesh) => sum + mesh.vertices.byteLength, 0), 86400);
  const bounds = api.geometry.drawnBounds(glb.meshes, [], null);
  assert(Math.abs(bounds.max[0] - 11.2) < 1e-5);
  const data = api.manifest.readBrowserManifest(JSON.parse(new TextDecoder().decode(input.manifestBytes)));
  const check = api.manifest.checkManifest(data, { glb, bounds, sha256: sha256(input.bytes), bytes: input.bytes.length },
    { sha256: sha256(input.reference), bytes: input.reference.length });
  assert.equal(check.identitiesInExtras, 110); assert(check.boundsDifference < 1e-4);
  const index = api.navigator.navigationIndex(glb, data);
  assert.equal(index.products.size, 100); assert.equal(index.occurrences.size, 10);
  assert.deepEqual(index.storeys.map(storey => storey.products.length), [50, 50]);
  assert.equal(index.unlisted.length, 0);
  assert(glb.meshes.every(mesh => mesh.occurrenceId === null && mesh.floorId === null));
  assert.equal(observed.size, existsSync(join(root, 'frontend/src/lantern/canonical-ifc/embedded-png-material.ts')) ? 7 : 6);
});

test('optional embedded-material import loads through the mapped production closure without a browser', async t => {
  const path = 'frontend/src/lantern/canonical-ifc/embedded-png-material.ts';
  if (!existsSync(join(root, path))) { t.skip('Source revision predates optional embedded materials'); return; }
  const observed = new Map(), api = await modules(root, observed);
  assert.equal(observed.get(path), sha256(readFileSync(join(root, path))), 'Optional dependency is included in source provenance');
  const input = await scenario(api.sample, 10), signal = new AbortController().signal;
  const plain = await api.standard.loadStandardGlb(input.bytes, 'generated', signal);
  // No image or texture exists in this fixture. This executes the actual
  // dynamic import/admission path, with no image decoder, DOM, canvas or GPU.
  const optional = await api.standard.loadStandardGlb(input.bytes, 'generated', signal, undefined, { embeddedPngMaterials: true });
  assert.deepEqual(optional.counts, plain.counts);
  assert.deepEqual(optional.meshes, plain.meshes);
  assert(optional.meshes.every(mesh => mesh.sourceMaterial === undefined));
});

test('static navigator rendering includes declared products and geometry-free rooms', async () => {
  const api = await modules(root, new Map()), input = await scenario(api.sample, 10);
  const glb = await api.standard.loadStandardGlb(input.bytes, 'generated', new AbortController().signal);
  const data = api.manifest.readBrowserManifest(JSON.parse(new TextDecoder().decode(input.manifestBytes)));
  const index = api.navigator.navigationIndex(glb, data);
  const navigation = { hidden: { storeys: new Set(), classes: new Set(), unlisted: false }, selection: null,
    setSelection() {}, toggleStorey() {}, toggleClass() {}, toggleUnlisted() {} };
  const html = api.server.renderToStaticMarkup(api.react.createElement(api.navigator.ModelNavigator, { index, navigation }));
  assert(html.includes('generated-product-9'));
  assert(html.includes('generated-room-0'));
  assert(html.includes('No geometry'));
});

test('actual plan picker keeps holes, nested rooms and explicit floor separation', async () => {
  const { geometry } = await modules(root, new Map());
  const square = (a, b) => [[a, a], [b, a], [b, b], [a, b]];
  const model = { floorFacts: new Map([['a', { occurrenceIds: ['outer', 'inner'] }], ['b', { occurrenceIds: ['upper'] }]]),
    planShapes: new Map([['outer', [[square(0, 10), square(4, 6)]]], ['inner', [[square(1, 3)]]], ['upper', [[square(0, 10)]]]]) };
  const projection = geometry.makeProjection({ yaw: -32, pitch: 90, zoom: 1, panX: 0, panY: 0 },
    { min: [0, 0, 0], max: [10, 1, 10] }, { width: 960, height: 640 }, 1);
  const pick = (floor, x, z) => { const [px, py] = projection.project(x, 0, z); return geometry.planPick(model, floor, 0, projection, px, py); };
  assert.equal(pick('a', 2, 2), 'inner'); assert.equal(pick('a', 8, 8), 'outer');
  assert.equal(pick('a', 5, 5), null); assert.equal(pick('b', 5, 5), 'upper');
});

test('sample aggregation preserves raw statistical allocation estimates', () => {
  assert.equal(sampledBytes({ selfSize: 32768, children: [{ selfSize: 65536, children: [] }] }), 98304);
  assert.deepEqual(summary([3, 1, 2]), { count: 3, median: 2, p95: 3, mad: 1, min: 1, max: 3 });
});

test('CLI retains a failed observation when selected product sources are absent', t => {
  const directory = mkdtempSync(join(tmpdir(), 'houseatlas-model-cpu-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'source'); mkdirSync(source);
  const git = args => execFileSync('git', args, { cwd: source, stdio: 'pipe', encoding: 'utf8' }).trim();
  git(['init', '--initial-branch=main']); writeFileSync(join(source, 'README.md'), 'Generated CPU measurement test repository.\n');
  git(['add', 'README.md']); git(['-c', 'user.name=Synthetic fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Generated fixture']);
  const output = join(directory, 'run.json');
  assert.equal(run(parseArgs(['--source-root', source, '--output', output])), 1);
  const document = JSON.parse(readFileSync(output));
  assert.equal(document.status, 'failed'); assert.equal(document.reason, 'execution-failed'); assert.deepEqual(document.results, []);
  assert.equal(document.source.commit, git(['rev-parse', 'HEAD']));
});
