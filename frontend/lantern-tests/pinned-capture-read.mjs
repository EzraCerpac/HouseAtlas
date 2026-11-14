/** Successful local-only pinned file discovery, capture and availability reads. */
import assert from 'node:assert/strict';
import { loadNumericSource } from './load-numeric-source.mjs';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';

const { createPinnedFileClient } = await import(await loadNumericSource('integration/pinned-file-client.ts'));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { workspaceId: uuid(800), homeId: uuid(801) };
const session = { actorId: uuid(802), csrfToken: 'synthetic-unused', expiresAt: '2099-01-01T00:00:00Z' };
const attachmentId = uuid(804);
const sources = [uuid(803), 'synthetic/étage+α'].map((collectionId, index) => ({ ...scope,
  key: { sourceInstanceId: uuid(810 + index), collectionId, sourceKind: 'homebox-entity', externalId: uuid(820 + index) } }));
const discovery = { schemaVersion: 1, scope, revision: 'synthetic-catalog-revision', installedSources: sources };
const tokenFor = index => uuid(830 + index);
const root = version => `/api/atlas/stock/v${version}/workspaces/${scope.workspaceId}/homes/${scope.homeId}`;
const events = [];
const makeArtifact = (request, index) => ({
  scope: { ...scope, sourceInstanceId: request.target.sourceInstanceId, collectionId: request.target.collectionId },
  target: request.target, downloadToken: tokenFor(index), sha256: 'a'.repeat(64), byteSize: 4096,
  contentType: 'application/pdf', localCapture: { semantics: 'process-local-pinned-snapshot',
    beforeRetrievedAt: '2026-10-08T12:00:00Z', bodyRetrievedAt: '2026-10-08T12:00:01Z',
    afterRetrievedAt: '2026-10-08T12:00:02Z', statuses: [200, 200, 200] },
});
const response = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const client = createPinnedFileClient({ getSessionBinding: () => ({ session, scope }),
  subscribeSessionBinding: () => () => {},
  transport: async (url, init) => {
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Accept, 'application/json');
    assert(init.signal instanceof AbortSignal);
    const target = new URL(url, 'https://atlas.invalid');
    events.push(target.pathname);
    if (target.pathname === `${root(3)}/homebox-pinned-file-admission`) {
      assert.equal(target.search, '');
      return response(discovery);
    }
    for (const [index, source] of sources.entries()) {
      const version = index === 0 ? 3 : 4;
      if (target.pathname === `${root(version)}/homebox-pinned-file`) {
        assert.deepEqual([...target.searchParams.keys()], ['request']);
        const request = JSON.parse(target.searchParams.get('request'));
        assert.equal(request.schemaVersion, version);
        assert.equal(request.commandId, 'homebox.file.download');
        assert.match(request.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        assert.deepEqual(request.context, scope);
        assert.deepEqual(request.target, { authority: 'homebox', sourceInstanceId: source.key.sourceInstanceId,
          collectionId: source.key.collectionId, resourceKind: 'attachment', entityId: source.key.externalId,
          resourceId: attachmentId });
        assert.deepEqual(request.payload, {});
        const artifact = makeArtifact(request, index);
        return response(version === 4 ? { schemaVersion: 4, commandId: request.commandId,
          requestId: request.requestId, artifact } : artifact);
      }
      const media = `/api/atlas/media/pinned-homebox/${scope.workspaceId}/${scope.homeId}/${tokenFor(index)}/availability`;
      if (target.pathname === media) {
        assert.equal(target.search, '');
        return response({ state: 'available', lifetime: { remainingMs: 60000 } });
      }
    }
    throw new Error(`Unexpected synthetic read path ${target.pathname}`);
  } });
