import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createCaptureDrafts } from '../src/capture-drafts/controller.ts';

// This is a deterministic controller/store contract harness, not an IndexedDB
// implementation or evidence about browser persistence behavior.

const actorA = 'synthetic-actor-a';
const actorB = 'synthetic-actor-b';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const homeA = '22222222-2222-4222-8222-222222222222';
const homeB = '33333333-3333-4333-8333-333333333333';
const recordId = '44444444-4444-4444-8444-444444444444';
const sourceRef = {
  workspaceId,
  homeId: homeA,
  key: {
    sourceInstanceId: '55555555-5555-4555-8555-555555555555',
    collectionId: 'synthetic-collection',
    sourceKind: 'homebox-entity',
    externalId: 'synthetic-item-1',
  },
};
const license = { status: 'unknown', reference: null };
const form = { statement: 'Synthetic evidence statement', sourceLicense: license, reason: 'Synthetic test' };
const originalBytes = new Uint8Array([0x48, 0x41, 0x01, 0xfe]);
const selectedAt = '2026-10-10T12:00:00.000Z';
let nextLocalOrdinal = 1;

function nextLocalId() {
  const tail = String(nextLocalOrdinal++).padStart(12, '0');
  return `66666666-6666-4666-8666-${tail}`;
}

function makeBoundary(actorId = actorA, homeId = homeA, sessionEpoch = {}) {
  return { actorId, workspaceId, homeId, sessionEpoch };
}

function makeAdmission(homeId = homeA) {
  return {
    record: { recordId, workspaceId, homeId, lifecycle: 'active', revision: 7 },
    guards: [],
    canReplaceClassification: false,
    attachmentPolicy: {
      contentTypes: ['image/png'],
      maximumBytes: 1024,
      licenses: [{ label: 'Unknown', value: license }],
    },
  };
}

function memoryStore(shared = { rows: [], tail: Promise.resolve(), failNextCommit: null, afterNextCommit: null }) {
  let closed = false;
  return {
    shared,
    async read() {
      if (closed) throw new Error('synthetic store closed');
      await shared.tail;
      return structuredClone(shared.rows);
    },
    change(edit) {
      const run = async () => {
        if (closed) throw new Error('synthetic store closed');
        const before = structuredClone(shared.rows);
        const next = edit(before);
        if (shared.failNextCommit) {
          const error = shared.failNextCommit;
          shared.failNextCommit = null;
          throw error;
        }
        shared.rows = structuredClone(next.rows);
        const afterCommit = shared.afterNextCommit;
        shared.afterNextCommit = null;
        afterCommit?.();
        return next.value;
      };
      const pending = shared.tail.then(run);
      shared.tail = pending.then(() => undefined, () => undefined);
      return pending;
    },
    close() { closed = true; },
  };
}

function makeHost(initialBoundary = makeBoundary()) {
  let activeBoundary = initialBoundary;
  let isForeground = true;
  let admission = makeAdmission(activeBoundary.homeId);
  let acknowledgementChecks = 0;
  let placeLoads = 0;
  let refreshBoundary = async signal => {
    signal.throwIfAborted();
    return activeBoundary;
  };
  return {
    host: {
      current: () => activeBoundary,
      foreground: () => isForeground,
      refreshBoundary: async signal => {
        signal.throwIfAborted();
        const result = await refreshBoundary(signal);
        signal.throwIfAborted();
        return result;
      },
      loadPlace: async (source, signal) => {
        signal.throwIfAborted();
        placeLoads++;
        assert.deepEqual(source, sourceRef);
        return structuredClone(admission);
      },
      validateAcknowledgement(result, intent) {
        acknowledgementChecks++;
        assert.equal(result.syntheticServerReceipt, true);
        assert.equal(result.requestId, intent.requestId);
      },
    },
    setBoundary(value) { activeBoundary = value; admission = makeAdmission(value.homeId); },
    setRefreshBoundary(value) {
      refreshBoundary = value ?? (async signal => { signal.throwIfAborted(); return activeBoundary; });
    },
    setForeground(value) { isForeground = value; },
    setAdmission(value) { admission = value; },
    get acknowledgementChecks() { return acknowledgementChecks; },
    get placeLoads() { return placeLoads; },
  };
}

