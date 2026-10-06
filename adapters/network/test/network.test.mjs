import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSnapshot, validateShape } from '../../../packages/contracts/src/index.mjs';
import { createNetworkReadAdapter, projectNetworkCapture, buildNetworkFacet, assertNetworkReadRequest, NETWORK_READ_ROUTES } from '../src/index.mjs';

const load = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const wire = load('../fixtures/inventory.wire.json'), review = load('../fixtures/link-review.json');
const source = {
  workspaceId: '00000000-0000-4000-8000-000000000001', homeId: '00000000-0000-4000-8000-000000000002',
  sourceInstanceId: '00000000-0000-4000-8000-000000000012', collectionId: 'inventory', owner: 'network',
  partitionMode: 'exclusive-home', allowedExternalIds: []
};
const at = '2026-01-02T12:00:00Z', later = '2026-01-02T13:00:00Z';
const clone = value => structuredClone(value);
const response = (body = wire) => ({ status: 200, source: clone(source), body: clone(body), sourceSnapshotAt: null });
const capture = (document = wire) => ({ source: clone(source), document: clone(document), retrievedAt: at, sourceSnapshotAt: null });
const project = (document = wire, annotations = review, registration = source) => projectNetworkCapture({ registration, capture: capture(document), review: annotations });
const fixtureAdapter = (transport = () => response(), extra = {}) => createNetworkReadAdapter({ registration: source, transport, review, clock: () => at,
  newGenerationId: () => '00000000-0000-4000-8000-000000000901', ...extra });
const facet = (state, now = at) => buildNetworkFacet({ registration: source, state, now });

