#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// This standalone evidence check loads the real TypeScript model through the
// Vite version already installed for the frontend. It never imports the UI or
// talks to a source service.
const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = resolve(frontendRoot, 'src/lantern/overlays/network/model.ts');
const vitePath = resolve(frontendRoot, 'node_modules/vite/dist/node/index.js');
const { transformWithOxc } = await import(pathToFileURL(vitePath).href);
const source = await readFile(modelPath, 'utf8');
const { code } = await transformWithOxc(source, modelPath, { lang: 'ts', target: 'es2022' });
const modelUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const model = await import(modelUrl);

const place = (roomLabel, detail, sourceRoomId = null, mappingStatus = 'unmatched') => ({
  placeId: null,
  sourceRoomId,
  roomLabel,
  detail,
  confidence: 'accepted',
  basis: 'Accepted synthetic overlay fixture.',
  floorKey: null,
  mappingStatus,
  coordinate: null,
});

const devices = [
  ...Array.from({ length: 13 }, (_, index) => ({
    id: `fixed-${String(index + 1).padStart(2, '0')}`,
    label: `Fixed device ${index + 1}`,
    kind: index === 0 ? 'gateway' : 'access-point',
    mobility: 'fixed',
    confidence: 'accepted',
    notes: 'Synthetic source note preserved.',
    place: place(index < 7 ? 'North room' : 'South room', `Shelf ${index + 1}`,
      index < 7 ? 'source-room-north' : 'source-room-south'),
  })),
  ...Array.from({ length: 5 }, (_, index) => ({
    id: `mobile-${index + 1}`,
    label: `Mobile device ${index + 1}`,
    kind: 'phone',
    mobility: 'mobile',
    confidence: 'accepted',
    notes: 'Portable endpoint.',
    // Deliberately contradictory placement must not place a mobile device.
    place: place('North room', 'Accidental provided place', 'source-room-north'),
  })),
  {
    id: 'fixed-unplaced', label: 'Unplaced fixed endpoint', kind: 'switch',
    mobility: 'fixed', confidence: 'accepted', notes: 'Room not recorded.', place: null,
  },
  {
    id: 'nonspatial-01', label: 'Cloud service', kind: 'service',
    mobility: 'nonspatial', confidence: 'accepted', notes: 'Not a physical device.',
    // Deliberately contradictory placement must not place a nonspatial record.
    place: place('South room', 'Accidental provided place', 'source-room-south'),
  },
];

const endpoints = [
  { id: 'if-fixed-01', label: 'eth0', kind: 'interface', ownerDeviceId: 'fixed-01', notes: 'WAN interface.' },
  { id: 'if-fixed-02', label: 'lan1', kind: 'interface', ownerDeviceId: 'fixed-02', notes: 'LAN interface.' },
  { id: 'seg-core', label: 'Core segment', kind: 'segment', ownerDeviceId: null, notes: 'Source segment label.' },
  { id: 'unresolved-peer', label: 'Unresolved peer from archive', kind: 'unresolved', ownerDeviceId: null, notes: 'No owner asserted.' },
  { id: 'named-source', label: 'Named source endpoint', kind: 'named-endpoint', ownerDeviceId: null, notes: 'Accepted user-named endpoint; no device crosswalk.' },
  { id: 'named-target', label: 'Named target endpoint', kind: 'named-endpoint', ownerDeviceId: null, notes: 'Accepted user-named endpoint; no device crosswalk.' },
];

const links = Array.from({ length: 20 }, (_, index) => ({
  id: `source-link-${String(index + 1).padStart(2, '0')}`,
  fromEndpointId: index === 19 ? 'if-fixed-01' : (index % 2 ? 'if-fixed-01' : 'if-fixed-02'),
  toEndpointId: index === 19 ? 'unresolved-peer' : 'seg-core',
  kind: 'segment-membership',
  medium: index % 2 ? 'ethernet' : 'fiber',
  confidence: 'accepted',
  sourceConfidence: 'unknown',
  temporalStatus: 'historical',
  recordedAtPrecision: 'month',
  basis: 'Synthetic source record.',
  recordedAt: '2024-02',
  notes: `Source link note ${index + 1}.`,
  path: null,
}));
links.push({
  id: 'accepted-named-connection',
  fromEndpointId: 'named-source',
  toEndpointId: 'named-target',
  kind: 'connection',
  medium: 'unknown',
  confidence: 'accepted',
  sourceConfidence: 'unknown',
  temporalStatus: 'accepted-current',
  recordedAtPrecision: null,
  basis: 'Accepted synthetic user policy; source identities remain unknown.',
  recordedAt: null,
  notes: 'Accepted named connection; endpoint device IDs remain unbound.',
  path: null,
});