function makeController(store, host, clock = () => Date.parse(selectedAt)) {
  return createCaptureDrafts(store, host.host, clock);
}

function selection(original = new File([originalBytes], 'synthetic.png', {
  type: 'image/png', lastModified: 1234,
}), file = new File([original], original.name, {
  type: 'image/png', lastModified: original.lastModified,
})) {
  return {
    original,
    file,
    capture: {
      schemaVersion: 1,
      selectionMethod: 'file-picker',
      selectedAt,
      filename: original.name,
      reportedContentType: original.type,
      byteOrigin: 'browser-returned-unmodified',
    },
  };
}

async function save(controller, chosen = selection(), target = structuredClone(sourceRef), localId = nextLocalId(), currentForm = form) {
  return controller.save({ localId, selection: chosen, form: structuredClone(currentForm), targetSourceRef: target, recordId, optedIn: true });
}

function abortController() { return new AbortController(); }

const controllers = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.close();
});

describe('capture draft controller synthetic regressions', () => {
  it('transaction-abort-reopen: an aborted atomic change leaves the committed row intact after close and reopen', async () => {
    const store = memoryStore();
    const host = makeHost();
    const controller = makeController(store, host);
    controllers.push(controller);
    const id = await save(controller);
    const before = await store.read();
    store.shared.failNextCommit = new Error('synthetic transaction abort');

    await assert.rejects(store.change(rows => ({ rows: rows.map(row => ({ ...row, state: 'outcome-unknown' })), value: undefined })), /synthetic transaction abort/);
    store.close();
    const reopened = memoryStore(store.shared);
    const after = await reopened.read();

    assert.equal(after.length, 1);
    assert.equal(after[0].id, id);
    assert.equal(after[0].state, 'unsent');
    assert.deepEqual(new Uint8Array(await after[0].original.arrayBuffer()), originalBytes);
    assert.deepEqual(after.map(row => row.id), before.map(row => row.id));
    reopened.close();
  });

  it('idempotent-local-staging: repeating the same host-minted capture id returns one row without extending its lifetime', async () => {
    let now = Date.parse(selectedAt);
    const store = memoryStore();
    const host = makeHost();
    const controller = makeController(store, host, () => now);
    controllers.push(controller);
    const id = nextLocalId();
    const chosen = selection();
    assert.equal(await save(controller, chosen, structuredClone(sourceRef), id), id);
    const before = (await store.read())[0];
    now += 3 * 24 * 60 * 60 * 1000;

    assert.equal(await save(controller, chosen, structuredClone(sourceRef), id), id);
    const after = await store.read();
    assert.equal(after.length, 1);
    assert.equal(after[0].id, id);
    assert.equal(after[0].createdAt, before.createdAt);
    assert.equal(after[0].expiresAt, before.expiresAt);
    assert.deepEqual(new Uint8Array(await after[0].original.arrayBuffer()), originalBytes);
  });

  it('changed-manifest-denial: a reused local capture id cannot overwrite bytes, form, or provenance', async () => {
    const store = memoryStore();
    const host = makeHost();
    const controller = makeController(store, host);
    controllers.push(controller);
    const id = nextLocalId();
    await save(controller, selection(), structuredClone(sourceRef), id);
    const before = (await store.read())[0];
    const changedForm = { ...form, statement: 'Changed synthetic statement' };

    await assert.rejects(save(controller, selection(new File([new Uint8Array([7, 7, 7])], 'changed.png', { type: 'image/png' })),
      structuredClone(sourceRef), id, changedForm), /already exists with different values/);
    const after = await store.read();
    assert.equal(after.length, 1);
    assert.equal(after[0].id, id);
    assert.deepEqual(after[0].form, before.form);
    assert.deepEqual(after[0].targetSourceRef, before.targetSourceRef);
    assert.deepEqual(new Uint8Array(await after[0].original.arrayBuffer()), originalBytes);
    assert.equal(after[0].createdAt, before.createdAt);
    assert.equal(after[0].expiresAt, before.expiresAt);
  });

  it('wrapper-byte-mismatch-denial: changed wrapper bytes cannot be staged as the browser-returned original', async () => {
    const store = memoryStore();
    const host = makeHost();
    const controller = makeController(store, host);
    controllers.push(controller);
    const original = new File([originalBytes], 'synthetic.png', { type: 'image/png', lastModified: 1234 });
    const wrapper = new File([new Uint8Array([9, 9, 9, 9])], 'synthetic.png', { type: 'image/png', lastModified: 1234 });

    await assert.rejects(save(controller, selection(original, wrapper)), /wrapper bytes differ/);
    assert.deepEqual(await store.read(), []);
  });

  it('quota-no-partial: an injected quota failure exposes no partial second draft and preserves the first', async () => {
    const store = memoryStore();
    const host = makeHost();
    const controller = makeController(store, host);
    controllers.push(controller);
    const firstId = await save(controller);
    store.shared.failNextCommit = new DOMException('Synthetic quota exhausted', 'QuotaExceededError');

    await assert.rejects(save(controller, selection(new File([new Uint8Array([9, 8, 7])], 'second.png', { type: 'image/png' }))),
      error => error?.name === 'QuotaExceededError');
    const rows = await store.read();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, firstId);
    assert.equal(rows[0].state, 'unsent');
  });

  it('owner-session-home-denial: an account, home, or session change blocks the old local draft before fresh admission', async () => {
    const store = memoryStore();
    const initial = makeBoundary();
    const host = makeHost(initial);
    const controller = makeController(store, host);
    controllers.push(controller);
    const id = await save(controller);
    const callsBefore = await controller.list();
    assert.equal(callsBefore.length, 1);

    host.setBoundary(makeBoundary(actorB, homeA));
    await assert.rejects(controller.review(id, abortController().signal), /unavailable for this account and home/);
    host.setBoundary(makeBoundary(actorA, homeB));
    await assert.rejects(controller.review(id, abortController().signal), /unavailable for this account and home/);
    host.setBoundary(makeBoundary(actorA, homeA, {}));
    const review = await controller.review(id, abortController().signal);
    const loadsBeforeRefreshMismatch = host.placeLoads;
    host.setRefreshBoundary(async signal => {
      signal.throwIfAborted();
      await Promise.resolve();
      const changed = makeBoundary(actorB, homeA);
      host.setBoundary(changed);
      return changed;
    });
    await assert.rejects(controller.beginAttempt(review.token, { confirmed: true }, abortController().signal), /current foreground session/);
    assert.equal(host.placeLoads, loadsBeforeRefreshMismatch);
    assert.equal((await store.read())[0].state, 'unsent');

    host.setRefreshBoundary(null);
    host.setBoundary(makeBoundary(actorA, homeA, {}));
    const currentReview = await controller.review(id, abortController().signal);
    host.setBoundary(makeBoundary(actorA, homeA, {}));
    await assert.rejects(controller.beginAttempt(currentReview.token, { confirmed: true }, abortController().signal), /current foreground session/);
    assert.equal((await store.read())[0].state, 'unsent');
  });

  it('immutable-original-provenance: saved bytes, source reference, owner, and capture labels are snapshots without session or admission data', async () => {
    const store = memoryStore();
    const host = makeHost();
    const controller = makeController(store, host);
    controllers.push(controller);
    const mutableSource = structuredClone(sourceRef);
    const inputFile = new File([originalBytes], 'synthetic.png', { type: '', lastModified: 1234 });
    await save(controller, selection(inputFile), mutableSource);
    mutableSource.key.externalId = 'changed-after-save';
    const row = (await store.read())[0];

    assert.deepEqual(new Uint8Array(await row.original.arrayBuffer()), originalBytes);
    assert.equal(row.contentType, 'image/png');
    assert.equal(row.lastModified, 1234);
    assert.deepEqual(row.targetSourceRef, sourceRef);
    assert.deepEqual(row.owner, { actorId: actorA, workspaceId, homeId: homeA });
    assert.deepEqual(row.capture, {
      schemaVersion: 1, selectionMethod: 'file-picker', selectedAt, filename: 'synthetic.png',
      reportedContentType: '', byteOrigin: 'browser-returned-unmodified',
    });
    assert.equal(row.state, 'unsent');
    assert.equal(row.attempt, null);
    assert.equal('sessionEpoch' in row, false);
    assert.equal('admission' in row, false);
    assert.equal('credential' in row, false);
    assert.equal('token' in row, false);
    const reviewed = await controller.review(row.id, abortController().signal);
    assert.equal(reviewed.file.name, 'synthetic.png');
    assert.equal(reviewed.file.type, 'image/png');
    assert.deepEqual(new Uint8Array(await reviewed.file.arrayBuffer()), originalBytes);
    assert.equal(reviewed.sha256, row.sha256);
    assert.deepEqual(reviewed.targetSourceRef, sourceRef);
    assert.deepEqual(reviewed.capture, row.capture);
  });

  it('unknown-handoff-no-retry: concurrent local handoff contenders yield one submission and one fake host invocation', async () => {
    const store = memoryStore();
    const host = makeHost();
    const controller = makeController(store, host);
    controllers.push(controller);
    const id = await save(controller);
    const firstReview = await controller.review(id, abortController().signal);
    const secondReview = await controller.review(id, abortController().signal);
    let hostInvocations = 0;

    const attempts = await Promise.allSettled([
      controller.beginAttempt(firstReview.token, { confirmed: true }, abortController().signal),
      controller.beginAttempt(secondReview.token, { confirmed: true }, abortController().signal),
    ]);
    const fulfilled = attempts.filter(result => result.status === 'fulfilled');
    const rejected = attempts.filter(result => result.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.match(String(rejected[0].reason), /already handed off/);

    const submission = fulfilled[0].value;
    const persisted = (await store.read())[0];
    assert.equal(persisted.state, 'outcome-unknown');
    assert.ok(persisted.attempt);
    assert.equal(Object.isFrozen(submission), true);
    assert.equal('intent' in submission, false);

    // The controller only returns values. This one synthetic host boundary
    // invocation stands in for receiving the handoff; it has no transport.
    const fakeHostInvocation = async value => {
      assert.equal(value, submission);
      assert.equal((await store.read())[0].state, 'outcome-unknown');
      hostInvocations++;
      const intent = value.takeForForegroundSubmit();
      assert.equal(intent.recordId, recordId);
      assert.deepEqual(intent.capture, persisted.capture);
      assert.throws(() => value.takeForForegroundSubmit(), /already handed off/);
      throw new Error('synthetic ambiguous host failure');
    };
    await assert.rejects(fakeHostInvocation(submission), /synthetic ambiguous host failure/);
    assert.equal(hostInvocations, 1);
    assert.equal((await store.read())[0].state, 'outcome-unknown');
  });

  it('validated-ack-only: local completion and mismatched receipts do not clear a draft; a correlated synthetic receipt does', async () => {
    const store = memoryStore();
    const host = makeHost();
    const controller = makeController(store, host);
    controllers.push(controller);
    const id = await save(controller);
    const reviewed = await controller.review(id, abortController().signal);
    const submission = await controller.beginAttempt(reviewed.token, { confirmed: true }, abortController().signal);
    const intent = submission.takeForForegroundSubmit();

    await assert.rejects(controller.acknowledge(submission, { localCompletion: true }), /differs from the local attempt/);
    const wrongScope = {
      commandId: 'atlas.batch.execute', requestId: intent.requestId,
      resolvedScope: { workspaceId, homeId: homeB }, syntheticServerReceipt: true,
    };
    await assert.rejects(controller.acknowledge(submission, wrongScope), /differs from the local attempt/);
    assert.equal((await store.read())[0].state, 'outcome-unknown');
    assert.equal(host.acknowledgementChecks, 0);

    const receipt = {
      commandId: 'atlas.batch.execute', requestId: intent.requestId,
      resolvedScope: { workspaceId, homeId: homeA }, syntheticServerReceipt: true,
    };
    const result = await controller.acknowledge(submission, receipt);
    assert.deepEqual(result, { state: 'server-acknowledged', requestId: intent.requestId });
    assert.equal(host.acknowledgementChecks, 1);
    assert.deepEqual(await store.read(), []);

    const secondId = await save(controller);
    const secondReview = await controller.review(secondId, abortController().signal);
    const secondSubmission = await controller.beginAttempt(secondReview.token, { confirmed: true }, abortController().signal);
    const secondIntent = secondSubmission.takeForForegroundSubmit();
    host.setBoundary(makeBoundary(actorA, homeA, {}));
    const freshLookingReceipt = {
      commandId: 'atlas.batch.execute', requestId: secondIntent.requestId,
      resolvedScope: { workspaceId, homeId: homeA }, syntheticServerReceipt: true,
    };
    await assert.rejects(controller.acknowledge(secondSubmission, freshLookingReceipt), /current foreground session/);
    assert.equal((await store.read()).find(row => row.id === secondId).state, 'outcome-unknown');
    assert.equal(host.acknowledgementChecks, 1);
  });

  it('cancellation-before/after-handoff: pre-cancel blocks before state change; post-marker cancellation keeps unknown state and fails handoff', async () => {
    const store = memoryStore();
    const host = makeHost();
    const controller = makeController(store, host);
    controllers.push(controller);
    const id = await save(controller);
    const reviewed = await controller.review(id, abortController().signal);
    const before = abortController();
    before.abort();
    await assert.rejects(controller.beginAttempt(reviewed.token, { confirmed: true }, before.signal), /abort/i);
    assert.equal((await store.read())[0].state, 'unsent');

    const nextReview = await controller.review(id, abortController().signal);
    const after = abortController();
    const submission = await controller.beginAttempt(nextReview.token, { confirmed: true }, after.signal);
    assert.equal((await store.read())[0].state, 'outcome-unknown');
    after.abort();
    assert.throws(() => submission.takeForForegroundSubmit(), /abort/i);
    assert.equal((await store.read())[0].state, 'outcome-unknown');
  });

  it('posttransaction-abort-inspect-unknown: a signal lost after marker commit leaves inspectable unknown state after reopen', async () => {
    const store = memoryStore();
    const host = makeHost();
    const controller = makeController(store, host);
    controllers.push(controller);
    const id = await save(controller);
    const reviewed = await controller.review(id, abortController().signal);
    const signal = abortController();
    store.shared.afterNextCommit = () => signal.abort();

    await assert.rejects(controller.beginAttempt(reviewed.token, { confirmed: true }, signal.signal), /abort/i);
    assert.equal((await store.read())[0].state, 'outcome-unknown');
    store.close();

    const reopened = memoryStore(store.shared);
    const afterReopen = makeController(reopened, host);
    controllers.push(afterReopen);
    const inspection = await afterReopen.inspectUnknown(id, abortController().signal);
    assert.equal(inspection.outcome, 'unknown');
    assert.equal(inspection.retrySafety, 'not-established');
    assert.equal(inspection.draftId, id);
    assert.ok(inspection.attempt.requestId);
    assert.ok(inspection.attempt.idempotencyKey);
    assert.equal(inspection.savedPlace.record.revision, 7);
    assert.equal((await reopened.read())[0].state, 'outcome-unknown');
    reopened.close();
  });

  it('expiry-and-explicit-cleanup: seven-day expiry blocks review deterministically and explicit account cleanup removes only that actor’s drafts', async () => {
    const start = Date.parse(selectedAt);
    let now = start;
    const store = memoryStore();
    const hostA = makeHost(makeBoundary(actorA));
    const controllerA = makeController(store, hostA, () => now);
    const hostB = makeHost(makeBoundary(actorB));
    const controllerB = makeController(store, hostB, () => now);
    controllers.push(controllerA, controllerB);
    const expiredId = await save(controllerA);
    const otherActorId = await save(controllerB);
    const saved = await store.read();
    assert.equal(Date.parse(saved.find(row => row.id === expiredId).expiresAt) - start, 7 * 24 * 60 * 60 * 1000);
    now = Date.parse(saved.find(row => row.id === expiredId).expiresAt);

    await assert.rejects(controllerA.review(expiredId, abortController().signal), /expired/);
    assert.equal((await store.read()).find(row => row.id === expiredId).state, 'unsent');
    await controllerA.discard(expiredId, { loseUnknownOutcome: false });
    await save(controllerA);
    await controllerA.clearAccount({ loseLocalCaptures: true });

    const remaining = await store.read();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, otherActorId);
    assert.equal(remaining[0].owner.actorId, actorB);
  });
});
