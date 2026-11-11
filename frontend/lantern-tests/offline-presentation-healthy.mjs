// Generated presentation controls. Real source functions, synthetic React/owner
// boundaries; no DOM, PDF renderer, IndexedDB, network, account or source grants.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), []);
const data = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const transform = async (text, name, lang = 'ts') => (await transformWithOxc(text, name,
  { lang, jsx: { runtime: 'automatic' }, target: 'esnext', tsconfig: false, sourcemap: false })).code;
const intent = await import(data(await transform(source('../src/offline/offline-reading-intent.ts'), 'generated-reading-intent.ts')));
const scope = { workspaceId: '00000000-0000-4000-8000-000000000001', homeId: '00000000-0000-4000-8000-000000000002' };
const snapshot = (patch = {}) => ({ actorRevision: '00000000-0000-4000-8000-000000000003', snapshotRevision: 'generated-first',
  data: { scope, entries: [] }, ...patch });
const native = { kind: 'native', pin: { documentId: 'generated-document', documentRevision: 1,
  assetId: 'generated-asset', assetRevision: 1, sha256: 'a'.repeat(64), bytes: 20, contentType: 'application/pdf' } };
const electrical = { kind: 'electrical', pin: { source: 'electrical-evidence', buildingId: 'generated-building',
  evidenceId: 'generated-evidence', evidenceRevision: 1, assetId: 'generated-asset', assetRevision: '1.0',
  sha256: 'b'.repeat(64), byteSize: '20', contentType: 'application/pdf' } };
const homebox = { kind: 'homebox', pin: { source: 'homebox-attachment', sourceInstanceId: 'generated-source', collectionId: 'generated-collection',
  entityId: 'generated-entity', attachmentId: 'generated-attachment', observationId: 'generated-observation', sourceRegistrationVersion: 1,
  sourceRegistrationSha256: 'c'.repeat(64), sha256: 'd'.repeat(64), bytes: 20, contentType: 'application/pdf', sourceContentType: 'text/plain',
  beforeRetrievedAt: '2030-01-01T00:00:00Z', bodyRetrievedAt: '2030-01-01T00:00:01Z', afterRetrievedAt: '2030-01-01T00:00:02Z' } };
const position = { page: 2, zoom: 2, scrollTop: 123, scrollLeft: 45 };
let initial = intent.revalidateReadingIntent(intent.emptyReadingIntent(), snapshot(), 1);
initial = intent.openReadingDocument({ ...initial, view: 'library' }, native);
initial = intent.rememberReadingPosition(initial, 1, intent.readingDocumentKey(native), position);
const renewed = intent.revalidateReadingIntent(initial, snapshot({ snapshotRevision: 'generated-new-capture' }), 2);
assert.equal(renewed.view, 'library'); assert.deepEqual(renewed.document.position, position);
assert.equal(intent.rememberReadingPosition(renewed, 1, intent.readingDocumentKey(native), { ...position, page: 1 }), renewed);
assert.equal(intent.closeReadingDocument(renewed, 1, intent.readingDocumentKey(native)), renewed);
for (const different of [snapshot({ actorRevision: 'generated-other-actor' }), snapshot({ data: { scope: { ...scope, homeId: 'generated-other-home' } } })]) {
  const next = intent.revalidateReadingIntent(renewed, different, 3);
  assert.equal(next.view, 'atlas'); assert.equal(next.document, null);
}
for (const invalid of [{ ...position, page: 0 }, { ...position, zoom: 0 }, { ...position, scrollTop: Infinity }, { ...position, scrollLeft: -1 }])
  assert.equal(intent.rememberReadingPosition(renewed, 2, intent.readingDocumentKey(native), invalid), renewed);
for (const request of [native, electrical, homebox]) {
  assert.notEqual(intent.readingDocumentKey(request), intent.readingDocumentKey({ ...request, pin: { ...request.pin, sha256: 'f'.repeat(64) } }));
  assert.equal(intent.openReadingDocument(initial, request, 2).document.position.page, 2);
}
console.log('PASS neutral intent: same-owner capture, exact namespace/pin, page/zoom/scroll, invalid values and late generations');