const data = {
  viewKey: 'synthetic-view-01',
  source: {
    label: 'Synthetic network archive', revision: 'fixture-r1',
    recordedAt: '2024-02', retrievedAt: '2026-10-10T12:00:00Z',
    status: 'accepted', acceptedAt: '2026-10-10T12:30:00Z', coverage: 'partial', notes: 'Synthetic only; accepted by explicit user policy.',
  },
  devices, links, endpoints,
};

assert.equal(devices.length, 20, 'fixture contains 13 fixed room devices, five mobile, one unplaced, and one nonspatial');
assert.equal(links.length, 21, 'the 20 source links and one accepted named connection remain present');
assert.deepEqual(links.slice(0, 20).map(link => link.id), Array.from(
  { length: 20 }, (_, index) => `source-link-${String(index + 1).padStart(2, '0')}`,
));
assert.deepEqual(endpoints.map(endpoint => endpoint.kind), [
  'interface', 'interface', 'segment', 'unresolved', 'named-endpoint', 'named-endpoint',
]);
assert.equal(data.source.status, 'accepted');
assert.equal(data.source.acceptedAt, '2026-10-10T12:30:00Z');
assert(devices.every(device => device.confidence === 'accepted'));
assert(devices.filter(device => device.place !== null).every(device => device.place.confidence === 'accepted'));
assert(links.every(link => link.confidence === 'accepted'));
assert(links.every(link => link.sourceConfidence === 'unknown'), 'unknown source confidence remains preserved independently of accepted overlay confidence');

const grouped = model.groupNetworkDevices(data.devices);
assert.deepEqual(grouped.rooms.map(room => [room.label, room.devices.length]), [['North room', 7], ['South room', 6]]);
assert.deepEqual(grouped.rooms.map(room => room.key), ['network:source-room-north', 'network:source-room-south']);
assert.deepEqual(grouped.unsited.map(device => device.id), ['fixed-unplaced']);
assert.deepEqual(grouped.excluded.map(device => device.id), [
  'mobile-1', 'mobile-2', 'mobile-3', 'mobile-4', 'mobile-5', 'nonspatial-01',
]);
assert(!grouped.rooms.flatMap(room => room.devices).some(device => device.mobility === 'mobile' || device.mobility === 'nonspatial'));
assert.equal(model.devicePlacement(devices.find(device => device.id === 'mobile-1')), 'Mobile · excluded from floor placement');
assert.equal(model.devicePlacement(devices.find(device => device.id === 'nonspatial-01')), 'Nonspatial endpoint · excluded from floor placement');
assert.equal(model.devicePlacement(devices.find(device => device.id === 'fixed-unplaced')), 'Room unknown · unsited');
assert.equal(model.devicePlacement(devices[0]), 'North room · Shelf 1');

// This read model has documentary place strings only: no helper derives floor,
// coordinate, or route geometry from labels, segment membership, or topology.
for (const device of devices) {
  if (device.place) {
    assert.equal(device.place.coordinate, null);
    assert.equal(device.place.floorKey, null);
  }
}
for (const link of links) assert.equal(link.path, null);
assert.equal(Object.hasOwn(grouped.rooms[0], 'floorKey'), false);
const northRoomDevice = devices[0];
const sameLabelDifferentSourceId = {
  ...northRoomDevice,
  id: 'same-label-different-source-room',
  place: { ...northRoomDevice.place, sourceRoomId: 'source-room-north-alt' },
};
const splitSameLabel = model.groupNetworkDevices([northRoomDevice, sameLabelDifferentSourceId]);
assert.deepEqual(splitSameLabel.rooms.map(room => [room.key, room.label, room.devices.length]), [
  ['network:source-room-north', 'North room', 1],
  ['network:source-room-north-alt', 'North room', 1],
]);

assert.equal(model.networkEndpointLabel(data, 'if-fixed-01'), 'Fixed device 1 (eth0)');
assert.equal(model.networkEndpointLabel(data, 'if-fixed-02'), 'Fixed device 2 (lan1)');
assert.equal(model.networkEndpointLabel(data, 'seg-core'), 'Core segment');
assert.equal(model.networkEndpointLabel(data, 'unresolved-peer'), 'Unresolved peer from archive');
assert.equal(model.networkEndpointLabel(data, 'missing-peer'), 'Unresolved endpoint (missing-peer)');
assert.equal(model.endpointDeviceId(data, 'if-fixed-01'), 'fixed-01');
assert.equal(model.endpointDeviceId(data, 'seg-core'), null);
assert.equal(model.endpointDeviceId(data, 'unresolved-peer'), null);
assert.equal(model.networkLinkLabel(data, links[0]), 'Fixed device 2 (lan1) ↔ Core segment');
assert.deepEqual(model.networkSelection(data, { kind: 'link', id: 'source-link-20' }), { kind: 'link', link: links[19] });
assert.equal(model.networkSelection(data, { kind: 'link', id: 'absent-link' }), null);
assert.equal(model.networkSelection(data, { kind: 'device', id: 'absent-device' }), null);
assert.equal(model.networkSelection(data, null), null);

