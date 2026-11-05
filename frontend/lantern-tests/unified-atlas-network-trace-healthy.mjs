// Generated synthetic topologies only; no browser, native host or source reads.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), []);
const scratch = mkdtempSync(join(tmpdir(), 'atlas-network-trace-'));
const root = fileURLToPath(new URL('../../', import.meta.url));
let traceToRoot, rootRank, NetworkStageConnections, createElement, renderToStaticMarkup;
try {
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, `export { traceToRoot, rootRank } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/network-trace.ts'))};
export { NetworkStageConnections } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/NetworkStageConnections.tsx'))};
`);
  const react = { name: 'frontend-react', enforce: 'pre', resolveId(id) {
    if (id === 'react' || id.startsWith('react/')) return { id: pathToFileURL(createRequire(join(root, 'frontend/package.json')).resolve(id)).href, external: true };
  } };
  const built = await build({ root: join(root, 'frontend'), configFile: false, logLevel: 'silent', plugins: [react], build: {
    write: false, target: 'node26', lib: { entry, formats: ['es'] },
    // React stays the frontend's own installed module, shared with react-dom/server below.
    rolldownOptions: { output: { codeSplitting: false } }, minify: false,
  } });
  const output = Array.isArray(built) ? built[0] : built, modulePath = join(scratch, 'trace.mjs');
  writeFileSync(modulePath, output.output.find(row => row.type === 'chunk' && row.isEntry).code);
  ({ traceToRoot, rootRank, NetworkStageConnections } = await import(pathToFileURL(modulePath).href));
  ({ createElement } = await import('react'));
  ({ renderToStaticMarkup } = await import('react-dom/server'));
} finally { rmSync(scratch, { recursive: true }); }

const device = (id, kind = 'switch') => ({ id: `d:${id}`, device: { id, label: `Generated ${id}`, kind, mobility: 'fixed',
  confidence: 'recorded', notes: '', place: null } });
const segment = id => ({ id: `e:${id}`, device: null });
let at = 0;
const edge = (a, b, confidence = 'accepted', kind = 'connection') => {
  const id = `link-${at}`;
  return { key: `${at++}:${id}`, a, b, link: { id, fromEndpointId: a, toEndpointId: b, kind, medium: 'ethernet', confidence,
    sourceConfidence: null, temporalStatus: '', recordedAtPrecision: null, basis: '', recordedAt: null, notes: '', path: null } };
};
const ids = trace => trace.edges.map(row => row.link.id);

// Root ranking: router before gateway before modem; other kinds are never roots.
assert.deepEqual(['router', 'Edge gateway', 'cable-modem', 'switch'].map(kind => rootRank(device('x', kind).device)), [0, 1, 2, -1]);
assert.equal(rootRank(null), -1);

{ // Chain: laptop → switch → access point → router, listed in order from the device.
  const nodes = [device('router', 'router'), device('ap', 'access-point'), device('sw'), device('laptop', 'computer')];
  const edges = [edge('d:router', 'd:ap'), edge('d:sw', 'd:ap'), edge('d:laptop', 'd:sw'), edge('d:laptop', 'd:laptop')];
  const trace = traceToRoot(nodes, edges, 'd:laptop');
  assert.equal(trace.status, 'traced');
  assert.equal(trace.root, 'd:router');
  assert.deepEqual(trace.nodes, ['d:laptop', 'd:sw', 'd:ap', 'd:router']);
  assert.deepEqual(ids(trace), ['link-2', 'link-1', 'link-0']);
  assert.equal(trace.uncertain, false);
  // The root itself and an unknown node.
  assert.deepEqual(traceToRoot(nodes, edges, 'd:router'), { from: 'd:router', root: 'd:router', status: 'is-root', nodes: ['d:router'], edges: [], uncertain: false });
  assert.equal(traceToRoot(nodes, edges, 'd:missing').status, 'unreachable');
}

{ // Equal hop counts: the accepted route wins over a hypothesis; fewer hops win over better evidence.
  const nodes = [device('router', 'router'), device('a'), device('b'), device('c'), device('tv', 'media')];
  const edges = [edge('d:tv', 'd:a', 'accepted', 'hypothesis'), edge('d:a', 'd:router'),
    edge('d:tv', 'd:b'), edge('d:b', 'd:router'),
    edge('d:tv', 'd:c'), edge('d:c', 'd:a')];
  const trace = traceToRoot(nodes, edges, 'd:tv');
  assert.deepEqual(trace.nodes, ['d:tv', 'd:b', 'd:router']);
  assert.equal(trace.uncertain, false);
  const shorter = traceToRoot(nodes, [edge('d:tv', 'd:router', 'tentative'), ...edges], 'd:tv');
  assert.deepEqual(shorter.nodes, ['d:tv', 'd:router']);
  assert.equal(shorter.uncertain, true);
}

