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
  'native-reported-mime-label-upload', 'native-offline-save-held-identity', 'native-save-no-identity-refused',
  'native-session-answer-classification', 'native-restart-unfocused-held-identity', 'native-invalid-upload-replies']);
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
        `export { selectEvidenceFile } from ${JSON.stringify(here('../src/capture-evidence/selection.ts'))};`,
        `export { createAtlasSessionClient } from ${JSON.stringify(here('../src/api/client.ts'))};`].join('\n');
      return stubs.get(id) ?? null;
    } }],
  build: { ssr: true, write: false, sourcemap: false, minify: false,
    rollupOptions: { input: entry, external: [...externals.keys()] } } });
let code = outputs.output.find(row => row.type === 'chunk').code;
for (const [specifier, relative] of externals)
  code = code.replaceAll(`from "${specifier}"`, `from ${JSON.stringify(new URL(`../node_modules/${relative}`, import.meta.url).href)}`);
const { createCaptureDraftAdapter, createNativeEvidenceClient, NativePlaceEvidence, CaptureDraftProvider, CaptureDraftPanel, selectEvidenceFile, createAtlasSessionClient } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
// The same Panel source with slot-backed hooks: handlers are called directly, without a DOM.
const hookKey = Symbol.for('native-draft-panel-hooks'), hooks = globalThis[hookKey] = { slot: 0, state: [] };
const hookModule = `const h = globalThis[Symbol.for('native-draft-panel-hooks')];
export function useState(init) { const i = h.slot++; if (!(i in h.state)) h.state[i] = init; return [h.state[i], v => { h.state[i] = typeof v === 'function' ? v(h.state[i]) : v; }]; }
export function useRef(current) { const i = h.slot++; if (!(i in h.state)) h.state[i] = { current }; return h.state[i]; }
export function useEffect(effect) { if (h.effects && !h.mounted) h.effects.push(effect); }`;
const panelOutput = await build({ configFile: false, root: here('..'), logLevel: 'error',
  build: { ssr: true, write: false, sourcemap: false, minify: false,
    rollupOptions: { input: here('../src/capture-drafts-ui/Panel.tsx'), external: ['react', 'react/jsx-runtime'] } } });
const panelCode = panelOutput.output.find(row => row.type === 'chunk').code
  .replaceAll('from "react/jsx-runtime"', `from ${JSON.stringify(new URL('../node_modules/react/jsx-runtime.js', import.meta.url).href)}`)
  .replaceAll('from "react"', `from "data:text/javascript;base64,${Buffer.from(hookModule).toString('base64')}"`);