const signal = new AbortController().signal;
const binding = client.getBindingIdentity();
assert(binding);
assert.deepEqual(client.getBindingScope(binding), scope);
const admitted = await client.discover(binding, signal);
assert.deepEqual(admitted.installedSources, sources);
assert.equal(admitted.revision, discovery.revision);
for (const [index, source] of admitted.installedSources.entries()) {
  const captured = await client.capture(admitted, source, attachmentId, signal);
  assert.equal(captured.request.schemaVersion, index === 0 ? 3 : 4);
  assert.deepEqual(captured.source, source);
  assert.equal(captured.attachmentId, attachmentId);
  assert.deepEqual(captured.artifact.scope, { ...scope, sourceInstanceId: source.key.sourceInstanceId,
    collectionId: source.key.collectionId });
  assert.equal(captured.artifact.byteSize, 4096);
  assert.deepEqual(captured.artifact.localCapture.statuses, [200, 200, 200]);
  assert.equal(Object.hasOwn(captured.artifact, 'downloadToken'), false);
  assert.equal(JSON.stringify(captured).includes(tokenFor(index)), false);
  const available = await client.resolve(captured, signal);
  assert.equal(available.state, 'offer');
  assert.equal(available.offer.remainingMs, 60000);
  assert.equal(available.offer.href,
    `/api/atlas/media/pinned-homebox/${scope.workspaceId}/${scope.homeId}/${tokenFor(index)}`);
  assert.equal(client.isOfferCurrent(available.offer), true);
  assert.equal(client.getUnknown(binding, source, attachmentId), null);
}
assert.deepEqual(events, [
  `${root(3)}/homebox-pinned-file-admission`, `${root(3)}/homebox-pinned-file`,
  `/api/atlas/media/pinned-homebox/${scope.workspaceId}/${scope.homeId}/${tokenFor(0)}/availability`,
  `${root(4)}/homebox-pinned-file`,
  `/api/atlas/media/pinned-homebox/${scope.workspaceId}/${scope.homeId}/${tokenFor(1)}/availability`,
]);
console.log('PASS synthetic pinned discovery, exact six-field v3/v4 capture and one availability observation each');

// The production bounded accumulator must accept fragmented/empty delivery without keeping a chunk list.
for (const invalid of [false, true]) {
  let calls = 0;
  const fragmented = createPinnedFileClient({ getSessionBinding: () => ({ session, scope }), subscribeSessionBinding: () => () => {},
    transport: async () => {
      calls++;
      const bytes = new TextEncoder().encode(JSON.stringify(invalid ? { ...discovery, unexpected: true } : discovery));
      return new Response(new ReadableStream({ start(controller) {
        for (let i = 0; i < 256; i++) controller.enqueue(new Uint8Array());
        for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.subarray(i, i + 1));
        controller.close();
      } }), { headers: { 'Content-Type': 'application/json' } });
    } });
  const identity = fragmented.getBindingIdentity();
  if (invalid) await assert.rejects(fragmented.discover(identity, new AbortController().signal));
  else assert.deepEqual((await fragmented.discover(identity, new AbortController().signal)).installedSources, sources);
  assert.equal(calls, 1, 'malformed/fragmented discovery never retries');
}
let oversizedCancelled = false;
const oversizedDiscovery = createPinnedFileClient({ getSessionBinding: () => ({ session, scope }), subscribeSessionBinding: () => () => {},
  transport: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel() { oversizedCancelled = true; },
  })) });
await assert.rejects(oversizedDiscovery.discover(oversizedDiscovery.getBindingIdentity(), new AbortController().signal));
assert.equal(oversizedCancelled, true, 'oversized delivered chunk is refused before an accumulator copy');

// Actual additive action source, generated hook/JSX and reader boundaries only.
// This is not a React/DOM mount, user download or ordinary-anchor retention control.
const actionKey = Symbol.for('houseatlas.homebox-original-action.generated');
const dataURL = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const hooksURL = dataURL(`
const state = () => globalThis[Symbol.for('houseatlas.homebox-original-action.generated')];
export const useState = initial => state().useState(initial);
export const useRef = initial => state().useRef(initial);
export const useMemo = (fn, deps) => state().useMemo(fn, deps);
export const useEffect = (fn, deps) => state().useEffect(fn, deps);
`);
const jsxURL = dataURL(`export const jsx = (type, props) => typeof type === 'function' ? type(props) : ({type, props}); export const jsxs = jsx; export const Fragment = 'fragment';`);
const storeURL = dataURL(`export const useStore = () => globalThis[Symbol.for('houseatlas.homebox-original-action.generated')].store;`);
const pdfURL = dataURL(`export const SourcePdf = props => ({type: 'generated-pdf', props});`);
const actionPath = new URL('../src/lantern/components/HomeboxOriginalAction.tsx', import.meta.url);
const actionSource = readFileSync(actionPath, 'utf8');
assert(!actionSource.includes('library-preference'), 'explicit keep-on-open must not read the bulk preference');
let actionCode = (await transformWithOxc(actionSource, actionPath.pathname,
  { lang: 'tsx', jsx: { runtime: 'automatic' }, target: 'esnext', tsconfig: false, sourcemap: false })).code;
