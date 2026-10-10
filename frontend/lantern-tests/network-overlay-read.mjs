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

const planAssociations = [{ sourceAnchorId: 'synthetic-source:TEXT:HANDLE', sourceFloorKey: 'reviewed-export', sourceFloorLabel: 'Reviewed upper plan',
  sourceReference: 'R4', sourceHandle: 'SYNTHETIC-TEXT-HANDLE', sourceSHA256: 'synthetic-source-hash', mappingReceiptSHA256: 'synthetic-receipt-hash' }];
const canonical = data.devices.slice(0, 3).map((device, index) => ({ ...device, place: { ...device.place,
  sourceRoomId: `document-room-${index}`, sourcePlaceId: index < 2 ? 'canonical-room-A' : 'canonical-room-B',
  sourcePlaceUUID: index < 2 ? 'stable-document-uuid-A' : 'stable-document-uuid-B', planAssociations,
} }));
const canonicalSnapshot = JSON.stringify(canonical);
const canonicalGroups = model.groupNetworkDevices(canonical);
assert.equal(canonicalGroups.rooms.length, 2, 'reviewed canonical identities group documented aliases; equal labels do not merge different places');
assert.equal(canonicalGroups.rooms[0].key, 'documentary:canonical-room-A');
assert.equal(canonicalGroups.rooms[0].devices.length, 2);
const namespaceGroups = model.groupNetworkDevices([
  canonical[0], { ...canonical[2], place: { ...canonical[2].place, sourcePlaceId: null, sourceRoomId: 'canonical-room-A' } },
  { ...canonical[1], place: { ...canonical[1].place, placeId: 'canonical-room-A' } },
]);
assert.equal(namespaceGroups.rooms.length, 3, 'native, canonical documentary and network source room identities have separate namespaces');
const withPlans = { ...data, devices: [...canonical, ...data.devices.slice(3)] };
const withPlanGraph = model.networkGraph(withPlans);
assert.deepEqual([...withPlanGraph.positions], [...graph.positions], 'reviewed plan references never become graph or device coordinates');
assert(canonical.every(device => device.place.placeId === null && device.place.coordinate === null && device.place.floorKey === null));
assert.equal(JSON.stringify(canonical), canonicalSnapshot, 'canonical grouping and graph leave evidence unchanged');

const reviewedData = { ...withPlans, source: { ...data.source, roomMappingReceipt: { id: 'synthetic-receipt', sha256: 'synthetic-receipt-hash' } } };
assert.equal(model.networkPlanReferences(reviewedData, canonical[0]).length, 1);
assert.equal(model.networkPlanReferences(data, canonical[0]).length, 0, 'missing source receipt cannot present a reviewed plan');
assert.equal(model.networkPlanReferences({ ...reviewedData, source: { ...reviewedData.source, roomMappingReceipt: { id: 'other', sha256: 'other-hash' } } }, canonical[0]).length, 0);
const context = { viewKey: data.viewKey, status: 'accepted', receiptId: 'synthetic-receipt', receiptSha256: 'synthetic-receipt-hash',
  sourceAnchorIds: ['synthetic-source:TEXT:HANDLE'], targets: [{ packagePlaceKey: 'canonical-room-A', packagePlaceUuid: 'stable-document-uuid-A' }],
  unresolvedLabels: ['Unknown span component'] };
