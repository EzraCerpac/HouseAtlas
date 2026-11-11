// #552 source-root controls. Generated synthetic bytes and topologies only; no
// browser, DOM mount, native host, network, credential or household data.
// Every block is labelled by what it establishes:
//   pure          in-process function results;
//   static-markup React server markup of the actual stage component (no effects, no frames);
//   static-source a stylesheet text rule, not rendered behaviour.
// Nothing here is mounted: effect ordering, first-frame state and paint timing
// are not measured by this file.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), []);
const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'atlas-network-source-root-'));
let mod, createElement, renderToStaticMarkup;
try {
  const entry = join(scratch, 'entry.ts');
  const at = path => JSON.stringify(join(root, path));
  writeFileSync(entry, `export { traceToRoot, rootRank, publishStageTrace, currentStageTrace } from ${at('frontend/src/lantern/unified-atlas/network-trace.ts')};
export { NetworkStageConnections } from ${at('frontend/src/lantern/unified-atlas/NetworkStageConnections.tsx')};
export { readSavedDocumentaryDetails } from ${at('frontend/integration/native-scene-source-client.ts')};
`);
  const react = { name: 'frontend-react', enforce: 'pre', resolveId(id) {
    if (id === 'react' || id.startsWith('react/')) return { id: pathToFileURL(createRequire(join(root, 'frontend/package.json')).resolve(id)).href, external: true };
  } };
  const built = await build({ root: join(root, 'frontend'), configFile: false, logLevel: 'silent', plugins: [react], build: {
    write: false, target: 'node26', lib: { entry, formats: ['es'] }, rolldownOptions: { output: { codeSplitting: false } }, minify: false,
  } });
  const output = Array.isArray(built) ? built[0] : built, modulePath = join(scratch, 'source-root.mjs');
  writeFileSync(modulePath, output.output.find(row => row.type === 'chunk' && row.isEntry).code);
  mod = await import(pathToFileURL(modulePath).href);
  ({ createElement } = await import('react'));
  ({ renderToStaticMarkup } = await import('react-dom/server'));
} finally { rmSync(scratch, { recursive: true }); }
const { traceToRoot, rootRank, publishStageTrace, currentStageTrace, NetworkStageConnections, readSavedDocumentaryDetails } = mod;

// ---- Source-byte admission (pure, actual documentary byte decoder) ---------------------------
const hash = value => createHash('sha256').update(value).digest('hex');
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const historical = Buffer.from('Generated historical documentary original.');
const receipt = JSON.stringify({ profile: 'houseatlas.native-scene-room-review.v1', receiptId: 'generated:receipt', sourceReceiptSha256: hash(historical), anchors: [] });
const receiptSha = hash(receipt);
const device = (id, kind, extra = {}) => ({ id, label: `Generated ${id}`, kind, mobility: 'fixed', confidence: 'recorded', notes: '', place: null, ...extra });
const sourceLink = (id, from, to, medium, confidence) => ({ id, fromEndpointId: from, toEndpointId: to, kind: 'connection', medium, confidence,
  sourceConfidence: null, temporalStatus: 'recorded-past', recordedAtPrecision: 'day', basis: 'Generated documentary connection', recordedAt: '2026-10-09', notes: '', path: null });
const bytesOf = (devices, links) => Buffer.from(JSON.stringify({ schema: 'houseatlas.native-scene-source.v1', receiptCanonicalJson: receipt,
  rooms: { status: 'available', reason: null, receiptId: 'generated:receipt', receiptSha256: receiptSha, entries: [], regions: [] },
  network: { status: 'available', reason: null,
    source: { label: 'Generated recorded network', revision: 'source-1', recordedAt: '2026-10-10', retrievedAt: null, status: 'recorded', acceptedAt: null, coverage: 'partial', notes: '' },
    devices, endpoints: [], links },
  electricity: { status: 'unavailable', reason: 'not-retained', documentarySource: null, roomRegistry: null, buildingPackageKey: null, retrievedAt: null } }));
const read = bytes => readSavedDocumentaryDetails({ workspaceId: U(1), homeId: U(2), buildingId: U(3), viewKey: 'generated-view',
  sceneEvidenceId: U(4), sceneAssetId: U(5), sceneOriginalSha256: hash(bytes), sceneEvidenceRevision: 1, sceneAssetRevision: 1,
  acceptedRoomReceiptId: 'generated:receipt', acceptedRoomReceiptSha256: receiptSha, acceptedRoomAnchors: [], acceptedRoomMappings: [],
  sourceFloorBindings: [] }, bytes, historical, () => {});
