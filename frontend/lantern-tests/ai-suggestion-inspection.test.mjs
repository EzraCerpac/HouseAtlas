// Generated owner allocations, fictional blobs and injected native reader ports.
// No browser/PDF renderer, native service, credentials, extraction or provider.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
assert.equal(process.version, 'v26.10.0');
const source = readFileSync(new URL('../src/ai/suggestion-adapter/inspection-owner.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(source, { mode: 'strip' });
const { createSuggestionInspectionOwner, SuggestionInspectionUnavailable, INSPECTION_LIMITS } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { proposalRevision: 'a'.repeat(64), sourceSetRevision: 'b'.repeat(64) };
const scope = () => ({ workspaceId: id(1), homeId: id(2) });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const recordEntry = () => ({ binding: { inputRef: 'input_1', version: 'cache-observation-7', evidenceRef: 'evidence_1', location: { kind: 'record' } },
  target: { kind: 'record', text: 'Generated cached assertion; upstream version and completeness unknown.' } });
function sourceFixture() {
  const blob = new Blob(['Generated fictional PDF bytes'], { type: 'application/pdf' });
  const asset = { assetId: id(4), revision: 5, bytes: blob.size, sha256: 'c'.repeat(64) };
  let originalOwner = {}, active = null, metadata = { scope: scope(), documentId: id(3), revision: 6,
    lifecycle: 'active', availability: { original: 'available' }, original: asset };
  const calls = [], releases = [], listeners = new Map(), ownerListeners = new Set();
  const fixture = {
    asset, blob, calls, releases, pending: null, get metadata() { return metadata; }, set metadata(value) { metadata = value; },
    entry: { binding: { inputRef: 'document_1', version: 'admitted-source-19', evidenceRef: 'citation_1', location: { kind: 'page', page: 2, pageCount: 3 } },
      target: { kind: 'native-source', documentId: id(3), documentRevision: 6, asset } },
    reader: {
      owner: () => originalOwner,
      subscribeOwner(cb) { ownerListeners.add(cb); return () => ownerListeners.delete(cb); },
      async get(documentId, signal) { calls.push(['get', documentId, signal]); return metadata; },
      async openOriginal(documentId, revision, signal) {
        calls.push(['original', documentId, revision, signal]);
        if (fixture.pending) await fixture.pending.promise;
        const frame = { lease: {}, documentId, documentRevision: revision, asset, mode: 'original', measuredContentType: blob.type };
        active = frame; return frame;
      },
      isCurrent: frame => active === frame,
      getBlob: frame => active === frame ? blob : null,
      subscribeInvalidation(frame, cb) { listeners.set(frame, cb); if (active !== frame) cb(); return () => listeners.delete(frame); },
      release(frame) { releases.push(frame); if (active === frame) { active = null; listeners.get(frame)?.(); } },
    },
    revoke() { const old = active; active = null; if (old) listeners.get(old)?.(); },
    replaceOwner() { originalOwner = {}; for (const cb of [...ownerListeners]) cb(); },
  };
  return fixture;
}
function textFixture(text = 'A🧭BéZ') {
  const blob = new Blob([text], { type: 'text/plain' });
  const asset = { assetId: id(5), revision: 8, bytes: blob.size, sha256: 'd'.repeat(64) };
  const exact = n => ({ toSafeInteger: () => n });
  let active = null, callback = () => {};
  const calls = [], releases = [];
  const fixture = {
    calls, releases, blob,
    entry: { binding: { inputRef: 'text_1', version: 'admitted-text-10', evidenceRef: 'range_1', location: { kind: 'text-range', start: 1, end: 4, textLength: 5 } },
      target: { kind: 'native-evidence', evidenceId: id(6), evidenceRevision: 11, asset } },
    reader: {
      async open(evidenceId, signal) {
        calls.push([evidenceId, signal]);
        active = { lease: {}, evidenceId, evidenceRevision: 11, asset: { ...asset, contentType: blob.type,
          revision: exact(asset.revision), byteSize: exact(blob.size) }, mode: 'original-download' };
        return active;
      },
      isCurrent: frame => active === frame,
      getBlob: frame => active === frame ? blob : null,
      subscribeInvalidation(_frame, cb) { callback = cb; return () => { callback = () => {}; }; },
      release(frame) { releases.push(frame); if (active === frame) { active = null; callback(); } },
    },
  };
  return fixture;
}
function setup(entries = [recordEntry()], extras = {}) {
  const listeners = new Set(), views = [], closed = [], created = [], revoked = [], checks = [];
  const snapshot = { ...identity, accountKey: 'generated-account', nativeBinding: { sessionIdentity: {}, scope: scope(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString() }, entries };
  let current = snapshot, recheck = async () => 'current', present = () => {};
  const controller = new AbortController();
  const owner = createSuggestionInspectionOwner({
    ...extras,
    inputs: { current: () => current, subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
      recheck(wanted, signal) { checks.push([wanted, signal]); return recheck(wanted, signal); } },
    objectUrls: { createObjectURL(blob) { const url = `blob:generated-${created.length}`; created.push([url, blob]); return url; }, revokeObjectURL(url) { revoked.push(url); } },
    present(view) { views.push(view); const stop = present(view); return () => { closed.push(view); stop?.(); }; },
  });
  return { owner, snapshot, views, closed, created, revoked, checks, controller, listeners,
    inspect: (binding = entries[0].binding, wanted = identity, signal = controller.signal) => owner.inspect(wanted, binding, signal),
    setRecheck(fn) { recheck = fn; }, setPresent(fn) { present = fn; },
    replace(value = { ...snapshot }) { current = value; for (const cb of [...listeners]) cb(); },
  };
}
test('exact record assertion uses private copied map and original input rechecks', async t => {
  const entry = recordEntry(), expected = entry.target.text, s = setup([entry]); t.after(() => s.owner.dispose());
  entry.target.text = 'Caller changed the record after admission';
  await s.inspect();
  assert.equal(s.views.length, 1); assert.equal(s.views[0].kind, 'record'); assert.equal(s.views[0].getText(), expected);
  assert.equal(s.checks.length, 2); assert.deepEqual(s.checks[0][0], identity); assert.equal(s.created.length, 0);
  s.owner.close(); assert.equal(s.views[0].getText(), null); assert.equal(s.views[0].signal.aborted, true); assert.equal(s.closed.length, 1);
});
test('missing version, mapping, evidence and changed identity refuse without a read', async t => {
  const s = setup(); t.after(() => s.owner.dispose());
  for (const change of [{ version: '' }, { version: 'newer-version' }, { evidenceRef: null }, { evidenceRef: 'other' },
    { inputRef: 'other' }, { location: null }, { location: { kind: 'record', url: 'https://example.invalid' } }])
    await assert.rejects(s.inspect({ ...s.snapshot.entries[0].binding, ...change }), SuggestionInspectionUnavailable);
  await assert.rejects(s.inspect(s.snapshot.entries[0].binding, { ...identity, sourceSetRevision: 'f'.repeat(64) }), SuggestionInspectionUnavailable);
  assert.equal(s.checks.length, 0); assert.equal(s.views.length, 0);
});
test('admission rejects missing versions and ambiguous duplicate map tuples', () => {
  const empty = recordEntry(); empty.binding.version = '';
  assert.throws(() => setup([empty]), SuggestionInspectionUnavailable);
  assert.throws(() => setup([recordEntry(), recordEntry()]), SuggestionInspectionUnavailable);
});
test('exact native document, revision, asset and page pass through unchanged', async t => {
  const native = sourceFixture(), s = setup([native.entry], { sourceDocuments: native.reader }); t.after(() => s.owner.dispose());
  await s.inspect(); const view = s.views[0];
  assert.equal(view.kind, 'pdf'); assert.equal(view.initialPage, 2); assert.equal(view.pageCount, 3);
  assert.equal(view.getBlob(), native.blob); assert.equal(view.getDownloadUrl(), 'blob:generated-0');
  assert.deepEqual(native.calls.map(c => c.slice(0, c[0] === 'get' ? 2 : 3)), [['get', id(3)], ['original', id(3), 6]]);
  assert.equal(s.checks.length, 2);
  s.owner.dispose(); assert.equal(view.getBlob(), null); assert.equal(view.getDownloadUrl(), null);
  assert.equal(view.signal.aborted, true); assert.equal(s.closed.length, 1); assert.deepEqual(s.revoked, ['blob:generated-0']); assert.equal(native.releases.length, 1);
});
test('page location requires exact page AND admitted page count; it is never clamped', async t => {
  const native = sourceFixture(), s = setup([native.entry], { sourceDocuments: native.reader }); t.after(() => s.owner.dispose());
  for (const loc of [{ kind: 'page', page: 1, pageCount: 3 }, { kind: 'page', page: 2, pageCount: 4 },
    { kind: 'page', page: 4, pageCount: 3 }, { kind: 'page', page: 0, pageCount: 3 }])
    await assert.rejects(s.inspect({ ...native.entry.binding, location: loc }), SuggestionInspectionUnavailable);
  assert.equal(native.calls.length, 0); assert.equal(s.views.length, 0);
});
test('unavailable original, newer revision, different asset and wrong scope all withhold', async t => {
  for (const change of [doc => ({ ...doc, availability: { original: 'unavailable' } }), doc => ({ ...doc, revision: doc.revision + 1 }),
    doc => ({ ...doc, original: { ...doc.original, assetId: id(99) } }), doc => ({ ...doc, scope: { ...doc.scope, homeId: id(99) } })]) {
    const native = sourceFixture(), s = setup([native.entry], { sourceDocuments: native.reader }); t.after(() => s.owner.dispose());
    native.metadata = change(native.metadata);
    await assert.rejects(s.inspect(), SuggestionInspectionUnavailable);
    assert.equal(s.views.length, 0); assert.equal(s.created.length, 0); assert.equal(native.calls.length, 1);
  }
});
test('no original reader or association means no guessed native or attachment fallback', async t => {
  const native = sourceFixture(), s = setup([native.entry]); t.after(() => s.owner.dispose());
  await assert.rejects(s.inspect(), SuggestionInspectionUnavailable); assert.equal(s.views.length, 0);
  const record = setup(); t.after(() => record.owner.dispose());
  await assert.rejects(record.inspect({ ...record.snapshot.entries[0].binding, location: native.entry.binding.location }), SuggestionInspectionUnavailable);
  assert.equal(record.views.length, 0);
});
test('original Unicode scalar ranges preserve the exact selection rather than UTF-16 offsets', async t => {
  const native = textFixture(), s = setup([native.entry], { evidenceDocuments: native.reader }); t.after(() => s.owner.dispose());
  await s.inspect(); assert.equal(s.views[0].kind, 'text-range'); assert.equal(s.views[0].getText(), '🧭Bé');
  assert.equal(s.created.length, 0); assert.equal(native.calls[0][0], id(6));
  s.controller.abort(); assert.equal(s.views[0].getText(), null); assert.equal(native.releases.length, 1);
});
test('range limits, changed text length, guessed extraction and invalid UTF-8 refuse', async t => {
  const native = textFixture(), s = setup([native.entry], { evidenceDocuments: native.reader }); t.after(() => s.owner.dispose());
  for (const change of [{ start: -1 }, { end: 6 }, { end: 1 }, { textLength: 6 }])
    await assert.rejects(s.inspect({ ...native.entry.binding, location: { ...native.entry.binding.location, ...change } }), SuggestionInspectionUnavailable);
  assert.equal(native.calls.length, 0);
  const oversized = textFixture(); oversized.entry.binding.location = { kind: 'text-range', start: 0, end: INSPECTION_LIMITS.rangeScalars + 1, textLength: INSPECTION_LIMITS.rangeScalars + 1 };
  assert.throws(() => setup([oversized.entry], { evidenceDocuments: oversized.reader }), SuggestionInspectionUnavailable);
  const changed = textFixture('A🧭BéZZ'), mismatch = setup([changed.entry], { evidenceDocuments: changed.reader }); t.after(() => mismatch.owner.dispose());
  await assert.rejects(mismatch.inspect(), SuggestionInspectionUnavailable); assert.equal(mismatch.views.length, 0); assert.equal(changed.releases.length, 1);
  const invalid = textFixture(), bytes = new Blob([new Uint8Array([255])], { type: 'text/plain' });
  invalid.entry.target.asset.bytes = bytes.size; invalid.reader.getBlob = () => bytes;
  // Match the fake byte owner pin so the UTF-8 decoder itself must refuse.
  const open = invalid.reader.open; invalid.reader.open = async (...args) => { const f = await open(...args); f.asset.byteSize = { toSafeInteger: () => bytes.size }; return f; };
  const malformed = setup([invalid.entry], { evidenceDocuments: invalid.reader }); t.after(() => malformed.owner.dispose());
  await assert.rejects(malformed.inspect(), SuggestionInspectionUnavailable); assert.equal(malformed.views.length, 0);
});
test('native evidence version and original asset revision are independent pins', async t => {
  for (const change of [f => { f.evidenceRevision++; }, f => { f.asset.revision = { toSafeInteger: () => 99 }; },
    f => { f.asset.sha256 = 'e'.repeat(64); }, f => { f.mode = 'inline-png'; }]) {
    const native = textFixture(), open = native.reader.open;
    native.reader.open = async (...args) => { const f = await open(...args); change(f); return f; };
    const s = setup([native.entry], { evidenceDocuments: native.reader }); t.after(() => s.owner.dispose());
    await assert.rejects(s.inspect(), SuggestionInspectionUnavailable); assert.equal(s.views.length, 0); assert.equal(native.releases.length, 1);
  }
});
test('fresh input recheck refuses stale, revoked and unavailable before disclosure', async t => {
  for (const status of ['stale', 'withdrawn', 'unavailable']) {
    const s = setup(); t.after(() => s.owner.dispose()); s.setRecheck(async () => status);
    await assert.rejects(s.inspect(), SuggestionInspectionUnavailable); assert.equal(s.views.length, 0);
    if (status !== 'unavailable') {
      s.setRecheck(async () => 'current');
      await assert.rejects(s.inspect(), SuggestionInspectionUnavailable);
    }
  }
});
test('second original-input recheck can revoke after native bytes arrive', async t => {
  const native = sourceFixture(), s = setup([native.entry], { sourceDocuments: native.reader }); t.after(() => s.owner.dispose());
  let count = 0; s.setRecheck(async () => ++count === 1 ? 'current' : 'withdrawn');
  await assert.rejects(s.inspect(), SuggestionInspectionUnavailable);
  assert.equal(s.views.length, 0); assert.equal(s.created.length, 0); assert.equal(native.releases.length, 1);
});
test('concurrent source replacement fences and releases a late original even when abort is ignored', async t => {
  const native = sourceFixture(), s = setup([native.entry], { sourceDocuments: native.reader }); t.after(() => s.owner.dispose());
  native.pending = deferred(); const work = s.inspect(); const refused = assert.rejects(work, SuggestionInspectionUnavailable);
  await turn(); assert.equal(native.calls.length, 2); s.replace(); await refused;
  native.pending.resolve(); await turn();
  assert.equal(native.releases.length, 1); assert.equal(s.views.length, 0); assert.equal(s.created.length, 0);
  s.replace(s.snapshot); await assert.rejects(s.inspect(), SuggestionInspectionUnavailable);
});
test('cancellation before admission, during open and after presentation always withholds or clears', async t => {
  const early = setup(); t.after(() => early.owner.dispose()); early.controller.abort();
  await assert.rejects(early.inspect(), SuggestionInspectionUnavailable); assert.equal(early.checks.length, 0);
  const native = sourceFixture(), s = setup([native.entry], { sourceDocuments: native.reader }); t.after(() => s.owner.dispose());
  native.pending = deferred(); const refused = assert.rejects(s.inspect(), SuggestionInspectionUnavailable);
  await turn(); s.controller.abort(); await refused; native.pending.resolve(); await turn();
  assert.equal(s.views.length, 0); assert.equal(native.releases.length, 1);
  const shown = sourceFixture(), later = setup([shown.entry], { sourceDocuments: shown.reader }); t.after(() => later.owner.dispose());
  await later.inspect(); later.controller.abort();
  assert.equal(later.views[0].getDownloadUrl(), null); assert.equal(later.views[0].getBlob(), null); assert.equal(later.closed.length, 1); assert.equal(later.revoked.length, 1);
});
test('source frame invalidation clears URL and borrowed lease synchronously', async t => {
  const native = sourceFixture(), s = setup([native.entry], { sourceDocuments: native.reader }); t.after(() => s.owner.dispose());
  await s.inspect(); const view = s.views[0]; native.revoke();
  assert.equal(view.signal.aborted, true); assert.equal(view.getBlob(), null); assert.equal(view.getDownloadUrl(), null);
  assert.equal(s.revoked.length, 1); assert.equal(s.closed.length, 1); assert.equal(native.releases.length, 1);
});
test('account, scope, session and equal-valued allocation replacement retire permanently', async t => {
  for (const replace of [s => ({ ...s.snapshot, accountKey: 'other' }), s => ({ ...s.snapshot, nativeBinding: { ...s.snapshot.nativeBinding, scope: scope() } }),
    s => ({ ...s.snapshot, nativeBinding: { ...s.snapshot.nativeBinding, sessionIdentity: {} } }), s => ({ ...s.snapshot })]) {
    const s = setup(); t.after(() => s.owner.dispose()); await s.inspect(); const view = s.views[0];
    s.replace(replace(s)); assert.equal(view.getText(), null); assert.equal(view.signal.aborted, true);
    s.replace(s.snapshot); await assert.rejects(s.inspect(), SuggestionInspectionUnavailable); assert.equal(s.views.length, 1);
  }
});
test('superseding inspections close the prior URL without cancelling the new lease', async t => {
  const native = sourceFixture(), s = setup([native.entry], { sourceDocuments: native.reader }); t.after(() => s.owner.dispose());
  await s.inspect(); await s.inspect();
  assert.equal(s.views[0].getBlob(), null); assert.equal(s.views[1].getBlob(), native.blob);
  assert.equal(s.views[1].signal.aborted, false); assert.equal(native.releases.length, 1); assert.deepEqual(s.revoked, ['blob:generated-0']);
});
test('reentrant replacement during presentation still runs returned view cleanup', async t => {
  const native = sourceFixture(), s = setup([native.entry], { sourceDocuments: native.reader }); t.after(() => s.owner.dispose());
  s.setPresent(() => { s.replace(); }); await assert.rejects(s.inspect(), SuggestionInspectionUnavailable);
  assert.equal(s.views[0].getBlob(), null); assert.equal(s.views[0].signal.aborted, true);
  assert.equal(s.closed.length, 1); assert.equal(s.revoked.length, 1); assert.equal(native.releases.length, 1);
});
test('owned cleanup continues when a presentation cleanup throws', async t => {
  const native = sourceFixture(), s = setup([native.entry], { sourceDocuments: native.reader }); t.after(() => s.owner.dispose());
  s.setPresent(() => () => { throw new Error('Generated cleanup failure'); }); await s.inspect();
  s.owner.dispose(); assert.equal(s.views[0].getBlob(), null); assert.equal(s.revoked.length, 1); assert.equal(native.releases.length, 1); assert.equal(s.listeners.size, 0);
});
test('native reader owner replacement withdraws current display without an input event', async t => {
  const native = sourceFixture(), s = setup([native.entry], { sourceDocuments: native.reader }); t.after(() => s.owner.dispose());
  await s.inspect(); native.replaceOwner();
  assert.equal(s.views[0].signal.aborted, true); assert.equal(s.views[0].getBlob(), null); assert.equal(s.revoked.length, 1);
  await assert.rejects(s.inspect(), SuggestionInspectionUnavailable);
});
test('native lease can reject a newer byte frame even after matching metadata', async t => {
  const native = sourceFixture(), open = native.reader.openOriginal;
  native.reader.openOriginal = async (...args) => { const frame = await open(...args); frame.documentRevision++; return frame; };
  const s = setup([native.entry], { sourceDocuments: native.reader }); t.after(() => s.owner.dispose());
  await assert.rejects(s.inspect(), SuggestionInspectionUnavailable);
  assert.equal(s.views.length, 0); assert.equal(native.releases.length, 1); assert.equal(s.created.length, 0);
});
test('account expiry retires a displayed lease and leaves no object URL', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2031-04-01T12:00:00Z') });
  const native = sourceFixture(), s = setup([native.entry], { sourceDocuments: native.reader }); t.after(() => s.owner.dispose());
  await s.inspect(); t.mock.timers.tick(3_600_001);
  assert.equal(s.views[0].signal.aborted, true); assert.equal(s.views[0].getBlob(), null); assert.equal(s.views[0].getDownloadUrl(), null);
  assert.equal(s.revoked.length, 1); assert.equal(native.releases.length, 1);
  await assert.rejects(s.inspect(), SuggestionInspectionUnavailable);
});