for (const [specifier, replacement] of Object.entries({ react: hooksURL, 'react/jsx-runtime': jsxURL,
  '../state/store': storeURL, '../source-documents/SourcePdf': pdfURL })) {
  assert(actionCode.includes(JSON.stringify(specifier))); actionCode = actionCode.replaceAll(JSON.stringify(specifier), JSON.stringify(replacement));
}
assert(!/^\s*import.*from\s+["'](?!data:)/m.test(actionCode));
const { HomeboxOriginalAction } = await import(dataURL(actionCode));
const textOf = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(textOf).join('')
  : typeof node === 'object' ? textOf(node.props?.children) : String(node);
function findNode(node, match) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const child of node) { const found = findNode(child, match); if (found) return found; } return null; }
  return match(node) ? node : findNode(node.props?.children, match);
}
function actionHarness() {
  const slots = [], effects = []; let cursor = 0, effectCursor = 0, pending = [];
  const entry = { source: { sourceKind: 'homebox-entity', sourceInstanceId: uuid(810), collectionId: 'generated-opaque', externalId: uuid(820) } };
  const attachment = { kind: 'stored-file', attachmentId };
  const state = { store: { projection: { view: { scope }, entries: new Map([['doc', entry]]), attachments: new Map([['doc', attachment]]) },
    house: { docs: [{ id: 'doc', title: 'Generated verified copy' }] } },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((v, at) => v !== slots[i].deps[at])) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useEffect(fn, deps) { const i = effectCursor++, old = effects[i];
      if (!old || deps.some((v, at) => v !== old.deps[at])) pending.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
    render(port) { cursor = 0; effectCursor = 0; pending = []; globalThis[actionKey] = state; return HomeboxOriginalAction({ docId: 'doc', port }); },
    commit() { const work = pending; pending = []; for (const fn of work) fn(); },
    close() { for (const effect of effects) effect.cleanup?.(); delete globalThis[actionKey]; },
  }; return state;
}
const settleAction = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const originalCreateURL = URL.createObjectURL, originalRevokeURL = URL.revokeObjectURL;
try {
  for (const [kind, outcome] of [['application/pdf', 'uncertain'], ['application/octet-stream', 'quota'], ['application/pdf', 'reject']]) {
    const madeURLs = [], revoked = [], listeners = new Set(), frame = {}, blob = new Blob(['generated bytes'], { type: kind });
    URL.createObjectURL = value => { assert.equal(value, blob); const url = `blob:generated-${madeURLs.length}`; madeURLs.push(url); return url; };
    URL.revokeObjectURL = url => revoked.push(url);
    let current = true, disposed = false, acquisitions = 0, keeps = 0, resolveStorage, rejectStorage, reconciles = 0;
    const result = new Promise((resolve, reject) => { resolveStorage = resolve; rejectStorage = reject; });
    const attempt = { result, async reconcile() { reconciles++; return { status: 'unresolved' }; } };
    const reader = { scope, async open() { acquisitions++; return { status: 'ok', frame }; },
      isCurrent: candidate => current && !disposed && candidate === frame,
      getBlob: candidate => reader.isCurrent(candidate) ? blob : null,
      subscribe(changed) { listeners.add(changed); return () => listeners.delete(changed); },
      retain(candidate) { assert.equal(candidate, frame); keeps++; return { status: 'ok', value: attempt }; },
      release() {}, dispose() { disposed = true; } };
    const port = { async createReader() { return { status: 'ok', value: reader }; } };
    const harness = actionHarness();
    try {
      harness.render(port); harness.commit(); await settleAction();
      let tree = harness.render(port); harness.commit();
      findNode(tree, n => n.type === 'button' && textOf(n) === 'Open file').props.onClick(); await settleAction();
      tree = harness.render(port); harness.commit(); tree = harness.render(port); harness.commit();
      assert.equal(acquisitions, 1); assert.equal(keeps, 1); assert.equal(madeURLs.length, 1);
      const save = findNode(tree, n => n.type === 'a'); assert.equal(save.props.href, madeURLs[0]); assert.equal(textOf(save), 'Save file');
      assert.match(textOf(tree), /Keeping a copy on this device/);
      save.props.onClick({ preventDefault() { assert.fail('Current verified copy should be usable'); } });
      assert.equal(revoked.length, 0, 'click does not revoke a still-owned URL');
      assert.equal(!!findNode(tree, n => n.type === 'generated-pdf'), kind === 'application/pdf');
      if (kind !== 'application/pdf') assert.match(textOf(tree), /No preview for this file type/);
      if (outcome === 'reject') {
        // A storage attempt that rejects after it began cannot be reported as "nothing kept".
        rejectStorage(new Error('Generated storage rejection')); await settleAction();
        tree = harness.render(port); harness.commit();
        assert.match(textOf(tree), /This file was read\. Not known whether it was kept on this device/);
        assert.doesNotMatch(textOf(tree), /No new copy was kept|could not be opened/);
        findNode(tree, n => n.type === 'button' && textOf(n) === 'Check this device').props.onClick(); await settleAction();
        assert.equal(reconciles, 1);
      } else if (outcome === 'uncertain') {
        resolveStorage({ status: 'uncertain' }); await settleAction();
        tree = harness.render(port); harness.commit(); assert.match(textOf(tree), /Not known whether this file was kept on this device/);
        findNode(tree, n => n.type === 'button' && textOf(n) === 'Check this device').props.onClick(); await settleAction();
        assert.equal(reconciles, 1);
      } else {
        // Storage refusal is stated beside the open file, never silent; there is nothing to check or retry.
        resolveStorage({ status: 'quota' }); await settleAction();
        tree = harness.render(port); harness.commit(); assert.match(textOf(tree), /Not kept on this device: device storage is full/);
        assert.equal(findNode(tree, n => n.type === 'button' && textOf(n) === 'Check this device'), null);
        assert.equal(reconciles, 0);
      }
      assert.equal(acquisitions, 1); assert.equal(keeps, 1);
      current = false; for (const changed of listeners) changed();
      assert.deepEqual(revoked, madeURLs, 'retirement revokes the URL synchronously before another render');
      const renderedPdf = findNode(tree, n => n.type === 'generated-pdf'); if (renderedPdf) assert(renderedPdf.props.signal.aborted);
      let blocked = false; save.props.onClick({ preventDefault() { blocked = true; } }); assert(blocked);
      tree = harness.render(port); harness.commit(); assert.equal(findNode(tree, n => n.type === 'a'), null);
      assert.deepEqual(revoked, madeURLs);
    } finally { resolveStorage({ status: 'quota' }); harness.close(); }
    assert(disposed);
  }
} finally { URL.createObjectURL = originalCreateURL; URL.revokeObjectURL = originalRevokeURL; delete globalThis[actionKey]; }
const previewSource = readFileSync(new URL('../src/lantern/components/RealPreview.tsx', import.meta.url), 'utf8');
assert(previewSource.includes("const HomeboxOriginalAction = lazy(() => import('./HomeboxOriginalAction')"));
assert(previewSource.includes("'Download original'")); assert(previewSource.includes('<PinnedFileAction key={id} docId={id} />'));
// Opening is the ordinary path: the kept-on-open action precedes the issued download in the preview stage.
assert(previewSource.indexOf('<HomeboxOriginalAction') > previewSource.indexOf('preview-stage')
  && previewSource.indexOf('<HomeboxOriginalAction') < previewSource.indexOf("'Download original'"));
console.log('PASS HomeBox open-and-keep action controls: one frame, keep on open, inert save, unknown reconciliation, reported storage refusal and owned URL cleanup');
