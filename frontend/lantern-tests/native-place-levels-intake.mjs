/** Synthetic native floor/room/other intake through the existing client and canonical batch shape. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadNumericSource } from './load-numeric-source.mjs';
import { transformWithOxc } from 'vite';

const { parseLosslessJson, stringifyLosslessJson } = await import(await loadNumericSource('numeric/lossless-json.ts'));
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const schemaModule = path => dataModule(`export default ${JSON.stringify(JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')))};`);
const quantitySource = new URL('../src/api/quantity-client.ts', import.meta.url);
let { code: quantityCode } = await transformWithOxc(readFileSync(quantitySource, 'utf8'), quantitySource.pathname,
  { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
for (const [specifier, replacement] of Object.entries({
  'ajv/dist/2020.js': import.meta.resolve('ajv/dist/2020.js'),
  'ajv-formats': import.meta.resolve('ajv-formats'),
  '../../../contracts/stock-wire3/agent/agent.schema.json': schemaModule('../../contracts/stock-wire3/agent/agent.schema.json'),
  '../../../packages/contracts/schemas/atlas.schema.json': schemaModule('../../packages/contracts/schemas/atlas.schema.json'),
})) {
  const literal = JSON.stringify(specifier);
  assert(quantityCode.includes(literal), `Missing quantity source import ${specifier}`);
  quantityCode = quantityCode.replaceAll(literal, JSON.stringify(replacement));
}
const quantityModule = dataModule(quantityCode);
const { quantityRequestDigest } = await import(quantityModule);
const placeClientSource = new URL('../src/api/native-place-client.ts', import.meta.url);
let { code: placeClientCode } = await transformWithOxc(readFileSync(placeClientSource, 'utf8'), placeClientSource.pathname,
  { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
const evidenceFactoryStub = `data:text/javascript,export%20const%20createNativeEvidenceClient%3D()%3D%3Enew%20Proxy(%7B%7D%2C%7Bget()%7Bthrow%20new%20Error('Evidence%20client%20is%20outside%20this%20place-intake%20fixture')%7D%7D)%3B`;
const placeImports = {
  './retained-intent-client': 'api/retained-intent-client.ts',
  '../numeric/decimal': 'numeric/decimal.ts',
  '../numeric/lossless-json': 'numeric/lossless-json.ts',
  '../numeric/schema-validator': 'numeric/schema-validator.ts',
  './quantity-client': quantityModule,
  './native-evidence-client': evidenceFactoryStub,
};
for (const [specifier, target] of Object.entries(placeImports)) {
  const replacement = target.startsWith('data:') ? target : await loadNumericSource(target);
  const literal = JSON.stringify(specifier);
  assert(placeClientCode.includes(literal), `Missing source import ${specifier}`);
  placeClientCode = placeClientCode.replaceAll(literal, JSON.stringify(replacement));
}
for (const match of placeClientCode.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
  assert(match[1].startsWith('data:') || match[1].startsWith('file:'), `Unexpected runtime import ${match[1]}`);
const { createNativePlaceClient } = await import(`data:text/javascript;base64,${Buffer.from(placeClientCode).toString('base64')}`);
const U = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const scope = { workspaceId: U(1), homeId: U(2) };
const session = { schemaVersion: 1, actorId: U(3), csrfToken: 'synthetic-local-only', expiresAt: '2099-01-01T00:00:00Z' };
const commandIds = ['atlas.batch.execute', 'atlas.evidence.create', 'atlas.identity.create', 'atlas.location-semantics.create', 'atlas.relation.create'];
const admission = { scope, commandIds, revision: 'synthetic-current' };
const target = (recordType, recordId) => ({ authority: 'atlas', recordType, recordId });
const evidenceRecord = { statement: 'Synthetic owner report.', provenance: { source: null, sourceRevision: null, sourceConfidence: null,
  evidenceBasis: 'owner-report', factAt: null, retrievedAt: '2026-10-12T00:00:00.000Z', vantage: null,
  uncertainty: { status: 'unknown', explanation: null } }, supersedesEvidenceIds: [], references: [] };
const records = new Map();
const addParent = (identityId, semanticsId, semanticKind) => {
  records.set(`identity/${identityId}`, { target: target('identity', identityId), revision: 1, lifecycle: 'active', payload: { kind: 'location', evidenceIds: [U(90)] } });
  records.set(`location-semantics/${semanticsId}`, { target: target('location-semantics', semanticsId), revision: 1, lifecycle: 'active',
    payload: { atlasId: identityId, semanticKind, reviewStatus: 'accepted', evidenceIds: [U(90)] } });
};
addParent(U(10), U(11), 'building');
const posted = [];
const client = createNativePlaceClient({ getContext: () => ({ session, scope, admission }), subscribe: () => () => {}, transport: async (url, init) => {
  assert.equal(new URL(url, 'https://atlas.invalid').pathname, `/api/atlas/stock/v3/workspaces/${scope.workspaceId}/homes/${scope.homeId}/commands`);
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.redirect, 'error');
  assert.equal(init.cache, 'no-store');
  const request = parseLosslessJson(init.body);
  const requestDigest = await quantityRequestDigest(JSON.parse(init.body));
  assert.equal(request.commandId, 'atlas.batch.execute');
  posted.push({ ...request, requestDigest });
  const produced = request.payload.commands.map(child => {
    const record = { target: child.target, revision: 1, lifecycle: 'active', payload: child.payload };
    records.set(`${child.target.recordType}/${child.target.recordId}`, record);
    return record;
  });
  return new Response(stringifyLosslessJson({ schemaVersion: 3, commandId: request.commandId, requestId: request.requestId,
    resolvedScope: scope, status: 'committed', replayed: false, operationId: U(800 + posted.length),
    data: { records: produced, auditIds: produced.map((_, index) => U(900 + posted.length * 10 + index)), requestDigest } }), { status: 200 });
} });
const binding = client.getBinding();
assert(binding);
assert.equal(client.canCreate(binding, true), true);

const packageUUID = U(700);
const floorPrepared = client.prepareCreate(binding, { label: 'Synthetic floor', kind: 'floor', parent: {
  identity: records.get(`identity/${U(10)}`), classification: records.get(`location-semantics/${U(11)}`),
}, statement: 'Synthetic floor classification; elevation is unknown.', reason: 'Synthetic native place intake' });
assert.equal((await client.commit(floorPrepared, new AbortController().signal)).status, 'committed');
const floorBatch = posted[0].payload.commands;
assert.equal(floorBatch.length, 4);
assert.equal(floorBatch[2].payload.semanticKind, 'floor');
assert.equal(Object.hasOwn(floorBatch[2].payload, 'elevation'), false);
assert.notEqual(floorBatch[1].target.recordId, packageUUID);
assert.equal(floorBatch[3].payload.membershipKind, 'building');
assert.deepEqual(floorBatch[3].preconditions.guards.map(value => value.target.recordType), ['identity', 'location-semantics']);
const floorId = floorBatch[1].target.recordId, floorSemanticsId = floorBatch[2].target.recordId;

for (const [kind, label, suffix] of [['room', 'Synthetic room', 1], ['other', 'Synthetic other place', 2]]) {
  const prepared = client.prepareCreate(binding, { label, kind, parent: {
    identity: records.get(`identity/${floorId}`), classification: records.get(`location-semantics/${floorSemanticsId}`),
  }, statement: `Synthetic ${kind} membership under the reviewed floor.`, reason: 'Synthetic native place intake' });
  assert.equal((await client.commit(prepared, new AbortController().signal)).status, 'committed');
  const batch = posted[suffix].payload.commands;
  assert.equal(batch[2].payload.semanticKind, kind);
  assert.equal(Object.hasOwn(batch[2].payload, 'elevation'), false);
  assert.equal(batch[3].payload.membershipKind, 'level');
  assert.deepEqual(batch[3].preconditions.guards.map(value => value.target.recordType), ['identity', 'location-semantics']);
  assert.notEqual(batch[1].target.recordId, packageUUID);
}
assert.equal(posted.length, 3);
assert(posted.every(request => request.payload.commands.every(command => command.target.recordId !== packageUUID)));
console.log('PASS synthetic native place intake: floor under reviewed building; room and other under reviewed floor; guarded accepted membership; client-allocated native IDs separate from package UUID; elevation omitted');