// A switch the source marks as root, an access point and a laptop; no router or gateway kind anywhere.
const links = [sourceLink('link:ap-switch', 'device:ap', 'device:core', 'ethernet', 'accepted'),
  sourceLink('link:laptop-ap', 'device:laptop', 'device:ap', 'wifi', 'tentative')];
const devicesWith = mark => [device('device:core', 'switch', mark), device('device:ap', 'access-point'), device('device:laptop', 'computer')];
const admitted = async mark => {
  const result = await read(bytesOf(devicesWith(mark), links));
  assert.equal(result.network.status, 'available');
  return result.network.data;
};
const graphOf = data => ({
  nodes: data.devices.map(entry => ({ id: `d:${entry.id}`, device: entry })),
  edges: data.links.map((entry, index) => ({ key: `${index}:${entry.id}`, a: `d:${entry.fromEndpointId}`, b: `d:${entry.toEndpointId}`, link: entry })),
});

{ // Accepted: `true` and `false` are kept exactly, on the frozen admitted device; the marked switch is the root.
  const marked = await admitted({ sourceRoot: true });
  assert.equal(marked.devices[0].sourceRoot, true);
  assert.ok(Object.isFrozen(marked.devices[0]));
  assert.deepEqual(marked.devices.slice(1).map(entry => Object.hasOwn(entry, 'sourceRoot')), [false, false]);
  const { nodes, edges } = graphOf(marked);
  const trace = traceToRoot(nodes, edges, 'd:device:laptop');
  assert.equal(trace.status, 'traced');
  assert.equal(trace.root, 'd:device:core');
  assert.deepEqual(trace.nodes, ['d:device:laptop', 'd:device:ap', 'd:device:core']);
  // Medium and confidence per hop, in order from the chosen device.
  assert.deepEqual(trace.edges.map(edge => [edge.link.medium, edge.link.confidence]), [['wifi', 'tentative'], ['ethernet', 'accepted']]);
  assert.deepEqual(trace.certain, [false, true]);
  assert.equal(trace.uncertain, true);
  assert.equal(traceToRoot(nodes, edges, 'd:device:core').status, 'is-root');

  const unmarked = await admitted({ sourceRoot: false });
  assert.equal(unmarked.devices[0].sourceRoot, false);
  assert.equal(traceToRoot(graphOf(unmarked).nodes, graphOf(unmarked).edges, 'd:device:laptop').status, 'no-root');
}

{ // Absent: today's bytes still admit, the device carries no marker and nothing becomes a root.
  const data = await admitted({});
  assert.equal(Object.hasOwn(data.devices[0], 'sourceRoot'), false);
  const { nodes, edges } = graphOf(data);
  const trace = traceToRoot(nodes, edges, 'd:device:laptop');
  assert.equal(trace.status, 'no-root');
  assert.deepEqual([...trace.reachable].sort(), ['d:device:ap', 'd:device:core', 'd:device:laptop']);
}

{ // Malformed or wrong type: the whole documentary read is refused, never coerced.
  for (const value of [null, 'true', 'false', 1, 0, [], {}, [true]]) {
    await assert.rejects(read(bytesOf(devicesWith({ sourceRoot: value }), links)), { name: 'NativeSceneSourceError' }, JSON.stringify(value));
  }
  // Other device keys stay closed: a similar name is not the marker.
  for (const extra of [{ root: true }, { isRoot: true }, { sourceroot: true }]) {
    await assert.rejects(read(bytesOf(devicesWith(extra), links)), { name: 'NativeSceneSourceError' }, JSON.stringify(extra));
  }
  // Required keys stay required.
  const missing = devicesWith({ sourceRoot: true }); delete missing[1].notes;
  await assert.rejects(read(bytesOf(missing, links)), { name: 'NativeSceneSourceError' });
}

// ---- Root selection (pure) ------------------------------------------------------------------
const node = (id, kind, extra = {}) => ({ id: `d:${id}`, device: device(id, kind, extra) });
let counter = 0;
const edge = (a, b, confidence = 'accepted', medium = 'ethernet') => {
  const id = `link-${counter}`;
  return { key: `${counter++}:${id}`, a, b, link: sourceLink(id, a, b, medium, confidence) };
};

// Rank: the source's mark first, then router, then gateway; an unmarked modem, switch or endpoint is never a root.
assert.deepEqual([
  device('x', 'switch', { sourceRoot: true }), device('x', 'router'), device('x', 'Edge gateway'), device('x', 'cable-modem'),
  device('x', 'switch'), device('x', 'switch', { sourceRoot: false }), device('x', 'router', { sourceRoot: false }),
].map(rootRank), [0, 1, 2, -1, -1, -1, 1]);
assert.equal(rootRank(null), -1);