const { CaptureDraftPanel: HookedPanel } = await import(`data:text/javascript;base64,${Buffer.from(panelCode).toString('base64')}`);
globalThis.requestAnimationFrame ??= () => 0;
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '';
/** One Panel instance: opt in, activate a named button, then read its visible status and listed rows. */
function mountPanel(port, candidate = () => null, { effects = false, onSubmitted = async () => {} } = {}) {
  hooks.state = []; hooks.effects = effects ? [] : null; hooks.mounted = false;
  const render = () => { hooks.slot = 0; return nodes(HookedPanel({ port, source: null, recordId: placeId, candidate, canSave: true,
    parentBusy: false, onBusy() {}, onSaved() {}, onSubmitted })); };
  // Optionally run the mount effects once, e.g. the invalidation subscription that clears the panel.
  render(); for (const effect of hooks.effects ?? []) effect(); hooks.mounted = true;
  return {
    /** Activate a button without waiting for the action to settle. */
    press(label) { const button = render().find(node => node.type === 'button' && text(node) === label); assert(button && !button.props.disabled, label); button.props.onClick(); },
    status: () => text(render().find(node => node.props?.role === 'status')),
    busy: () => render()[0].props['aria-busy'],
    optIn() { render().find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); },
    /** Tick the checkbox whose label contains this text. */
    check(label) { const box = render().find(node => node.type === 'label' && text(node).includes(label)); nodes(box.props.children).find(node => node.type === 'input').props.onChange({ target: { checked: true } }); },
    async click(label) {
      const button = render().find(node => node.type === 'button' && text(node) === label);
      assert(button && !button.props.disabled, label); button.props.onClick();
      for (let i = 0; i < 200 && render()[0].props['aria-busy']; i++) await new Promise(resolve => setTimeout(resolve, 1));
      return text(render().find(node => node.props?.role === 'status'));
    },
    rows: () => render().filter(node => node.type === 'li').map(text),
  };
}

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
const offline = () => { throw new TypeError('Synthetic offline session read; no actual transport'); };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function fixture(shared = { rows: [] }, input = selection) {
  let session = { schemaVersion: 1, actorId: 'synthetic-actor', csrfToken: 'synthetic-private-marker', expiresAt: new Date(Date.now() + 600_000).toISOString() };
  let canonical = { ...session }, readScope = scope;
  const calls = { open: 0, get: 0, post: 0, editing: 0, read: 0, recheck: 0 }, order = [];
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
      if (shared.uploadAnswer) return shared.uploadAnswer(requestId);
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
    // The actual session client over a fake transport: `shared.answer` replaces the canonical reply.
    readSession: createAtlasSessionClient({ session: '/api/atlas/auth/session', login: '/api/atlas/auth/login' }, async (_url, init) => {
      calls.read++; init.signal.throwIfAborted();
      return shared.answer ? shared.answer() : json({ ...canonical });
    }).session,
    foreground: () => shared.focused !== false, recheckSession: () => { calls.recheck++; },
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
const nativeView = (f, port = f.port, identities = []) => renderToStaticMarkup(createElement(CaptureDraftProvider, { port },
  createElement(NativePlaceEvidence, { client: f.evidence, binding: f.binding,
    location: { id: identityId, label: 'Synthetic room', semantics: [{ lifecycle: 'active', target: { recordId: placeId }, payload: { reviewStatus: 'accepted' } }] },
    index: { data: { bindings: [], identities } }, refresh() { throw new Error('No refresh in static rendering'); } })));

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
    // Browser-wide limits refuse a further save by name; nothing partial is stored.
    const filler = (n, bytes) => ({ ...row, id: uuid(n), original: new Blob([new Uint8Array(bytes)], { type: row.contentType }) });
    const candidate = (file, id = uuid(940)) => () => ({ localId: id, selection: { original: file, file, capture: { ...capture, filename: file.name, reportedContentType: file.type } },
      form, targetSourceRef: null, recordId: placeId, optedIn: true });
    f.shared.rows = [row, filler(941, 16), filler(942, 16), filler(943, 16)];
    let panel = mountPanel(f.port, candidate(original)); panel.optIn();
    assert.equal(await panel.click('Save local draft'), 'Local draft not saved: this browser already holds the maximum of 4 local drafts, including any for other places or accounts.');
    assert.equal(f.shared.rows.length, 4);
    const mib = 1024 * 1024, large = new File([new Uint8Array(3 * mib).fill(65)], 'synthetic-large.txt', { type: 'text/plain', lastModified: 42 });
    f.shared.rows = [filler(941, 10 * mib), filler(942, 10 * mib), filler(943, 10 * mib)];
    panel = mountPanel(f.port, candidate(large)); panel.optIn();
    assert.equal(await panel.click('Save local draft'), 'Local draft not saved: it would exceed the 32 MiB total for local drafts in this browser, including any for other places or accounts.');
    assert.deepEqual(f.shared.rows.map(stored => stored.id), [uuid(941), uuid(942), uuid(943)]);
    assert.equal(f.calls.post + f.calls.get + f.calls.editing, 0);
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
    // The retained identity evidence row names the sent original's size from the validated receipt; prior evidence stays unsized.
    const retained = nativeView(f, f.port, [{ lifecycle: 'active', target: { recordId: identityId }, payload: { kind: 'location', evidenceIds: [priorEvidence, uuid(908)] } }]);
    assert(retained.includes(`Evidence ID: ${uuid(908)} · Original file: ${original.name} · ${original.size} bytes`), 'Retained evidence row shows the original size');
    assert(retained.includes(`Evidence ID: ${priorEvidence}</span>`), 'Evidence without a receipt shows no guessed size');
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
    // Through the panel: right after the lost reply the row reads Outcome unknown, without a reload.
    const g = fixture();
    const shown = mountPanel(g.port, () => ({ localId, selection, form, targetSourceRef: null, recordId: placeId, optedIn: true }));
    shown.optIn(); await shown.click('Save local draft');
    await shown.click(`Review ${original.name}`);
    g.shared.lostReply = true; shown.check('Upload this saved file');
    assert.equal(await shown.click('Confirm upload'), 'Upload outcome unknown: the server may have saved this file. It will not be sent again automatically. Read its saved information before any further action.');
    assert.deepEqual(shown.rows().map(listed => listed.split('Saved ')[0]), [`${original.name} · ${original.size} bytes · Outcome unknown`]);
    assert.equal(g.calls.post, 1); assert.equal(g.shared.rows[0].state, 'outcome-unknown');
    // Adversarial: the re-list completes only after an invalidation (sign-out, scope or place
    // change, closing the panel). Its rows and the outcome status must not reappear.
    const h = fixture();
    let gate = null;
    const late = { ...h.port, list: () => gate ? gate.promise : h.port.list(), submit: async () => { throw new Error('Synthetic lost reply'); } };
    const fenced = mountPanel(late, () => ({ localId, selection, form, targetSourceRef: null, recordId: placeId, optedIn: true }), { effects: true });
    fenced.optIn(); await fenced.click('Save local draft'); await fenced.click(`Review ${original.name}`);
    fenced.check('Upload this saved file');
    gate = Promise.withResolvers(); fenced.press('Confirm upload');
    for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 1));
    h.port.invalidate();
    gate.resolve([{ ...(await h.port.list())[0], state: 'outcome-unknown' }]);
    for (let i = 0; i < 200 && fenced.busy(); i++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(fenced.busy(), false); assert.deepEqual(fenced.rows(), []); assert.equal(fenced.status(), '');
    // The same after a non-committed receipt, when the late re-list rejects as a stale read:
    // no status and no completion callback for the invalidated attempt.
    const k = fixture();
    let completions = 0;
    const stale = { ...k.port, list: () => gate ? gate.promise : k.port.list(),
      submit: async () => ({ committed: false, result: {}, localCleanup: 'unconfirmed' }) };
    gate = null;
    const quiet = mountPanel(stale, () => ({ localId, selection, form, targetSourceRef: null, recordId: placeId, optedIn: true }),
      { effects: true, async onSubmitted() { completions++; } });
    quiet.optIn(); await quiet.click('Save local draft'); await quiet.click(`Review ${original.name}`);
    quiet.check('Upload this saved file');
    gate = Promise.withResolvers(); quiet.press('Confirm upload');
    for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 1));
    k.port.invalidate();
    gate.reject(new Error('Synthetic stale read after invalidation'));
    for (let i = 0; i < 200 && quiet.busy(); i++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(quiet.busy(), false); assert.deepEqual(quiet.rows(), []); assert.equal(quiet.status(), ''); assert.equal(completions, 0);
    // An invalidation landing after the re-list settles but before the action resumes
    // (another handler on the same promise) is honoured too, on both paths.
    for (const nonCommitted of [false, true]) {
      const m = fixture();
      let called = 0, held = null;
      const between = { ...m.port, list: () => held ? held.promise : m.port.list(), submit: nonCommitted
        ? async () => ({ committed: false, result: {}, localCleanup: 'unconfirmed' }) : async () => { throw new Error('Synthetic lost reply'); } };
      const shown = mountPanel(between, () => ({ localId, selection, form, targetSourceRef: null, recordId: placeId, optedIn: true }),
        { effects: true, async onSubmitted() { called++; } });
      shown.optIn(); await shown.click('Save local draft'); await shown.click(`Review ${original.name}`);
      shown.check('Upload this saved file');
      held = Promise.withResolvers(); shown.press('Confirm upload');
      for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 1));
      held.promise.then(() => m.port.invalidate());
      held.resolve([{ ...(await m.port.list())[0], state: 'outcome-unknown' }]);
      for (let i = 0; i < 200 && shown.busy(); i++) await new Promise(resolve => setTimeout(resolve, 1));
      assert.equal(shown.busy(), false); assert.deepEqual(shown.rows(), []); assert.equal(shown.status(), ''); assert.equal(called, 0);
    }
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
  } else if (caseName === 'native-invalid-upload-replies') {
    for (const [label, uploadAnswer, nativeOutcome, rejection] of [
      ['missing', () => new Response(null, { status: 204 }), 'unknown', /Native evidence body missing/],
      ['malformed', () => new Response('{"status":'), 'unknown', /Invalid JSON/],
      ['known intake refusal', requestId => json({ schemaVersion: 1, kind: 'native-evidence-outcome', requestId, scope,
        recordId: placeId, outcome: 'not-committed', phase: 'intake', error: { code: 'invalid-upload', httpStatus: 422 } }, 422), 'not-committed'],
    ]) {
      const shared = { rows: [], uploadAnswer };
      const original = fixture(shared);
      await original.save();
      const review = await original.port.review(localId, original.signal);
      const submission = original.port.submit(review, null, placeId, original.signal);
      if (nativeOutcome === 'not-committed') {
        const completion = await submission;
        assert.equal(completion.committed, false, label);
        assert.equal(completion.localCleanup, 'unconfirmed', label);
      } else {
        await assert.rejects(submission, rejection, label);
      }
      const [pending] = original.evidence.pending(original.binding);
      assert.equal(pending.outcome, nativeOutcome, label);
      const [retained] = shared.rows;
      assert.equal(retained.state, 'outcome-unknown', label);
      assert.equal(retained.attempt.requestId, pending.prepared.requestId, label);
      assert.equal(retained.attempt.idempotencyKey, null, label);
      assert.equal(retained.sha256, shared.posted.sha256, label);
      assert.equal(await retained.original.text(), await selection.original.text(), label);
      assert.deepEqual(retained.capture, selection.capture, label);
      assert(!original.order.includes('delete'), label);
      await assert.rejects(original.port.submit(review, null, placeId, original.signal), /Review and confirm/);
      const reopened = fixture(shared);
      const inspected = await reopened.port.inspectUnknown(localId, reopened.signal);
      assert.equal(inspected.retrySafety, 'not-established', label);
      assert.deepEqual(inspected.attempt, retained.attempt, label);
      assert.equal(original.calls.post, 1, label);
      assert.equal(reopened.calls.post, 0, label);
    }
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
  } else if (caseName === 'native-offline-save-held-identity') {
    // Offline after an earlier online sign-in: a foreground session probe fails, then the save reads nothing.
    f.shared.answer = offline;
    await assert.rejects(f.port.prepare(f.signal), /Synthetic offline/); assert.equal(f.calls.read, 1);
    assert(f.port.current(), 'The held session still binds local saves'); assert.equal(f.calls.recheck, 0);
    const panel = mountPanel(f.port, () => ({ localId, selection, form, targetSourceRef: null, recordId: placeId, optedIn: true }));
    panel.optIn();
    assert.equal(await panel.click('Save local draft'), 'Unsent draft saved on this browser. Nothing was uploaded.');
    assert.equal(f.calls.read, 1, 'Saving a local draft reads no session');
    const [row, ...rest] = f.shared.rows;
    assert.equal(rest.length, 0); assert.equal(row.state, 'unsent'); assert.equal(row.recordId, placeId);
    assert.deepEqual(row.owner, { actorId: 'synthetic-actor', ...scope });
    // Review still needs a fresh session read, which is unavailable offline.
    await assert.rejects(f.port.review(localId, f.signal)); assert.equal(f.calls.read, 2);
    // Listing and removal stay local: offline they read and change only this browser's rows.
    assert.equal(await panel.click('View local drafts'), 'Local drafts loaded for this place and account.');
    assert.deepEqual(panel.rows().map(row => row.split('Saved ')[0]), [`${original.name} · ${original.size} bytes · Unsent draft`]);
    assert.equal(await panel.click(`Remove local ${original.name}`), 'Local file removed. This does not cancel any server operation.');
    assert.deepEqual(f.shared.rows, []); assert.deepEqual(panel.rows(), []);
    assert.equal(f.calls.read, 2, 'Listing and removal read no session');
    assert.equal(f.calls.get + f.calls.post + f.calls.editing, 0);
  } else if (caseName === 'native-save-no-identity-refused') {
    f.adapter.invalidateSession(); f.shared.answer = offline;
    assert.equal(f.port.current(), null);
    let asked = 0;
    const panel = mountPanel(f.port, () => { asked++; return { localId, selection, form, targetSourceRef: null, recordId: placeId, optedIn: true }; });
    panel.optIn();
    assert.equal(await panel.click('Save local draft'), 'Local draft not saved: this browser holds no signed-in session for this home.');
    assert.equal(await panel.click('View local drafts'), 'Local drafts unavailable: this browser holds no signed-in session for this home.');
    assert.equal(asked, 0); assert.deepEqual(f.shared.rows, []); assert.equal(f.calls.open, 0, 'No draft storage opens without an identity');
    assert.equal(f.calls.read + f.calls.get + f.calls.post + f.calls.editing, 0);
  } else if (caseName === 'native-restart-unfocused-held-identity') {
    // A relaunched browser: the page load's 200 session read holds the identity, but the
    // page is visible without focus (activation that never focused the window).
    await f.save();
    f.shared.focused = false;
    const reopened = fixture(f.shared);
    assert.equal(reopened.port.current(), null);
    const panel = mountPanel(reopened.port, () => ({ localId, selection, form, targetSourceRef: null, recordId: placeId, optedIn: true }));
    assert.equal(await panel.click('View local drafts'), 'Local drafts unavailable: this page is not in the foreground. Select the page and try again.');
    panel.optIn();
    assert.equal(await panel.click('Save local draft'), 'Local draft not saved: this page is not in the foreground. Select the page and try again.');
    assert.equal(reopened.calls.open, 0); assert.deepEqual(panel.rows(), []);
    // Focus alone restores it: the held identity is the load's, with no sign-in or further session read.
    f.shared.focused = true;
    assert.equal(await panel.click('View local drafts'), 'Local drafts loaded for this place and account.');
    assert.deepEqual(panel.rows().map(row => row.split('Saved ')[0]), [`${original.name} · ${original.size} bytes · Unsent draft`]);
    assert.equal(reopened.calls.read + reopened.calls.recheck + reopened.calls.get + reopened.calls.post + reopened.calls.editing, 0);
  } else if (caseName === 'native-session-answer-classification') {
    // Each session answer through the actual session client and adapter, from a fresh held identity.
    const outcomes = {};
    for (const [name, answer] of [['401', () => json({}, 401)], ['403', () => json({}, 403)], ['404', () => json({}, 404)],
      ['transport', offline], ['500', () => json({}, 500)], ['undecodable', () => new Response('not json', { status: 200 })],
      ['invalid-session', () => json({ schemaVersion: 2 })]]) {
      const q = fixture(); const before = q.port.current().sessionEpoch;
      q.shared.answer = answer;
      await assert.rejects(q.port.prepare(q.signal));
      const held = q.port.current();
      outcomes[name] = { held: !!held, freshEpoch: held ? held.sessionEpoch !== before : null, reload: q.calls.recheck };
      if (held) { await q.save(); assert.deepEqual(q.shared.rows[0].owner, { actorId: 'synthetic-actor', ...scope }); }
      else await assert.rejects(q.save());
      if (name === '500') {
        q.shared.answer = null; await q.port.prepare(q.signal);
        assert(q.port.current(), 'A later valid answer restores the boundary');
      }
    }
    assert.deepEqual(outcomes, {
      401: { held: false, freshEpoch: null, reload: 1 }, 403: { held: false, freshEpoch: null, reload: 1 }, 404: { held: false, freshEpoch: null, reload: 1 },
      transport: { held: true, freshEpoch: true, reload: 0 },
      500: { held: false, freshEpoch: null, reload: 0 }, undecodable: { held: false, freshEpoch: null, reload: 0 },
      'invalid-session': { held: false, freshEpoch: null, reload: 0 },
    });
  }
  console.log(`PASS ${caseName}: synthetic native draft evidence only`);
} finally { globalThis.fetch = realFetch; }
