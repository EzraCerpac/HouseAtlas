// Source-only proposals until independent lane review + exact README release.
// Every case uses synthetic Files, an in-memory store, fake ports, no listener.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from '../node_modules/ajv/dist/2020.js';
import addFormats from '../node_modules/ajv-formats/dist/index.js';
import { createCaptureDraftAdapter } from '../integration/capture-drafts-adapter.ts';
import { draftReceipt, identityGuard, identityId } from './receipt.fixture.mjs';

const args = process.argv.slice(2);
assert.equal(args.length, 2); assert.equal(args[0], '--case');
const cases = new Set(['healthy-save-review-commit', 'healthy-canonical-published-binding', 'pending-canonical-late-context',
  'home-change-denies-reviewed-submit', 'target-change-denies-submit', 'malformed-receipt-keeps-original',
  'noncommitted-receipt-keeps-original', 'lost-fake-reply-inspect-only', 'cleanup-failure-known-commit',
  'explicit-clear-before-signout', 'cross-tab-invalidation-signal', 'unavailable-probe-explicit-recheck', 'wrong-correlation-keeps-original',
  'reused-receipt-object-keeps-unknown', 'receipt-record-closure-keeps-original', 'existing-original-receipt-commit']);
assert(cases.has(args[1]), 'Only an exact named case is allowed');
const realFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Network is prohibited in combined fake-port cases'); };
const workspaceId = '11111111-1111-4111-8111-111111111111', homeId = '22222222-2222-4222-8222-222222222222';
const recordId = '33333333-3333-4333-8333-333333333333', localId = '44444444-4444-4444-8444-444444444444';
const scope = { workspaceId, homeId };
const source = { ...scope, key: { sourceInstanceId: '55555555-5555-4555-8555-555555555555', collectionId: 'synthetic-collection', sourceKind: 'homebox-entity', externalId: 'synthetic-room' } };
const license = { status: 'unknown', reference: null };
const form = { statement: 'Synthetic capture statement', sourceLicense: license, reason: 'Synthetic combined fixture' };
const original = new File([readFileSync(new URL('../capture-evidence-tests/fixtures/synthetic-photo.jpg', import.meta.url))], 'synthetic-photo.jpg', { type: 'image/jpeg', lastModified: 42 });
const selection = { original, file: original, capture: { schemaVersion: 1, selectionMethod: 'photo-picker', selectedAt: '2026-10-10T12:00:00.000Z', filename: original.name, reportedContentType: original.type, byteOrigin: 'browser-returned-unmodified' } };
const validator = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true }); addFormats(validator);
const atlas = JSON.parse(readFileSync(new URL('../../packages/contracts/schemas/atlas.schema.json', import.meta.url)));
const agent = JSON.parse(readFileSync(new URL('../../contracts/stock-wire3/agent/agent.schema.json', import.meta.url)));
validator.addSchema(atlas); validator.addSchema(agent);
const schemas = { validate(reference, value) {
  const check = validator.getSchema(reference.startsWith('#') ? agent.$id + reference : reference);
  if (!check || !check(value)) throw new TypeError('Closed actual schema rejected synthetic receipt');
} };
function fixture() {
  let session = { schemaVersion: 1, actorId: 'synthetic-actor', csrfToken: 'synthetic-private-canonical-marker', expiresAt: new Date(Date.now() + 600_000).toISOString() };
  let canonical = { ...session }, generation = 1, readScope = scope, rows = [], failDelete = false;
  let read = async signal => { signal.throwIfAborted(); return { ...canonical }; };
  const calls = { open: 0, canonical: 0, load: 0, upload: 0, recheck: 0, acknowledgementDelete: 0 };
  const order = [];
  const receipt = intent => draftReceipt(intent);
  let upload = async intent => {
    calls.upload++; order.push('upload');
    assert.equal(rows[0].state, 'outcome-unknown'); assert.equal(rows[0].attempt.requestId, intent.requestId);
    assert.equal(rows[0].attempt.idempotencyKey, intent.idempotencyKey);
    assert(Object.isFrozen(intent)); assert.equal(intent.expectedRevision, 7); assert.deepEqual(intent.capture, selection.capture);
    assert.deepEqual(new Uint8Array(await intent.file.arrayBuffer()), new Uint8Array(await original.arrayBuffer()));
    return receipt(intent);
  };
  const store = {
    read: async () => structuredClone(rows),
    async change(edit) {
      const next = edit(structuredClone(rows));
      if (rows.length && !next.rows.length) {
        calls.acknowledgementDelete++; order.push('delete');
        if (failDelete) throw new Error('Synthetic local delete failure');
      }
      if (next.rows[0]?.state === 'outcome-unknown') order.push('unknown-marker');
      rows = structuredClone(next.rows); return next.value;
    }, close() {},
  };
  const adapter = createCaptureDraftAdapter({
    getSession: () => session, getGeneration: () => generation, getReadScope: () => readScope,
    readSession: async signal => { calls.canonical++; order.push('canonical'); return read(signal); },
    foreground: () => true, recheckSession: () => { calls.recheck++; }, schemas,
    openStore: () => { calls.open++; return store; },
    editing: { replacePlace: async () => { throw new Error('Not part of this capture case'); },
      loadPlace: async (target, signal) => { signal.throwIfAborted(); calls.load++; order.push('load'); assert.deepEqual(target, source);
        return { record: { recordId, ...scope, lifecycle: 'active', revision: 7, payload: { atlasId: identityId } },
          guards: [structuredClone(identityGuard)], canReplaceClassification: false,
          attachmentPolicy: { contentTypes: ['image/jpeg'], maximumBytes: 10 * 1024 * 1024, licenses: [{ label: 'Unknown', value: license }] } }; },
      uploadPlaceEvidence: (intent, signal) => { signal.throwIfAborted(); return upload(intent); } },
  });
  adapter.observeCanonical(session); adapter.setScope(scope);
  const signal = new AbortController().signal;
  return { adapter, calls, order, signal, receipt,
    rows: () => rows, session: () => session, canonical: () => canonical,
    read: value => { read = value; }, upload: value => { upload = value; }, failDelete: () => { failDelete = true; },
    rootChange: () => { generation++; session = { ...session }; },
    normalizeLogin: () => { adapter.invalidateSession(); session = { ...canonical }; adapter.observeCanonical(session); adapter.setScope(scope); },
    changeHome: () => { readScope = { ...scope, homeId: '77777777-7777-4777-8777-777777777777' }; adapter.setScope(readScope); },
    save: () => adapter.port.save({ localId, selection, form, targetSourceRef: source, recordId, optedIn: true }),
    review: () => adapter.port.review(localId, signal),
  };
}
try {
  const f = fixture(), port = f.adapter.port, caseName = args[1];
  if (caseName === 'healthy-save-review-commit') {
    assert.equal(f.calls.open, 0, 'No storage before opt-in'); const session = f.session(), epoch = port.current().sessionEpoch;
    await f.save(); const review = await f.review();
    assert.equal(port.current().sessionEpoch, epoch); assert.equal(f.session(), session, 'Existing host binding object is unchanged');
    assert.deepEqual(review.form, form); assert.equal(f.calls.upload, 0);
    const done = await port.submit(review, source, recordId, f.signal);
    assert.equal(done.localCleanup, 'removed'); assert.equal(f.calls.upload, 1); assert.equal(f.calls.canonical, 2); assert.equal(f.calls.load, 2);
    assert.deepEqual(f.rows(), []); assert(f.order.indexOf('unknown-marker') < f.order.indexOf('upload')); assert(f.order.indexOf('upload') < f.order.indexOf('delete'));
  } else if (caseName === 'healthy-canonical-published-binding') {
    f.normalizeLogin(); const session = f.session(); await port.prepare(f.signal);
    const epoch = port.current().sessionEpoch; assert.equal(f.session(), session);
    await f.save(); await f.review(); assert.equal(port.current().sessionEpoch, epoch); assert.equal(f.calls.upload, 0);
  } else if (caseName === 'pending-canonical-late-context') {
    let resolve; f.read(() => new Promise(r => { resolve = r; }));
    const pending = port.prepare(f.signal); assert.equal(port.current(), null);
    f.rootChange(); resolve(f.canonical()); await assert.rejects(pending); assert.equal(port.current(), null); assert.equal(f.calls.upload, 0);
  } else if (caseName === 'unavailable-probe-explicit-recheck') {
    const session = f.session(), previousEpoch = port.current().sessionEpoch;
    f.read(async () => { throw new Error('Synthetic read unavailable'); });
    await assert.rejects(port.prepare(f.signal)); assert.equal(port.current(), null); assert.equal(f.calls.recheck, 0);
    f.read(async () => ({ ...f.canonical() })); await port.prepare(f.signal);
    assert(port.current()); assert.notEqual(port.current().sessionEpoch, previousEpoch); assert.equal(f.session(), session);
    assert.equal(f.calls.open, 0); assert.equal(f.calls.upload, 0);
  } else if (caseName === 'home-change-denies-reviewed-submit') {
    await f.save(); const review = await f.review(); f.changeHome();
    await assert.rejects(port.submit(review, source, recordId, f.signal)); assert.equal(f.calls.upload, 0); assert.equal(f.rows()[0].state, 'unsent');
  } else if (caseName === 'target-change-denies-submit') {
    await f.save(); const review = await f.review();
    await assert.rejects(port.submit(review, { ...source, key: { ...source.key, externalId: 'other-synthetic-room' } }, recordId, f.signal));
    assert.equal(f.calls.upload, 0); assert.equal(f.rows()[0].state, 'unsent');
  } else if (caseName === 'wrong-correlation-keeps-original') {
    await f.save(); const review = await f.review();
    f.upload(async intent => ({ ...await f.receipt(intent), requestId: '88888888-8888-4888-8888-888888888888' }));
    await assert.rejects(port.submit(review, source, recordId, f.signal)); assert.equal(f.rows()[0].state, 'outcome-unknown');
    assert.equal(f.calls.acknowledgementDelete, 0);
  } else if (caseName === 'malformed-receipt-keeps-original' || caseName === 'noncommitted-receipt-keeps-original') {
    await f.save(); const review = await f.review();
    f.upload(async intent => ({ ...await f.receipt(intent), ...(caseName.startsWith('malformed') ? { unexpected: true } : { status: 'denied' }) }));
    await assert.rejects(port.submit(review, source, recordId, f.signal)); assert.equal(f.rows()[0].state, 'outcome-unknown');
    assert.equal(f.calls.acknowledgementDelete, 0);
  } else if (caseName === 'lost-fake-reply-inspect-only') {
    await f.save(); const review = await f.review(); let invoked = 0;
    f.upload(async () => { invoked++; throw new Error('Synthetic reply unavailable; no actual transport'); });
    await assert.rejects(port.submit(review, source, recordId, f.signal));
    const ids = structuredClone(f.rows()[0].attempt); const inspection = await port.inspectUnknown(localId, f.signal);
    assert.equal(inspection.retrySafety, 'not-established'); assert.deepEqual(inspection.attempt, ids);
    await assert.rejects(f.review()); assert.equal(invoked, 1); assert.equal(f.rows()[0].state, 'outcome-unknown');
  } else if (caseName === 'cleanup-failure-known-commit') {
    await f.save(); const review = await f.review(); f.failDelete();
    const done = await port.submit(review, source, recordId, f.signal);
    assert.equal(done.result.status, 'committed'); assert.equal(done.localCleanup, 'unconfirmed'); assert.equal(f.rows()[0].state, 'outcome-unknown');
    await assert.rejects(f.review()); assert.equal(f.calls.upload, 1);
  } else if (caseName === 'existing-original-receipt-commit') {
    f.upload(async intent => {
      f.calls.upload++;
      assert.equal(f.rows()[0].state, 'outcome-unknown');
      return draftReceipt(intent, { existingAsset: true });
    });
    await f.save();
    const completion = await port.submit(await f.review(), source, recordId, f.signal);
    assert.equal(completion.result.data.records.length, 2);
    assert.equal(completion.localCleanup, 'removed');
    assert.equal(f.calls.upload, 1); assert.equal(f.calls.acknowledgementDelete, 1);
    assert.deepEqual(f.rows(), []);
  } else if (caseName === 'receipt-record-closure-keeps-original') {
    const ofType = (receipt, type) => receipt.data.records.find(row => row.target.recordType === type);
    const otherId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const mutations = [
      ['empty receipt', receipt => { receipt.data.records = []; receipt.data.auditIds = []; }],
      ['missing identity', receipt => { receipt.data.records = receipt.data.records.filter(row => row.target.recordType !== 'identity'); receipt.data.auditIds.pop(); }],
      ['wrong identity', receipt => { ofType(receipt, 'identity').target.recordId = otherId; }],
      ['wrong identity revision', receipt => { ofType(receipt, 'identity').revision--; }],
      ['wrong identity kind', receipt => { ofType(receipt, 'identity').payload.kind = 'item'; }],
      ['missing evidence link', receipt => { ofType(receipt, 'identity').payload.evidenceIds = []; }],
      ['different statement', receipt => { ofType(receipt, 'evidence').payload.statement = 'Other synthetic statement'; }],
      ['superseding evidence', receipt => { ofType(receipt, 'evidence').payload.supersedesEvidenceIds = [otherId]; }],
      ['different asset reference', receipt => { ofType(receipt, 'evidence').payload.references[0].assetId = otherId; }],
      ['different original hash', receipt => { ofType(receipt, 'asset').payload.sha256 = '0'.repeat(64); }],
      ['different original size', receipt => { ofType(receipt, 'asset').payload.byteSize++; }],
      ['different original type', receipt => { ofType(receipt, 'asset').payload.contentType = 'text/plain'; }],
      ['different original license', receipt => { ofType(receipt, 'asset').payload.sourceLicense = { status: 'restricted', reference: 'Synthetic restriction' }; }],
      ['invented fact time', receipt => { ofType(receipt, 'evidence').payload.provenance.factAt = selection.capture.selectedAt; }],
      ['different selection claim', receipt => { ofType(receipt, 'evidence').payload.provenance.vantage = 'Browser selection claim v1: ' + JSON.stringify({ ...selection.capture, selectionMethod: 'camera-request' }); }],
      ['JPEG preview policy', receipt => { ofType(receipt, 'asset').payload.previewPolicy = 'unreviewed'; }],
      ['inactive returned target', receipt => { ofType(receipt, 'identity').lifecycle = 'tombstoned'; }],
      ['incomplete audit list', receipt => { receipt.data.auditIds.pop(); }],
    ];
    for (const [label, mutate] of mutations) {
      const q = fixture();
      q.upload(async intent => {
        q.calls.upload++;
        assert.equal(q.rows()[0].state, 'outcome-unknown');
        const receipt = await draftReceipt(intent); mutate(receipt);
        schemas.validate('#/$defs/result_atlas_batch_execute', receipt);
        return receipt;
      });
      await q.save(); const review = await q.review();
      await assert.rejects(q.adapter.port.submit(review, source, recordId, q.signal), /Local draft receipt/, label);
      assert.equal(q.calls.acknowledgementDelete, 0, label);
      assert.equal(q.rows()[0].state, 'outcome-unknown', label);
      assert.deepEqual(new Uint8Array(await q.rows()[0].original.arrayBuffer()), new Uint8Array(await original.arrayBuffer()), label);
      const inspection = await q.adapter.port.inspectUnknown(localId, q.signal);
      assert.equal(inspection.outcome, 'unknown', label); assert.equal(inspection.retrySafety, 'not-established', label);
      await assert.rejects(q.review(), /outcome is unknown/, label);
      await assert.rejects(q.adapter.port.submit(review, source, recordId, q.signal));
      assert.equal(q.calls.upload, 1, label);
    }
  } else if (caseName === 'reused-receipt-object-keeps-unknown') {
    let firstReceipt;
    const requests = [];
    f.upload(async intent => {
      f.calls.upload++; requests.push(intent.requestId);
      assert.equal(f.rows()[0].state, 'outcome-unknown');
      assert.equal(f.rows()[0].attempt.requestId, intent.requestId);
      firstReceipt ??= await f.receipt(intent);
      return firstReceipt;
    });
    await f.save();
    const first = await port.submit(await f.review(), source, recordId, f.signal);
    assert.equal(first.localCleanup, 'removed');
    assert.deepEqual(f.rows(), []);
    await f.save();
    const secondReview = await f.review();
    await assert.rejects(port.submit(secondReview, source, recordId, f.signal), /differs from the local attempt/);
    assert.equal(f.calls.upload, 2);
    assert.notEqual(requests[0], requests[1]);
    assert.equal(firstReceipt.requestId, requests[0]);
    assert.equal(f.calls.acknowledgementDelete, 1, 'Only the first correlated receipt allowed cleanup');
    assert.equal(f.rows()[0].state, 'outcome-unknown');
    assert.equal(f.rows()[0].attempt.requestId, requests[1]);
    assert.deepEqual(new Uint8Array(await f.rows()[0].original.arrayBuffer()), new Uint8Array(await original.arrayBuffer()));
    const inspection = await port.inspectUnknown(localId, f.signal);
    assert.equal(inspection.outcome, 'unknown');
    assert.equal(inspection.retrySafety, 'not-established');
    await assert.rejects(f.review());
    await assert.rejects(port.submit(secondReview, source, recordId, f.signal));
    assert.equal(f.calls.upload, 2, 'Neither inspection nor the consumed review can dispatch again');
  } else if (caseName === 'explicit-clear-before-signout') {
    await f.save();
    const other = structuredClone(f.rows()[0]); other.id='99999999-9999-4999-8999-999999999999'; other.owner.actorId='synthetic-other-actor';
    f.rows().push(other);await port.clearBeforeSignOut(); assert.equal(f.rows().length,1);assert.equal(f.rows()[0].owner.actorId,'synthetic-other-actor'); assert.equal(f.calls.upload, 0);
    assert.equal(f.session().actorId, 'synthetic-actor', 'Cleanup completes while owner remains authenticated');
  } else if (caseName === 'cross-tab-invalidation-signal') {
    const originalChannel = globalThis.BroadcastChannel; let channel;
    globalThis.BroadcastChannel = class extends EventTarget { constructor() { super(); channel = this; } postMessage(value) { assert.deepEqual(value, { version: 1, type: 'invalidate' }); } close() {} };
    const window = new EventTarget(), document = new EventTarget(); document.visibilityState = 'visible';
    const disconnect = f.adapter.connect(window, document);
    try { await f.save(); const review = await f.review(), operation = port.operation();
      channel.dispatchEvent(new MessageEvent('message', { data: { version: 1, type: 'invalidate' } }));
      assert(operation.controller.signal.aborted); assert.equal(port.current(), null); assert.equal(f.calls.recheck, 1);
      await assert.rejects(port.submit(review, source, recordId, f.signal)); assert.equal(f.calls.upload, 0); assert.equal(f.rows()[0].state, 'unsent');
      f.adapter.announceSessionChange();
    } finally { disconnect(); globalThis.BroadcastChannel = originalChannel; }
  }
  console.log(`PASS ${caseName}: synthetic fake-port evidence only`);
} finally { globalThis.fetch = realFetch; }