const acceptedNamedLink = model.networkSelection(data, { kind: 'link', id: 'accepted-named-connection' }).link;
assert.equal(acceptedNamedLink.kind, 'connection');
assert.equal(acceptedNamedLink.confidence, 'accepted');
assert.equal(acceptedNamedLink.sourceConfidence, 'unknown');
assert.equal(acceptedNamedLink.temporalStatus, 'accepted-current');
assert.equal(acceptedNamedLink.recordedAt, null);
assert.equal(acceptedNamedLink.recordedAtPrecision, null);
assert.equal(acceptedNamedLink.path, null);
assert.equal(endpoints.find(endpoint => endpoint.id === acceptedNamedLink.fromEndpointId).ownerDeviceId, null);
assert.equal(endpoints.find(endpoint => endpoint.id === acceptedNamedLink.toEndpointId).ownerDeviceId, null);
assert.equal(model.networkLinkLabel(data, acceptedNamedLink), 'Named source endpoint ↔ Named target endpoint');

const historical = model.networkSelection(data, { kind: 'link', id: 'source-link-01' }).link;
assert.equal(historical.recordedAt, '2024-02');
assert.equal(historical.recordedAtPrecision, 'month');
assert.equal(historical.temporalStatus, 'historical');
assert.equal(historical.sourceConfidence, 'unknown');

const sourceSnapshot = JSON.stringify(data);
const graph = model.networkGraph(data);
assert.equal(graph.edges.length, 21);
assert.deepEqual(graph.edges.map(edge => edge.link.id), links.map(link => link.id));
for (let index = 0; index < links.length; index++) assert.strictEqual(graph.edges[index].link, links[index]);
assert.equal(graph.nodes.filter(node => node.kind === 'device').length, devices.length);
assert.equal(graph.nodes.some(node => node.id === 'if-fixed-01' || node.id === 'if-fixed-02'), false,
  'bound interfaces are labels on owning device nodes, not extra physical nodes');
assert.equal(graph.nodes.filter(node => node.id === 'fixed-01').length, 1);
assert.equal(graph.nodes.find(node => node.id === 'seg-core').kind, 'segment');
assert.equal(graph.nodes.find(node => node.id === 'unresolved-peer').kind, 'unresolved');
assert.equal(graph.nodes.find(node => node.id === 'named-source').kind, 'named-endpoint');
assert.equal(graph.nodes.find(node => node.id === 'named-target').kind, 'named-endpoint');
const acceptedEdge = graph.edges.find(edge => edge.link.id === 'accepted-named-connection');
assert.deepEqual([acceptedEdge.from, acceptedEdge.to], ['named-source', 'named-target']);
assert.equal(acceptedEdge.link.confidence, 'accepted');
assert.equal(acceptedEdge.link.sourceConfidence, 'unknown');
assert.equal(graph.positions.size, graph.nodes.length);
assert(graph.width >= 840 && graph.height > 0);
for (const [id, position] of graph.positions) {
  assert(graph.nodes.some(node => node.id === id));
  assert.equal(position.length, 2);
  assert(position.every(Number.isFinite));
}
assert.equal(JSON.stringify(data), sourceSnapshot, 'graph layout must not mutate source place or endpoint data');
assert(data.devices.filter(device => device.place !== null).every(device => device.place.coordinate === null && device.place.floorKey === null));
assert(data.links.every(link => link.path === null));

const danglingInput = {
  ...data,
  links: data.links.map((link, index) => index === 0 ? { ...link, toEndpointId: 'dangling-source-endpoint' } : link),
};
const danglingGraph = model.networkGraph(danglingInput);
assert.equal(danglingGraph.edges.length, 21, 'a dangling endpoint does not drop its supplied edge');
assert(danglingGraph.edges.some(edge => edge.link.id === links[0].id && edge.to === 'dangling-source-endpoint'));
assert.deepEqual(danglingGraph.nodes.find(node => node.id === 'dangling-source-endpoint'), {
  id: 'dangling-source-endpoint', label: 'Unresolved endpoint (dangling-source-endpoint)', kind: 'unresolved', device: null,
});
assert.equal(JSON.stringify(data), sourceSnapshot, 'handling an input with a dangling endpoint does not mutate the source input');

console.log(`PASS network overlay model and graph: ${devices.length} synthetic devices, ${links.length} source edges, explicit accepted policy, preserved unknown source confidence, unbound named endpoints, source identity grouping, dangling endpoint recovery, dates, and no invented placement/routes`);
