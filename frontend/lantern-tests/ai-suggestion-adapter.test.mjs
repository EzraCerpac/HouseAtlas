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
test('inventory with no proposed changes keeps exact cited inspection without an accept intent', async () => {
  const wire = fixture(); wire.view.fields = []; wire.view.candidates = []; wire.selections = {};
  wire.view.sources[0].excerpt = 'Generated record A reports Blue; current physical location unknown.';
  wire.view.sources.push({ ...wire.view.sources[0], key: 'e2', label: 'Generated record B', recordVersion: 'record-2',
    sourceDate: '2029-01-01', retrievedAt: '2030-04-01T12:00:00Z',
    excerpt: 'Generated record B reports Amber; same physical identity is unknown.' });
  wire.inspections.e2 = { inputRef: 'record2', version: 'record-2', evidenceRef: 'e2', location: { kind: 'page', page: 2, pageCount: 3 } };
  wire.view.uncertainty = ['No field or duplicate suggestion; inspect both records.'];
  const s = setup(wire), c = s.session.controller;
  assert.equal(c.getSnapshot().view.sources.length, 2);
  assert.equal(c.getSnapshot().view.sources[1].excerpt, wire.view.sources[1].excerpt);
  assert.deepEqual(c.getSnapshot().candidateKeys, []);
  assert.deepEqual(c.getSnapshot().fields, []);
  await c.inspectSource('e1'); await c.inspectSource('e2');
  assert.deepEqual(s.inspected.map(x => [x.binding.inputRef, x.binding.version, x.binding.evidenceRef]),
    [['doc1', 'record-1', 'e1'], ['record2', 'record-2', 'e2']]);
  await c.decide('accept-for-review');
  assert.equal(s.intents.length, 0);
  assert.equal(c.selectCandidate('invented-room', true), false);
  s.session.dispose();
});
test('product match with unknown physical identity retains exact binding and one-use review intent', async () => {
  const wire = fixture();
  wire.view.candidates[0].relation = 'same-product-identity-unknown';
  const s = setup(wire);
  const view = s.session.controller.getSnapshot();
  assert.equal(view.view.candidates[0].relation, 'same-product-identity-unknown');
  assert.deepEqual(view.candidateKeys, []);
  assert.equal(s.intents.length, 0);
  s.session.controller.selectCandidate('duplicate:item2', true);
  await s.session.controller.decide('accept-for-review');
  await s.session.controller.decide('accept-for-review');
  assert.equal(s.intents.length, 1);
  assert.equal(s.intents[0].intent.authority, 'none');
  assert.deepEqual(s.intents[0].intent.candidateKeys, ['duplicate:item2']);
  assert.deepEqual(s.intents[0].selections, { 'duplicate:item2': { kind: 'inventory-duplicate', inputRef: 'item2' } });
  s.session.dispose();
  const bad = fixture(); bad.view.candidates[0].relation = 'same-product-authorized-merge';
  assert.throws(() => setup(bad));
  const unbound = fixture(); unbound.view.candidates[0].relation = 'same-product-identity-unknown';
  unbound.selections['duplicate:item2'].inputRef = 'different-item';
  assert.throws(() => setup(unbound));
});
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