assert.equal(model.networkReviewedPlaces(reviewedData, null), null, 'no documentary context preserves building behavior');
assert.deepEqual(model.networkReviewedPlaces(reviewedData, context).devices.map(device => device.id), canonical.slice(0, 2).map(device => device.id));
const multiTarget = { ...context, targets: [...context.targets, { packagePlaceKey: 'canonical-room-B', packagePlaceUuid: 'stable-document-uuid-B' }] };
assert.equal(model.networkReviewedPlaces(reviewedData, multiTarget).devices.length, 3, 'reviewed spans retain multiple targets');
assert.deepEqual(multiTarget.unresolvedLabels, ['Unknown span component']);
for (const fenced of [{ ...context, viewKey: 'other-view' }, { ...context, status: 'proposed' },
  { ...context, status: 'unmatched' }, { ...context, receiptSha256: 'changed-receipt' }, { ...context, receiptId: 'other-receipt' }]) {
  const result = model.networkReviewedPlaces(reviewedData, fenced);
  assert.equal(result.eligible, false);
  assert.equal(result.devices.length, 0);
}
assert.equal(model.networkReviewedPlaces(reviewedData, { ...context, targets: [{ packagePlaceKey: 'canonical-room-A', packagePlaceUuid: 'wrong-uuid' }] }).devices.length, 0);
assert.equal(model.networkReviewedPlaces(reviewedData, { ...context, sourceAnchorIds: ['other-source-anchor'] }).devices.length, 0);
assert.equal(model.networkReviewedPlaces(data, context).eligible, false, 'a source without the receipt cannot accept its selection');
const extendedPlans = { ...canonical[0], place: { ...canonical[0].place, planAssociations: [...planAssociations, { ...planAssociations[0], sourceAnchorId: 'different-anchor', sourceReference: 'P1' }] } };
const extendedData = { ...reviewedData, devices: [extendedPlans, ...reviewedData.devices.slice(1)] };
assert.equal(model.networkPlanReferences(extendedData, extendedPlans, context).length, 1, 'selected source anchors bound reviewed reference details');
assert.equal(model.networkPlanReferences(extendedData, extendedPlans).length, 2, 'building context retains all reviewed aliases');
assert.equal(model.networkPlanReferences(extendedData, extendedPlans, { ...context, receiptSha256: 'stale' }).length, 0);
assert.equal(model.networkPlanReferences(extendedData, canonical[2], context).length, 0, 'exact key and UUID also fence plan details');
assert.equal(JSON.stringify(canonical), canonicalSnapshot, 'selection matching never writes evidence or unresolved span components');

