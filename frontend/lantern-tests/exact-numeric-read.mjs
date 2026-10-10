/** Successful, synthetic, local Response reads through actual browser modules. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from '../node_modules/ajv/dist/2020.js';
import addFormats from '../node_modules/ajv-formats/dist/index.js';
import atlas from '../../packages/contracts/schemas/atlas.schema.json' with { type: 'json' };
import agent from '../../contracts/stock-wire3/agent/agent.schema.json' with { type: 'json' };
import { loadNumericSource } from './load-numeric-source.mjs';

const { ExactDecimal } = await import(await loadNumericSource('numeric/decimal.ts'));
const { parseLosslessJson, stringifyLosslessJson } = await import(await loadNumericSource('numeric/lossless-json.ts'));
const { createExactStockResultValidator } = await import(await loadNumericSource('numeric/schema-validator.ts'));
const { createGeometryClient } = await import(await loadNumericSource('api/geometry-client.ts'));
const { createTopologyClient } = await import(await loadNumericSource('api/topology-client.ts'));
const { buildTopologyIndex, buildBuildingModel, metres } = await import(await loadNumericSource('lantern/topology/model.ts'));
const { createNetworkRelationsClient } = await import(await loadNumericSource('api/network-relations-client.ts'));
const { createAiHostClient } = await import(await loadNumericSource('ai/host/client.ts'));
const { projectView } = await import('../src/lantern/adapters/read.ts');

const exact = parseLosslessJson('{"large":9007199254740993,"tiny":1e-1000,"negative":-0.45,"zero":0,"whole":1e3,"missing":null}');
assert.equal(exact.large.token, '9007199254740993');
assert.equal(exact.tiny.token, '1e-1000');
assert.equal(exact.negative.token, '-0.45');
assert.equal(exact.zero.token, '0');
assert.equal(exact.whole.token, '1e3');
assert.equal(exact.whole.isInteger, true);
assert.equal(exact.missing, null);
assert.equal(stringifyLosslessJson(exact), '{"large":9007199254740993,"tiny":1e-1000,"negative":-0.45,"zero":0,"whole":1e3,"missing":null}');
assert(ExactDecimal.parse('1e-1000').compare(ExactDecimal.parse('0')) > 0);

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const source = JSON.parse(readFileSync(new URL('../../packages/contracts/fixtures/optional-geometry.snapshot.json', import.meta.url), 'utf8'));
const original = source.records.find(record => record.recordType === 'geometry');
assert(original);
const scope = { workspaceId: original.workspaceId, homeId: original.homeId };
const record = { target: { authority: 'atlas', recordType: 'geometry', recordId: original.recordId },
  revision: original.revision, lifecycle: original.lifecycle, payload: structuredClone(original.payload) };
const envelope = { schemaVersion: 3, commandId: 'atlas.geometry.list', requestId: uuid(901), resolvedScope: scope,
  status: 'read', replayed: false, data: { records: [record], nextCursor: null, sourceStatus: 'current' } };
const rawGeometry = JSON.stringify(envelope).replace('"scale":null,"transform":null',
  '"scale":1e-1000,"transform":[9007199254740993,-0.45,0,1e3,1,0]');
assert(rawGeometry.includes('"scale":1e-1000'));
const validator = createExactStockResultValidator();
assert.equal(validator.validate('geometry', parseLosslessJson(rawGeometry)), true);
let geometryCalls = 0;
const geometry = createGeometryClient(async (url, init) => {
  geometryCalls++;
  const target = new URL(url, 'https://atlas.invalid');
  assert.equal(target.pathname, `/api/atlas/stock/v3/workspaces/${scope.workspaceId}/homes/${scope.homeId}/records/geometry`);
  assert.equal(target.searchParams.get('pageSize'), '100');
  assert.equal(target.searchParams.get('includeArchived'), 'false');
  assert.equal(init.method, 'GET');
  assert.equal(init.credentials, 'same-origin');
  return new Response(rawGeometry, { status: 200, headers: { 'Content-Type': 'application/json' } });
});
const geometryRead = await geometry.read(scope, new AbortController().signal);
assert.equal(geometryRead.status, 'ready');
assert.equal(geometryRead.sourceStatus, 'current');
assert.equal(geometryRead.records.length, 1);
assert.equal(geometryRead.records[0].revision, 1);
assert.equal(geometryRead.records[0].payload.geometryVersion, 1);
assert.equal(geometryRead.records[0].payload.scale.token, '1e-1000');
assert.deepEqual(geometryRead.records[0].payload.transform.map(value => value.token),
  ['9007199254740993', '-0.45', '0', '1e3', '1', '0']);
assert.equal(geometryCalls, 1);

// Reuse the unchanged, synthetic topology producer fixture as a complete read
// context; only this new response's two numeric tokens change.
const topologyFixtureSource = readFileSync(new URL('./topology-read.mjs', import.meta.url), 'utf8');
const fixtureStart = topologyFixtureSource.indexOf('const fixture = ') + 'const fixture = '.length;
const fixtureEnd = topologyFixtureSource.indexOf(';\nconst ajv =', fixtureStart);
assert(fixtureStart > 'const fixture = '.length && fixtureEnd > fixtureStart);
const topologyFixture = JSON.parse(topologyFixtureSource.slice(fixtureStart, fixtureEnd));
const requestAjv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(requestAjv); requestAjv.addSchema(atlas); requestAjv.addSchema(agent);
const requestSchemas = { validate(ref, value) {
  const check = requestAjv.getSchema(agent.$id + ref);
  assert(check);
  assert.equal(check(value), true, JSON.stringify(check.errors));
} };
const topologySession = { schemaVersion: 1, actorId: uuid(802), csrfToken: 'synthetic-unused', expiresAt: '2099-01-01T00:00:00Z' };
const snapshotSha256 = 'b'.repeat(64);
const topologyCalls = [];
const topology = createTopologyClient({ schemas: requestSchemas,
  getSessionBinding: () => ({ session: topologySession, scope: topologyFixture.scope }),
  subscribeSessionBinding: () => () => {}, transport: async (url, init) => {
    const target = new URL(url, 'https://atlas.invalid');
    assert.equal(target.pathname,
      `/api/atlas/stock/v3/workspaces/${topologyFixture.scope.workspaceId}/homes/${topologyFixture.scope.homeId}/invoke`);
    assert.deepEqual([...target.searchParams.keys()], ['request']);
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'same-origin');
    const request = JSON.parse(target.searchParams.get('request'));
    topologyCalls.push(request);
    const kind = request.target.recordType;
    let records = topologyFixture.records[kind];
    if (request.payload.buildingId !== undefined) {
      assert.equal(kind, 'identity');
      assert.equal(request.payload.buildingId, topologyFixture.members[0]);
      records = records.filter(record => topologyFixture.members.includes(record.target.recordId));
    }
    const result = { schemaVersion: 3, commandId: request.commandId, requestId: request.requestId,
      resolvedScope: topologyFixture.scope, status: 'read', replayed: false,
      data: { records, nextCursor: null, sourceStatus: 'current' } };
    let body = JSON.stringify(result);
    if (kind === 'location-semantics') {
      assert(body.includes('"metres":2.7') && body.includes('"metres":0'));
      body = body.replace('"metres":2.7', '"metres":9007199254740993')
        .replace('"metres":0', '"metres":1e-1000');
      assert.equal(validator.validate('location_semantics', parseLosslessJson(body)), true);
    }
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json',
      'x-atlas-snapshot-sha256': snapshotSha256 } });
  } });
const topologyBinding = topology.getBinding();
assert(topologyBinding);
const topologySignal = new AbortController().signal;
const [identities, bindings, semantics, relations] = await Promise.all(
  ['identity', 'binding', 'location-semantics', 'relation'].map(kind => topology.listAll(topologyBinding, kind, topologySignal)));
for (const read of [identities, bindings, semantics, relations]) {
  assert.equal(read.status, 'ready');
  assert.equal(read.snapshotSha256, snapshotSha256);
  assert.equal(read.sourceStatus, 'current');
}
const members = await topology.buildingMembers(topologyBinding, topologyFixture.members[0], topologySignal);
assert.equal(members.status, 'ready');
assert.deepEqual(members.records.map(record => record.target.recordId), topologyFixture.members);
const projection = projectView(topologyFixture.view);
const selectable = new Map(projection.house.spaces.map(space => [space.id, projection.entries.get(space.id)]));
const index = buildTopologyIndex({ identities: identities.records, bindings: bindings.records,
  semantics: semantics.records, relations: relations.records, sourceStatuses: ['current'] }, topologyFixture.view, selectable);
const model = buildBuildingModel(index, topologyFixture.members[0], members.records);
assert(model);
const sameDatum = model.levels.filter(level => level.elevation.status === 'known'
  && level.elevation.elevation.datumAtlasId === topologyFixture.members[0]);
assert.deepEqual(sameDatum.map(level => level.elevation.elevation.metres.token),
  ['9007199254740993', '1e-1000']);
assert.equal(metres(sameDatum[0].elevation.elevation.metres), '+9007199254740993 m');
assert.equal(metres(sameDatum[1].elevation.elevation.metres), '+1e-1000 m');
assert(model.levels.some(level => level.elevation.status === 'known'
  && metres(level.elevation.elevation.metres) === '−0.45 m'));
assert.equal(topologyCalls.length, 5);

const networkScope = { workspaceId: uuid(800), homeId: uuid(801) };
const networkSession = { actorId: uuid(802) };
const relation = { schemaVersion: 1, ...networkScope, sourceInstanceId: uuid(803), collectionId: 'synthetic-network',
  externalId: 'synthetic-link', kind: 'network-connection',
  from: { kind: 'device', id: 'synthetic-a', description: null },
  to: { kind: 'device', id: 'synthetic-b', description: null }, medium: 'ethernet', sourceRevision: 0,
  sourceSnapshotAt: null, retrievedAt: '2026-10-08T12:00:00Z', vantage: null,
  sourceConfidence: 'reported', evidenceBasis: 'source-report', temporalStatus: 'current-claim',
  factAt: null, notes: '' };
const networkPage = { contractVersion: '1.0.0', items: [relation], nextCursor: null, sourceStatuses: [] };
for (const revision of ['9007199254740993', '1e3', '0', 'null']) {
  const rawPage = JSON.stringify(networkPage).replace('"sourceRevision":0', `"sourceRevision":${revision}`);
  assert(rawPage.includes(`"sourceRevision":${revision}`));
  let calls = 0;
  const network = createNetworkRelationsClient({ getSessionBinding: () => ({ session: networkSession, scope: networkScope }),
    subscribeSessionBinding: () => () => {}, fetch: async (url, init) => {
      calls++;
      const target = new URL(url, 'https://atlas.invalid');
      assert.equal(target.pathname, `/api/atlas/v1/workspaces/${networkScope.workspaceId}/homes/${networkScope.homeId}/network/relations`);
      assert.equal(target.searchParams.get('limit'), '25');
      assert.equal(init.method, 'GET');
      assert.equal(init.credentials, 'same-origin');
      return new Response(rawPage, { status: 200, headers: { 'Content-Type': 'application/json' } });
    } });
  const read = await network.read(network.getBinding(), null, new AbortController().signal);
  assert.equal(read.status, 'ready');
  assert.equal(read.page.items[0].sourceRevision, revision === 'null' ? null : revision);
  assert.deepEqual(read.page.items[0].from, relation.from);
  assert.equal(calls, 1);
}

const aiOutcome = '{"status":"review-required","continuationId":"synthetic-continuation","calls":[{"callId":"synthetic-call","name":"atlas_records","arguments":{"large":9007199254740993,"tiny":1e-1000,"ordinary":2}}],"reviews":[{"challengeId":"synthetic-challenge","commandId":"atlas.circuit.create","requestDigest":"synthetic-request","targetDigest":"synthetic-target","impactId":"synthetic-impact","impactDigest":"synthetic-impact-digest","affectedTargets":[{"revision":9007199254740993,"elevation":-0.45}],"recoverability":"reversible-tombstone","expiresAt":"2099-01-01T00:00:00Z"}],"usage":{"inputTokens":12,"outputTokens":7,"totalTokens":19}}';
const finished = '{"requestId":"synthetic-request-id","status":"finished","outcome":' + aiOutcome + '}';
const observed = [];
const ai = createAiHostClient({ endpoints: { connection: '/synthetic/connection', connectionAction: '/synthetic/action',
  connectionActionStatus: id => `/synthetic/action/${id}`, run: '/synthetic/run', cancel: id => `/synthetic/cancel/${id}`,
  openReview: '/synthetic/review', resume: '/synthetic/resume', requestStatus: id => `/synthetic/status/${id}` },
mutationHeaders: async () => ({ 'X-Atlas-CSRF': 'synthetic-application-nonce' }),
fetch: async (url, init) => {
  observed.push({ url, method: init.method, body: init.body });
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.cache, 'no-store');
  const body = url === '/synthetic/status/synthetic-request-id' ? finished : aiOutcome;
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
} });
const signal = new AbortController().signal;
const input = { requestId: 'synthetic-request-id', prompt: 'Synthetic preview' };
const run = await ai.run(input, signal);
const resume = await ai.resume({ requestId: input.requestId, continuationId: run.continuationId }, signal);
const status = await ai.requestStatus(input.requestId, signal);
for (const outcome of [run, resume, status.outcome]) {
  assert.equal(outcome.status, 'review-required');
  assert.equal(outcome.calls[0].arguments.large.token, '9007199254740993');
  assert.equal(outcome.calls[0].arguments.tiny.token, '1e-1000');
  assert.equal(outcome.reviews[0].affectedTargets[0].revision.token, '9007199254740993');
  assert.equal(stringifyLosslessJson(outcome.calls[0].arguments),
    '{"large":9007199254740993,"tiny":1e-1000,"ordinary":2}');
  assert.equal(stringifyLosslessJson(outcome.reviews[0].affectedTargets),
    '[{"revision":9007199254740993,"elevation":-0.45}]');
  assert.deepEqual(outcome.usage, { inputTokens: 12, outputTokens: 7, totalTokens: 19 });
}
assert.equal(status.status, 'finished');
assert.deepEqual(observed.map(row => [row.url, row.method]),
  [['/synthetic/run', 'POST'], ['/synthetic/resume', 'POST'], ['/synthetic/status/synthetic-request-id', 'GET']]);
assert.deepEqual(JSON.parse(observed[0].body), input);
assert.deepEqual(JSON.parse(observed[1].body), { requestId: input.requestId, continuationId: run.continuationId });
assert.equal(observed[2].body, undefined);
console.log('PASS exact numeric parser, canonical geometry schema/client, passive network revision read, AI run/resume/finished review values');
