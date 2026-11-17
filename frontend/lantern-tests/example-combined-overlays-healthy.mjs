// Generated example owner, production reader and documentary projection only.
// No browser, native authority, provider, real household or device evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    `export { electricalGroups } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/electrical-group.ts'))};`,
    `export { traceElectricalGroup } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/electrical-trace.ts'))};`,
    `export { exampleElectricalInput, exampleElectricalProjection } from ${JSON.stringify(join(root, 'frontend/example/electrical-data.ts'))};`,
    `export { traceToRoot } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/network-trace.ts'))};`,
    `export { buildGraph } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/NetworkGraph.tsx'))};`,
    `export { admittedNetworkDevices, networkLinkStyle, networkUnplacedReason, uncertainLink } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/network-map.ts'))};`,
  ].join('\n'));
  // Expose the actual non-exported builder only in this test bundle.
  const graphPath = join(root, 'frontend/src/lantern/unified-atlas/NetworkGraph.tsx');
  const exposeGraph = { name: 'test-only-network-builder', enforce: 'pre', transform(code, id) {
    if (id === graphPath) return `${code}\nexport { buildGraph };\n`;
  } };
  const result = await build({ root: join(root, 'frontend'), configFile: false, logLevel: 'silent', plugins: [exposeGraph],
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
// The admitted scene exposes selectable IDs under `selectable`, not the
// publication envelope's `selectableOccurrences` field.
assert.ok(Array.isArray(scene.coverage.selectable));
const selectable = new Set(scene.coverage.selectable);
const records = api.documentaryRoomRecords(scene, frame, selectable);
assert.deepEqual(['syn-room-hall', 'syn-room-living'].map(id => records.rooms.get(id).electrical.length), [3, 1]);
// Network: every placed device sits in its own reviewed room; the root is in Living room.
const networkIds = id => records.rooms.get(id).network.map(row => row.id).sort();
assert.deepEqual(['syn-room-hall', 'syn-room-living', 'syn-room-stairs', 'syn-room-bedroom-b'].map(networkIds),
  [['example-switch'], ['example-printer', 'example-root', 'example-speaker', 'example-streaming-box'], ['example-access-point'], ['example-desk-computer']]);
const graph = api.buildGraph(frame.network.data);
assert.equal(graph.nodes.size, 9, 'the Devices list shows the nine fictional devices');
// The map draws devices only where their own reviewed room record admits them.
const admitted = api.admittedNetworkDevices(records);
assert.deepEqual(admitted.map(row => `${row.roomId}:${row.deviceId}`).sort(), ['syn-room-bedroom-b:example-desk-computer', 'syn-room-hall:example-switch',
  'syn-room-living:example-printer', 'syn-room-living:example-root', 'syn-room-living:example-speaker', 'syn-room-living:example-streaming-box',
  'syn-room-stairs:example-access-point']);
// A graph without the parser-owned record keys places nothing, whatever its names say.
assert.deepEqual(api.admittedNetworkDevices({ ...records, networkGraphs: records.networkGraphs.map(row => ({ ...row, deviceRecordKeys: undefined })) }), []);
const links = new Map(frame.network.data.links.map(row => [row.id, row]));
assert.deepEqual(['example-link', 'example-link-speaker', 'example-link-printer', 'example-link-camera', 'example-link-box'].map(id => api.networkLinkStyle(links.get(id))),
  ['wired', 'wireless', 'unknown', 'unknown', 'wireless']);
assert.equal(api.networkLinkStyle(links.get('example-link'), [{ nodeKey: null }]), 'unknown', 'an unresolved end takes the unknown style');
// Only the source's own word for a medium sets the style: a bare "LAN" names none.
assert.deepEqual(['wireless LAN', '802.11 LAN', 'LAN', 'powerline'].map(medium => api.networkLinkStyle({ ...links.get('example-link'), medium })),
  ['wireless', 'wireless', 'unknown', 'wired']);
assert.deepEqual(['example-link-box', 'example-link'].map(id => api.uncertainLink(links.get(id))), [true, false]);
const devicesById = new Map(frame.network.data.devices.map(row => [row.id, row]));
assert.deepEqual(['example-tablet', 'example-garden-camera'].map(id => api.networkUnplacedReason(devicesById.get(id))), ['moves-around', 'no-reviewed-room']);
assert.ok(!admitted.some(row => row.deviceId === 'example-tablet' || row.deviceId === 'example-garden-camera'));
// One device carries invented Network source facts; the others carry none.
assert.deepEqual(frame.network.data.devices.filter(row => row.liveFacts).map(row => row.id), ['example-access-point']);
const route = from => api.traceToRoot(graph.nodes.values(), graph.edges, `d:${from}`);
const trace = route('example-access-point');
assert.equal(trace.status, 'traced');
assert.deepEqual(trace.nodes, ['d:example-access-point', 'd:example-root']);
assert.equal(trace.root, 'd:example-root');
assert.deepEqual(trace.edges.map(edge => edge.link.id), ['example-link']);
assert.deepEqual(trace.certain, [true]);
assert.equal(trace.uncertain, false);
// Hall to Living room through the switch, and a tentative hop that stays uncertain.
assert.deepEqual(route('example-switch').nodes, ['d:example-switch', 'd:example-root']);
const tentative = route('example-streaming-box');
assert.deepEqual(tentative.nodes, ['d:example-streaming-box', 'd:example-switch', 'd:example-root']);
assert.deepEqual(tentative.certain, [false, true]);
assert.equal(tentative.uncertain, true);
assert.equal(route('example-root').status, 'is-root');
// Electrical: one historic drawing group spans Hall and Living room; one symbol has none.
// The group itself claims no circuit or wiring; the fictional projection below does.
assert.equal(frame.electricity.status, 'unavailable');
const groups = api.electricalGroups(records);
assert.equal(groups.length, 1);
const [group] = groups;
assert.deepEqual([group.groupId, group.label, group.missing], ['example-group-1', 'Fictional drawing group 1', 0]);
assert.deepEqual(group.fixtureIds, ['example-symbol-0', 'example-symbol-1', 'example-symbol-3']);
assert.deepEqual(group.members.map(row => [row.record.id, row.rooms.join()]).sort(),
  [['example-symbol-0', 'syn-room-hall'], ['example-symbol-1', 'syn-room-hall'], ['example-symbol-3', 'syn-room-living']]);
assert.ok(!group.members.some(row => row.record.id === 'example-symbol-2'), 'the symbol without a drawn group stays unknown');
assert.ok(frame.electricalFixtures.data.groups.every(row => row.currentCircuitId === null && row.verifiedWiring === false));
// Selecting the group highlights its member symbols' rooms.
assert.deepEqual([...new Set(group.members.flatMap(row => row.rooms))].sort(), ['syn-room-hall', 'syn-room-living']);

// Fictional current panel/circuit data: the actual #557 projector on the
// example's input, with every review made current here, gives exactly the
// projection the page ships, for exactly the ledger bytes this frame shows.
const { createElectricalDataProjector, electricalReviewSubject } = await import(pathToFileURL(join(root, 'packages/contracts/src/electrical-data.mjs')).href);
const json = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const project = createElectricalDataProjector(json('contracts/electrical-data/v1.schema.json'), json('packages/contracts/schemas/atlas.v2.schema.json'));
const traceSource = frame.electricalData, ledger = frame.electricalFixtures.data;
const hall = scene.rooms.find(row => row.roomId === 'syn-room-hall');
assert.equal(traceSource.ledger.sha256, createHash('sha256').update(JSON.stringify(ledger)).digest('hex'));
assert.deepEqual(traceSource.ledger, { ...group.source, viewKey: ledger.viewKey, sha256: traceSource.ledger.sha256 });
assert.equal(traceSource.roomBindings, frame.roomBindings);
const input = api.exampleElectricalInput(api.EXAMPLE_SCOPE, ledger.viewKey, ledger, traceSource.ledger.sha256, hall.nativePlaceId);
const reviews = ['panel', 'breaker', 'mapping'].flatMap(kind => input.data[`${kind}s`].map(row =>
  ({ receipt: row.review.receipt, subject: electricalReviewSubject(input.data, kind, row) })));
const projected = project(input.data, { ...input.context, currentReviews: reviews });
assert.deepEqual(traceSource.projection, projected);
assert.deepEqual(api.exampleElectricalProjection(input), projected);
assert.deepEqual(projected.mappings.map(row => [row.status, row.verifiedWiring]), [['reviewed-association', true], ['reviewed-association', false]]);
// Without current reviews the same projector withholds every row.
const unreviewed = project(input.data, { ...input.context, currentReviews: [] });
assert.ok([...unreviewed.panels, ...unreviewed.breakers, ...unreviewed.mappings].every(row => row.status === 'withheld'));
// The Atlas trace of the selected group: A1 tested on symbol 1 (Hall), A2
// untested with unknown rating and protection on symbol 4 (Living room),
// symbol 2 without a circuit, and the panel's reviewed room is Hall.
const circuits = api.traceElectricalGroup(group, traceSource);
assert.equal(circuits.status, 'traced');
assert.deepEqual(circuits.rows.map(row => [row.coverage.label, row.circuit.label, row.test?.observedAt ?? null,
  row.circuit.details.ratingAmperes, row.circuit.details.protection, row.circuit.panel.label, row.circuit.panel.room]), [
  ['Fictional symbol 1', 'Fictional circuit A1', '2026-01-02T09:00:00Z', 16, 'Fictional label: RCD 30 mA', 'Fictional panel',
    { kind: 'room', roomId: 'syn-room-hall', nativePlaceId: hall.nativePlaceId }],
  ['Fictional symbol 4', 'Fictional circuit A2', null, null, null, 'Fictional panel',
    { kind: 'room', roomId: 'syn-room-hall', nativePlaceId: hall.nativePlaceId }]]);
assert.deepEqual(circuits.uncovered, [{ fixtureId: 'example-symbol-1', label: 'Fictional symbol 2' }]);
assert.ok(hall.occurrenceIds.some(id => selectable.has(id)), 'the panel room button selects a Hall part');
assert.deepEqual(api.traceElectricalGroup(group, { ...traceSource, ledger: { ...traceSource.ledger, sha256: 'f'.repeat(64) } }),
  { status: 'refused', reason: 'source-mismatch' });
const mismatch = { ...frame, sourceSelection: { ...frame.sourceSelection, acceptedRoomReceiptSha256: 'f'.repeat(64) } };
const refused = api.documentaryRoomRecords(scene, mismatch, selectable);
assert.equal(refused.rooms.get('syn-room-stairs').network.length, 0);
assert.deepEqual(api.admittedNetworkDevices(refused), []);
assert.equal(refused.rooms.get('syn-room-hall').electrical.length, 0);
let invalidations = 0;
handle.source.subscribeInvalidation(frame, () => { invalidations++; });
controller.abort();
assert.equal(invalidations, 1);
assert.equal(handle.source.isCurrent(frame), false);
handle.source.release(frame); handle.source.dispose();
assert.equal(invalidations, 1);
await assert.rejects(handle.source.open(handle.request, new AbortController().signal));
{
  const factory = new AbortController(), opening = new AbortController();
  const fresh = await api.createExampleOverlays(selection, scene, house, factory.signal);
  await assert.rejects(fresh.source.open({ ...fresh.request }, opening.signal));
  const owned = await fresh.source.open(fresh.request, opening.signal);
  assert.equal(fresh.source.isCurrent({ ...owned }), false);
  let notices = 0;
  fresh.source.subscribeInvalidation(owned, () => { notices++; });
  opening.abort();
  assert.equal(factory.signal.aborted, false);
  assert.equal(fresh.source.isCurrent(owned), false);
  factory.abort(); fresh.source.release(owned); fresh.source.dispose();
  assert.equal(notices, 1, 'opening abort retires once and detaches the factory signal');
}
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
console.log('PASS fictional example combined overlays: reader, room joins, drawing group, tested and untested fictional circuits through the actual projector, network routes and owner retirement (pure)');