// Load the actual scene join against the same transformed model. This tests
// documentary admission, not a replica of camera/layout implementation.
const scenePath = resolve(frontendRoot, 'src/lantern/overlays/network/scene.ts');
const sceneSource = await readFile(scenePath, 'utf8');
const sceneCode = (await transformWithOxc(sceneSource, scenePath, { lang: 'ts', target: 'es2022' })).code
  .replace(/from ["']\.\/model["']/g, `from "${modelUrl}"`);
const sceneModel = await import(`data:text/javascript;base64,${Buffer.from(sceneCode).toString('base64')}`);
const sceneAnchor = { id: 'display-room-A', viewKey: data.viewKey, packagePlaceKey: 'canonical-room-A',
  packagePlaceUuid: 'stable-document-uuid-A', sourceAnchorIds: context.sourceAnchorIds, receiptId: context.receiptId,
  receiptSha256: context.receiptSha256, floorKey: 'reviewed-export', base: [150, 200], top: [150, 170],
  visible: true, basis: 'schematic-room' };
// Two real endpoint-owning interfaces within room A and a connection to a
// separately shown floor. Other source associations remain unplaced records.
const sceneData = { ...reviewedData,
  devices: reviewedData.devices.map((device, index) => index === 2 ? { ...device,
    place: { ...device.place, planAssociations: planAssociations.map(ref => ({ ...ref, sourceFloorKey: 'second-export' })) } } : device),
  links: reviewedData.links.map((link, index) => index < 2 ? { ...link, kind: 'connection',
    fromEndpointId: index === 0 ? 'if-fixed-01' : 'if-fixed-02',
    toEndpointId: index === 0 ? 'if-fixed-02' : canonical[2].id } : link),
};
const secondAnchor = { ...sceneAnchor, id: 'display-room-B', packagePlaceKey: 'canonical-room-B',
  packagePlaceUuid: 'stable-document-uuid-B', floorKey: 'second-export', base: [160, 300], top: [160, 270] };
const sceneSnapshot = JSON.stringify(sceneData);
const sceneJoin = sceneModel.networkSceneProjection(sceneData, [sceneAnchor], [450, 80], 1, context);
assert.deepEqual(sceneJoin.placed.map(entry => entry.device.id), canonical.slice(0, 2).map(device => device.id));
assert(sceneJoin.placed.every(entry => entry.anchor === sceneAnchor && entry.base === sceneAnchor.base),
  'devices share the reviewed room anchor; separate heads are display-only');
assert.equal(sceneJoin.nodes.filter(node => node.kind === 'device').length, 20);
assert.equal(sceneJoin.edges.length, 1, 'partial floor coverage admits only the within-room mapped pair');
assert.deepEqual(sceneJoin.edges.map(edge => edge.link.id), [data.links[0].id]);
assert.equal(sceneData.links.length, 21, 'scene filtering never drops stored topology records');
assert.equal(sceneJoin.unplaced.length, 18);
assert.equal(JSON.stringify(sceneData), sceneSnapshot);
assert(sceneData.devices.every(device => !device.place || device.place.coordinate === null));
assert(sceneData.links.every(link => link.path === null));
for (const wrongAnchor of [{ ...sceneAnchor, viewKey: 'other-view' }, { ...sceneAnchor, receiptId: 'other-receipt' },
  { ...sceneAnchor, receiptSha256: 'stale-hash' }, { ...sceneAnchor, packagePlaceKey: 'other-room' },
  { ...sceneAnchor, packagePlaceUuid: 'other-uuid' }, { ...sceneAnchor, sourceAnchorIds: ['other-anchor'] },
  { ...sceneAnchor, floorKey: 'other-export' }, { ...sceneAnchor, visible: false },
  { ...sceneAnchor, basis: 'measured-device' }, { ...sceneAnchor, top: [Infinity, 170] }]) {
  const joined = sceneModel.networkSceneProjection(sceneData, [wrongAnchor], [450, 80], 1, context);
  assert.equal(joined.placed.length, 0);
  assert.equal(joined.edges.length, 0, 'missing or rejected anchors cannot produce scene edges');
}
assert.equal(sceneModel.networkSceneProjection(sceneData, [sceneAnchor], [450, 80], 1, { ...context, status: 'proposed' }).placed.length, 0);
assert.equal(sceneModel.networkSceneProjection(sceneData, [sceneAnchor, sceneAnchor], [450, 80]).placed.length, 2,
  'duplicate display anchors never duplicate device pins');
const portableScene = { ...sceneData, devices: sceneData.devices.map((device, index) => index < 2
  ? { ...device, mobility: index === 0 ? 'mobile' : 'nonspatial' } : device) };
assert.equal(sceneModel.networkSceneProjection(portableScene, [sceneAnchor], [450, 80]).placed.length, 0,
  'contradictory mobile/nonspatial room fields never receive scene markers');
const unknownScene = { ...sceneData, devices: sceneData.devices.map((device, index) => index < 2 ? { ...device, mobility: 'unknown' } : device) };
assert.equal(sceneModel.networkSceneProjection(unknownScene, [sceneAnchor], [450, 80]).placed.length, 0);
assert.equal(JSON.stringify(sceneData), sceneSnapshot, 'presentation never writes device/source geometry');

const fullScene = sceneModel.networkSceneProjection(sceneData, [sceneAnchor, secondAnchor], [450, 80]);
assert.equal(fullScene.placed.length, 3);
assert.deepEqual(fullScene.edges.map(edge => edge.link.id), data.links.slice(0, 2).map(link => link.id),
  'a cross-floor association is shown only when both endpoint anchors are visible');
assert(fullScene.edges.every(edge => fullScene.placed.some(p => p.device.id === edge.from)
  && fullScene.placed.some(p => p.device.id === edge.to)));
assert(fullScene.edges.every(edge => edge.fromPoint !== fullScene.dock && edge.toPoint !== fullScene.dock),
  'the unplaced records dock never serves as a topology endpoint');
for (const visibleAnchors of [[], [secondAnchor], [{ ...sceneAnchor, visible: false }, secondAnchor]]) {
  assert.equal(sceneModel.networkSceneProjection(sceneData, visibleAnchors, [450, 80]).edges.length, 0,
    'missing first-floor coverage or selected-floor visibility removes every incomplete pair');
}
assert.equal(sceneModel.networkSceneProjection(sceneData, [sceneAnchor, { ...secondAnchor, visible: false }], [450, 80]).edges.length, 1);
assert.equal(sceneModel.networkSceneProjection(sceneData, [sceneAnchor, secondAnchor], [450, 80], 1, context).edges.length, 1,
  'documentary room selection cannot expose an edge to a device without a current admitted marker');
assert.equal(sceneModel.networkSceneProjection(sceneData, [sceneAnchor, secondAnchor], [450, 80], 1, multiTarget).edges.length, 2);
assert.equal(sceneModel.networkSceneProjection(portableScene, [sceneAnchor, secondAnchor], [450, 80]).edges.length, 0);
assert.equal(sceneModel.networkSceneProjection(unknownScene, [sceneAnchor, secondAnchor], [450, 80]).edges.length, 0);
const nativeOnlyScene = { ...sceneData, devices: sceneData.devices.map((device, index) => index < 2
  ? { ...device, place: { ...device.place, placeId: sceneAnchor.packagePlaceKey,
      sourcePlaceId: null, sourcePlaceUUID: null } } : device) };
const nativeOnlyJoin = sceneModel.networkSceneProjection(nativeOnlyScene, [sceneAnchor, secondAnchor], [450, 80]);
assert.equal(nativeOnlyJoin.placed.length, 1, 'matching native IDs cannot substitute for documentary key and UUID');
assert.equal(nativeOnlyJoin.edges.length, 0);
assert.equal(model.networkGraph(nativeOnlyScene).edges.length, 21, 'native-only records retain all source topology');
assert.equal(JSON.stringify(sceneData), sceneSnapshot, 'scene edge visibility never mutates full topology or source geometry');

// Shared-medium memberships are documentary associations, not direct cables.
// Two reviewed members on separate floors can be connected without placing the
// abstract segment or drawing a fanout to the third, unplaced member.
const membership = (index, endpoint) => ({ ...sceneData.links[index], kind: 'segment-membership',
  confidence: 'accepted', medium: 'powerline', fromEndpointId: endpoint, toEndpointId: 'seg-core' });
const sharedData = { ...sceneData, links: sceneData.links.map((link, index) => index < 3
  ? membership(index, [canonical[0].id, canonical[2].id, 'fixed-04'][index]) : link) };
const sharedSnapshot = JSON.stringify(sharedData);
const sharedAssociations = model.networkSharedMediumAssociations(sharedData).filter(pair => pair.medium === 'powerline');
assert.equal(sharedAssociations.length, 3, 'three distinct accepted members share one medium; no chain order is asserted');
const sharedPair = sharedAssociations.find(pair => pair.from === canonical[0].id && pair.to === canonical[2].id);
assert(sharedPair);
assert.deepEqual(sharedPair.memberships.map(link => link.id), sharedData.links.slice(0, 2).map(link => link.id));
assert(sharedPair.memberships.every(link => sharedData.links.includes(link)), 'details retain actual source relation objects');
const sharedSelection = { kind: 'shared-medium', id: sharedPair.id };
assert.deepEqual(model.networkSelection(sharedData, sharedSelection), { kind: 'shared-medium', association: sharedPair });
assert.equal(model.networkSelection(sharedData, { ...sharedSelection, id: 'unrecorded-pair' }), null);
assert.equal(model.networkSceneSelection(sharedData, sharedSelection, [sharedPair.from, sharedPair.to]).kind, 'shared-medium');
assert.equal(model.networkSceneSelection(sharedData, sharedSelection, [sharedPair.from]), null, 'a stale pair selection expires when a member leaves the scene');
assert.equal(model.networkSceneSelection(sharedData, sharedSelection, [sharedPair.from, sharedPair.to], context), null);
assert.equal(model.networkSceneSelection(sharedData, sharedSelection, [sharedPair.from, sharedPair.to], multiTarget).kind, 'shared-medium');
assert.equal(model.networkSceneSelection(sharedData, sharedSelection, [sharedPair.from, sharedPair.to], { ...multiTarget, status: 'proposed' }), null);

const sharedScene = sceneModel.networkSceneProjection(sharedData, [sceneAnchor, secondAnchor], [450, 80]);
assert.equal(sharedScene.edges.filter(edge => edge.association).length, 1);
assert.deepEqual(sharedScene.edges.find(edge => edge.association).selection, sharedSelection);
assert(sharedScene.edges.every(edge => sharedScene.placed.some(pin => pin.device.id === edge.from)
  && sharedScene.placed.some(pin => pin.device.id === edge.to)));
assert(!sharedScene.edges.some(edge => edge.from === 'fixed-04' || edge.to === 'fixed-04'));
assert.equal(model.networkGraph(sharedData).edges.length, 21);
assert.equal(sharedData.links.length, 21, 'display pairs never become new stored links');
for (const visibleAnchors of [[], [sceneAnchor], [secondAnchor], [sceneAnchor, { ...secondAnchor, visible: false }]]) {
  assert.equal(sceneModel.networkSceneProjection(sharedData, visibleAnchors, [450, 80]).edges.filter(edge => edge.association).length, 0);
}
assert.equal(sceneModel.networkSceneProjection(sharedData, [sceneAnchor, secondAnchor], [450, 80], 1, context).edges.filter(edge => edge.association).length, 0);
assert.equal(sceneModel.networkSceneProjection(sharedData, [sceneAnchor, secondAnchor], [450, 80], 1, multiTarget).edges.filter(edge => edge.association).length, 1);
for (const change of [{ confidence: 'recorded' }, { kind: 'connection' }, { medium: 'ethernet' }, { medium: 'unknown' },
  { fromEndpointId: 'unresolved-peer' }]) {
  const changed = { ...sharedData, links: sharedData.links.map((link, index) => index === 0 ? { ...link, ...change } : link) };
  assert.equal(model.networkSelection(changed, sharedSelection), null, 'selection must still resolve both accepted source memberships');
  assert.equal(sceneModel.networkSceneProjection(changed, [sceneAnchor, secondAnchor], [450, 80]).edges.filter(edge => edge.association).length, 0);
}
const noSegment = { ...sharedData, endpoints: sharedData.endpoints.map(endpoint => endpoint.id === 'seg-core' ? { ...endpoint, kind: 'unresolved' } : endpoint) };
assert.equal(model.networkSelection(noSegment, sharedSelection), null);
const reversed = { ...sharedData, links: [...sharedData.links].reverse().map(link => ({ ...link,
  fromEndpointId: link.toEndpointId, toEndpointId: link.fromEndpointId })) };
assert.equal(model.networkSelection(reversed, sharedSelection).association.id, sharedPair.id, 'stable selection is independent of membership ordering and direction');
const repeated = { ...sharedData, links: [...sharedData.links, { ...sharedData.links[0], id: 'alias-membership', fromEndpointId: 'seg-core', toEndpointId: 'if-fixed-01' }] };
assert.equal(model.networkSharedMediumAssociations(repeated).filter(pair => pair.medium === 'powerline').length, 3, 'interface aliases and repeated memberships do not duplicate device pairs');
assert.equal(model.networkSelection(repeated, sharedSelection).association.memberships.length, 3, 'additional original provenance stays available');
const separateSegments = { ...sharedData, endpoints: [...sharedData.endpoints, { ...sharedData.endpoints[2], id: 'separate-segment' }],
  links: [...sharedData.links, { ...membership(0, canonical[1].id), id: 'other-member-1', toEndpointId: 'separate-segment' },
    { ...membership(1, canonical[2].id), id: 'other-member-2', toEndpointId: 'separate-segment' }] };
assert(!model.networkSharedMediumAssociations(separateSegments).some(pair => pair.from === canonical[0].id && pair.to === canonical[1].id),
  'sharing a member across two segments does not create a transitive route');
const parallelScene = sceneModel.networkSceneProjection(separateSegments, [sceneAnchor, secondAnchor], [450, 80]);
const pairLanes = parallelScene.edges.filter(edge => edge.association).map(edge => edge.index);
assert.equal(new Set(pairLanes).size, pairLanes.length, 'separate displayed shared associations use distinct curve lanes');
const twoMedia = { ...sharedData, links: [...sharedData.links,
  { ...membership(0, canonical[0].id), id: 'ethernet-member-a', medium: 'ethernet' },
  { ...membership(1, canonical[2].id), id: 'ethernet-member-b', medium: 'ethernet' }] };
const parallelMedia = model.networkSharedMediumAssociations(twoMedia).filter(pair => pair.from === canonical[0].id && pair.to === canonical[2].id);
assert.deepEqual(parallelMedia.map(pair => pair.medium).sort(), ['ethernet', 'powerline']);
assert(parallelMedia.every(pair => pair.memberships.every(link => link.medium === pair.medium)), 'distinct shared media retain their own source membership sets');
const sparseDirect = { ...sharedData, links: sharedData.links.map((link, index) => index === 17 ? { ...link,
  kind: 'connection', fromEndpointId: canonical[0].id, toEndpointId: canonical[2].id } : link) };
const sparseScene = sceneModel.networkSceneProjection(sparseDirect, [sceneAnchor, secondAnchor], [450, 80]);
assert.equal(sparseScene.edges.length, 2);
assert.equal(new Set(sparseScene.edges.map(edge => edge.index)).size, 2, 'shared curve lane remains distinct from a sparse direct source edge index');
const orphanInterface = { ...sharedData, links: sharedData.links.map((link, index) => index === 0 ? { ...link, fromEndpointId: 'orphan-interface' } : link),
  endpoints: [...sharedData.endpoints, { id: 'orphan-interface', kind: 'interface', label: 'Unbound interface', ownerDeviceId: null, notes: '' }] };
assert.equal(model.networkSelection(orphanInterface, sharedSelection), null, 'unowned interfaces cannot invent device membership');
assert.equal(JSON.stringify(sharedData), sharedSnapshot);
assert(sharedData.devices.every(device => !device.place || device.place.coordinate === null));
assert(sharedData.links.every(link => link.path === null));

console.log(`PASS network overlay model and graph: ${devices.length} synthetic devices, ${links.length} topology edges, explicit accepted policy, preserved source confidence, endpoint ownership, canonical/native identity separation, reviewed plan references, camera-projected schematic room joins without source placement, accepted shared-medium cross-floor associations, dates, and source immutability`);