{ // Equal distance: the marked root wins over a router; nearer still wins over better rank.
  const nodes = [node('router', 'router'), node('core', 'switch', { sourceRoot: true }), node('pc', 'computer'), node('far', 'switch')];
  const edges = [edge('d:pc', 'd:router'), edge('d:pc', 'd:core')];
  assert.equal(traceToRoot(nodes, edges, 'd:pc').root, 'd:core');
  assert.equal(traceToRoot([...nodes].reverse(), [...edges].reverse(), 'd:pc').root, 'd:core', 'input order does not change the root');
  const nearer = [edge('d:pc', 'd:router'), edge('d:pc', 'd:far'), edge('d:far', 'd:core')];
  assert.equal(traceToRoot(nodes, nearer, 'd:pc').root, 'd:router');
  // Two marked roots at equal cost: the lower node ID.
  const twin = [node('b-root', 'switch', { sourceRoot: true }), node('a-root', 'switch', { sourceRoot: true }), node('pc', 'computer')];
  assert.equal(traceToRoot(twin, [edge('d:pc', 'd:b-root'), edge('d:pc', 'd:a-root')], 'd:pc').root, 'd:a-root');
}

{ // An unmarked modem is not the root; the route continues to the router behind it.
  const nodes = [node('modem', 'cable-modem'), node('router', 'router'), node('pc', 'computer')];
  const trace = traceToRoot(nodes, [edge('d:pc', 'd:modem'), edge('d:modem', 'd:router')], 'd:pc');
  assert.deepEqual(trace.nodes, ['d:pc', 'd:modem', 'd:router']);
  assert.equal(traceToRoot([node('modem', 'cable-modem'), node('pc', 'computer')], [edge('d:pc', 'd:modem')], 'd:pc').status, 'no-root');
  // The same modem marked by its source is the root.
  assert.equal(traceToRoot([node('modem', 'cable-modem', { sourceRoot: true }), node('pc', 'computer')], [edge('d:pc', 'd:modem')], 'd:pc').root, 'd:modem');
}

{ // Unreachable: a marked root exists but no recorded link leads to it.
  const nodes = [node('core', 'switch', { sourceRoot: true }), node('pc', 'computer'), node('tv', 'media')];
  const island = traceToRoot(nodes, [edge('d:pc', 'd:tv')], 'd:pc');
  assert.equal(island.status, 'unreachable');
  assert.equal(island.root, null);
  assert.deepEqual([...island.reachable].sort(), ['d:pc', 'd:tv']);
}

// ---- Route retirement (pure; the stage integration is a separate held change) ---------------
const graphA = { key: 'g:a', data: {} }, graphA2 = { key: 'g:a', data: {} }, graphB = { key: 'g:b', data: {} };
const traceOf = (graph, linkIds = ['up']) => ({ graphKey: graph.key, data: graph.data, linkIds, reversedLinkIds: new Set(),
  deviceOrder: new Map(), segmentIds: new Set() });
{
  let current = null;
  const publish = (graph, trace) => { current = publishStageTrace(current, graph.key, graph.data, trace); };
  // Current owner and graph.
  const first = traceOf(graphA); publish(graphA, first);
  assert.equal(currentStageTrace(current, [graphA, graphB], true), first);
  // Clear, then reselect.
  publish(graphA, null); assert.equal(current, null);
  const again = traceOf(graphA, ['side']); publish(graphA, again);
  assert.equal(currentStageTrace(current, [graphA], true), again);
  // Replacement under the same key with new data: retired at once, before the graph republishes.
  assert.equal(currentStageTrace(current, [graphA2], true), null);
  const replacement = traceOf(graphA2); publish(graphA2, replacement); publish(graphA, null);
  assert.equal(current, replacement, 'late withdrawal cannot clear same-key replacement data');
  // Replacement by another graph whose route arrives before the departing graph's delayed cleanup.
  const second = traceOf(graphB); publish(graphB, second); publish(graphA, null);
  assert.equal(current, second, 'a late cleanup never clears a newer graph\'s route');
  assert.equal(currentStageTrace(current, [graphB], true), second);
  // A graph that mounts with nothing chosen leaves another graph's route alone.
  publish(graphA2, null); assert.equal(current, second);
  // Layer off (no graphs) and source removal (graph gone) retire the route in the same render.
  assert.equal(currentStageTrace(current, [], true), null);
  assert.equal(currentStageTrace(current, [graphA2], true), null);
  // Close: no graph view shown retires it; reopen shows nothing until the graph publishes again.
  assert.equal(currentStageTrace(current, [graphB], false), null);
  publish(graphB, null); assert.equal(currentStageTrace(current, [graphB], true), null);
  const reopened = traceOf(graphB, ['side']); publish(graphB, reopened);
  assert.equal(currentStageTrace(current, [graphB], true), reopened);
}

