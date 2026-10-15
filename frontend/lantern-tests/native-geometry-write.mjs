/** One fake-transport healthy custody workflow. No server, listener, real media,
 * provider, association, retry, timeout or failure/control case is executed. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { transformWithOxc } from 'vite';
import { loadNumericSource } from './load-numeric-source.mjs';
import { loadIfcGlbProfileSource } from './scan-mesh-read.mjs';

const file = new URL('../integration/native-geometry-write-client.ts', import.meta.url);
let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname,
  { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
// This helper owns only its new module bridge; the existing loader is unchanged.
for (const [specifier, module] of Object.entries({
  '../src/numeric/decimal': 'numeric/decimal.ts',
  '../src/numeric/lossless-json': 'numeric/lossless-json.ts',
  '../src/numeric/schema-validator': 'numeric/schema-validator.ts',
})) {
  const literal = JSON.stringify(specifier);
  assert(code.includes(literal), `Missing actual source import ${specifier}`);
  code = code.replaceAll(literal, JSON.stringify(await loadNumericSource(module)));
}
const glbSpecifier = '"../src/lantern/scans/ifc-glb-profile"'; assert(code.includes(glbSpecifier));
code = code.replaceAll(glbSpecifier, JSON.stringify(await loadIfcGlbProfileSource()));
for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
  assert(match[1].startsWith('data:'), `Unexpected actual source import ${match[1]}`);
const { createNativeGeometryWriteClient } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const { isExactDecimal } = await import(await loadNumericSource('numeric/decimal.ts'));
const { stringifyLosslessJson } = await import(await loadNumericSource('numeric/lossless-json.ts'));

const uid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const scope = Object.freeze({ workspaceId: uid(2), homeId: uid(3) });
const session = Object.freeze({ schemaVersion: 1, actorId: 'synthetic-native-geometry',
  csrfToken: 'synthetic-current-csrf', expiresAt: new Date(Date.now() + 3600000).toISOString() });
const admission = Object.freeze({ scope, commandIds: Object.freeze(['atlas.asset.create']), revision: 'synthetic-admission' });
const license = Object.freeze({ status: 'unknown', reference: null });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Fixture numeric leaves are bounded integers; independently construct the
// native owner intent digest (exclude root requestId/approvalReceiptId only).
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const intentDigest = root => {
  const intent = { ...root }; delete intent.requestId; delete intent.approvalReceiptId;
  return sha(Buffer.from(canonical(intent), 'utf8'));
};
const bytesByKind = { original: Uint8Array.of(1, 2, 3), derivative: Uint8Array.of(4, 5, 6, 7) };
const responses = [];
const sourceListeners = new Set();
let posts = 0;
let client;
let binding;
const transport = async (path, init) => {
  posts++;
  const kind = posts === 1 ? 'original' : 'derivative';
  assert(posts <= 2);
  assert.equal(path, `/api/atlas/geometry/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/originals${kind === 'derivative' ? `/${uid(701)}/derivative` : ''}`);
  assert.equal(init.method, 'POST'); assert.equal(init.credentials, 'same-origin');
  assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
  assert.deepEqual(init.headers, { Accept: 'application/json', 'x-atlas-csrf': session.csrfToken });
  assert(init.signal instanceof AbortSignal); assert.equal(init.signal.aborted, false);
  assert(init.body instanceof FormData);
  const fields = [...init.body.entries()]; assert.deepEqual(fields.map(([name]) => name), ['metadata', 'file']);
  assert.equal(typeof fields[0][1], 'string');
  const metadata = JSON.parse(fields[0][1]);
  const uploaded = fields[1][1]; assert(uploaded instanceof Blob);
  assert.equal(uploaded.name, metadata.filename); assert.equal(uploaded.type, metadata.contentType);
  const bytes = new Uint8Array(await uploaded.arrayBuffer());
  assert.deepEqual(bytes, bytesByKind[kind]);
  assert.deepEqual(metadata.context, scope); assert.deepEqual(metadata.sourceLicense, license);
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.filename, kind === 'original' ? 'synthetic.usdz' : 'synthetic.mesh.json');
  assert.equal(metadata.reason, `Synthetic ${kind} custody`);
  assert.equal(metadata.contentType, kind === 'original' ? 'model/vnd.usdz+zip' : 'application/vnd.houseatlas.magicplan-authored-mesh+json');
  assert.match(metadata.requestId, /^[0-9a-f-]{36}$/); assert.match(metadata.idempotencyKey, /^[0-9a-f-]{36}$/);
  // Observe the one successful exchange's pre-dispatch ledger. This does not
  // force an unknown result or exercise an unknown-custody control.
  const pending = client.pending(binding); assert.equal(pending.at(-1).outcome, 'unknown');
  assert.equal(pending.at(-1).prepared.metadata, fields[0][1]);
  assert.equal(pending.at(-1).prepared.file.size, bytes.byteLength);
  const target = { authority: 'atlas', recordType: 'asset', recordId: uid(kind === 'original' ? 701 : 702) };
  const purpose = kind === 'original' ? 'geometry-original' : 'derived-preview';
  const originalRequest = { schemaVersion: 3, commandId: 'atlas.asset.create', requestId: metadata.requestId,
    context: scope, target, payload: { staged: { uploadToken: uid(kind === 'original' ? 711 : 712),
      sha256: sha(bytes), byteSize: bytes.byteLength, contentType: metadata.contentType, filename: metadata.filename },
      purpose, sourceLicense: license, evidenceIds: [] }, idempotencyKey: metadata.idempotencyKey,
    reason: metadata.reason, preconditions: { target: null, guards: kind === 'original' ? [] : [
      { target: { authority: 'atlas', recordType: 'asset', recordId: uid(701) }, revision: { kind: 'atlas', value: 1 } },
    ] }, approvalReceiptId: null };
  const result = { schemaVersion: 3, commandId: 'atlas.asset.create', requestId: metadata.requestId,
    resolvedScope: scope, status: 'committed', replayed: false,
    // Real storage issues an operation UUID independently of idempotencyKey.
    operationId: uid(kind === 'original' ? 721 : 722), data: { records: [
      { target, revision: 1, lifecycle: 'active', payload: { owner: 'atlas', purpose, sha256: sha(bytes),
        byteSize: bytes.byteLength, contentType: metadata.contentType, sourceLicense: license,
        availability: 'available', previewPolicy: 'download-only', evidenceIds: [] } },
    ], auditIds: [uid(kind === 'original' ? 731 : 732)], requestDigest: intentDigest(originalRequest) } };
  const envelope = { schemaVersion: 1, originalRequest, result, association: 'not-associated' };
  const responseBody = JSON.stringify(envelope);
  responses.push({ envelope, responseBody });
  return new Response(responseBody, { status: 200, headers: { 'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(responseBody)), 'cache-control': 'private, no-store' } });
};
// One explicit synthetic owner identity, stable while this actual session is
// current. Getter DTOs are fresh clones; none is used as the authority identity.
const sessionIdentity = Object.freeze({});
client = createNativeGeometryWriteClient({ getContext: () => ({ sessionIdentity,
  session: { ...session }, scope: { ...scope },
  admission: { ...admission, scope: { ...scope }, commandIds: [...admission.commandIds] } }),
  subscribe: changed => { sourceListeners.add(changed); return () => { sourceListeners.delete(changed); }; }, transport });
binding = client.getBinding(); assert(binding); assert.deepEqual(binding, { scope });
assert.equal(client.getBinding(), binding); assert.equal(client.canPrepare(binding), true);
const signal = new AbortController().signal;
const originalInput = await client.prepareOriginal(binding, { file: new Blob([bytesByKind.original]),
  filename: 'synthetic.usdz', contentType: 'model/vnd.usdz+zip', reason: 'Synthetic original custody', sourceLicense: license }, signal);
assert(Object.isFrozen(originalInput)); assert.equal(originalInput.sha256, sha(bytesByKind.original));
const original = await client.commit(originalInput, signal);
assert.equal(original.kind, 'original'); assert.equal(original.assetId, uid(701)); assert.equal(original.association, 'not-associated');
assert.equal(original.responseBody, responses[0].responseBody);
assert.equal(stringifyLosslessJson(original.originalRequest), JSON.stringify(responses[0].envelope.originalRequest));
assert(isExactDecimal(original.originalRequest.payload.staged.byteSize)); assert.equal(original.originalRequest.payload.staged.byteSize.token, '3');
assert(Object.isFrozen(original.originalRequest.payload.staged));
const derivativeInput = await client.prepareDerivative(binding, original, { file: new Blob([bytesByKind.derivative]),
  filename: 'synthetic.mesh.json', reason: 'Synthetic derivative custody', sourceLicense: license }, signal);
assert.notEqual(derivativeInput.requestId, originalInput.requestId);
assert.notEqual(derivativeInput.idempotencyKey, originalInput.idempotencyKey);
assert.equal(derivativeInput.originalAssetId, original.assetId);
const derivative = await client.commit(derivativeInput, signal);
assert.equal(derivative.kind, 'derivative'); assert.equal(derivative.assetId, uid(702)); assert.equal(derivative.association, 'not-associated');
assert.equal(derivative.responseBody, responses[1].responseBody);
assert.equal(stringifyLosslessJson(derivative.originalRequest), JSON.stringify(responses[1].envelope.originalRequest));
assert.equal(derivative.originalRequest.preconditions.guards[0].target.recordId, original.assetId);
assert(isExactDecimal(derivative.result.data.records[0].revision)); assert.equal(derivative.result.data.records[0].revision.token, '1');
assert.equal(derivative.result.data.records[0].payload.sha256, sha(bytesByKind.derivative));
assert.equal(posts, 2); assert.equal(sourceListeners.size, 0);
const pending = client.pending(binding);
assert.deepEqual(pending.map(row => row.outcome), ['committed', 'committed']);
assert.equal(pending[0].prepared, originalInput); assert.equal(pending[0].receipt, original);
assert.equal(pending[1].prepared, derivativeInput); assert.equal(pending[1].receipt, derivative);
assert.equal(Object.hasOwn(client, 'associate'), false);
console.log('PASS native geometry two independent custody commits through actual exact client and fake Response transport');