// Compile the actual root and reopen functions. The explicit hook seam models
// state/effect/commit ordering only; it is not React/DOM or source qualification.
const host = source('../src/offline/OfflineLanternHost.tsx');
const between = (start, end) => {
  assert.equal(host.split(start).length, 2); assert.equal(host.split(end).length, 2);
  return host.slice(host.indexOf(start), host.indexOf(end, host.indexOf(start)));
};
function hookRuntime() {
  let cursor = 0;
  const slots = [], layouts = [], effects = [], cleanups = new Map(), savedEffects = new Map();
  const register = (queue, fn, deps) => {
    const at = cursor++, before = slots[at];
    if (before && deps && before.length === deps.length && deps.every((value, index) => value === before[index])) return;
    slots[at] = deps; queue.push([at, fn]); if (queue === effects) savedEffects.set(at, fn);
  };
  const flush = queue => { for (const [at, fn] of queue.splice(0)) { cleanups.get(at)?.(); cleanups.set(at, fn()); } };
  return {
    begin() { cursor = 0; },
    useState(value) { const at = cursor++; if (!(at in slots)) slots[at] = typeof value === 'function' ? value() : value;
      return [slots[at], next => { slots[at] = typeof next === 'function' ? next(slots[at]) : next; }]; },
    useRef(value) { const at = cursor++; if (!(at in slots)) slots[at] = { current: value }; return slots[at]; },
    useEffect: (fn, deps) => register(effects, fn, deps),
    useLayoutEffect: (fn, deps) => register(layouts, fn, deps),
    commit(node, box) { if (node?.props.ref) node.props.ref.current = box; flush(layouts); },
    effects() { flush(effects); },
    replay() { for (const [at, fn] of savedEffects) { cleanups.get(at)?.(); cleanups.set(at, fn()); } },
    close() { for (const cleanup of cleanups.values()) cleanup?.(); cleanups.clear(); },
  };
}
let runtime = hookRuntime();
const RetainedApp = () => null, SavedAtlasHost = () => null, Modal = () => null, SourcePdf = () => null, HeldDownload = () => null;
const hooks = { ...intent, RetainedApp, SavedAtlasHost, Modal, SourcePdf, HeldDownload,
  useState: value => runtime.useState(value), useRef: value => runtime.useRef(value),
  useEffect: (fn, deps) => runtime.useEffect(fn, deps), useLayoutEffect: (fn, deps) => runtime.useLayoutEffect(fn, deps) };
const token = Symbol.for('houseatlas.offline-presentation.synthetic');
globalThis[token] = hooks;
const jsx = data('export const jsx=(type,props,key)=>({type,props,key});export const jsxs=jsx;export const Fragment=Symbol.for("generated-fragment");');
let code = await transform(`const { ${Object.keys(hooks).join(',')} } = globalThis[Symbol.for('houseatlas.offline-presentation.synthetic')];
  ${between('export function OfflineLanternHost(', '\nfunction RetainedApp(')}
  export ${between('async function readHeldDocument(', '\nfunction ReopenedDocument(')}
  export ${host.slice(host.indexOf('function ReopenedDocument('))}`, 'generated-offline-presentation.tsx', 'tsx');
code = code.replaceAll(JSON.stringify('react/jsx-runtime'), JSON.stringify(jsx));
const component = await import(data(code));
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const box = { hidden: false, setAttribute(name) { assert.equal(name, 'hidden'); this.hidden = true; },
  removeAttribute(name) { assert.equal(name, 'hidden'); this.hidden = false; } };
let refresh;
const reads = [];
const owner = { read: {
  subscribe(callback) { refresh = callback; return () => { refresh = null; }; },
  readLast(signal) { return new Promise(resolve => reads.push({ signal, resolve })); },
} };
const props = { owner, openAtlas: async () => null, openLegacyAtlas: async () => null };
const renderHost = () => { runtime.begin(); return component.OfflineLanternHost(props); };
const commit = node => { runtime.commit(node, box); runtime.effects(); };
try {
  commit(renderHost()); assert.equal(box.hidden, true);
  reads[0].resolve({ status: 'ok', value: { handle: { generated: 1 }, snapshot: snapshot() } }); await settle();
  assert.equal(box.hidden, true, 'fulfilled read alone cannot expose pre-commit DOM');
  let tree = renderHost(); commit(tree); let app = tree.props.children;
  assert.equal(app.type, RetainedApp); assert.equal(box.hidden, false);
  app.props.changePresentation(state => intent.openReadingDocument({ ...state, view: 'library' }, native, 2));
  tree = renderHost(); commit(tree); app = tree.props.children;
  app.props.changePresentation(state => intent.rememberReadingPosition(state, 1, intent.readingDocumentKey(native), position));
  tree = renderHost(); commit(tree); app = tree.props.children;
  const old = app;
  refresh();
  assert.equal(box.hidden, true); assert.equal(reads[0].signal.aborted, true, 'old allocation retires synchronously');
  old.props.changePresentation(state => ({ ...state, view: 'changes', document: null }));
  tree = renderHost(); commit(tree); assert.notEqual(tree.props.children.type, RetainedApp); assert.equal(box.hidden, true);
  reads[1].resolve({ status: 'ok', value: { handle: { generated: 2 }, snapshot: snapshot({ snapshotRevision: 'fresh' }) } }); await settle();
  assert.equal(box.hidden, true, 'old DOM stays hidden until the fresh commit');
  tree = renderHost(); commit(tree); app = tree.props.children;
  assert.equal(app.props.presentation.view, 'library'); assert.deepEqual(app.props.presentation.document.position, position);
  assert.notEqual(app.key, old.key); assert.notEqual(app.props.selection.signal, old.props.selection.signal);
  assert.equal(app.props.selection.signal.aborted, false); assert.equal(box.hidden, false);
  refresh(); reads[2].resolve({ status: 'retired' }); await settle();
  tree = renderHost(); commit(tree); assert.notEqual(tree.props.children.type, RetainedApp); assert.notEqual(tree.props.children.type, SavedAtlasHost);
  refresh(); reads[3].resolve({ status: 'ok', value: { handle: {}, snapshot: snapshot() } }); await settle();
  tree = renderHost(); commit(tree); app = tree.props.children;
  assert.equal(app.props.presentation.view, 'atlas'); assert.equal(app.props.presentation.document, null, 'unknown ownership never resurrects old file intent');
  refresh(); refresh();
  reads[4].resolve({ status: 'ok', value: { handle: {}, snapshot: snapshot({ actorRevision: 'obsolete' }) } }); await settle();
  tree = renderHost(); commit(tree); assert.notEqual(tree.props.children.type, RetainedApp); assert.equal(box.hidden, true);
  reads[5].resolve({ status: 'ok', value: { handle: {}, snapshot: snapshot({ actorRevision: 'fresh-owner' }) } }); await settle();
  tree = renderHost(); commit(tree); assert.equal(tree.props.children.props.presentation.document, null);
  console.log('PASS actual root: synchronous hide/abort, commit-only unhide, fresh allocations, section preservation, retirement and obsolete results');
} finally { runtime.close(); }

