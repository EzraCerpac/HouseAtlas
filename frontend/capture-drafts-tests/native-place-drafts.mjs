// Local unsent drafts for a native Atlas place, one exact named case per run.
// Actual draft adapter/controller, native evidence client and React views,
// bundled with Vite. Synthetic files, an in-memory draft store and a fake
// native exchange only: no listener, browser, IndexedDB, network or provider.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';

const cases = new Set(['native-save-no-upload', 'native-reopen-unsent', 'native-review-confirm-one-upload',
  'native-form-no-draft-database', 'native-other-place-or-account-refused', 'native-lost-reply-drafts-reachable',
  'native-reported-mime-label-upload']);
const args = process.argv.slice(2);
assert(args.length === 2 && args[0] === '--case' && cases.has(args[1]), 'Select exactly one named case');
const caseName = args[1];
const realFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Network is prohibited in native draft cases'); };

const here = path => new URL(path, import.meta.url).pathname;
const entry = 'native-place-drafts-entry';
const stubs = new Map([
  [here('../src/capture-evidence/EvidencePicker.tsx'), 'export const EvidencePicker = () => null;'],
  [here('../src/lantern/components/LinkedEvidence.tsx'), 'export const LinkedEvidence = () => null;'],
]);
const externals = new Map([['react', 'react/index.js'], ['react/jsx-runtime', 'react/jsx-runtime.js'],
  ['ajv/dist/2020.js', 'ajv/dist/2020.js'], ['ajv-formats', 'ajv-formats/dist/index.js'], ['ajv-formats/dist/formats.js', 'ajv-formats/dist/formats.js']]);
const outputs = await build({ configFile: false, root: here('..'), logLevel: 'error',
  plugins: [{ name: 'native-draft-fixture', enforce: 'pre',
    resolveId(source) { return source === entry ? '\0' + entry : null; },
    load(id) {
      if (id === '\0' + entry) return [
        `export { createCaptureDraftAdapter } from ${JSON.stringify(here('../integration/capture-drafts-adapter.ts'))};`,
        `export { createNativeEvidenceClient } from ${JSON.stringify(here('../src/api/native-evidence-client.ts'))};`,
        `export { NativePlaceEvidence } from ${JSON.stringify(here('../src/lantern/topology/NativePlaceEvidence.tsx'))};`,
        `export { CaptureDraftProvider } from ${JSON.stringify(here('../src/capture-drafts-ui/Context.tsx'))};`,
        `export { CaptureDraftPanel } from ${JSON.stringify(here('../src/capture-drafts-ui/Panel.tsx'))};`,
        `export { selectEvidenceFile } from ${JSON.stringify(here('../src/capture-evidence/selection.ts'))};`].join('\n');
      return stubs.get(id) ?? null;
    } }],
  build: { ssr: true, write: false, sourcemap: false, minify: false,
    rollupOptions: { input: entry, external: [...externals.keys()] } } });
let code = outputs.output.find(row => row.type === 'chunk').code;
for (const [specifier, relative] of externals)
  code = code.replaceAll(`from "${specifier}"`, `from ${JSON.stringify(new URL(`../node_modules/${relative}`, import.meta.url).href)}`);
const { createCaptureDraftAdapter, createNativeEvidenceClient, NativePlaceEvidence, CaptureDraftProvider, CaptureDraftPanel, selectEvidenceFile } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { workspaceId: uuid(900), homeId: uuid(901) }, placeId = uuid(902), identityId = uuid(903), priorEvidence = uuid(904);
const otherPlaceId = uuid(920), localId = uuid(921), timestamp = '2026-10-11T10:00:00Z';
const location = { schemaVersion: 1, recordType: 'location-semantics', recordId: placeId, ...scope, revision: 1,
  lifecycle: 'active', createdAt: timestamp, updatedAt: timestamp, lastAuditId: uuid(905),
  payload: { atlasId: identityId, semanticKind: 'room', reviewStatus: 'accepted', evidenceIds: [priorEvidence] } };