test('only the pinned passive inventory GET can reach a transport', async () => {
  const calls = []; const adapter = fixtureAdapter(request => { calls.push(clone(request)); return response(); });
  assert.deepEqual(NETWORK_READ_ROUTES, ['/api/inventory']);
  const state = await adapter.refresh();
  assert.equal(state.cache.status, 'fresh'); assert.deepEqual(calls, [{ method: 'GET', path: '/api/inventory' }]);
  assert.deepEqual(Object.keys(adapter).sort(), ['read', 'refresh']);
  const prohibited = ['/api/snapshot', '/api/history', '/api/events', '/api/session', '/api/login', '/api/observations',
    '/api/collector/control', '/api/collector/jobs', '/api/collector/attestation', '/api/viewer-demand', '/api/diagnostics', '/api/import',
    '/api/export', '/api/wifi-scan-history', '/api/inventory?diagnostics=true', '//evil.invalid/api/inventory', '/api/../api/inventory', '/api/%69nventory'];
  for (const path of prohibited) assert.throws(() => assertNetworkReadRequest({ method: 'GET', path }), { code: 'forbidden' });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'get']) assert.throws(() => assertNetworkReadRequest({ method, path: '/api/inventory' }), { code: 'forbidden' });
  for (const key of ['body', 'headers', 'collectorToken', 'query', 'url']) assert.throws(() => assertNetworkReadRequest({ method: 'GET', path: '/api/inventory', [key]: {} }), { code: 'forbidden' });
  assert.equal(calls.length, 1);
});
test('IDs, source confidence, fact time, retrieval time, vantage and unknowns are retained', () => {
  const generation = project();
  assert.deepEqual(generation.inventory.devices.map(row => row.externalId), wire.inventory.devices.map(row => row.id));
  assert.deepEqual(generation.inventory.links.map(row => row.value), wire.inventory.links);
  const relation = generation.networkRelations.find(row => row.externalId === 'member-a');
  assert.equal(relation.sourceConfidence, 'confirmed'); assert.equal(relation.evidenceBasis, 'owner-report');
  assert.equal(relation.factAt, '2025-12-01T00:00:00Z'); assert.equal(relation.retrievedAt, at); assert.equal(relation.sourceSnapshotAt, null);
  assert.equal(relation.sourceRevision, 42); assert.equal(relation.from.id, 'interface-a'); assert.equal(relation.to.id, 'segment-a');
  assert.equal(generation.networkRelations.find(row => row.externalId === 'association-a').vantage, 'synthetic-laptop');
  assert.equal(generation.networkRelations.find(row => row.externalId === 'connection-a').medium, 'wifi');
  assert.deepEqual(generation.networkRelations.find(row => row.externalId === 'gap-a').to, { kind: 'unresolved', id: null, description: 'Unknown peer' });
  assert.equal(generation.inventory.devices[1].value.roomId, undefined);
  for (const row of generation.networkRelations) validateShape('networkRelation', row);
});
for (const [label, list, field, projectionList] of [
  ['group name', 'rooms', 'name', 'groups'], ['device name', 'devices', 'name', 'devices'],
  ['device kind', 'devices', 'kind', 'devices'], ['interface name', 'interfaces', 'name', 'interfaces'],
  ['segment name', 'segments', 'name', 'segments']
]) test(`R1 source-valid blank ${label} survives projection, refresh, reopen and facet`, async () => {
  const document = clone(wire); document.inventory[list][0][field] = '';
  let generation; assert.doesNotThrow(() => { generation = project(document); });
  assert.equal(generation.inventory[projectionList][0].value[field], '');
  assert.equal(generation.inventory[projectionList][0].externalId, wire.inventory[list][0].id);
  const state = await fixtureAdapter(() => response(document)).refresh(); assert.equal(state.cache.status, 'fresh');
  const reopened = fixtureAdapter(() => response(document), { initialState: state }).read();
  assert.equal(facet(reopened)[projectionList][0].value[field], '');
});
test('R1 source text remains verbatim, accepts its 2000-character limit and validates IDs separately', () => {
  const document = clone(wire); document.inventory.devices[0].name = ' '.repeat(2000);
  assert.equal(project(document).inventory.devices[0].value.name, document.inventory.devices[0].name);
  document.inventory.devices[0].name += ' '; assert.throws(() => project(document), { code: 'invalid-schema' });
  document.inventory.devices[0].name = ''; document.inventory.devices[0].id = '';
  assert.throws(() => project(document), { code: 'invalid-schema' });
});
test('projected relations join the frozen snapshot without schema changes', () => {
  const snapshot = load('../../../packages/contracts/fixtures/plan-free.snapshot.json');
  snapshot.networkRelations = project().networkRelations;
  assert.equal(validateSnapshot(snapshot), snapshot);
});
test('captured observations retain original IDs/times/vantage and invalidation', async () => {
  const document = clone(wire);
  document.observations = [{ id: 'observation-a', collectorId: 'synthetic-collector', deviceId: 'device-a', interfaceId: 'interface-a',
    kind: 'association', timestamp: '2025-12-01T00:00:00Z', vantagePoint: 'synthetic-router',
    invalidatedAt: '2025-12-02T00:00:00Z', value: { status: 'unreachable' } }];
  const generation = project(document);
  assert.deepEqual(generation.observations[0].value, document.observations[0]);
  assert.equal(generation.observations[0].externalId, 'observation-a');
  const state = await fixtureAdapter().refresh(); state.generation = generation;
  const model = facet(state); assert.equal(model.observations[0].freshness, 'invalidated');
  assert.equal(model.message.includes('off'), false);
});
test('facet browsing performs no requests and separates history, segments and groups', async () => {
  let calls = 0; const adapter = fixtureAdapter(() => { calls++; return response(); });
  const state = await adapter.refresh(); const model = facet(state);
  assert.equal(model.readOnly, true); assert.equal(model.history.length, 1);
  assert.equal(model.history[0].temporalStatus, 'disputed'); assert.equal(model.currentClaims.length, 3);
  assert.equal(model.groups[0].sourceKind, 'network-group'); assert.equal(model.segments[0].sourceKind, 'network-segment');
  assert.deepEqual(model.capabilities, { demand: false, diagnostics: false, writes: false, physicalPlacement: false, electricalCircuits: false });
  facet(adapter.read()); facet(adapter.read(), later); assert.equal(calls, 1);
  assert.equal(model.geometry, undefined); assert.equal(model.circuits, undefined); assert.equal(model.atlasId, undefined);
});

