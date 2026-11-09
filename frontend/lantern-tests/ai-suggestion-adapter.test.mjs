// Fictional disclosure/controller checks only. No browser, service or inference.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
assert.equal(process.version, 'v26.10.0');
const moduleUrl = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const controller = stripTypeScriptTypes(readFileSync(new URL('../src/ai/suggestion-review/controller.ts', import.meta.url), 'utf8'), { mode: 'strip' });
const source = stripTypeScriptTypes(readFileSync(new URL('../src/ai/suggestion-adapter/session.ts', import.meta.url), 'utf8'), { mode: 'strip' });
const code = source.replace("'../suggestion-review/controller'", JSON.stringify(moduleUrl(controller)));
assert.notEqual(code, source, 'load the actual unchanged controller');
const { createSuggestionReviewSession } = await import(moduleUrl(code));
const pin = 'a'.repeat(64), revision = 'b'.repeat(64);
function fixture(kind = 'inventory') {
  const field = kind === 'inventory' ? 'category' : 'document-class';
  const candidate = kind === 'inventory' ? 'duplicate:item2' : 'document-link:item2';
  return { schemaVersion: 1, contextPin: pin, view: {
    key: 'review:' + revision, revision, sourceSetRevision: pin, kind, title: 'Generated suggestion',
    sources: [{ key: 'e1', label: 'Generated manual', recordVersion: 'record-1', sourceDate: null,
      retrievedAt: '2026-11-08T12:00:00Z', page: 2, section: null, excerpt: 'Generated exact source excerpt',
      freshness: 'snapshot-current', original: 'available' }],
    fields: [{ key: field, label: 'Category', current: null, proposed: kind === 'inventory' ? 'filter' : 'manual',
      reason: 'Extracted claim is tentative', uncertainty: 'Unknown', evidenceKeys: ['e1'] }],
    candidates: [{ key: candidate, label: 'Generated candidate item2', relation: kind === 'inventory' ? 'same-product' : 'proposed-association',
      reason: 'Contradicting extracted claim retained', uncertainty: 'Ambiguous', evidenceKeys: ['e1'] }],
    uncertainty: ['Physical correspondence unknown'], uncalibratedScore: null,
  }, inspections: { e1: { inputRef: 'doc1', version: 'record-1', evidenceRef: 'e1', location: { kind: 'page', page: 2, pageCount: 3 } } },
  selections: { [field]: { kind: kind === 'inventory' ? 'inventory-category' : 'document-class', inputRef: 'subject1' },
    [candidate]: { kind: kind === 'inventory' ? 'inventory-duplicate' : 'document-link', inputRef: 'item2' } } };
}
function setup(wire = fixture(), options = {}) {
  const context = {}, listeners = new Set(), inspected = [], intents = [];
  let current = { context, proposalRevision: revision, sourceSetRevision: pin, availability: 'ready' };
  const owner = { current: () => current, subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb); if (options.unsubscribeThrows) throw new Error('Generated cleanup refusal'); }; },
    async recheck() { return 'current'; }, async inspect(identity, binding, signal) { inspected.push({ identity, binding, signal }); },
    onIntent(intent, selections) { intents.push({ intent, selections }); } };
  const session = createSuggestionReviewSession(JSON.stringify(wire), context, owner);
  return { session, owner, context, inspected, intents, change(value) { current = value; for (const cb of [...listeners]) cb(); } };
}
test('inventory and document projection connects to actual controller with empty selections', async () => {
  for (const kind of ['inventory', 'document']) {
    const { session, intents, inspected } = setup(fixture(kind));
    const controller = session.controller;
    assert.equal(controller.getSnapshot().fields[0].selected, false);
    assert.deepEqual(controller.getSnapshot().candidateKeys, []);
    await controller.inspectSource('e1');
    assert.deepEqual(inspected[0].binding.location, { kind: 'page', page: 2, pageCount: 3 });
    assert.equal(inspected[0].binding.version, 'record-1');
    const field = kind === 'inventory' ? 'category' : 'document-class';
    controller.selectField(field, true); controller.editField(field, 'edited for review');
    controller.selectCandidate(kind === 'inventory' ? 'duplicate:item2' : 'document-link:item2', true);
    await controller.decide('accept-for-review'); await controller.decide('accept-for-review');
    assert.equal(intents.length, 1); assert.equal(intents[0].intent.authority, 'none');
    assert.equal(intents[0].intent.fields[0].edited, true);
    assert.equal(intents[0].selections[field].inputRef, 'subject1');
    assert.equal(Object.values(intents[0].selections)[1].inputRef, 'item2');
    session.dispose();
  }
});
test('source/context supersession hides content; retired sessions cannot deliver', async () => {
  const s = setup(); let retired = 0; const stop = s.session.onRetire(() => retired++);
  s.change({ context: {}, proposalRevision: revision, sourceSetRevision: pin, availability: 'ready' });
  assert.equal(s.session.controller.getSnapshot().view, null);
  s.session.dispose(); s.session.dispose(); stop();
  await s.session.controller.decide('reject');
  assert.equal(retired, 1); assert.equal(s.intents.length, 0);
});
test('retained controller prevents replay when an owner remounts its same session', async () => {
  const s = setup(); const same = s.session.controller;
  same.selectField('category', true); await same.decide('accept-for-review');
  assert.equal(s.session.controller, same);
  await s.session.controller.decide('accept-for-review');
  assert.equal(s.intents.length, 1); s.session.dispose();
});
test('retirement releases owned views even when owner unsubscribe throws', () => {
  const s = setup(fixture(), { unsubscribeThrows: true }); let retired = 0;
  s.session.onRetire(() => retired++);
  assert.throws(() => s.session.dispose(), /Generated cleanup refusal/);
  assert.equal(s.session.retired, true); assert.equal(retired, 1);
  assert.equal(s.session.controller.getSnapshot().view, null);
  s.session.dispose(); assert.equal(retired, 1);
});
test('closed disclosure decoder refuses invented pages, bindings, versions and extra authority', () => {
  for (const mutate of [
    w => { w.approval = 'invented'; }, w => { w.contextPin = 'c'.repeat(64); },
    w => { w.inspections.e1.location.page = 3; }, w => { w.inspections.e1.version = 'record-2'; },
    w => { w.inspections.e1.url = 'https://fictional.invalid'; },
    w => { w.selections['duplicate:item2'].inputRef = 'unadmitted'; },
    w => { w.selections.extra = { kind: 'document-link', inputRef: 'item3' }; },
    w => { w.view.fields[0].key = 'arbitrary-native-write'; },
  ]) { const w = fixture(); mutate(w); assert.throws(() => setup(w)); }
});
