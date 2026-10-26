// Dedicated production-mode CPU process. No browser, listener or provider is created.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixtures } from './fixtures.mjs';
import { PROFILE } from './settings.mjs';
import { policies, summarize } from '../contract/index.mjs';
import { dependencyUrl, loadSource, threeUrl } from './load-source.mjs';

const source = resolve(process.argv[2]);
const observed = new Map(), rows = new Map();
const ids = prefix => policies.filter(policy => policy.id.startsWith(prefix)).map(policy => policy.id);
const unavailable = (selected, status, reason) => { for (const id of selected) rows.set(id, { id, status, reason }); };
const measured = (id, samples) => rows.set(id, { id, status: 'measured', samples, summary: summarize(samples) });
async function time(id, fn) {
  for (let i = 0; i < PROFILE.warmups; i++) await fn();
  const samples = [];
  for (let i = 0; i < PROFILE.repetitions; i++) { const start = performance.now(); await fn(); samples.push(performance.now() - start); }
  measured(id, samples);
}
const present = path => existsSync(resolve(source, path));
const compile = (path, replacements) => loadSource(source, path, observed, replacements);
let sink = 0;
const inputs = fixtures();

if (process.version !== 'v26.10.0' || process.env.NODE_ENV !== 'production') {
  unavailable(policies.filter(p => p.id.startsWith('frontend.') && !p.id.startsWith('frontend.startup_') && !p.id.startsWith('frontend.bundle.')).map(p => p.id), 'blocked', 'runtime-mismatch');
} else {
  const scanIds = ids('frontend.scan.');
  const scanPath = 'frontend/src/lantern/scans/mesh-profile.ts';
  if (!present(scanPath)) unavailable(scanIds, 'unsupported', 'feature-not-present');
  else try {
    const decimal = await compile('frontend/src/numeric/decimal.ts');
    const glb = await compile('frontend/src/lantern/scans/ifc-glb-profile.ts', { '../../numeric/decimal': decimal });
    const yieldTask = await compile('frontend/src/lantern/scans/presentation/yield-task.ts');
    const mesh = await import(await compile(scanPath, { '../../numeric/decimal': decimal, './ifc-glb-profile': glb, './presentation/yield-task': yieldTask }));
    const signal = new AbortController().signal;
    let profile = await mesh.parseMeshProfile(inputs[0].bytes, signal);
    await time('frontend.scan.parse_ms', async () => { profile = await mesh.parseMeshProfile(inputs[0].bytes, signal); });
    let scene = await mesh.prepareMeshRender(profile, signal);
    await time('frontend.scan.prepare_ms', async () => { scene = await mesh.prepareMeshRender(profile, signal); sink += scene.meshes.length; });
    measured('frontend.scan.prepared_bytes', [scene.meshes.reduce((sum, item) => sum + item.vertices.byteLength, 0)]);
    const edgePath = 'frontend/src/lantern/scans/presentation/display-edges.ts';
    if (!present(edgePath)) unavailable(['frontend.scan.edges_ms'], 'unsupported', 'feature-not-present');
    else {
      const edges = await import(await compile(edgePath));
      await time('frontend.scan.edges_ms', async () => { sink += (await edges.displayEdges(scene.meshes[0].vertices, signal)).length; });
    }
  } catch { unavailable(scanIds, 'failed', 'execution-failed'); }

  const glbIds = ['frontend.standard_glb.load_ms', 'frontend.standard_glb.prepared_bytes', 'frontend.navigation.index_ms', 'frontend.mesh.pick_ms', 'frontend.navigator.ssr_ms'];
  const base = 'frontend/src/lantern/canonical-ifc/';
  if (!present(base + 'standard-glb.ts') || !present(base + 'geometry.ts') || !present(base + 'glb-preflight.ts'))
    unavailable(glbIds, 'unsupported', 'feature-not-present');
  else try {
    const geometryUrl = await compile(base + 'geometry.ts');
    const preflight = await compile(base + 'glb-preflight.ts');
    // Older sources have no material module. New sources still require an
    // explicit mapping through the same strict compiler; measurements opt out.
    const materialImports = present(base + 'embedded-png-material.ts')
      ? { './embedded-png-material': await compile(base + 'embedded-png-material.ts', { './glb-preflight': preflight }) } : {};
    // Meshopt expansion, mapped the same way where the source has it.
    const meshoptImports = present(base + 'glb-meshopt.ts')
      ? { './glb-meshopt': await compile(base + 'glb-meshopt.ts', { './glb-preflight': preflight,
        'three/examples/jsm/libs/meshopt_decoder.module.js': dependencyUrl('three/examples/jsm/libs/meshopt_decoder.module.js') }) } : {};
    const standard = await import(await compile(base + 'standard-glb.ts', { './geometry': geometryUrl, './glb-preflight': preflight,
      ...materialImports, ...meshoptImports, three: threeUrl, 'three/examples/jsm/loaders/GLTFLoader.js': dependencyUrl('three/examples/jsm/loaders/GLTFLoader.js') }));
    const geometry = await import(geometryUrl), signal = new AbortController().signal;
    let loaded = await standard.loadStandardGlb(inputs[1].bytes, 'synthetic', signal);
    await time('frontend.standard_glb.load_ms', async () => { loaded = await standard.loadStandardGlb(inputs[1].bytes, 'synthetic', signal); sink += loaded.counts.triangles; });
    measured('frontend.standard_glb.prepared_bytes', [loaded.meshes.reduce((sum, item) => sum + item.vertices.byteLength, 0)]);
    const bounds = geometry.drawnBounds(loaded.meshes, [], null), scenario = PROFILE.scenario;
    const projection = geometry.makeProjection({ yaw: scenario.yaw, pitch: scenario.pitch, zoom: 1, panX: 0, panY: 0 }, bounds,
      { width: scenario.viewport[0], height: scenario.viewport[1] }, 0);
    const middle = Math.floor(scenario.glbInstances / 2), side = Math.ceil(Math.sqrt(scenario.glbInstances));
    const point = projection.project((middle % side) * 1.2, .9, Math.floor(middle / side) * 1.2);
    await time('frontend.mesh.pick_ms', () => { sink += geometry.pick(loaded.meshes, projection, { visibleFloors: 'all', clipY: null }, point[0], point[1]).kind.length; });
    if (!present(base + 'ModelNavigator.tsx')) unavailable(['frontend.navigation.index_ms', 'frontend.navigator.ssr_ms'], 'unsupported', 'feature-not-present');
    else {
      const navigator = await import(await compile(base + 'ModelNavigator.tsx', { react: dependencyUrl('react'), 'react/jsx-runtime': dependencyUrl('react/jsx-runtime') }));
      const data = { products: loaded.nodes.map(node => ({ nodeIndex: node.nodeIndex, globalId: `syn-product-${node.nodeIndex}`,
        ifcClass: node.nodeIndex % 3 ? 'IfcBuildingElementProxy' : 'IfcSlab', storey: 's0' })),
      roomOccurrences: [], storeys: [{ key: 's0', label: 'Synthetic storey' }] };
      let index = navigator.navigationIndex(loaded, data);
      await time('frontend.navigation.index_ms', () => { index = navigator.navigationIndex(loaded, data); sink += index.products.size; });
      const { createElement } = await import('react'), { renderToStaticMarkup } = await import('react-dom/server');
      const navigation = { hidden: { storeys: new Set(), classes: new Set(), unlisted: false }, selection: null,
        setSelection() {}, toggleStorey() {}, toggleClass() {}, toggleUnlisted() {} };
      await time('frontend.navigator.ssr_ms', () => { sink += renderToStaticMarkup(createElement(navigator.ModelNavigator, { index, navigation })).length; });
    }
  } catch { unavailable(glbIds, 'failed', 'execution-failed'); }
}

process.stdout.write(JSON.stringify({ metrics: [...rows.values()], files: [...observed].map(([path, sha256]) => ({ path, sha256 })), sink }));
