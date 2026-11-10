// Generated in-memory owners only. No native service, credentials or navigation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
assert.equal(process.version, 'v26.10.0');
const moduleUrl = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const load = path => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'), { mode: 'strip' });
const model = moduleUrl(load('../src/app/model.ts'));
const source = load('../src/ai/suggestion-adapter/native-handoff.ts');
const code = source.replace("'../../app/model'", JSON.stringify(model));
assert.notEqual(code, source);
const { createNativeHandoff } = await import(moduleUrl(code));
const scope = { workspaceId: 'fictional-workspace', homeId: 'fictional-home' };
const key = { sourceInstanceId: 'generated-source', collectionId: 'generated-collection', sourceKind: 'homebox-entity', externalId: 'generated-item' };
const nativeHref = 'https://inventory.example.invalid/item/generated-item/edit';
function fixture() {
  const context = {}, listeners = new Set();
  const entry = { ...scope, key: JSON.stringify(Object.values(key)), source: { ...key },
    sourceState: 'present', cacheStatus: 'fresh', entity: { id: key.externalId, archived: false },
    nativeLinks: [{ kind: 'homebox-native', intent: 'edit', verifiedRoute: true,
      entity: { ...scope, key: { ...key } }, href: nativeHref }] };
  const view = { context, key: 'review:revision', revision: 'revision', sourceSetRevision: 'sources', kind: 'inventory',
    fields: [{ key: 'category', label: 'Category', proposed: 'Unedited', current: null }], candidates: [] };
  const fields = [{ key: 'category', value: 'Edited\ncategory\tlabel', edited: true }];
  const intent = { kind: 'suggestion-review-intent', authority: 'none', intentId: 'generated-intent', context,
    proposalKey: view.key, proposalRevision: view.revision, sourceSetRevision: view.sourceSetRevision,
    action: 'accept-for-review', fields, candidateKeys: [] };
  const snapshot = { phase: 'sent', view, fields: fields.map(f => ({ ...f, selected: true })), candidateKeys: [], maintenance: [] };
  const selections = { category: { kind: 'inventory-category', inputRef: 'subject1' } };
  let current = { ...scope, context, accountKey: 'generated-account', proposalRevision: 'revision', sourceSetRevision: 'sources',
    availability: 'ready', canEdit: true, inputs: [{ inputRef: 'subject1', version: 'exact-v1', entry }] };
  let check = async () => 'current';
  const checks = [];
  const owner = { current: () => current, subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    recheck(pins, signal) { checks.push({ pins, signal }); return check(pins, signal); } };
  return { entry, intent, snapshot, selections, owner, checks,
    current: () => current, change(next) { current = next; for (const cb of [...listeners]) cb(); },
    check(fn) { check = fn; }, create() { return createNativeHandoff(intent, selections, snapshot, owner); } };
}
test('manual review keeps exact selected edits with only the owned verified link', async () => {
  const f = fixture();
  f.intent.url = 'https://evil.example.invalid/redirect';
  f.snapshot.view.fields[0].proposed = 'https://evil.example.invalid/model-url';
  const h = f.create();
  assert.equal(h.getSnapshot().phase, 'checking');
  assert.deepEqual(h.getSnapshot().rows, []);
  await h.ready;
  const state = h.getSnapshot();
  assert.equal(state.phase, 'ready');
  assert.equal(state.rows[0].href, nativeHref);
  assert.equal(state.rows[0].value, f.intent.fields[0].value);
  assert.equal(state.rows[0].edited, true);
  assert.equal(f.intent.authority, 'none');
  assert.equal(h.canNavigate('category', nativeHref), true);
  assert.equal(h.canNavigate('category', f.intent.url), false);
  assert.equal(f.checks.length, 1);
  assert.equal(f.checks[0].pins[0].version, 'exact-v1');
  assert.equal(Object.hasOwn(h, 'execute'), false);
  h.dispose();
});
test('missing stale or malicious native links and disabled/offline never expose usable rows', async () => {
  const mutations = [
    f => { f.entry.nativeLinks = []; },
    f => { f.entry.cacheStatus = 'stale'; },
    f => { f.entry.sourceState = 'confirmed-deleted'; },
    f => { f.entry.entity.archived = true; },
    f => { f.entry.nativeLinks[0].verifiedRoute = false; },
    f => { f.entry.nativeLinks[0].entity.homeId = 'wrong-home'; },
    f => { f.entry.nativeLinks[0].entity.key.externalId = 'wrong-target'; },
    f => { f.current().availability = 'offline'; },
    f => { f.current().availability = 'disabled'; },
    f => { f.current().canEdit = false; },
    f => { f.entry.homeId = 'wrong-home'; },
    f => { f.entry.entity.id = 'wrong-target'; },
    ...['javascript:alert(1)', '//evil.example.invalid', 'https://user:pass@inventory.example.invalid/edit',
      nativeHref + '?next=https://evil.example.invalid', nativeHref + '#prefill'].map(href => f => { f.entry.nativeLinks[0].href = href; }),
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f); const h = f.create(); await h.ready;
    assert.equal(h.getSnapshot().phase, 'unavailable');
    assert.deepEqual(h.getSnapshot().rows, []);
    assert.equal(h.canNavigate('category', nativeHref), false); h.dispose();
  }
});
test('account scope proposal target and version replacement clear ready handoffs synchronously', async () => {
  for (const replace of [
    c => ({ ...c, accountKey: 'other-account' }), c => ({ ...c, homeId: 'other-home' }),
    c => ({ ...c, workspaceId: 'other-workspace' }), c => ({ ...c, proposalRevision: 'new' }),
    c => ({ ...c, sourceSetRevision: 'new' }), c => ({ ...c, context: {} }),
    c => ({ ...c, inputs: [{ ...c.inputs[0], version: 'exact-v2' }] }),
    c => ({ ...c, inputs: [] }), c => ({ ...c, inputs: [...c.inputs, ...c.inputs] }),
    c => ({ ...c, inputs: [{ ...c.inputs[0], entry: { ...c.inputs[0].entry, source: { ...key, externalId: 'other' } } }] }),
    c => ({ ...c, availability: 'offline' }), () => null,
  ]) {
    const f = fixture(), h = f.create(); await h.ready;
    f.change(replace(f.current()));
    assert.deepEqual(h.getSnapshot().rows, []);
    assert.equal(h.canNavigate('category', nativeHref), false); h.dispose();
  }
});
test('retirement and ABA replacement during recheck cannot revive stale links', async () => {
  for (const mode of ['dispose', 'aba', 'retire', 'offline', 'version']) {
    const f = fixture(); let finish;
    f.check(() => new Promise(resolve => { finish = resolve; }));
    const h = f.create(), before = f.current();
    if (mode === 'dispose') h.dispose();
    else if (mode === 'aba') { f.change({ ...before, context: {} }); f.change(before); }
    else if (mode === 'retire') f.change(null);
    else if (mode === 'offline') f.change({ ...before, availability: 'offline' });
    else f.change({ ...before, inputs: [{ ...before.inputs[0], version: 'exact-v2' }] });
    finish('current'); await h.ready;
    assert.deepEqual(h.getSnapshot().rows, []);
    assert.equal(f.checks[0].signal.aborted, true); h.dispose();
  }
});
test('silent source changes and changed rendered href are refused on activation', async () => {
  const f = fixture(), h = f.create(); await h.ready;
  f.entry.nativeLinks[0].href = 'https://inventory.example.invalid/item/other/edit';
  assert.equal(h.canNavigate('category', nativeHref), false);
  assert.deepEqual(h.getSnapshot().rows, []); h.dispose();
});
test('recheck refusal and thrown errors are unavailable without replay', async () => {
  for (const outcome of ['stale', 'unavailable', 'throw']) {
    const f = fixture(); f.check(async () => { if (outcome === 'throw') throw new Error('Generated'); return outcome; });
    const h = f.create(); await h.ready;
    assert.equal(h.getSnapshot().phase, 'unavailable');
    assert.equal(h.canNavigate('category', nativeHref), false);
    assert.equal(f.checks.length, 1); h.dispose();
  }
});
test('reject unselected edits and changed bindings do not become manual handoffs', () => {
  for (const mutate of [
    f => { f.intent.action = 'reject'; }, f => { f.intent.authority = 'write'; },
    f => { f.snapshot.fields[0].selected = false; }, f => { f.intent.fields[0].value = 'different'; },
    f => { f.selections.category.kind = 'document-link'; },
    f => { f.selections.extra = f.selections.category; }, f => { f.snapshot.phase = 'closed'; },
  ]) { const f = fixture(); mutate(f); assert.throws(() => f.create()); }
});
test('maintenance intervals remain manual review text with unknown due date', async () => {
  const f = fixture(), target = 'subject1', taskKey = 'maintenance:0:' + target;
  f.snapshot.view.kind = 'maintenance'; f.snapshot.view.fields = [];
  f.snapshot.view.maintenance = [{ key: taskKey, targetKey: target, targetLabel: 'Generated filter', baselineDate: null }];
  f.snapshot.fields = []; f.intent.fields = [];
  const interval = { kind: 'periodic', every: 3, unit: 'months' };
  f.intent.maintenance = [{ key: taskKey, targetKey: target, title: 'Edited filter check', interval,
    conditions: ['Inspect first'], urgency: 'unknown', editedFields: ['title', 'interval'] }];
  f.snapshot.maintenance = [{ ...f.intent.maintenance[0], interval: { ...interval, every: '3' }, selected: true, valid: true }];
  f.entry.nativeLinks[0].intent = 'maintenance';
  f.selections = { [taskKey]: { kind: 'maintenance-task', inputRef: target, taskIndex: 0 } };
  const h = createNativeHandoff(f.intent, f.selections, f.snapshot, f.owner); await h.ready;
  const value = JSON.parse(h.getSnapshot().rows[0].value);
  assert.deepEqual(value.interval, interval); assert.equal(value.baselineDate, null); assert.equal(value.dueDate, null);
  h.dispose();
});