for (const [name, mutate, code] of [
  ['unknown endpoint', d => d.inventory.links[0].to = 'missing', 'invalid-schema'],
  ['duplicate external ID', d => d.inventory.devices[1].id = 'device-a', 'invalid-schema'],
  ['cross-kind duplicate ID', d => d.inventory.rooms[0].id = 'device-a', 'invalid-schema'],
  ['mobile fixed placement', d => d.inventory.devices[1].roomId = 'group-a', 'invalid-schema'],
  ['invalid source confidence', d => d.inventory.links[0].confidence = 'physically-proven', 'invalid-schema'],
  ['malformed fact time', d => d.inventory.links[0].observedAt = 'not-a-date', 'invalid-schema'],
  ['invalid reported rate', d => d.inventory.links[2].reportedRate.mbps = -1, 'invalid-schema'],
  ['invalid positions', d => d.inventory.positions['device-a'].x = null, 'invalid-schema'],
  ['unreviewed source fields', d => d.inventory.devices[0].collectorToken = 'synthetic-secret', 'invalid-schema']
]) test(`invalid generation aborts: ${name}`, () => {
  const document = clone(wire); mutate(document); assert.throws(() => project(document), { code });
});
test('classification requires current reviewed revision and cannot invent current association or segment chain', () => {
  for (const mutate of [r => r.revision++, r => delete r.links['gap-a'], r => r.links['association-a'].temporalStatus = 'current-claim',
    r => r.links['member-a'].kind = 'network-connection', r => r.links['member-a'].evidenceBasis = 'certain']) {
    const annotations = clone(review); mutate(annotations); assert.throws(() => project(wire, annotations), { code: 'invalid-schema' });
  }
});
test('full qualified source tuple is required before projection or response publication', async () => {
  for (const key of ['workspaceId', 'homeId', 'sourceInstanceId', 'collectionId']) {
    const wrong = capture(); wrong.source[key] = 'wrong';
    assert.throws(() => projectNetworkCapture({ registration: source, capture: wrong, review }), { code: 'wrong-scope' });
    const adapter = fixtureAdapter(() => { const result = response(); result.source[key] = 'wrong'; return result; });
    const state = await adapter.refresh(); assert.equal(state.cache.error.code, 'wrong-scope'); assert.equal(state.generation, null);
  }
  const wrongOwner = clone(source); wrongOwner.owner = 'homebox'; assert.throws(() => project(wire, review, wrongOwner), { code: 'wrong-scope' });
});
test('reviewed shared-source partitions fail closed on mixed-home records', () => {
  const shared = clone(source); shared.partitionMode = 'reviewed-entity-allowlist'; shared.allowedExternalIds = ['device-a'];
  assert.throws(() => project(wire, review, shared), { code: 'wrong-scope' });
  shared.allowedExternalIds = Object.values(wire.inventory).filter(Array.isArray).flat().map(row => row.id);
  assert.equal(project(wire, review, shared).inventory.devices.length, 2);
});

