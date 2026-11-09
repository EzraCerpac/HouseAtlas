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

function maintenanceFixture(interval = { every: 6, kind: 'periodic', unit: 'months' }) {
  const wire = fixture();
  wire.view.kind = 'maintenance'; wire.view.fields = []; wire.view.candidates = [];
  wire.view.sources.push({ ...wire.view.sources[0], key: 'e2', label: 'Generated candidate', page: null, excerpt: 'Generated candidate instance; service date unknown' });
  wire.inspections.e2 = { inputRef: 'item2', version: 'record-1', evidenceRef: 'e2', location: { kind: 'record' } };
  wire.view.maintenance = [{ key: 'maintenance:0:item2', targetKey: 'item2', targetLabel: 'Generated target item2',
    title: 'Review filter service', interval, conditions: ['Service baseline unknown'], urgency: 'unknown',
    reason: 'Generated source interval and candidate evidence only', uncertainty: 'Ambiguous', evidenceKeys: ['e1', 'e2'], baselineDate: null }];
  wire.selections = { 'maintenance:0:item2': { kind: 'maintenance-task', inputRef: 'item2', taskIndex: 0 } };
  return wire;
}
test('maintenance session preserves canonical variants and binds edits without creating tasks', async () => {
  for (const interval of [{ every: 6, kind: 'periodic', unit: 'months' }, { kind: 'conditional', condition: 'Only after documented usage' }, { kind: 'unknown' }]) {
    const s = setup(maintenanceFixture(interval)), c = s.session.controller;
    assert.equal(c.getSnapshot().maintenance[0].selected, false);
    assert.equal(c.getSnapshot().view.maintenance[0].baselineDate, null);
    c.selectMaintenanceTask('maintenance:0:item2', true);
    await c.decide('accept-for-review'); await c.decide('accept-for-review');
    assert.equal(s.intents.length, 1);
    assert.equal(s.intents[0].intent.authority, 'none');
    assert.deepEqual(s.intents[0].intent.maintenance[0].editedFields, []);
    assert.deepEqual(s.intents[0].selections['maintenance:0:item2'], { kind: 'maintenance-task', inputRef: 'item2', taskIndex: 0 });
    s.session.dispose();
  }
  const s = setup(maintenanceFixture()), c = s.session.controller;
  c.selectMaintenanceTask('maintenance:0:item2', true);
  c.editMaintenanceTask('maintenance:0:item2', { title: 'Review edited service', interval: { kind: 'conditional', condition: 'When documented indicator appears' }, conditions: ['Owner review required'], urgency: 'review-soon' });
  await c.decide('accept-for-review');
  assert.equal(s.intents.length, 1);
  const task = s.intents[0].intent.maintenance[0];
  assert.equal(task.targetKey, 'item2');
  assert.deepEqual(task.editedFields, ['title', 'interval', 'conditions', 'urgency']);
  assert.deepEqual(task.interval, { kind: 'conditional', condition: 'When documented indicator appears' });
  assert.equal(Object.hasOwn(task, 'dueDate'), false);
  s.session.dispose();
  for (const every of ['6', '06']) {
    const same = setup(maintenanceFixture()), controller = same.session.controller;
    controller.selectMaintenanceTask('maintenance:0:item2', true);
    controller.editMaintenanceTask('maintenance:0:item2', { interval: { kind: 'periodic', every, unit: 'months' } });
    await controller.decide('accept-for-review');
    assert.equal(same.intents.length, 1, 'raw same-value interval edits remain deliverable');
    assert.deepEqual(same.intents[0].intent.maintenance[0].editedFields, ['interval']);
    assert.equal(same.intents[0].intent.maintenance[0].interval.every, 6);
    same.session.dispose();
  }
});
test('maintenance canonical edit rejection remains editable before consumption and correction delivers once', async () => {
  for (const patch of [{ title: 'x'.repeat(257) }, { title: 'é'.repeat(129) },
    { interval: { kind: 'periodic', every: '100001', unit: 'days' } },
    { interval: { kind: 'conditional', condition: 'x'.repeat(1025) } }, { conditions: ['x'.repeat(513)] },
    { title: 'Service\u0000task' }, { conditions: ['Service\u0085condition'] },
    { interval: { kind: 'conditional', condition: 'Service\u007fcondition' } },
    { title: 'Service\rtask' }, { conditions: ['Service\rcondition'] },
    { interval: { kind: 'conditional', condition: 'Service\rcondition' } }, { title: 'Service\ud800task' }]) {
    const s = setup(maintenanceFixture()), c = s.session.controller;
    let checks = 0; s.owner.recheck = async () => { checks++; return 'current'; };
    c.selectMaintenanceTask('maintenance:0:item2', true);
    assert.equal(c.editMaintenanceTask('maintenance:0:item2', patch), true);
    assert.equal(c.getSnapshot().maintenance[0].valid, false);
    await c.decide('accept-for-review'); await c.decide('accept-for-review');
    assert.equal(s.intents.length, 0);
    assert.equal(checks, 0, 'invalid local edits do not start source checks or delivery');
    assert.equal(c.getSnapshot().phase, 'reviewing');
    assert.equal(c.editMaintenanceTask('maintenance:0:item2', { title: 'Corrected service',
      interval: { kind: 'periodic', every: '6', unit: 'months' }, conditions: [], urgency: 'unknown' }), true);
    assert.equal(c.getSnapshot().maintenance[0].valid, true);
    await c.decide('accept-for-review'); await c.decide('accept-for-review');
    assert.equal(s.intents.length, 1); assert.equal(checks, 1);
    s.session.dispose();
  }
});
test('maintenance LF and TAB remain valid in titles conditions and conditional intervals', async () => {
  const wire = maintenanceFixture({ kind: 'conditional', condition: 'When\nindicator\tchanges' });
  wire.view.maintenance[0].title = 'Review\nservice\ttask';
  wire.view.maintenance[0].conditions = ['Check\nsource\tcontext'];
  const s = setup(wire), c = s.session.controller;
  c.selectMaintenanceTask('maintenance:0:item2', true);
  assert.equal(c.editMaintenanceTask('maintenance:0:item2', { title: 'Edited\nservice\ttask',
    conditions: ['Edited\nsource\tcontext'], interval: { kind: 'conditional', condition: 'Edited\nindicator\tcondition' } }), true);
  assert.equal(c.getSnapshot().maintenance[0].valid, true);
  await c.decide('accept-for-review');
  assert.equal(s.intents.length, 1);
  const task = s.intents[0].intent.maintenance[0];
  assert.equal(task.title, 'Edited\nservice\ttask');
  assert.deepEqual(task.conditions, ['Edited\nsource\tcontext']);
  assert.equal(task.interval.condition, 'Edited\nindicator\tcondition');
  s.session.dispose();
});
test('maintenance actual owner handoff failure remains consumed after a correctable local rejection', async () => {
  const s = setup(maintenanceFixture()), c = s.session.controller; let deliveries = 0;
  s.owner.onIntent = async () => { deliveries++; throw new Error('Synthetic uncertain delivery'); };
  c.selectMaintenanceTask('maintenance:0:item2', true);
  c.editMaintenanceTask('maintenance:0:item2', { title: 'x'.repeat(257) });
  await c.decide('accept-for-review'); assert.equal(deliveries, 0);
  assert.equal(c.editMaintenanceTask('maintenance:0:item2', { title: 'Corrected service' }), true);
  await c.decide('accept-for-review');
  assert.equal(deliveries, 1); assert.equal(c.getSnapshot().phase, 'handoff-unconfirmed');
  assert.equal(c.editMaintenanceTask('maintenance:0:item2', { title: 'Do not replay' }), false);
  await c.decide('accept-for-review'); await c.decide('reject');
  assert.equal(deliveries, 1); s.session.dispose();
});
test('maintenance disclosure refuses invented targets, indices, baselines and schedules', () => {
  for (const mutate of [
    w => { w.view.maintenance[0].targetKey = 'other'; },
    w => { w.selections['maintenance:0:item2'].taskIndex = 1; },
    w => { w.selections['maintenance:0:item2'].inputRef = 'other'; },
    w => { w.view.maintenance[0].baselineDate = '2030-01-01'; },
    w => { w.view.maintenance[0].dueDate = '2030-02-01'; },
    w => { w.view.maintenance[0].interval.every = 100001; },
    w => { w.selections['maintenance:0:item2'].approval = 'invented'; },
  ]) { const wire = maintenanceFixture(); mutate(wire); assert.throws(() => setup(wire)); }
});
test('maintenance currentness and reject keep review intents separate from effects', async () => {
  const stale = setup(maintenanceFixture());
  stale.owner.recheck = async () => 'stale';
  stale.session.controller.selectMaintenanceTask('maintenance:0:item2', true);
  await stale.session.controller.decide('accept-for-review');
  assert.equal(stale.intents.length, 0);
  assert.equal(stale.session.controller.getSnapshot().phase, 'stale');
  stale.session.dispose();
  const rejected = setup(maintenanceFixture());
  await rejected.session.controller.decide('reject');
  assert.deepEqual(rejected.intents[0].intent.maintenance, []);
  assert.deepEqual(rejected.intents[0].selections, {});
  assert.equal(rejected.intents[0].intent.authority, 'none');
  rejected.session.dispose();
});