// ---- Stage markup (static-markup: actual NetworkStageConnections, no effects or frames) -----
const anchor = (nodeId, x) => ({ graphKey: 'g:a', nodeKind: 'device', nodeId, roomId: `room-${nodeId}`, occurrenceId: `occ-${nodeId}`,
  point: [x, 0], basis: 'room-summary', qualification: 'Generated' });
const end = (sourceId, x) => ({ sourceId, label: sourceId, nodeKey: sourceId, ownerDeviceKey: null, anchors: [anchor(sourceId, x)], placementReason: 'admitted-anchor' });
const connection = (id, from, fx, to, tx) => {
  const a = end(from, fx), b = end(to, tx);
  return { key: id, graphKey: 'g:a', link: sourceLink(id, from, to, 'ethernet', 'accepted'), source: {}, qualification: 'Generated',
    from: a, to: b, renderable: true, placements: [{ key: `${id}:p`, from: a.anchors[0], to: b.anchors[0], coincident: false }] };
};
const connections = { nodes: [], sharedMediumAssociations: [], coverage: {}, connections: [
  connection('up', 'core', 100, 'ap', 50), connection('side', 'ap', 50, 'laptop', 0), connection('other', 'core', 100, 'tv', 200)] };
const paths = props => [...renderToStaticMarkup(createElement('svg', null, createElement(NetworkStageConnections, { connections, selected: null, ...props })))
  .matchAll(/<path[^>]*>/g)].map(match => match[0]);
const markup = props => renderToStaticMarkup(createElement('svg', null, createElement(NetworkStageConnections, { connections, selected: null, ...props })));
{
  const route = { ...traceOf(graphA, ['side', 'up']), reversedLinkIds: new Set(['side', 'up']) };
  // 3D stage: both hops lit in order from the chosen device; the rest steps back.
  const stage = paths({ trace: currentStageTrace(route, [graphA], true) });
  const lit = stage.filter(path => path.includes('ua-net-trace'));
  assert.equal(lit.length, 2);
  assert.match(lit.find(path => path.includes('--hop:0')), /d="M 0 0 Q [^"]* 50 0"/, 'hop 0 starts at the laptop');
  assert.match(lit.find(path => path.includes('--hop:1')), /d="M 50 0 Q [^"]* 100 0"/, 'hop 1 ends at the marked root');
  assert.match(stage.find(path => !path.includes('ua-net-trace')), /opacity="0.14"/);
  // Plan: only the route, between the plan's own rooms.
  const plan = paths({ trace: currentStageTrace(route, [graphA], true), fade: 0, shown: occurrence => occurrence !== 'occ-tv' });
  assert.equal(plan.length, 2);
  assert.ok(plan.every(path => path.includes('ua-net-trace')));
  // A departing route that is not validated dims every replacement connection: the retirement gap.
  assert.ok(paths({ trace: traceOf(graphA, ['gone']) }).every(path => /opacity="0.14"/.test(path)));
  // Validated against the replacement graph, the stage draws as with no route at all, in 3D and in plan.
  const retired = currentStageTrace(traceOf(graphA, ['gone']), [graphA2], true);
  assert.equal(retired, null);
  assert.equal(markup({ trace: retired }), markup({ trace: null }));
  assert.ok(!markup({ trace: retired }).includes('ua-net-tracing'));
  assert.equal(paths({ trace: retired, fade: 0, shown: () => true }).length, 0);
}

// ---- Reduced motion (static-source: stylesheet text only, not rendered behaviour) -----------
{
  const css = readFileSync(join(root, 'frontend/src/lantern/unified-atlas/unified-atlas.css'), 'utf8');
  const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([^]*?)\n\}/g)].map(match => match[1]);
  assert.ok(reduced.some(body => /\.ua-net-trace \{ animation: none; \}/.test(body)), 'the stage route draws without animation under reduced motion');
  const graphCss = readFileSync(join(root, 'frontend/src/lantern/unified-atlas/network-graph.css'), 'utf8');
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{[^]*?g\.is-trace \.ung-edge \{ animation: none; \}/.test(graphCss));
}

console.log('unified-atlas network source root: healthy');
