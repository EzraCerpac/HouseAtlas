// Named generated positive logical associations; no browser, native host or source reads.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), []);
const scratch = mkdtempSync(join(tmpdir(), 'atlas-network-connections-positive-'));
const root = fileURLToPath(new URL('../../', import.meta.url));
let projectNetworkConnections, networkConnectionNodeKey;
try {
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, `export { projectNetworkConnections, networkConnectionNodeKey } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/network-connections.ts'))};`);
  const built = await build({ root: join(root, 'frontend'), configFile: false, logLevel: 'silent', build: {
    write: false, target: 'node26', lib: { entry, formats: ['es'] },
    rolldownOptions: { output: { codeSplitting: false } }, minify: false,
  } });
  const output = Array.isArray(built) ? built[0] : built, modulePath = join(scratch, 'positive.mjs');
  writeFileSync(modulePath, output.output.find(row => row.type === 'chunk' && row.isEntry).code);
  ({ projectNetworkConnections, networkConnectionNodeKey } = await import(pathToFileURL(modulePath).href));
} finally { rmSync(scratch, { recursive: true }); }

const device = id => ({ id, label: `Generated ${id}`, kind: 'switch', mobility: 'fixed', confidence: 'recorded', notes: '', place: null });
const endpoint = (id, ownerDeviceId = null, kind = 'interface') => ({ id, label: `Generated ${id}`, kind, ownerDeviceId, notes: '' });
const link = (id, fromEndpointId, toEndpointId, kind = 'connection') => ({ id, fromEndpointId, toEndpointId, kind,
  medium: kind === 'segment-membership' ? 'powerline' : 'ethernet', confidence: 'accepted', sourceConfidence: 'generated owner report',
  temporalStatus: 'recorded claim', recordedAtPrecision: 'day', basis: 'Generated source evidence', recordedAt: '2026-10-01',
  notes: 'Generated uncertainty retained', path: null });
const graph = (key, data) => ({ key, qualification: 'Generated saved logical source; no physical cable route', data: {
  viewKey: `generated:${key}`, source: { label: `Generated source ${key}`, revision: 'generated-r1', recordedAt: '2026-10-01',
    retrievedAt: '2026-10-02', status: 'recorded', acceptedAt: null, coverage: 'complete', notes: 'Generated complete inventory' }, ...data,
} });
const anchor = (graphKey, nodeId, roomId, occurrenceId, point, nodeKind = 'device') => ({ graphKey, nodeKind, nodeId,
  roomId, occurrenceId, point, basis: 'room-summary', qualification: 'Generated admitted room association; count marker only' });
const a = anchor('source:one', 'a', 'building:one/room:a', 'occurrence:a', [10, 20]);
const b = anchor('source:one', 'b', 'building:two/room:b', 'occurrence:b', [90, 70]);
const a2 = anchor('source:one', 'a', 'building:one/room:a', 'occurrence:a2', [12, 22]);
const source = graph('source:one', { devices: [device('a'), device('b'), device('c')],
  endpoints: [endpoint('a-port', 'a'), endpoint('b-port', 'b'), endpoint('segment', null, 'segment'), endpoint('unlocated-owner-port', 'c')],
  links: [link('direct', 'a', 'b'), link('owned', 'a-port', 'b-port'), link('reverse', 'b', 'a'),
    link('parallel', 'a', 'b'), link('within', 'a', 'a-port'), link('membership:a', 'a-port', 'segment', 'segment-membership'),
    link('membership:b', 'b', 'segment', 'segment-membership'), link('unlocated', 'a', 'unlocated-owner-port')],
});
const before = JSON.stringify(source);
const projected = projectNetworkConnections([source], [b, a2, a]);
assert.deepEqual(projected.coverage, {
  devices: { total: 3, anchored: 2, unplaced: 1 }, endpoints: { total: 4, anchored: 2, unplaced: 2 },
  links: { total: 8, anchored: 5, unplaced: 3 }, sharedMediumAssociations: { total: 1, anchored: 1, unplaced: 0 },
});
assert.equal(JSON.stringify(source), before);
projected.connections.forEach((row, at) => {
  assert.equal(row.link, source.data.links[at]); assert.equal(row.source, source.data.source);
  assert.equal(row.qualification, source.qualification);
});
assert.equal(projected.connections[0].placements.length, 2, 'Every admitted room occurrence remains available across buildings');
assert.deepEqual(projected.connections[0].placements[0].to.point, b.point);
assert.equal(projected.connections[1].from.placementReason, 'explicit-owner-anchor');
assert.equal(projected.connections[1].from.nodeKey, networkConnectionNodeKey(source.key, 'endpoint', 'a-port'));
assert.equal(projected.connections[1].from.ownerDeviceKey, networkConnectionNodeKey(source.key, 'device', 'a'));
assert.equal(new Set(projected.connections.slice(0, 4).map(row => row.key)).size, 4, 'Reversed and parallel source links remain distinct');
assert.equal(projected.connections[4].placements.filter(row => row.coincident).length, 2, 'Within-room links remain available for association glyphs');
assert.equal(projected.connections[5].to.placementReason, 'owner-not-recorded');
assert.equal(projected.connections[7].to.placementReason, 'owner-without-admitted-anchor');
const shared = projected.sharedMediumAssociations[0];
assert.equal(shared.segment, source.data.endpoints[2]);
assert.equal(shared.medium, 'powerline');
assert.deepEqual(shared.memberships, source.data.links.slice(5, 7));
assert.equal(shared.memberships[0], source.data.links[5]);
assert.equal(shared.renderable, true);
assert.deepEqual(projectNetworkConnections([source], [a, b, a2]), projected, 'Anchor input ordering does not change the projection');

// Cross-type raw ID reuse remains separate in the record ledger. Direct link
// references use the established device-first contract; explicit endpoint
// anchors remain on that endpoint. No labels or inferred owner names join it.
const typed = graph('source:typed', { devices: [device('same'), device('other')], endpoints: [endpoint('same')],
  links: [link('same', 'same', 'other')] });
const typedProjection = projectNetworkConnections([typed], [anchor(typed.key, 'same', 'room:one', 'occurrence:one', [1, 2]),
  anchor(typed.key, 'same', 'room:two', 'occurrence:two', [3, 4], 'endpoint'), anchor(typed.key, 'other', 'room:three', 'occurrence:three', [5, 6])]);
assert.equal(new Set(typedProjection.nodes.map(row => row.key)).size, 3);
assert.deepEqual(typedProjection.connections[0].from.anchors[0].point, [1, 2]);
assert.deepEqual(typedProjection.nodes.find(row => row.kind === 'endpoint').anchors[0].point, [3, 4]);

// Same IDs in independent source/building frames never borrow placement.
const second = graph('source:two', { devices: [device('a'), device('b')], endpoints: [], links: [link('direct', 'a', 'b')] });
const union = projectNetworkConnections([source, second], [a, b]);
assert.equal(union.connections.at(-1).renderable, false);
assert.equal(union.connections.at(-1).from.placementReason, 'no-admitted-anchor');
assert.equal(new Set(union.nodes.map(row => row.key)).size, 9);
assert.equal(new Set(union.connections.map(row => row.key)).size, 9);
assert.equal(union.coverage.devices.total + union.coverage.endpoints.total + union.coverage.links.total, 18);
console.log('Unified Atlas network connections healthy: original/owned/parallel/within-room/shared-medium/multiple-source associations passed');