const identity = { schemaVersion: 1, recordType: 'identity', recordId: identityId, ...scope, revision: 1,
  lifecycle: 'active', createdAt: timestamp, updatedAt: timestamp, lastAuditId: uuid(906),
  payload: { kind: 'location', evidenceIds: [priorEvidence] } };
const license = { status: 'unknown', reference: null };
const policy = { contentTypes: ['image/png', 'image/jpeg', 'application/pdf', 'text/plain'], maximumBytes: 10 * 1024 * 1024,
  licenses: [{ label: 'Synthetic unknown licence', value: license }] };
const admission = { schemaVersion: 1, admissionKind: 'native-location', scope, record: location, identity,
  guards: [{ record: { recordType: 'evidence', recordId: priorEvidence }, expectedRevision: 1 },
    { record: { recordType: 'identity', recordId: identityId }, expectedRevision: 1 }],
  canAttachEvidence: true, maximumReasonCodePoints: 1024, attachmentPolicy: policy };
const original = new File(['%PDF-1.7\nSynthetic native draft bytes\n'], 'synthetic-native.pdf', { type: 'application/pdf', lastModified: 42 });
const capture = { schemaVersion: 1, selectionMethod: 'file-picker', selectedAt: timestamp, filename: original.name,
  reportedContentType: original.type, byteOrigin: 'browser-returned-unmodified' };
const selection = { original, file: original, capture };
const form = { statement: 'Synthetic native statement', sourceLicense: license, reason: 'Synthetic native draft fixture' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function fixture(shared = { rows: [] }, input = selection) {
  let session = { schemaVersion: 1, actorId: 'synthetic-actor', csrfToken: 'synthetic-private-marker', expiresAt: new Date(Date.now() + 600_000).toISOString() };
  let canonical = { ...session }, readScope = scope;
  const calls = { open: 0, get: 0, post: 0, editing: 0 }, order = [];
  const binding = Object.freeze({ scope: Object.freeze({ ...scope }) }), owner = {};
  const evidence = createNativeEvidenceClient({ getBinding: () => binding, owner: () => owner, subscribe: () => () => undefined,
    exchange: async (actual, route, method, signal, body, requestId) => {
      assert.equal(actual, binding); signal.throwIfAborted();
      const base = `/api/atlas/editing/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/native-places/${placeId}`;
      if (method === 'GET') { calls.get++; order.push('get'); return route === base ? json(admission) : json({}, 404); }
      calls.post++; order.push('post');
      assert.equal(method, 'POST'); assert.equal(route, `${base}/evidence`);
      assert.equal(shared.rows[0].state, 'outcome-unknown', 'Durable unknown marker precedes the native POST');
      assert.equal(shared.rows[0].attempt.requestId, requestId);
      if (shared.lostReply) throw new Error('Synthetic lost reply; no actual transport');
      const metadata = JSON.parse(body.get('metadata')), file = body.get('file');
      assert.equal(file.name, input.original.name); assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array(await input.original.arrayBuffer()));
      assert.equal(metadata.statement, form.statement); assert.equal(metadata.reason, form.reason); assert.deepEqual(metadata.capture, input.capture);
      shared.posted = { type: file.type, contentType: metadata.contentType, sha256: createHash('sha256').update(new Uint8Array(await file.arrayBuffer())).digest('hex') };
      const evidenceId = uuid(908), assetId = uuid(909);
      return json({ schemaVersion: 3, commandId: 'atlas.batch.execute', requestId, resolvedScope: scope, status: 'committed',
        replayed: false, operationId: uuid(910), data: { auditIds: [uuid(911), uuid(912)], requestDigest: 'a'.repeat(64), records: [
          { target: { authority: 'atlas', recordType: 'evidence', recordId: evidenceId }, revision: 1, lifecycle: 'active', payload: {
            statement: metadata.statement, provenance: { source: null, sourceRevision: null, sourceConfidence: null, evidenceBasis: 'unknown',
              factAt: null, retrievedAt: timestamp, vantage: `Browser selection claim v1: ${JSON.stringify(metadata.capture)}`,
              uncertainty: { status: 'unknown', explanation: null } }, supersedesEvidenceIds: [], references: [{ kind: 'atlas-asset', assetId }] } },
          { target: { authority: 'atlas', recordType: 'identity', recordId: identityId }, revision: 2, lifecycle: 'active',
            payload: { kind: 'location', evidenceIds: [priorEvidence, evidenceId] } },
        ] } });
    } });
  const store = {
    read: async () => structuredClone(shared.rows),
    async change(edit) {
      const next = edit(structuredClone(shared.rows));
      if (next.rows[0]?.state === 'outcome-unknown' && shared.rows[0]?.state !== 'outcome-unknown') order.push('unknown-marker');
      if (shared.rows.length > next.rows.length) order.push('delete');
      shared.rows = structuredClone(next.rows); return next.value;
    }, close() {},
  };
  const refuse = async () => { calls.editing++; throw new Error('No source editing call belongs to a native draft'); };
  const adapter = createCaptureDraftAdapter({
    getSession: () => session, getGeneration: () => 1, getReadScope: () => readScope,
    readSession: async signal => { signal.throwIfAborted(); return { ...canonical }; },
    foreground: () => true, recheckSession: () => undefined,
    schemas: { validate() { throw new Error('Stock schema validation belongs to source drafts only'); } },
    openStore: () => { calls.open++; return store; },
    editing: { replacePlace: refuse, loadPlace: refuse, uploadPlaceEvidence: refuse },
    placeEvidence: () => evidence,
  });
  adapter.observeCanonical(session); adapter.setScope(scope);
  const signal = new AbortController().signal;
  return { adapter, port: adapter.port, evidence, binding, calls, order, signal, shared,
    save: (recordId = placeId) => adapter.port.save({ localId, selection: input, form, targetSourceRef: null, recordId, optedIn: true }),
    changeAccount() {
      adapter.invalidateSession(); session = { ...session, actorId: 'synthetic-other-actor' }; canonical = { ...session };
      adapter.observeCanonical(session); adapter.setScope(scope);
    },
    changeHome() { readScope = { ...scope, homeId: uuid(930) }; adapter.setScope(readScope); },
  };
}
const opener = markup => /<button[^>]*>Add native evidence<\/button>/.exec(markup)?.[0];
const nativeView = (f, port = f.port) => renderToStaticMarkup(createElement(CaptureDraftProvider, { port },
  createElement(NativePlaceEvidence, { client: f.evidence, binding: f.binding,
    location: { id: identityId, label: 'Synthetic room', semantics: [{ lifecycle: 'active', target: { recordId: placeId }, payload: { reviewStatus: 'accepted' } }] },
    index: { data: { bindings: [], identities: [] } }, refresh() { throw new Error('No refresh in static rendering'); } })));

