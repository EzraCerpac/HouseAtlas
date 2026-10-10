/** SOURCE ONLY until exact Root registration. Healthy local synthetic reads;
 * no provider, listener, browser, private specimen, native import or mutation. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { transformWithOxc } from 'vite';
import { loadNumericSource } from './load-numeric-source.mjs';

const dataUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
export async function loadScanProfileSource() {
  const file = new URL('../src/lantern/scans/mesh-profile.ts', import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
    { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  const specifier = '"../../numeric/decimal"'; assert(code.includes(specifier));
  code = code.replaceAll(specifier, JSON.stringify(await loadNumericSource('numeric/decimal.ts')));
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert(match[1].startsWith('data:'), `Unexpected runtime import ${match[1]}`);
  return dataUrl(code);
}
const identity = () => ['1', '0', '0', '0', '0', '1', '0', '0', '0', '0', '1', '0', '0', '0', '0', '1'];
export function syntheticMeshFixture(label = 'Synthetic export A') {
  const translation = identity(); translation[12] = '2.5000'; translation[14] = '-1e0';
  return {
    profile: 'houseatlas.magicplan-authored-mesh.v1',
    source: { fileName: 'SYNTHETIC.usdz', floorLabel: label, originalSHA256: 'a'.repeat(64), originalBytes: 32,
      primaryLayerName: 'synthetic.usdc', primaryLayerSHA256: 'b'.repeat(64), primaryLayerBytes: 32,
      serializedUSDASHA256: 'c'.repeat(64), serializedUSDABytes: 32 },
    converter: { codeSHA256: 'd'.repeat(64), schemaSHA256: 'e'.repeat(64), profileSHA256: 'f'.repeat(64),
      usdcatExecutableSHA256: '0'.repeat(64), usdcatVersion: 'Synthetic fixture; no actual conversion',
      invocation: 'usdcat local-primary.usdc -> private serialized.usda stdout; no flatten, composition or network' },
    authoredCoordinates: { upAxis: 'Y', metersPerUnitToken: '1', defaultPrim: 'Stage',
      matrixConvention: 'row-major storage; row vector p_local * M_mesh * M_parent * ...',
      numericTokenProvenance: 'exact tokens from usdcat USDA serialization; original USDC has binary values, not text lexemes' },
    qualification: { physicalScale: 'unknown', floorAlignment: 'unknown', stageToHouseTransform: null, semanticRoomObjects: 0 },
    nodes: [
      { path: '/Stage', primType: 'Xform', parentPath: null, authoredOpOrder: ['xformOp:transform'], rawOpOrderLiteral: '["xformOp:transform"]', resetXformStack: false,
        operations: [{ name: 'xformOp:transform', type: 'matrix4d', matrixTokens: translation }], localMatrixTokens: translation },
      { path: '/Stage/Triangle', primType: 'Mesh', parentPath: '/Stage', authoredOpOrder: null, rawOpOrderLiteral: null,
        resetXformStack: false, operations: [], localMatrixTokens: identity() },
    ],
    meshes: [{ sourceObjectId: '/Stage/Triangle', sourceName: 'Triangle', authoredOrientation: null, resolvedOrientation: 'rightHanded',
      orientationQualification: 'USD schema default; not physically verified', authoredDoubleSided: true, authoredDoubleSidedToken: '1',
      positionsLocalTokens: ['-0.000', '0', '0', '1.000', '0', '0', '0', '1e0', '0'], triangleIndicesTokens: ['0', '1', '2'],
      faceVertexCounts: { repeatedToken: '3', count: 1 }, ancestorChain: ['/Stage/Triangle', '/Stage'], appliedChain: ['/Stage/Triangle', '/Stage'],
      composedLocalToStageMatrixTokens: translation, vertexCount: 3, triangleCount: 1 }],
    counts: { meshes: 1, vertices: 3, triangles: 1, nodes: 2 },
  };
}
export async function runHealthyScanMeshRead() {
  const { readScanMesh, prepareMeshRender } = await import(await loadScanProfileSource());
  const bytes = new TextEncoder().encode(JSON.stringify(syntheticMeshFixture()));
  const sha = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const floor = Object.freeze({ key: 'synthetic-floor-a', exportLabel: 'Synthetic export A', derivativeSHA256: sha, originalSHA256: 'a'.repeat(64) });
  const events = [], subscriptions = new Set();
  const port = {
    isCurrent: key => key === 'synthetic-current-view',
    subscribeInvalidation(key, notify) { assert.equal(key, 'synthetic-current-view'); subscriptions.add(notify); return () => subscriptions.delete(notify); },
    async read(key, descriptor, signal) {
      assert.equal(key, 'synthetic-current-view'); assert.equal(descriptor, floor); assert.equal(signal.aborted, false);
      events.push('read'); return { viewKey: key, floorKey: descriptor.key, bytes };
    },
  };
  const profile = await readScanMesh(port, 'synthetic-current-view', floor, new AbortController().signal);
  assert.deepEqual(events, ['read']); assert.equal(subscriptions.size, 0);
  assert.equal(profile.source.originalSHA256, floor.originalSHA256); assert.equal(profile.source.originalBytes.token, '32');
  assert.equal(profile.converter.invocation, 'usdcat local-primary.usdc -> private serialized.usda stdout; no flatten, composition or network');
  assert.equal(profile.meshes[0].positionsLocalTokens[0], '-0.000'); assert.equal(profile.nodes[0].operations[0].matrixTokens[12], '2.5000');
  assert.equal(profile.meshes[0].authoredDoubleSidedToken, '1'); assert.equal(profile.meshes[0].authoredDoubleSided, true);
  assert(Object.isFrozen(profile) && Object.isFrozen(profile.nodes) && Object.isFrozen(profile.nodes[0].operations[0].matrixTokens));
  assert(Object.isFrozen(profile.meshes[0].positionsLocalTokens));
  assert.equal(profile.qualification.semanticRoomObjects.token, '0'); assert.equal(profile.qualification.stageToHouseTransform, null);
  assert.equal(profile.qualification.physicalScale, 'unknown'); assert.equal(profile.qualification.floorAlignment, 'unknown');
  const rendered = await prepareMeshRender(profile, new AbortController().signal);
  assert.equal(rendered.meshes.length, 1); assert.equal(rendered.meshes[0].triangles, 1); assert.equal(rendered.bytes, 144);
  assert.equal(rendered.meshes[0].sourceObjectId, '/Stage/Triangle');
  assert.equal(profile.meshes[0].positionsLocalTokens[0], '-0.000');
  console.log('PASS healthy synthetic scan read, digest/lineage and preserved shared transform tokens; no native/GPU acceptance');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runHealthyScanMeshRead();
