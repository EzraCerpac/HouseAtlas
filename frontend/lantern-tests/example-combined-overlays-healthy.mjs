// Generated example owner, production reader and documentary projection only.
// No browser, native authority, provider, real household or device evidence.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

assert.deepEqual(process.argv.slice(2), []);
const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'example-overlays-'));
let api;
try {
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, [
    `export { createExampleOverlays } from ${JSON.stringify(join(root, 'frontend/example/synthetic-overlays.ts'))};`,
    `export { EXAMPLE_SCOPE } from ${JSON.stringify(join(root, 'frontend/example/household.ts'))};`,
    `export { buildSyntheticAtlas, composeAtlasEnvelope, createAtlasTransport, atlasScenePath, SYNTHETIC_ATLAS } from ${JSON.stringify(join(root, 'frontend/lantern-tests/unified-atlas/synthetic-atlas.ts'))};`,
    `export { readUnifiedAtlas } from ${JSON.stringify(join(root, 'frontend/integration/unified-atlas-reader.ts'))};`,
    `export { documentaryRoomRecords, matchesOverlayScene } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/runtime-overlays.ts'))};`,
    `export { traceToRoot } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/network-trace.ts'))};`,
  ].join('\n'));
  const result = await build({ root: join(root, 'frontend'), configFile: false, logLevel: 'silent',
    build: { write: false, target: 'node26', lib: { entry, formats: ['es'] }, rolldownOptions: { output: { codeSplitting: false } }, minify: false } });
  const path = join(scratch, 'fixture.mjs');
  writeFileSync(path, (Array.isArray(result) ? result[0] : result).output.find(row => row.type === 'chunk' && row.isEntry).code);
  api = await import(pathToFileURL(path).href);
} finally { rmSync(scratch, { recursive: true }); }

const generated = await api.buildSyntheticAtlas(api.EXAMPLE_SCOPE);
const composed = await api.composeAtlasEnvelope(generated.companionBytes, generated.glb, api.SYNTHETIC_ATLAS.revision);
const selection = { owner: {}, scope: api.EXAMPLE_SCOPE, expiresAt: '2099-01-01T00:00:00Z', publicationId: composed.publicationId, manifestSha256: composed.manifestSha256 };
const transport = api.createAtlasTransport({ origin: api.SYNTHETIC_ATLAS.origin, scenePath: api.atlasScenePath(composed.scope),
  envelopeBytes: composed.envelopeBytes, href: composed.href, glb: generated.glb, sha256: composed.sha256,
  manifestSha256: composed.manifestSha256, revision: api.SYNTHETIC_ATLAS.revision });
const controller = new AbortController();
const read = await api.readUnifiedAtlas({ selection, signal: controller.signal, origin: api.SYNTHETIC_ATLAS.origin, isCurrent: () => true, transport });
const scene = read.scene, house = scene.buildings.find(row => row.buildingId === 'syn-building-house');
const handle = await api.createExampleOverlays(selection, scene, house, controller.signal);
assert.ok(handle);
const frame = await handle.source.open(handle.request, controller.signal);
assert.equal(frame.status, 'available');
assert.equal(handle.source.isCurrent(frame), true);
assert.equal(api.matchesOverlayScene(frame, scene, house.buildingId), true);
const records = api.documentaryRoomRecords(scene, frame, new Set(scene.coverage.selectableOccurrences));
assert.deepEqual(['syn-room-hall', 'syn-room-living'].map(id => records.rooms.get(id).electrical.length), [3, 1]);
assert.equal(records.rooms.get('syn-room-stairs').network.length, 1);
assert.equal(records.rooms.get('syn-room-stairs').network[0].id, 'example-access-point');
const data = frame.network.data, nodes = data.devices.map(device => ({ id: device.id, device }));
const edge = { key: data.links[0].id, a: data.links[0].fromEndpointId, b: data.links[0].toEndpointId, link: data.links[0] };
assert.deepEqual(api.traceToRoot(nodes, [edge], 'example-access-point').nodes, ['example-access-point', 'example-root']);
const mismatch = { ...frame, sourceSelection: { ...frame.sourceSelection, acceptedRoomReceiptSha256: 'f'.repeat(64) } };
const refused = api.documentaryRoomRecords(scene, mismatch, new Set(scene.coverage.selectableOccurrences));
assert.equal(refused.rooms.get('syn-room-stairs').network.length, 0);
assert.equal(refused.rooms.get('syn-room-hall').electrical.length, 0);
let invalidations = 0;
handle.source.subscribeInvalidation(frame, () => { invalidations++; });
controller.abort();
assert.equal(invalidations, 1);
assert.equal(handle.source.isCurrent(frame), false);
handle.source.release(frame); handle.source.dispose();
assert.equal(invalidations, 1);
await assert.rejects(handle.source.open(handle.request, new AbortController().signal));
for (const action of ['release', 'dispose']) {
  const fresh = await api.createExampleOverlays(selection, scene, house, new AbortController().signal);
  const owned = await fresh.source.open(fresh.request, new AbortController().signal);
  let notices = 0;
  fresh.source.subscribeInvalidation(owned, () => { notices++; });
  if (action === 'release') fresh.source.release(owned); else fresh.source.dispose();
  assert.equal(fresh.source.isCurrent(owned), false);
  fresh.source.dispose();
  assert.equal(notices, 1, `${action} retires this owner once`);
}
console.log('PASS fictional example combined overlays: reader, room joins, trace and owner retirement (pure)');