const blob = new Blob(['%PDF-generated'], { type: 'application/pdf' });
function localOwner(kind, pin) {
  let bodyReads = 0;
  const status = async () => ({ status: 'ok', value: { availability: 'held', pin } });
  const body = async () => { bodyReads++; return { status: 'ok', value: blob }; };
  return { count: () => bodyReads, read: { documentStatus: status, electricalStatus: status, homeboxStatus: status,
    readCatalog: async () => ({ status: 'ok', value: { documents: [{ ...pin, lifecycle: 'active', title: 'Fresh generated title' }] } }),
    readDocument: body, readElectricalDocument: body, readHomeboxDocument: body } };
}
const homeboxSnapshot = snapshot({ data: { scope, entries: [{ source: { sourceKind: 'homebox-entity', ...homebox.pin, externalId: homebox.pin.entityId },
  attachments: [{ kind: 'stored-file', attachmentId: homebox.pin.attachmentId, title: 'Fresh generated attachment' }] }] } });
for (const request of [native, electrical, homebox]) {
  const o = localOwner(request.kind, request.pin), selection = { handle: {}, snapshot: request.kind === 'homebox' ? homeboxSnapshot : snapshot() };
  const result = await component.readHeldDocument(o, selection, request, new AbortController().signal);
  assert.equal(result.blob, blob); assert.equal(o.count(), 1);
  const changed = localOwner(request.kind, { ...request.pin, sha256: 'f'.repeat(64) });
  assert.equal(await component.readHeldDocument(changed, selection, request, new AbortController().signal), null);
  assert.equal(changed.count(), 0, 'changed exact pins cannot reach bytes');
}
{
  const o = localOwner('homebox', homebox.pin);
  assert.equal(await component.readHeldDocument(o, { handle: {}, snapshot: snapshot() }, homebox, new AbortController().signal), null);
  assert.equal(o.count(), 0, 'removed HomeBox association cannot reopen');
  o.read.homeboxStatus = async () => ({ status: 'missing' });
  assert.equal(await component.readHeldDocument(o, { handle: {}, snapshot: homeboxSnapshot }, homebox, new AbortController().signal), null);
}
console.log('PASS actual reopen resolver: all three namespaces revalidate exact pins, membership and fresh metadata before bytes');

function find(node, type) {
  if (node?.type === type) return node;
  const children = node?.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) { if (child && typeof child === 'object') { const found = find(child, type); if (found) return found; } }
  return null;
}
const selected = { handle: {}, snapshot: snapshot(), signal: new AbortController().signal, generation: 1 };
let unavailable = 0;
const readProps = { owner: localOwner('native', native.pin), selection: selected, reading: { request: native, position },
  onUnavailable: () => { unavailable++; }, onPosition: () => {} };
runtime = hookRuntime();
const draw = () => { runtime.begin(); return component.ReopenedDocument(readProps); };
try {
  let tree = draw(); runtime.commit(tree); runtime.effects(); await settle();
  tree = draw(); const first = find(tree, SourcePdf);
  assert(first); assert.deepEqual(first.props.initialReadingPosition, position); assert.equal(first.props.signal.aborted, false);
  // Explicit effect replay is a synthetic scheduler control, not browser execution.
  runtime.replay(); assert.equal(first.props.signal.aborted, true); await settle();
  tree = draw(); const next = find(tree, SourcePdf);
  assert(next); assert.notEqual(next.props.signal, first.props.signal); assert.equal(next.props.signal.aborted, false);
  assert.equal(unavailable, 0); assert.equal(readProps.owner.count(), 2);
  console.log('PASS actual reopen allocation: effect replay aborts old signal and obtains fresh verified bytes/controller');
} finally { runtime.close(); delete globalThis[token]; }
console.log('Offline presentation controls passed; hook/owner boundaries synthetic, real focus/layout/PDF draw awaits browser CI.');
