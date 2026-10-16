// Healthy generated GET responses only. Actual reader/DTO decoder, no server,
// credentials, household input, browser, publication or deployment.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { transformWithOxc } from 'vite';
assert.equal(process.version, 'v26.10.0');
const dataURL = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function source(relative, replacements = {}) {
  const path = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(path, 'utf8'), path.pathname, { lang: 'ts', target: 'esnext', tsconfig: false });
  for (const [specifier, url] of Object.entries(replacements)) code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert.ok(match[1].startsWith('data:'), `unmapped import ${match[1]}`);
  return dataURL(code);
}
const decimal = await source('../src/numeric/decimal.ts');
const lossless = await source('../src/numeric/lossless-json.ts', { './decimal': decimal });
const reader = await source('../integration/model-overview-reader.ts', { '../src/numeric/decimal': decimal, '../src/numeric/lossless-json': lossless });
const model = await source('../src/app/model.ts');
const decoder = await source('../src/app/decode.ts', { './model': model });
const { readModelOverview } = await import(reader), { decodeAtlasView } = await import(decoder);
const scope = { workspaceId: '11111111-1111-4111-8111-111111111111', homeId: '22222222-2222-4222-8222-222222222222' };
const publicationId = '33333333-3333-4333-8333-333333333333', manifestSha256 = 'a'.repeat(64);
const selected = { owner: {}, scope, expiresAt: new Date(Date.now() + 60_000).toISOString(), publicationId, manifestSha256 };
const facet = { profile: 'houseatlas.model-overview-read.v1', available: true, publicationId, manifestSha256 };
const view = { status: 'ready', scope, homeLabel: 'Synthetic home', now: '2026-01-01T00:00:00Z', canEdit: false,
  homes: [{ ...scope, label: 'Synthetic home' }], entries: [], caches: [] };
assert.equal(decodeAtlasView(view).modelOverviewService, undefined);
assert.equal(decodeAtlasView({ ...view, modelOverviewService: { ...facet, available: false, publicationId: null, manifestSha256: null } }).modelOverviewService, undefined);
assert.equal(decodeAtlasView({ ...view, modelOverviewService: { ...facet, profile: 'future.overview-profile' } }).modelOverviewService, undefined);
assert.deepEqual(decodeAtlasView({ ...view, modelOverviewService: facet }).modelOverviewService, facet);

// One generated empty glTF scene; this lane verifies delivery, not mesh rendering.
const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }] }));
const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const glb = Buffer.alloc(20 + padded.length); glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); padded.copy(glb, 20);
const sha256 = createHash('sha256').update(glb).digest('hex');
const path = `/api/atlas/models/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/overview`;
const href = `${path}/${publicationId}/original?expectedSha256=${sha256}`;
const original = { contentType: 'model/gltf-binary', sha256, bytes: glb.length };
const descriptor = { profile: facet.profile, scope, publicationId, manifestSha256, label: 'Synthetic overview', qualification: 'provisional-overview',
  frame: { linearUnit: 'm', upAxis: 'Y', placement: 'baked-in-asset', physicalRegistration: null },
  components: [{ id: 'synthetic-building', kind: 'building', label: 'Synthetic building' }], sourceNote: 'Unbound example.', original: { ...original, href } };
const canonical = value => typeof value === 'object' && value !== null
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const frame = canonical({ profile: 'houseatlas.model-overview-bytes.v1', scope, publicationId, manifestSha256, original });
const calls = [];
const common = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
const transport = async (url, init) => {
  calls.push(url); assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'same-origin');
  assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
  assert.ok(!init.headers.Authorization && !init.headers.Cookie);
  if (url === `https://fixture.invalid${path}`) return new Response(JSON.stringify(descriptor), { headers: { ...common, 'content-type': 'application/json' } });
  assert.equal(url, `https://fixture.invalid${href}`);
  return new Response(glb, { headers: { ...common, 'content-type': original.contentType, 'content-length': String(glb.length),
    'x-atlas-model-frame': Buffer.from(frame).toString('base64url'), 'content-digest': `sha-256=:${Buffer.from(sha256, 'hex').toString('base64')}:` } });
};
for (let i = 0; i < 2; i++) {
  const asset = await readModelOverview({ selection: selected, signal: new AbortController().signal,
    origin: 'https://fixture.invalid', isCurrent: () => true, transport });
  assert.equal(asset.label, descriptor.label); assert.equal(asset.publicationId, publicationId);
  assert.deepEqual(asset.components, descriptor.components); assert.equal(asset.sourceNote, descriptor.sourceNote);
  assert.deepEqual(Buffer.from(await asset.blob.arrayBuffer()), glb);
}
assert.equal(calls.length, 4, 'fresh descriptor and original read each time');
console.log('PASS selected optional view facet; two fresh scoped GET pairs, canonical byte-frame/digest/size pins and exact returned Blob; generated data only, no renderer/browser proof');