function answerFixture() {
  const wire = fixture('document');
  wire.view.kind = 'answer'; wire.view.fields = []; wire.view.candidates = []; wire.selections = {};
  wire.view.sources.push({ ...wire.view.sources[0], key: 'e2', label: 'Generated ranked record', page: null });
  wire.inspections.e2 = { inputRef: 'item2', version: 'record-1', evidenceRef: 'e2', location: { kind: 'record' } };
  wire.view.answer = { route: 'documents', coverage: 'partial',
    rankedCandidates: [{ key: 'rank:item2', label: 'item2 · record-1' }, { key: 'rank:doc1', label: 'doc1 · record-1' }],
    statements: [{ key: 'answer:0', text: 'Generated documentary association only.', reason: 'Review exact generated evidence', uncertainty: 'Ambiguous', evidenceKeys: ['e1', 'e2'] }],
    missingEvidence: ['Actual physical correspondence unknown'] };
  wire.rankings = { 'rank:item2': { inputRef: 'item2', version: 'record-1', rankIndex: 0 },
    'rank:doc1': { inputRef: 'doc1', version: 'record-1', rankIndex: 1 } };
  return wire;
}
function sourceFreeAnswerFixture() {
  const wire = answerFixture();
  wire.view.sources = []; wire.inspections = {}; wire.rankings = {};
  wire.view.answer = { route: 'clarify', coverage: 'no-answer', rankedCandidates: [], statements: [],
    missingEvidence: ['Generated retrieval coverage is missing; this does not mean no parts exist.'] };
  return wire;
}
test('source-free clarify and unknown keep empty bindings and cannot inspect or deliver intent', async () => {
  for (const route of ['clarify', 'unknown']) {
    const wire = sourceFreeAnswerFixture(); wire.view.answer.route = route;
    const s = setup(wire), c = s.session.controller;
    assert.deepEqual(c.getSnapshot().view.sources, []);
    assert.deepEqual(c.getSnapshot().view.answer.rankedCandidates, []);
    assert.deepEqual(c.getSnapshot().view.answer.statements, []);
    assert.deepEqual(c.getSnapshot().view.answer.missingEvidence, wire.view.answer.missingEvidence);
    assert.equal(c.selectCandidate('invented', true), false);
    assert.equal(c.editField('invented', 'no effect'), false);
    await c.inspectSource('invented'); await c.decide('accept-for-review'); await c.decide('reject');
    assert.equal(s.inspected.length, 0); assert.equal(s.intents.length, 0);
    c.dismiss(); assert.equal(c.getSnapshot().view, null); s.session.dispose();
  }
});
test('source-free strict decoder and supplied question replacement refuse late or factual disclosure', () => {
  for (const mutate of [
    w => { w.view.answer.route = 'inventory'; },
    w => { w.view.answer.coverage = 'partial'; },
    w => { w.view.answer.missingEvidence = []; },
    w => { w.view.answer.statements = [{ key: 'a', text: 'Invented fact', reason: 'No source', uncertainty: 'Unknown', evidenceKeys: [] }]; },
    w => { w.view.answer.rankedCandidates = [{ key: 'rank:item2', label: 'item2 · record-1' }];
      w.rankings = { 'rank:item2': { inputRef: 'item2', version: 'record-1', rankIndex: 0 } }; },
    w => { w.inspections.invented = { inputRef: 'item2', version: 'record-1', evidenceRef: null, location: null }; },
    w => { w.selections.invented = { kind: 'inventory-duplicate', inputRef: 'item2' }; },
    w => { w.view.findings = []; },
  ]) { const wire = sourceFreeAnswerFixture(); mutate(wire); assert.throws(() => setup(wire)); }
  for (const newGeneration of [false, true]) {
    const wireA = sourceFreeAnswerFixture(), s = setup(wireA);
    const currentB = { context: newGeneration ? {} : s.context, proposalRevision: 'd'.repeat(64),
      sourceSetRevision: 'c'.repeat(64), availability: 'ready' };
    s.change(currentB);
    assert.equal(s.session.controller.getSnapshot().view, null);
    assert.throws(() => createSuggestionReviewSession(JSON.stringify(wireA), s.context, s.owner));
    const wireB = sourceFreeAnswerFixture(); wireB.contextPin = currentB.sourceSetRevision;
    wireB.view.sourceSetRevision = currentB.sourceSetRevision; wireB.view.revision = currentB.proposalRevision;
    wireB.view.key = 'review:' + currentB.proposalRevision;
    const next = createSuggestionReviewSession(JSON.stringify(wireB), currentB.context, s.owner);
    assert.deepEqual(next.controller.getSnapshot().view.sources, []);
    assert.equal(s.intents.length, 0); next.dispose(); s.session.dispose();
  }
  // These are supplied pins and fake owner generations, never authenticated
  // request capture, cancellation or host/session integration qualification.
});
test('answer session binds exact ordered ranks and citations without any intent delivery', async () => {
  const s = setup(answerFixture()), c = s.session.controller; let checks = 0;
  s.owner.recheck = async () => { checks++; return 'current'; };
  assert.deepEqual(c.getSnapshot().view.answer.rankedCandidates.map(v => v.key), ['rank:item2', 'rank:doc1']);
  assert.equal(c.selectField('document-class', true), false);
  assert.equal(c.editField('document-class', 'invoice'), false);
  assert.equal(c.selectCandidate('rank:item2', true), false);
  assert.equal(c.selectMaintenanceTask('task-1', true), false);
  assert.equal(c.editMaintenanceTask('task-1', { title: 'No edit' }), false);
  await c.decide('accept-for-review'); await c.decide('reject');
  assert.equal(checks, 0); assert.equal(s.intents.length, 0);
  await c.inspectSource('e1');
  assert.equal(s.inspected[0].binding.inputRef, 'doc1');
  assert.equal(s.inspected[0].binding.version, 'record-1');
  assert.deepEqual(s.inspected[0].binding.location, { kind: 'page', page: 2, pageCount: 3 });
  c.dismiss(); assert.equal(c.getSnapshot().view, null); assert.equal(s.intents.length, 0); s.session.dispose();
});
test('answer no-answer clarify and unknown sessions retain gaps without invented sources', async () => {
  for (const route of ['clarify', 'unknown']) {
    const wire = answerFixture(); wire.view.answer = { route, coverage: 'no-answer', rankedCandidates: [], statements: [], missingEvidence: ['Generated retrieval is incomplete'] };
    wire.rankings = {};
    wire.view.sources = [{ ...wire.view.sources[0], key: 'subject:doc1', original: 'unavailable', page: null, excerpt: '' }];
    wire.inspections = { 'subject:doc1': { inputRef: 'doc1', version: 'record-1', evidenceRef: null, location: null } };
    const s = setup(wire), c = s.session.controller;
    assert.deepEqual(c.getSnapshot().view.answer.missingEvidence, ['Generated retrieval is incomplete']);
    await c.inspectSource('subject:doc1'); await c.decide('reject');
    assert.equal(s.inspected.length, 0); assert.equal(s.intents.length, 0); s.session.dispose();
  }
});
test('answer decoder refuses reordered ranks invented citations and authority fields', () => {
  for (const mutate of [
    w => { w.view.answer.rankedCandidates.reverse(); },
    w => { w.rankings['rank:item2'].inputRef = 'other'; },
    w => { w.rankings['rank:item2'].version = 'record-2'; },
    w => { w.rankings['rank:item2'].url = 'https://generated.invalid'; },
    w => { w.view.answer.statements[0].evidenceKeys = ['not-admitted']; },
    w => { w.view.answer.statements[0].key = 'answer:1'; },
    w => { w.selections.write = { kind: 'native-write', inputRef: 'item2' }; },
    w => { w.view.answer.coverage = 'exhaustive'; },
    w => { w.view.answer.route = 'unknown'; },
    w => { w.view.answer.approval = 'invented'; },
  ]) { const wire = answerFixture(); mutate(wire); assert.throws(() => setup(wire)); }
});
test('answer offline disabled and superseded sessions cannot inspect or deliver', async () => {
  for (const availability of ['offline', 'disabled']) {
    const s = setup(answerFixture()), c = s.session.controller;
    s.change({ context: s.context, proposalRevision: revision, sourceSetRevision: pin, availability });
    await c.inspectSource('e1'); await c.decide('accept-for-review');
    assert.equal(s.inspected.length, 0); assert.equal(s.intents.length, 0);
    c.dismiss(); assert.equal(c.getSnapshot().view, null); s.session.dispose();
  }
  const s = setup(answerFixture());
  s.change({ context: {}, proposalRevision: revision, sourceSetRevision: pin, availability: 'ready' });
  assert.equal(s.session.controller.getSnapshot().view, null);
  await s.session.controller.inspectSource('e1'); assert.equal(s.inspected.length, 0); s.session.dispose();
});

