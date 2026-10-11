/** Synthetic named GET positives for historical native evidence requests. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithOxc } from 'vite';

const root = new URL('../src/', import.meta.url);
const dataUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const raw = async relative => dataUrl(`export default ${JSON.stringify(await readFile(new URL(relative, import.meta.url), 'utf8'))};`);
const moduleCache = new Map();
const schemaAgent = await raw('../../contracts/stock-wire3/agent/agent.schema.json');
const schemaAtlas = await raw('../../packages/contracts/schemas/atlas.schema.json');
const formats = new URL('../node_modules/ajv-formats/dist/formats.js', import.meta.url).href;
const sourcePath = relative => new URL(relative, root);
const runtimeModules = new Set([
  'api/native-evidence-client.ts',
  'capture-evidence/selection.ts',
  'capture-evidence/types.ts',
  'numeric/decimal.ts',
  'numeric/lossless-json.ts',
  'numeric/schema-validator.ts',
]);
async function load(relative) {
  assert(runtimeModules.has(relative), `unexpected production runtime module: ${relative}`);
  if (moduleCache.has(relative)) return moduleCache.get(relative);
  const file = sourcePath(relative), source = await readFile(file, 'utf8');
  let { code } = await transformWithOxc(source, file.pathname, { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  const imports = [...code.matchAll(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'];?\s*$/gm)].map(match => match[1]);
  for (const specifier of imports) {
    let destination;
    if (specifier === '../../../contracts/stock-wire3/agent/agent.schema.json?raw') destination = schemaAgent;
    else if (specifier === '../../../packages/contracts/schemas/atlas.schema.json?raw') destination = schemaAtlas;
    else if (specifier === 'ajv-formats/dist/formats.js') destination = formats;
    else {
      assert(specifier.startsWith('.'), `unexpected bare production import: ${specifier}`);
      const resolved = new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, file).pathname
        .replace(sourcePath('').pathname, '');
      assert(runtimeModules.has(resolved), `unexpected production runtime dependency: ${resolved}`);
      destination = await load(resolved);
    }
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(destination));
  }
  const url = dataUrl(code); moduleCache.set(relative, url); return url;
}

const { createNativeEvidenceClient } = await import(await load('api/native-evidence-client.ts'));
const { stringifyLosslessJson } = await import(await load('numeric/lossless-json.ts'));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { workspaceId: uuid(800), homeId: uuid(801) }, placeId = uuid(802), identityId = uuid(803), priorEvidence = uuid(804);
const requestedId = uuid(805), evidenceId = uuid(806), assetId = uuid(807), auditA = uuid(808), auditB = uuid(809), operationId = uuid(810);
const timestamp = '2026-10-11T10:00:00Z';
const identityPayload = { kind: 'location', evidenceIds: [priorEvidence] };
const location = { schemaVersion: 1, recordType: 'location-semantics', recordId: placeId, ...scope, revision: 1,
  lifecycle: 'active', createdAt: timestamp, updatedAt: timestamp, lastAuditId: uuid(811),
  payload: { atlasId: identityId, semanticKind: 'room', reviewStatus: 'accepted', evidenceIds: [priorEvidence] } };
const identity = { schemaVersion: 1, recordType: 'identity', recordId: identityId, ...scope, revision: 1,
  lifecycle: 'active', createdAt: timestamp, updatedAt: timestamp, lastAuditId: uuid(812), payload: identityPayload };
const guards = [
  { record: { recordType: 'evidence', recordId: priorEvidence }, expectedRevision: 1 },
  { record: { recordType: 'identity', recordId: identityId }, expectedRevision: 1 },
];
const admission = { schemaVersion: 1, admissionKind: 'native-location', scope, record: location, identity, guards,
  canAttachEvidence: true, maximumReasonCodePoints: 1024,
  attachmentPolicy: { contentTypes: ['image/png', 'image/jpeg', 'application/pdf', 'text/plain'], maximumBytes: 10 * 1024 * 1024,
    licenses: [{ label: 'Synthetic unknown licence', value: { status: 'unknown', reference: null } }] } };
const evidencePayload = { statement: 'Synthetic historical evidence', provenance: { source: null, sourceRevision: null,
  sourceConfidence: null, evidenceBasis: 'unknown', factAt: null, retrievedAt: timestamp, vantage: 'Synthetic',
  uncertainty: { status: 'unknown', explanation: null } }, supersedesEvidenceIds: [], references: [{ kind: 'atlas-asset', assetId }] };
const publicRecord = (recordType, recordId, revision, payload) => ({ target: { authority: 'atlas', recordType, recordId }, revision, lifecycle: 'active', payload });
const receipt = { schemaVersion: 3, commandId: 'atlas.batch.execute', requestId: requestedId, resolvedScope: scope, status: 'committed',
  replayed: false, operationId, data: { auditIds: [auditA, auditB], requestDigest: 'a'.repeat(64), records: [
    publicRecord('evidence', evidenceId, 1, evidencePayload),
    publicRecord('identity', identityId, 2, { kind: 'location', evidenceIds: [priorEvidence, evidenceId] }),
  ] } };
const wrapper = (outcome, result) => ({ schemaVersion: 1, kind: 'native-evidence-reconciliation', requestId: requestedId, scope, recordId: placeId,
  outcome, ...(outcome === 'unknown' ? { retrySafety: 'not-established' } : { result }) });
const response = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

async function runCase(name, observed) {
  const calls = [], notifications = [], binding = Object.freeze({ scope: Object.freeze({ ...scope }) }), owner = {};
  const client = createNativeEvidenceClient({ getBinding: () => binding, subscribe: () => () => {}, owner: () => owner,
    exchange: async (actual, route, method, signal) => {
      assert.equal(actual, binding); assert.equal(method, 'GET'); assert(signal instanceof AbortSignal);
      calls.push({ route, method });
      const base = `/api/atlas/editing/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/native-places/${placeId}`;
      if (route === base) return response({ schemaVersion: 1, admissionKind: 'native-location', scope, record: location, identity, guards,
        canAttachEvidence: true, maximumReasonCodePoints: 1024, attachmentPolicy: admission.attachmentPolicy });
      assert.equal(route, `${base}/evidence/requests/${requestedId}`);
      return response(observed);
    } });
  client.subscribePending(() => notifications.push('ledger-change'));
  const before = client.pending(binding);
  const fresh = await client.load(binding, placeId, new AbortController().signal);
  const afterLoad = client.pending(binding);
  const result = await client.readRequest(fresh, requestedId, new AbortController().signal);
  assert.equal(result.outcome, name === 'healthy-committed-observation' ? 'committed' : 'unknown');
  assert.equal(result.retrySafety, 'not-established');
  assert.equal(stringifyLosslessJson(result.observed), JSON.stringify(observed));
  if (result.outcome === 'committed') assert.equal(stringifyLosslessJson(result.result), JSON.stringify(receipt));
  assert.deepEqual(client.pending(binding), before);
  assert.deepEqual(afterLoad, before);
  assert.deepEqual(notifications, []);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET']);
  assert(!calls.some(call => call.method === 'POST'));
  console.log(`PASS ${name}: actual response read, closed batch validation, no POST or ledger change`);
}

const name = process.argv[2];
if (name === 'healthy-committed-observation') await runCase(name, wrapper('committed', receipt));
else if (name === 'healthy-unknown-observation') await runCase(name, wrapper('unknown'));
else throw new Error('Select one named case: healthy-committed-observation or healthy-unknown-observation');
