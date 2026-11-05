// Generated synthetic topologies only; no browser, native host or source reads.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), []);
const scratch = mkdtempSync(join(tmpdir(), 'atlas-network-trace-'));
const root = fileURLToPath(new URL('../../', import.meta.url));
let traceToRoot, rootRank;
try {
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, `export { traceToRoot, rootRank } from ${JSON.stringify(join(root, 'frontend/src/lantern/unified-atlas/network-trace.ts'))};`);
  const built = await build({ root: join(root, 'frontend'), configFile: false, logLevel: 'silent', build: {
    write: false, target: 'node26', lib: { entry, formats: ['es'] },
    rolldownOptions: { output: { codeSplitting: false } }, minify: false,
  } });
  const output = Array.isArray(built) ? built[0] : built, modulePath = join(scratch, 'trace.mjs');
  writeFileSync(modulePath, output.output.find(row => row.type === 'chunk' && row.isEntry).code);
  ({ traceToRoot, rootRank } = await import(pathToFileURL(modulePath).href));
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

console.log('unified-atlas network trace: healthy');