function comparisonFixture() {
  const wire = answerFixture(); wire.view.kind = 'contradictions'; delete wire.view.answer; delete wire.rankings;
  wire.view.sources[0].sourceDate = '2020-01-01';
  const finding = 'c'.repeat(64), key = 'finding:' + finding;
  wire.view.contradictions = { findings: [{ key, pattern: 'incompatible-location',
    assertions: [{ key: 'c1', inputKey: 'doc1', text: 'Generated earlier location assertion', uncertainty: 'tentative', factDate: null, evidenceKeys: ['e1'] },
      { key: 'c2', inputKey: 'item2', text: 'Generated conflicting assertion; fact time unknown', uncertainty: 'unknown', factDate: null, evidenceKeys: ['e2'] }],
    rationale: 'Potential contradiction requires original-owner review, not a winner', uncertainty: 'ambiguous' }], missingEvidence: ['Fact dates and current physical location unknown'] };
  wire.comparisons = { [key]: { findingKey: finding, findingIndex: 0, assertions: {
    c1: { inputRef: 'doc1', version: 'record-1', evidenceRefs: ['e1'] }, c2: { inputRef: 'item2', version: 'record-1', evidenceRefs: ['e2'] },
  } } };
  return wire;
}
test('comparison session binds finding claim input and evidence without fact-date inference or intent', async () => {
  const s = setup(comparisonFixture()), c = s.session.controller; let checks = 0;
  s.owner.recheck = async () => { checks++; return 'current'; };
  const view = c.getSnapshot().view;
  assert.equal(view.sources[0].sourceDate, '2020-01-01');
  assert.deepEqual(view.contradictions.findings[0].assertions.map(v => v.factDate), [null, null]);
  assert.equal(c.selectField('category', true), false); assert.equal(c.editField('category', 'winner'), false);
  assert.equal(c.selectCandidate('c1', true), false); assert.equal(c.selectMaintenanceTask('c1', true), false);
  assert.equal(c.editMaintenanceTask('c1', { title: 'No correction' }), false);
  await c.decide('accept-for-review'); await c.decide('reject');
  assert.equal(checks, 0); assert.equal(s.intents.length, 0);
  await c.inspectSource('e1');
  assert.equal(s.inspected[0].binding.inputRef, 'doc1'); assert.equal(s.inspected[0].binding.version, 'record-1');
  assert.deepEqual(s.inspected[0].binding.location, { kind: 'page', page: 2, pageCount: 3 });
  c.dismiss(); assert.equal(c.getSnapshot().view, null); assert.equal(s.intents.length, 0); s.session.dispose();
});
test('comparison decoder refuses cross-input citations invented fact dates and winner authority', () => {
  for (const mutate of [
    w => { w.view.contradictions.findings[0].assertions[0].inputKey = 'other'; },
    w => { w.comparisons[Object.keys(w.comparisons)[0]].assertions.c1.version = 'record-2'; },
    w => { const f = w.view.contradictions.findings[0]; f.assertions[0].evidenceKeys = ['e2']; w.comparisons[f.key].assertions.c1.evidenceRefs = ['e2']; },
    w => { w.view.contradictions.findings[0].assertions[0].factDate = '2020-01-01'; },
    w => { w.comparisons[Object.keys(w.comparisons)[0]].findingIndex = 1; },
    w => { w.comparisons[Object.keys(w.comparisons)[0]].findingKey = 'd'.repeat(64); },
    w => { w.view.contradictions.findings[0].winner = 'c1'; },
    w => { w.selections.c1 = { kind: 'correct-record', inputRef: 'doc1' }; },
    w => { w.comparisons[Object.keys(w.comparisons)[0]].assertions.c1.approval = 'invented'; },
  ]) { const wire = comparisonFixture(); mutate(wire); assert.throws(() => setup(wire)); }
});
test('empty comparison retains gaps without agreement persistence or review intent', async () => {
  const wire = comparisonFixture(); wire.view.contradictions.findings = []; wire.comparisons = {};
  const s = setup(wire), c = s.session.controller;
  assert.deepEqual(c.getSnapshot().view.contradictions.missingEvidence, ['Fact dates and current physical location unknown']);
  await c.decide('reject'); assert.equal(s.intents.length, 0); c.dismiss(); s.session.dispose();
});
test('comparison currentness cancels late inspection and offline states cannot deliver', async () => {
  for (const availability of ['offline', 'disabled']) {
    const s = setup(comparisonFixture()), c = s.session.controller;
    s.change({ context: s.context, proposalRevision: revision, sourceSetRevision: pin, availability });
    await c.inspectSource('e1'); await c.decide('accept-for-review');
    assert.equal(s.inspected.length, 0); assert.equal(s.intents.length, 0); c.dismiss(); s.session.dispose();
  }
  const s = setup(comparisonFixture()), c = s.session.controller; let finish, signal;
  s.owner.inspect = async (_identity, _binding, abort) => { signal = abort; await new Promise(resolve => { finish = resolve; }); };
  const pending = c.inspectSource('e1');
  s.change({ context: {}, proposalRevision: revision, sourceSetRevision: pin, availability: 'ready' });
  assert.equal(signal.aborted, true); finish(); await pending;
  assert.equal(c.getSnapshot().view, null); assert.equal(s.intents.length, 0); s.session.dispose();
});