try {
  const f = fixture();
  if (caseName === 'native-save-no-upload') {
    assert.equal(f.calls.open, 0, 'No draft storage before an explicit save');
    assert.equal(await f.save(), localId);
    assert.equal(f.calls.open, 1); assert.equal(f.shared.rows.length, 1);
    const [row] = f.shared.rows;
    assert.equal(row.state, 'unsent'); assert.equal(row.attempt, null); assert.equal(row.targetSourceRef, null); assert.equal(row.recordId, placeId);
    assert.deepEqual(row.owner, { actorId: 'synthetic-actor', ...scope });
    assert.deepEqual(new Uint8Array(await row.original.arrayBuffer()), new Uint8Array(await original.arrayBuffer()));
    assert.equal(f.calls.post, 0); assert.equal(f.calls.get, 0); assert.equal(f.calls.editing, 0);
  } else if (caseName === 'native-reopen-unsent') {
    await f.save();
    // A new adapter over the same retained rows models a reopened app.
    const reopened = fixture(f.shared);
    assert.equal(reopened.calls.open, 0);
    await reopened.port.prepare(reopened.signal);
    const [summary, ...rest] = await reopened.port.list();
    assert.equal(rest.length, 0); assert.equal(summary.state, 'unsent'); assert.equal(summary.expired, false);
    assert.equal(summary.targetSourceRef, null); assert.equal(summary.recordId, placeId);
    assert.equal(summary.filename, original.name); assert.equal(summary.byteSize, original.size);
    assert.equal(reopened.calls.post + f.calls.post, 0); assert.equal(reopened.calls.get, 0, 'Listing reads no native admission');
  } else if (caseName === 'native-review-confirm-one-upload') {
    await f.save();
    const review = await f.port.review(localId, f.signal);
    assert.equal(review.targetSourceRef, null); assert.equal(review.recordId, placeId); assert.deepEqual(review.form, form);
    assert.equal(f.calls.post, 0, 'Review does not upload'); assert.equal(f.calls.get, 1);
    const done = await f.port.submit(review, null, placeId, f.signal);
    assert.equal(done.committed, true); assert.equal(done.localCleanup, 'removed'); assert.equal(f.calls.post, 1);
    assert.deepEqual(f.shared.rows, []);
    assert(f.order.indexOf('unknown-marker') < f.order.indexOf('post')); assert(f.order.indexOf('post') < f.order.indexOf('delete'));
    const [attempt] = f.evidence.pending(f.binding);
    assert.equal(attempt.prepared, done.result.prepared); assert.equal(attempt.outcome, 'committed');
    assert.deepEqual(attempt.original, { name: original.name, type: original.type, byteSize: original.size });
    await assert.rejects(f.port.submit(review, null, placeId, f.signal)); assert.equal(f.calls.post, 1, 'A consumed review cannot upload again');
    const markup = nativeView(f);
    assert(markup.includes('Native evidence saved'));
    assert(markup.includes(`Original file: ${original.name} · ${original.type} · ${original.size} bytes`), 'Saved native evidence shows name, type and size');
    assert.equal(f.calls.editing, 0);
  } else if (caseName === 'native-form-no-draft-database') {
    // Static render of the native evidence row and of the draft panel as the open form mounts it.
    const markup = nativeView(f);
    assert(markup.includes('Add native evidence'));
    const panel = renderToStaticMarkup(createElement(CaptureDraftPanel, { port: f.port, source: null, recordId: placeId,
      candidate: () => null, canSave: false, parentBusy: false, onBusy() {}, onSaved() {}, async onSubmitted() {} }));
    for (const name of ['Save this file and reviewed values locally without uploading', 'Save local draft', 'View local drafts'])
      assert(panel.includes(name), name);
    await f.port.prepare(f.signal); assert(f.port.current());
    assert.equal(f.calls.open, 0, 'Rendering and session checks open no draft database');
    assert.equal(f.calls.get + f.calls.post, 0);
  } else if (caseName === 'native-other-place-or-account-refused') {
    await f.save();
    const review = await f.port.review(localId, f.signal);
    await assert.rejects(f.port.submit(review, null, otherPlaceId, f.signal), /another Atlas place/);
    const source = { ...scope, key: { sourceInstanceId: uuid(940), collectionId: 'synthetic-collection', sourceKind: 'homebox-entity', externalId: 'synthetic-room' } };
    await assert.rejects(f.port.submit(review, source, placeId, f.signal), /another Atlas place/);
    assert.equal(f.shared.rows[0].state, 'unsent');
    // A draft saved for another native place is refused by that place's fresh admission.
    const other = fixture(); await other.save(otherPlaceId);
    await assert.rejects(other.port.review(localId, other.signal)); assert.equal(other.calls.get, 1);
    assert.equal(other.shared.rows[0].state, 'unsent');
    const home = fixture(); await home.save(); home.changeHome();
    await assert.rejects(home.port.review(localId, home.signal));
    f.changeAccount(); await f.port.prepare(f.signal);
    assert.deepEqual(await f.port.list(), [], 'Another account sees no draft');
    await assert.rejects(f.port.review(localId, f.signal), /unavailable for this account/);
    assert.equal(f.shared.rows.length, 1); assert.equal(f.shared.rows[0].state, 'unsent');
    assert.equal(f.calls.post + other.calls.post + home.calls.post, 0); assert.equal(f.calls.editing, 0);
  } else if (caseName === 'native-lost-reply-drafts-reachable') {
    await f.save();
    f.shared.lostReply = true;
    await assert.rejects(f.port.submit(await f.port.review(localId, f.signal), null, placeId, f.signal));
    assert.equal(f.calls.post, 1); assert.equal(f.shared.rows[0].state, 'outcome-unknown');
    assert.equal(f.evidence.pending(f.binding)[0].outcome, 'unknown');
    // Closed state after the lost reply (static markup: no click). The opener stays
    // enabled so the form, with upload blocked, can mount the draft panel again.
    const closed = nativeView(f);
    assert(opener(closed) && !opener(closed).includes('disabled'), 'Draft management stays reachable');
    assert(closed.includes('Native evidence completion unknown'));
    // Without a draft port the unknown attempt still blocks the opener as before.
    const plain = renderToStaticMarkup(createElement(NativePlaceEvidence, { client: f.evidence, binding: f.binding,
      location: { id: identityId, label: 'Synthetic room', semantics: [{ lifecycle: 'active', target: { recordId: placeId }, payload: { reviewStatus: 'accepted' } }] },
      index: { data: { bindings: [], identities: [] } }, refresh() {} }));
    assert(opener(plain).includes('disabled'));
    // The draft panel as the reopened form mounts it: upload blocked, management kept.
    const panel = renderToStaticMarkup(createElement(CaptureDraftPanel, { port: f.port, source: null, recordId: placeId,
      candidate: () => null, canSave: false, canUpload: false, parentBusy: false, onBusy() {}, onSaved() {}, async onSubmitted() {} }));
    assert(/<button type="button">View local drafts<\/button>/.test(panel));
    // Controller paths behind those controls: the retained file is listed, inspected and removable.
    await f.port.prepare(f.signal);
    const [summary] = await f.port.list();
    assert.equal(summary.state, 'outcome-unknown'); assert.equal(summary.byteSize, original.size);
    const inspection = await f.port.inspectUnknown(localId, f.signal);
    assert.equal(inspection.retrySafety, 'not-established'); assert.equal(inspection.savedRevision, '1');
    assert.deepEqual(inspection.attempt, f.shared.rows[0].attempt);
    await assert.rejects(f.port.review(localId, f.signal), /outcome is unknown/);
    await assert.rejects(f.port.discard(localId, { loseUnknownOutcome: false }));
    await f.port.discard(localId, { loseUnknownOutcome: true });
    assert.deepEqual(f.shared.rows, []);
    assert.equal(f.calls.post, 1, 'Inspection and removal send nothing');
  } else if (caseName === 'native-reported-mime-label-upload') {
    // Browser labels the direct native upload accepts: none, and a JPEG alias.
    const pdf = new File(['%PDF-1.7\nSynthetic unlabelled draft bytes\n'], 'synthetic-unlabelled.pdf', { type: '', lastModified: 43 });
    const jpeg = new File([readFileSync(new URL('../capture-evidence-tests/fixtures/synthetic-photo.jpg', import.meta.url))],
      'synthetic-alias.jpg', { type: 'image/jpg', lastModified: 44 });
    for (const [picked, reported, canonical] of [[pdf, '', 'application/pdf'], [jpeg, 'image/jpg', 'image/jpeg']]) {
      const chosen = await selectEvidenceFile(picked, 'file-picker', policy, new AbortController().signal, timestamp);
      assert.equal(chosen.original.type, reported); assert.equal(chosen.file.type, canonical); assert.equal(chosen.capture.reportedContentType, reported);
      const q = fixture({ rows: [] }, chosen), sha256 = createHash('sha256').update(new Uint8Array(await picked.arrayBuffer())).digest('hex');
      await q.save();
      assert.equal(q.shared.rows[0].contentType, canonical); assert.equal(q.shared.rows[0].sha256, sha256);
      const done = await q.port.submit(await q.port.review(localId, q.signal), null, placeId, q.signal);
      assert.equal(done.committed, true, reported || 'empty label'); assert.equal(done.localCleanup, 'removed');
      assert.equal(q.calls.post, 1); assert.deepEqual(q.shared.rows, []);
      assert.deepEqual(q.shared.posted, { type: canonical, contentType: canonical, sha256 });
    }
  }
  console.log(`PASS ${caseName}: synthetic native draft evidence only`);
} finally { globalThis.fetch = realFetch; }
