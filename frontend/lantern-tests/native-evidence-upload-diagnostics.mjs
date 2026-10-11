/** Individually selected, synthetic-only upload diagnostic failures. No network or browser. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build, transformWithOxc } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
const cases = new Set(['waiting-headers-transport', 'waiting-headers-deadline', 'caller-canceled', 'context-changed',
  'reading-response-transport', 'reading-response-idle', 'response-validation', 'correlated-intake-rejection',
  'owner-session-expired', 'exchange-session-expired', 'throwing-observer-transport', 'throwing-observer-intake-rejection', 'throwing-observer-committed',
  'host-context-change-ordered']);
const name = process.argv[2];
assert(cases.has(name), 'Select exactly one documented diagnostic case');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { workspaceId: uuid(900), homeId: uuid(901) }, placeId = uuid(902), identityId = uuid(903), priorEvidence = uuid(904);
const timestamp = '2026-10-11T10:00:00Z';
const location = { schemaVersion: 1, recordType: 'location-semantics', recordId: placeId, ...scope, revision: 1,
  lifecycle: 'active', createdAt: timestamp, updatedAt: timestamp, lastAuditId: uuid(905),
  payload: { atlasId: identityId, semanticKind: 'room', reviewStatus: 'accepted', evidenceIds: [priorEvidence] } };
const identity = { schemaVersion: 1, recordType: 'identity', recordId: identityId, ...scope, revision: 1,
  lifecycle: 'active', createdAt: timestamp, updatedAt: timestamp, lastAuditId: uuid(906),
  payload: { kind: 'location', evidenceIds: [priorEvidence] } };
const policy = { contentTypes: ['image/png', 'image/jpeg', 'application/pdf', 'text/plain'], maximumBytes: 10 * 1024 * 1024,
  licenses: [{ label: 'Synthetic unknown licence', value: { status: 'unknown', reference: null } }] };
const admission = { schemaVersion: 1, admissionKind: 'native-location', scope, record: location, identity,
  guards: [{ record: { recordType: 'evidence', recordId: priorEvidence }, expectedRevision: 1 },
    { record: { recordType: 'identity', recordId: identityId }, expectedRevision: 1 }],
  canAttachEvidence: true, maximumReasonCodePoints: 1024, attachmentPolicy: policy };
let binding = Object.freeze({ scope: Object.freeze({ ...scope }) });
const owner = {}, otherOwner = {};
const calls = [], observations = [], listeners = new Set();
let currentBinding = binding, capturedReason, armed = false, lateResponse;
let hostListener, hostAbortReason, hostNotifications = 0;
const notificationOrder = [];
const genuineSessionCase = ['owner-session-expired', 'exchange-session-expired'].includes(name);
const sessionExpiry = new Date(Date.now() + 60000).toISOString();
const session = { schemaVersion: 1, actorId: uuid(907), csrfToken: 'synthetic-private-csrf', expiresAt: sessionExpiry };
const originalFailure = new Error('SYNTHETIC_PRIVATE_ERROR: filename statement cookie CSRF must stay lexical');
const outer = new AbortController();
const never = () => new Promise(() => {});
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const options = { getBinding: () => currentBinding, owner: actual => actual === binding ? owner : otherOwner,
  subscribe(changed) { listeners.add(changed); return () => listeners.delete(changed); },
  exchange: async (actual, route, method, signal, body, requestId) => {
    assert.equal(actual, binding); assert(signal instanceof AbortSignal);
    const base = `/api/atlas/editing/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/native-places/${placeId}`;
    calls.push({ route, method });
    if (method === 'GET') { assert.equal(route, base); return response(admission); }
    assert.equal(method, 'POST'); assert.equal(route, `${base}/evidence`); assert(body instanceof FormData);
    assert.equal(body.get('file').name, 'synthetic-private.pdf');
    assert.equal(JSON.parse(body.get('metadata')).requestId, requestId);
    signal.addEventListener('abort', () => { capturedReason = signal.reason; }, { once: true });
    armed = true;
    if (['waiting-headers-transport', 'throwing-observer-transport'].includes(name)) throw originalFailure;
    if (name === 'waiting-headers-deadline') return new Promise(resolve => { lateResponse = resolve; });
    if (name === 'caller-canceled') { outer.abort(originalFailure); return never(); }
    if (name === 'context-changed') {
      currentBinding = Object.freeze({ scope: binding.scope });
      for (const listener of [...listeners]) listener();
      return never();
    }
    if (name === 'host-context-change-ordered') {
      assert.equal(listeners.size, 2, 'mounted host and in-flight bounded operation are both subscribed');
      assert.equal([...listeners][0], hostListener, 'mounted host was subscribed before commit');
      currentBinding = Object.freeze({ scope: Object.freeze({ ...scope, homeId: uuid(915) }) });
      for (const listener of [...listeners]) {
        notificationOrder.push(listener === hostListener ? 'host' : 'bounded'); listener();
        if (listener === hostListener) {
          assert(signal.aborted, 'host clearing aborts the in-flight operation before its own context subscriber runs');
          assert.equal(signal.reason, outer.signal.reason, 'the original outer reason is forwarded unchanged');
        }
      }
      return never();
    }
    if (name === 'reading-response-transport') return new Response(new ReadableStream({ start(controller) { controller.error(originalFailure); } }), { status: 502 });
    if (name === 'reading-response-idle') return new Response(new ReadableStream({ cancel() {} }), { status: 408 });
    if (name === 'response-validation') return response({ secret: originalFailure.message }, 408);
    if (name === 'owner-session-expired') return new Response(new ReadableStream({ pull(controller) {
      session.expiresAt = '1970-01-01T00:00:00Z'; controller.error(originalFailure);
    } }, { highWaterMark: 0 }), { status: 200 });
    if (name === 'exchange-session-expired') { session.expiresAt = '1970-01-01T00:00:00Z'; return response({}); }
    if (name === 'throwing-observer-committed') {
      const metadata = JSON.parse(body.get('metadata')), evidenceId = uuid(908), assetId = uuid(909);
      return response({ schemaVersion: 3, commandId: 'atlas.batch.execute', requestId, resolvedScope: scope, status: 'committed',
        replayed: false, operationId: uuid(910), data: { auditIds: [uuid(911), uuid(912)], requestDigest: 'a'.repeat(64), records: [
          { target: { authority: 'atlas', recordType: 'evidence', recordId: evidenceId }, revision: 1, lifecycle: 'active', payload: {
            statement: metadata.statement, provenance: { source: null, sourceRevision: null, sourceConfidence: null, evidenceBasis: 'unknown',
              factAt: null, retrievedAt: timestamp, vantage: `Browser selection claim v1: ${JSON.stringify(metadata.capture)}`,
              uncertainty: { status: 'unknown', explanation: null } }, supersedesEvidenceIds: [], references: [{ kind: 'atlas-asset', assetId }] } },
          { target: { authority: 'atlas', recordType: 'identity', recordId: identityId }, revision: 2, lifecycle: 'active',
            payload: { kind: 'location', evidenceIds: [priorEvidence, evidenceId] } },
        ] } });
    }
    assert(['correlated-intake-rejection', 'throwing-observer-intake-rejection'].includes(name));
    return response({ schemaVersion: 1, kind: 'native-evidence-outcome', requestId, scope, recordId: placeId,
      outcome: 'not-committed', phase: 'intake', error: { code: 'upload-timeout', httpStatus: 408 } }, 408);
  } };
async function actualNativePlaceClient() {
  // This exact host owns session checks and throws ordinary Errors; it is not
  // replaced by a diagnostic-only fake owner. Only its transport/context are synthetic.
  const entry = new URL('../src/api/native-place-client.ts', import.meta.url);
  const outputs = await build({ configFile: false, root: new URL('..', import.meta.url).pathname, logLevel: 'error',
    build: { ssr: entry.pathname, write: false, sourcemap: false, minify: false,
      rollupOptions: { external: ['ajv/dist/2020.js', 'ajv-formats', 'ajv-formats/dist/formats.js'] } } });
  let code = outputs.output.find(row => row.type === 'chunk').code;
  for (const [specifier, relative] of [['ajv/dist/2020.js', 'ajv/dist/2020.js'], ['ajv-formats', 'ajv-formats/dist/index.js'],
    ['ajv-formats/dist/formats.js', 'ajv-formats/dist/formats.js']]) {
    const destination = new URL(`../node_modules/${relative}`, import.meta.url).href;
    code = code.replaceAll(`from "${specifier}"`, `from ${JSON.stringify(destination)}`);
  }
  const { createNativePlaceClient } = await import(dataUrl(code));
  const context = { session, scope, admission: { scope, commandIds: [] } };
  return createNativePlaceClient({ getContext: () => context, subscribe: options.subscribe,
    transport: (route, init) => {
      assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
      if (init.method === 'POST') assert.equal(init.headers['X-Atlas-CSRF'], session.csrfToken);
      return options.exchange(binding, route, init.method, init.signal, init.body, init.headers['X-Atlas-Upload-Request-Id']);
    } }).evidence;
}
const client = genuineSessionCase ? await actualNativePlaceClient() : createNativeEvidenceClient(options);
if (genuineSessionCase) { binding = client.getBinding(); assert(binding); currentBinding = binding; }
// NativePlaceEvidence's mounted useLayoutEffect subscribes before a later
// commit. Its clear() calls active.current?.abort() without replacing the reason.
// Model that source-backed ordering; this is not an interactive React mount.
const unsubscribeHost = name === 'host-context-change-ordered' ? client.subscribe(hostListener = () => {
  if (client.getBinding() !== binding) { hostNotifications++; outer.abort(); hostAbortReason = outer.signal.reason; }
}) : () => undefined;
let observerCalls = 0;
if (name.startsWith('throwing-observer-')) client.subscribePending(() => { observerCalls++; throw new Error('SYNTHETIC_PRIVATE_OBSERVER_ERROR'); });
client.subscribePending(() => {
  if (currentBinding === binding) observations.push(client.pending(binding).map(row => row.uploadDiagnostic));
});
const fresh = await client.load(binding, placeId, new AbortController().signal);
const file = new File(['%PDF-1.7\nSynthetic private bytes\n'], 'synthetic-private.pdf', { type: 'application/pdf' });
const input = { selection: { original: file, file, capture: { schemaVersion: 1, selectionMethod: 'file-picker', selectedAt: timestamp,
  filename: file.name, reportedContentType: file.type, byteOrigin: 'browser-returned-unmodified' } },
  statement: 'Synthetic private statement', reason: 'Synthetic reason', sourceLicense: policy.licenses[0].value };
const prepared = await client.prepare(fresh, input, new AbortController().signal);
assert.deepEqual(calls.map(call => call.method), ['GET', 'GET']);

// Only the source's unchanged commit/response-idle timers are made deterministic.
// Preparation GET timers and every other delay use the actual timer API.
const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout, fakeTimers = new Set();
globalThis.setTimeout = (action, delay, ...args) => {
  if ((name === 'waiting-headers-deadline' && delay === 90000) || (name === 'reading-response-idle' && delay === 15000)) {
    const handle = {}; fakeTimers.add(handle);
    queueMicrotask(() => { if (fakeTimers.has(handle) && armed) action(...args); });
    return handle;
  }
  return realSetTimeout(action, delay, ...args);
};
globalThis.clearTimeout = handle => { if (!fakeTimers.delete(handle)) realClearTimeout(handle); };
let thrown, result;
try { result = await client.commit(prepared, outer.signal); }
catch (error) { thrown = error; }
finally { globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout; fakeTimers.clear(); }
unsubscribeHost();
assert.equal(listeners.size, 0, 'bounded commit subscriptions are removed');
assert.equal(calls.filter(call => call.method === 'POST').length, 1, 'one fake POST only');
if (genuineSessionCase) {
  assert.throws(() => client.pending(binding), /session expired/, 'actual owner still refuses the expired synthetic session');
  if (name === 'exchange-session-expired') {
    assert.equal(thrown.constructor, Error); assert.equal(thrown.message, 'Native evidence session changed', 'ordinary host error is not replaced');
  } else assert.equal(thrown, originalFailure, 'original body error is not replaced by the owner recheck error');
  // Restore only the synthetic fixture's original eligibility to inspect private
  // custody. This sends no GET/POST and changes no production expiry authority.
  session.expiresAt = sessionExpiry;
}
if (['context-changed', 'host-context-change-ordered'].includes(name)) {
  assert.equal(thrown, capturedReason);
  if (name === 'host-context-change-ordered') {
    assert.deepEqual(notificationOrder, ['host', 'bounded']); assert.equal(hostNotifications, 1);
    assert.equal(thrown, hostAbortReason); assert.equal(thrown, outer.signal.reason);
    assert.equal(thrown.name, 'AbortError', 'the mounted host abort remains the original reason, not a classifier error');
  }
  assert.equal(client.getBinding(), currentBinding);
  assert.deepEqual(client.pending(currentBinding), [], 'superseded attempt is not exposed in a different binding');
  // Restore the same synthetic binding to inspect retained private custody; no read or retry is dispatched.
  currentBinding = binding;
}
const [pending] = client.pending(binding);
assert(pending); assert.equal(pending.prepared, prepared);
const diagnostic = pending.uploadDiagnostic;
assert(diagnostic && Object.isFrozen(diagnostic));
assert.deepEqual(Object.keys(diagnostic).sort(), ['elapsedMs', 'failure', 'headersReceivedMs', 'httpStatus', 'phase', 'responseReadMs', 'state'].sort());
assert.equal(diagnostic.state, 'finished');
for (const key of ['elapsedMs', 'headersReceivedMs', 'responseReadMs'])
  assert(diagnostic[key] === null || (Number.isInteger(diagnostic[key]) && diagnostic[key] >= 0 && diagnostic[key] <= 2_147_483_647));
assert(!JSON.stringify(diagnostic).includes('SYNTHETIC_PRIVATE_ERROR'));
assert(!Object.hasOwn(pending, 'originalUploadFailure'), 'original exception is never exposed');
const expected = {
  'waiting-headers-transport': ['waiting-for-response-headers', 'transport-failed', null],
  'waiting-headers-deadline': ['waiting-for-response-headers', 'commit-deadline', null],
  'caller-canceled': ['waiting-for-response-headers', 'caller-canceled', null],
  'context-changed': ['waiting-for-response-headers', 'context-changed', null],
  'reading-response-transport': ['reading-response', 'response-read-failed', 502],
  'reading-response-idle': ['reading-response', 'response-idle', 408],
  'response-validation': ['validating-response', 'response-validation-failed', 408],
  'correlated-intake-rejection': ['validating-response', null, 408],
  'owner-session-expired': ['reading-response', 'context-changed', 200],
  'exchange-session-expired': ['waiting-for-response-headers', 'context-changed', null],
  'throwing-observer-transport': ['waiting-for-response-headers', 'transport-failed', null],
  'throwing-observer-intake-rejection': ['validating-response', null, 408],
  'throwing-observer-committed': ['validating-response', null, 200],
  'host-context-change-ordered': ['waiting-for-response-headers', 'context-changed', null],
}[name];
assert.deepEqual([diagnostic.phase, diagnostic.failure, diagnostic.httpStatus], expected);
if (name === 'throwing-observer-committed') {
  assert.equal(thrown, undefined); assert.equal(result.outcome, 'committed'); assert.equal(pending.outcome, 'committed');
  assert(pending.receipt); assert.equal(pending.evidenceId, uuid(908)); assert.equal(pending.assetId, uuid(909));
} else if (['correlated-intake-rejection', 'throwing-observer-intake-rejection'].includes(name)) {
  assert.equal(thrown, undefined); assert.equal(result.outcome, 'not-committed'); assert.equal(pending.outcome, 'not-committed');
  assert.deepEqual(pending.intakeError, { code: 'upload-timeout', httpStatus: 408 });
} else {
  assert(thrown instanceof Error); assert.equal(pending.outcome, 'unknown'); assert.equal(pending.receipt, undefined); assert.equal(pending.intakeError, undefined);
  if (['waiting-headers-transport', 'caller-canceled', 'reading-response-transport', 'owner-session-expired', 'throwing-observer-transport'].includes(name)) assert.equal(thrown, originalFailure, 'original thrown error identity is preserved');
  if (name === 'waiting-headers-deadline') assert.equal(thrown, capturedReason);
  await assert.rejects(client.prepare(fresh, input, new AbortController().signal), /unknown; do not resend/);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
}
if (name === 'waiting-headers-deadline') {
  let canceled = false;
  const before = observations.length;
  lateResponse(new Response(new ReadableStream({ cancel() { canceled = true; } }), { status: 200 }));
  await new Promise(resolve => realSetTimeout(resolve, 0));
  assert(canceled, 'a late response body is canceled after the terminal deadline');
  assert.equal(client.pending(binding)[0].uploadDiagnostic, diagnostic, 'late transport settlement cannot replace the terminal observation');
  assert.equal(client.pending(binding)[0].outcome, 'unknown'); assert.equal(observations.length, before);
}
assert(observations.length >= 2, 'phase and terminal observations are notified');
if (name.startsWith('throwing-observer-')) assert.equal(observerCalls, observations.length, 'a throwing observer does not stop later observers or the transport/outcome');

// Render the actual pending-attempt component. Two unrelated view dependencies
// are no-op fixtures: the unopened picker and evidence links are not under test.
const panelFile = new URL('../src/lantern/topology/NativePlaceEvidence.tsx', import.meta.url);
const stubs = new Map([
  [new URL('../src/capture-evidence/EvidencePicker.tsx', import.meta.url).pathname, 'export const EvidencePicker = () => null;'],
  [new URL('../src/lantern/components/LinkedEvidence.tsx', import.meta.url).pathname, 'export const LinkedEvidence = () => null;'],
]);
const outputs = await build({ configFile: false, root: new URL('..', import.meta.url).pathname, logLevel: 'error',
  plugins: [{ name: 'unrelated-view-fixtures', enforce: 'pre', load(id) { return stubs.get(id) ?? null; },
    // The receipt carries branded exact decimals from the actual client module.
    // Share its actual lossless serializer instead of bundling a second brand.
    resolveId(source) { if (source === '../../numeric/lossless-json' || source === sourcePath('numeric/lossless-json.ts').pathname)
      return { id: 'houseatlas-test-shared-lossless-json', external: true }; } }],
  build: { ssr: panelFile.pathname, write: false, sourcemap: false, minify: false,
    rollupOptions: { external: ['react', 'react/jsx-runtime'] } } });
let code = outputs.output.find(entry => entry.type === 'chunk').code;
code = code.replaceAll('from "houseatlas-test-shared-lossless-json"', `from ${JSON.stringify(await load('numeric/lossless-json.ts'))}`);
for (const module of ['react/jsx-runtime', 'react']) {
  const url = new URL(`../node_modules/${module === 'react' ? 'react/index.js' : 'react/jsx-runtime.js'}`, import.meta.url).href;
  code = code.replaceAll(`from "${module}"`, `from ${JSON.stringify(url)}`);
}
const { NativePlaceEvidence } = await import(dataUrl(code));
const markup = renderToStaticMarkup(createElement(NativePlaceEvidence, { client, binding,
  location: { id: identityId, label: 'Synthetic room', semantics: [{ lifecycle: 'active', target: { recordId: placeId }, payload: { reviewStatus: 'accepted' } }] },
  index: { data: { bindings: [], identities: [] } }, refresh() { throw new Error('No refresh is expected in static rendering'); } }));
assert(markup.includes(prepared.requestId)); assert(markup.includes('Upload observation'));
assert(markup.includes('HTTP status:')); assert(markup.includes('do not establish server commit, rollback or safe retry'));
assert(markup.includes('last observed')); assert(markup.includes('do not update continuously'));
if (pending.outcome === 'unknown') assert(markup.includes('Do not resend this request'));
for (const secret of ['SYNTHETIC_PRIVATE_ERROR', 'SYNTHETIC_PRIVATE_OBSERVER_ERROR', session.csrfToken, input.reason, 'Synthetic private bytes']) assert(!markup.includes(secret));
if (name !== 'throwing-observer-committed') for (const secret of ['synthetic-private.pdf', input.statement]) assert(!markup.includes(secret));
console.log(`PASS ${name}: actual client phase/status, original error preservation, bounded private view, one fake POST, retained outcome, actual static pending UI`);