for (const [name, fail, expected] of [
  ['transport failure', () => { throw new Error('secret-session-token and private path'); }, 'transport'],
  ['HTTP failure', () => ({ status: 503, body: 'private backend detail' }), 'upstream'],
  ['redirect', () => ({ ...response(), status: 200, redirected: true }), 'upstream'],
  ['wrong scope', () => ({ ...response(), source: { ...source, collectionId: 'other' } }), 'wrong-scope'],
  ['malformed JSON', () => response('{'), 'invalid-schema'],
  ['partial inventory', () => response({ revision: 42, inventory: { devices: [] } }), 'invalid-schema'],
  ['missing reviewed links', () => { const d = clone(wire); d.inventory.links = []; return response(d); }, 'invalid-schema']
]) test(`independent outage control: ${name} retains cache and HomeBox/Atlas views`, async () => {
  let outage = false, currentTime = at;
  const core = load('../../../fixtures/integration/network-outage.snapshot.json'), before = clone(core);
  const adapter = fixtureAdapter(() => outage ? fail() : response(), { clock: () => currentTime });
  const successful = await adapter.refresh(); outage = true; currentTime = later;
  const failed = await adapter.refresh(); assert.equal(failed.cache.error.code, expected);
  assert.deepEqual(failed.generation, successful.generation); assert.equal(failed.cache.lastSuccessfulFetchAt, at);
  assert.equal(failed.cache.generationId, successful.cache.generationId); assert.equal(failed.cache.lastAttemptAt, later);
  assert.equal(facet(failed, later).status, 'stale'); assert.deepEqual(core, before); validateSnapshot(core);
  assert.equal(JSON.stringify(failed.cache).includes('secret-session-token'), false);
});
test('first read failure stays independently unavailable with honest empty metadata', async () => {
  const adapter = fixtureAdapter(() => { throw new Error('unavailable'); }); const failed = await adapter.refresh();
  assert.equal(failed.cache.lastSuccessfulFetchAt, null); assert.equal(failed.cache.generationId, null);
  assert.equal(facet(failed).status, 'unavailable'); assert.deepEqual(facet(failed).devices, []);
});
test('access revocation denies cached data, remains denied through transport outage, and permits verified recovery', async () => {
  let status = 200; const adapter = fixtureAdapter(() => status === 200 ? response() : status === 401 ? { status } : Promise.reject(new Error('unavailable')));
  await adapter.refresh(); status = 401; const denied = await adapter.refresh();
  assert.equal(denied.cache.status, 'access-revoked'); assert.equal(denied.generation, null); assert.equal(denied.cache.lastSuccessfulFetchAt, at);
  assert.equal(adapter.read().generation, null); assert.equal(facet(denied).status, 'revoked'); assert.deepEqual(facet(denied).devices, []);
  status = 503; const outage = await adapter.refresh(); assert.equal(outage.generation, null); assert.equal(facet(outage).status, 'revoked');
  status = 200; const restored = await adapter.refresh(); assert.equal(restored.cache.status, 'fresh'); assert.ok(restored.generation);
});
test('bounded timeout aborts transport and late completion cannot publish data', async () => {
  let resolveResponse, signal;
  const adapter = fixtureAdapter((_request, options) => { signal = options.signal; return new Promise(resolve => { resolveResponse = resolve; }); }, { limits: { requestTimeoutMs: 5 } });
  const failed = await adapter.refresh(); assert.equal(failed.cache.error.code, 'timeout'); assert.equal(signal.aborted, true);
  resolveResponse(response()); await Promise.resolve(); assert.equal(adapter.read().generation, null);
});
test('response bytes and generation counts are bounded', async () => {
  const small = fixtureAdapter(() => response(), { limits: { maxResponseBytes: 10 } });
  assert.equal((await small.refresh()).cache.error.code, 'size-limit');
  assert.throws(() => projectNetworkCapture({ registration: source, capture: capture(), review, limits: { maxRecords: 2 } }), { code: 'size-limit' });
});
test('concurrent refreshes coalesce into one atomic generation', async () => {
  let resolveResponse, calls = 0;
  const adapter = fixtureAdapter(() => { calls++; return new Promise(resolve => { resolveResponse = resolve; }); });
  const first = adapter.refresh(), second = adapter.refresh(); assert.equal(first, second);
  await Promise.resolve(); assert.equal(calls, 1); assert.equal(adapter.read().generation, null);
  resolveResponse(response()); assert.equal((await first).cache.status, 'fresh'); assert.equal((await second).cache.status, 'fresh');
});
test('inputs and returned cache objects cannot mutate internal state', async () => {
  const registration = clone(source), annotations = clone(review), document = clone(wire);
  const adapter = fixtureAdapter(() => response(document), { registration, review: annotations });
  annotations.revision = 1; registration.homeId = 'other'; const state = await adapter.refresh();
  state.generation.inventory.devices[0].value.name = 'changed'; state.cache.status = 'empty';
  assert.equal(adapter.read().cache.status, 'fresh'); assert.equal(adapter.read().generation.inventory.devices[0].value.name, wire.inventory.devices[0].name);
  assert.deepEqual(wire, load('../fixtures/inventory.wire.json'));
});
test('stale age and source snapshot time stay distinct from fact and successful-fetch times', async () => {
  const adapter = fixtureAdapter(() => ({ ...response(), sourceSnapshotAt: '2026-01-02T11:00:00Z' }));
  const state = await adapter.refresh(); const model = facet(state, later);
  assert.equal(model.ageMs, 3600000); assert.equal(model.status, 'stale'); assert.equal(model.sourceSnapshotAt, '2026-01-02T11:00:00Z');
  assert.equal(state.cache.lastSuccessfulFetchAt, at); assert.match(model.message, /device state is unknown/);
});
test('reopen retained state is scope validated and revoked recovery metadata does not expose records', async () => {
  const state = await fixtureAdapter().refresh(); const reopened = fixtureAdapter(() => response(), { initialState: state });
  assert.deepEqual(reopened.read(), state);
  const wrong = clone(state); wrong.generation.inventory.devices[0].homeId = 'wrong';
  assert.throws(() => fixtureAdapter(() => response(), { initialState: wrong }), { code: 'wrong-scope' });
  const revoked = clone(state); revoked.cache.status = 'access-revoked'; revoked.generation = null;
  assert.equal(facet(fixtureAdapter(() => response(), { initialState: revoked }).read()).status, 'revoked');
});
test('cached provenance corruption is rejected before facet rendering', async () => {
  const state = await fixtureAdapter().refresh();
  for (const change of [s => s.generation.networkRelations.pop(), s => s.generation.networkRelations[0].sourceConfidence = 'reported',
    s => s.generation.inventory.devices[0].sourceSnapshotAt = later, s => s.generation.networkRelations[0].sourceRevision = 41]) {
    const wrong = clone(state); change(wrong); assert.throws(() => facet(wrong), { code: 'invalid-schema' });
  }
});
test('R2 cached endpoint rewiring, reversal, segment reclassification and unreviewed gaps fail reopen and facet', async () => {
  const state = await fixtureAdapter().refresh();
  const relation = (s, externalId) => s.generation.networkRelations.find(row => row.externalId === externalId);
  const corruptions = [
    ['existing interface peer', s => relation(s, 'connection-a').to = { kind: 'interface', id: 'interface-a', description: null }],
    ['existing device peer', s => relation(s, 'connection-a').to = { kind: 'device', id: 'device-a', description: null }],
    ['existing source endpoint', s => relation(s, 'connection-a').from = { kind: 'interface', id: 'interface-a', description: null }],
    ['ordinary reversal', s => { const row = relation(s, 'connection-a'); [row.from, row.to] = [row.to, row.from]; }],
    ['membership as connection', s => relation(s, 'member-a').kind = 'network-connection'],
    ['reversed membership', s => { const row = relation(s, 'member-a'); [row.from, row.to] = [row.to, row.from]; }],
    ['unreviewed unresolved target', s => relation(s, 'connection-a').to = { kind: 'unresolved', id: null, description: 'Invented gap' }],
    ['changed reviewed gap description', s => relation(s, 'gap-a').to.description = 'Another gap'],
    ['reviewed gap silently resolved', s => relation(s, 'gap-a').to = { kind: 'device', id: 'device-b', description: null }],
    ['missing retained review', s => delete s.generation.linkReview],
    ['review revision mismatch', s => s.generation.linkReview.revision++],
    ['missing reviewed link', s => delete s.generation.linkReview.links['gap-a']],
    ['extra reviewed link', s => s.generation.linkReview.links.extra = clone(review.links['gap-a'])],
    ['segment masked by gap', s => {
      s.generation.linkReview.links['member-a'].kind = 'network-connection';
      s.generation.linkReview.links['member-a'].unresolvedTo = 'Unknown segment peer';
      relation(s, 'member-a').kind = 'network-connection';
      relation(s, 'member-a').to = { kind: 'unresolved', id: null, description: 'Unknown segment peer' };
    }]
  ];
  for (const [name, change] of corruptions) {
    const wrong = clone(state); change(wrong);
    assert.throws(() => fixtureAdapter(() => response(), { initialState: wrong }), { code: 'invalid-schema' }, `reopen: ${name}`);
    assert.throws(() => facet(wrong), { code: 'invalid-schema' }, `facet: ${name}`);
  }
});
test('R2 valid raw member orientation, reviewed reversal and explicit unresolved gap survive reopen and facet', async () => {
  for (const reverseRawMembership of [false, true]) {
    const document = clone(wire);
    if (reverseRawMembership) {
      const link = document.inventory.links.find(row => row.id === 'member-a'); [link.from, link.to] = [link.to, link.from];
    }
    const state = await fixtureAdapter(() => response(document)).refresh(); assert.equal(state.cache.status, 'fresh');
    const reopened = fixtureAdapter(() => response(document), { initialState: state }).read(); const model = facet(reopened);
    const member = model.currentClaims.find(row => row.externalId === 'member-a');
    assert.deepEqual(member.from, { kind: 'interface', id: 'interface-a', description: null });
    assert.deepEqual(member.to, { kind: 'segment', id: 'segment-a', description: null });
    assert.deepEqual(model.currentClaims.find(row => row.externalId === 'gap-a').to, { kind: 'unresolved', id: null, description: 'Unknown peer' });
    assert.deepEqual(reopened.generation.linkReview, review);
  }
});
test('R2 shared projector rejects segment-as-connection even when its target is made unresolved', () => {
  const document = clone(wire), annotations = clone(review), link = document.inventory.links.find(row => row.id === 'member-a');
  [link.from, link.to] = [link.to, link.from];
  annotations.links['member-a'].kind = 'network-connection'; annotations.links['member-a'].unresolvedTo = 'Unresolved segment';
  assert.throws(() => project(document, annotations), { code: 'invalid-schema' });
});
test('R2 same-revision configured review prevents coordinated cache-review rewriting', async () => {
  const state = await fixtureAdapter().refresh();
  state.generation.linkReview.links['gap-a'].unresolvedTo = 'Rewritten gap';
  state.generation.networkRelations.find(row => row.externalId === 'gap-a').to.description = 'Rewritten gap';
  assert.throws(() => fixtureAdapter(() => response(), { initialState: state }), { code: 'invalid-schema' });
});
test('R2 retained reviewed generation stays available when a newer configured review encounters an outage', async () => {
  const state = await fixtureAdapter().refresh(), nextReview = clone(review); nextReview.revision++;
  const adapter = fixtureAdapter(() => { throw new Error('unavailable'); }, { initialState: state, review: nextReview, clock: () => later });
  const failed = await adapter.refresh(); assert.deepEqual(failed.generation, state.generation);
  assert.equal(facet(failed, later).status, 'stale'); assert.equal(failed.generation.linkReview.revision, 42);
});
test('same-revision content change and source rollback retain prior cache', async () => {
  let document = clone(wire); const adapter = fixtureAdapter(() => response(document)); const first = await adapter.refresh();
  document.inventory.devices[0].name = 'unversioned change'; const conflict = await adapter.refresh();
  assert.equal(conflict.cache.error.code, 'invalid-schema'); assert.deepEqual(conflict.generation, first.generation);
  document = clone(wire); document.revision--; const rollback = await adapter.refresh();
  assert.equal(rollback.cache.error.code, 'invalid-schema'); assert.deepEqual(rollback.generation, first.generation);
});
test('unchanged inventory can refresh retrieval metadata without freshening source facts', async () => {
  let currentTime = at; const adapter = fixtureAdapter(() => response(), { clock: () => currentTime });
  const first = await adapter.refresh(); currentTime = later; const second = await adapter.refresh();
  assert.equal(second.cache.status, 'fresh'); assert.equal(second.cache.lastSuccessfulFetchAt, later);
  assert.equal(second.generation.networkRelations[0].factAt, first.generation.networkRelations[0].factAt);
  assert.equal(second.generation.networkRelations[0].sourceSnapshotAt, null);
  assert.equal(second.generation.networkRelations[0].retrievedAt, later);
});
test('conflicting JSON keys, escaped duplicate keys, nonfinite numbers and deep nesting are rejected', () => {
  for (const raw of [JSON.stringify(wire).replace('"revision":42', '"revision":1,"revision":42'),
    JSON.stringify(wire).replace('"revision":42', '"revision":1,"\\u0072evision":42'),
    JSON.stringify(wire).replace('"revision":42', '"revision":1e999'),
    '{"revision":42,"nested":' + '['.repeat(101) + '0' + ']'.repeat(101) + '}']) {
    assert.throws(() => project(raw), { code: 'invalid-schema' });
  }
});