{ // Hop count is compared before evidence: two conflicting hops still beat three accepted ones.
  const nodes = [device('router', 'router'), device('a'), device('b'), device('c'), device('phone', 'phone')];
  const edges = [edge('d:phone', 'd:a'), edge('d:a', 'd:b'), edge('d:b', 'd:router'),
    edge('d:phone', 'd:c', 'conflicting'), edge('d:c', 'd:router', 'conflicting')];
  const trace = traceToRoot(nodes, edges, 'd:phone');
  assert.deepEqual(trace.nodes, ['d:phone', 'd:c', 'd:router']);
  assert.equal(trace.uncertain, true);
}

{ // A link the source qualifies as a hypothesis in its basis or notes is uncertain and loses ties.
  const nodes = [device('router', 'router'), device('a'), device('b'), device('cam', 'camera')];
  const guessed = edge('d:cam', 'd:a');
  const qualified = { ...guessed, link: { ...guessed.link, basis: 'Owner hypothesis, not checked' } };
  const edges = [qualified, edge('d:a', 'd:router'), edge('d:cam', 'd:b'), edge('d:b', 'd:router')];
  assert.deepEqual(traceToRoot(nodes, edges, 'd:cam').nodes, ['d:cam', 'd:b', 'd:router']);
  const only = traceToRoot(nodes, [qualified, edge('d:a', 'd:router')], 'd:cam');
  assert.deepEqual(only.nodes, ['d:cam', 'd:a', 'd:router']);
  assert.equal(only.uncertain, true);
}

{ // Through a shared segment (powerline), and the nearest root wins; router beats gateway on a tie.
  const nodes = [device('gw', 'gateway'), device('router', 'router'), segment('plc'), device('adapter'), device('desk', 'computer')];
  const edges = [edge('d:desk', 'd:adapter'), edge('d:adapter', 'e:plc', 'accepted', 'segment-membership'),
    edge('e:plc', 'd:router', 'accepted', 'segment-membership'), edge('e:plc', 'd:gw', 'accepted', 'segment-membership')];
  const trace = traceToRoot(nodes, edges, 'd:desk');
  assert.deepEqual(trace.nodes, ['d:desk', 'd:adapter', 'e:plc', 'd:router']);
  assert.equal(trace.edges.length, 3);
  // Same input in another order gives the same route.
  assert.deepEqual(traceToRoot([...nodes].reverse(), [...edges].reverse(), 'd:desk').nodes, trace.nodes);
}

{ // No root recorded, or no connection to it.
  const nodes = [device('a'), device('b')];
  assert.equal(traceToRoot(nodes, [edge('d:a', 'd:b')], 'd:a').status, 'no-root');
  const island = traceToRoot([...nodes, device('router', 'router')], [edge('d:a', 'd:b')], 'd:a');
  assert.equal(island.status, 'unreachable');
  assert.equal(island.root, null);
  assert.deepEqual(island.nodes, ['d:a']);
}

{ // The stage lights only the traced links, and draws each hop from the chosen device toward the root,
  // even where the source records the link the other way round.
  const anchor = (nodeId, x) => ({ graphKey: 'g', nodeKind: 'device', nodeId, roomId: `room-${nodeId}`, occurrenceId: `occ-${nodeId}`,
    point: [x, 0], basis: 'room-summary', qualification: 'Generated' });
  const end = (sourceId, x) => ({ sourceId, label: sourceId, nodeKey: sourceId, ownerDeviceKey: null, anchors: [anchor(sourceId, x)], placementReason: 'admitted-anchor' });
  const connection = (id, from, fx, to, tx) => {
    const a = end(from, fx), b = end(to, tx);
    return { key: id, graphKey: 'g', link: edge(from, to).link && { ...edge(from, to).link, id }, source: {}, qualification: 'Generated',
      from: a, to: b, renderable: true, placements: [{ key: `${id}:p`, from: a.anchors[0], to: b.anchors[0], coincident: false }] };
  };
  const connections = { nodes: [], sharedMediumAssociations: [], coverage: {}, connections: [
    connection('up', 'router', 100, 'laptop', 0), connection('side', 'laptop', 0, 'printer', 50)] };
  const render = trace => renderToStaticMarkup(createElement('svg', null, createElement(NetworkStageConnections, { connections, selected: null, trace })));
  const plain = render(null);
  assert.equal((plain.match(/ua-net-trace"/g) ?? []).length, 0);
  const lit = render({ graphKey: 'g', linkIds: ['up'], reversedLinkIds: new Set(['up']), deviceOrder: new Map([['laptop', 0], ['router', 1]]), segmentIds: new Set() });
  const paths = [...lit.matchAll(/<path[^>]*>/g)].map(match => match[0]);
  const traced = paths.filter(path => path.includes('ua-net-trace'));
  assert.equal(traced.length, 1);
  assert.match(traced[0], /d="M 0 0 Q [^"]* 100 0"/, 'the hop starts at the device, not the router');
  assert.match(paths.find(path => !path.includes('ua-net-trace')), /opacity="0.14"/, 'other links step back');
}

console.log('unified-atlas network trace: healthy');
