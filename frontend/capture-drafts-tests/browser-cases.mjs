import { createCaptureDrafts } from '/src/capture-drafts/controller.ts';
import { DRAFT_DATABASE, openDraftStore } from '/src/capture-drafts/indexeddb.ts';

const knownCases = new Set([
  'retained-original-after-reopen',
  'unknown-attempt-locked-after-reopen',
  'storage-deletion-denies-stale-resume',
  'concurrent-handoff-single-winner',
  'change-callback-abort-preserves-row',
]);
const params = new URLSearchParams(location.search);
const caseName = params.get('case');
const forbiddenActivity = [];
const originalFetch = window.fetch.bind(window);
window.fetch = (...args) => {
  forbiddenActivity.push('fetch');
  return Promise.reject(new Error('Network access is disabled in the synthetic browser case'));
};
const originalXhrOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (...args) {
  forbiddenActivity.push('XMLHttpRequest');
  throw new Error('Network access is disabled in the synthetic browser case');
};
if (navigator.sendBeacon) {
  navigator.sendBeacon = () => {
    forbiddenActivity.push('sendBeacon');
    return false;
  };
}
for (const method of ['submit', 'requestSubmit']) {
  const original = HTMLFormElement.prototype[method];
  if (original) HTMLFormElement.prototype[method] = function (...args) {
    forbiddenActivity.push(`form.${method}`);
    throw new Error('Form submission is disabled in the synthetic browser case');
  };
}

const boundary = () => ({ actorId: 'synthetic-browser-actor', workspaceId: 'a5bc5bc5-37aa-4ebd-8fc2-882777aa3129',
  homeId: 'a622ebf8-9a9b-4b5b-a2cf-08747f759b99', sessionEpoch: {} });
const source = () => ({ workspaceId: boundary().workspaceId, homeId: boundary().homeId,
  key: { sourceInstanceId: 'e844cfc0-e959-49c4-9b90-f2d6cb95090f', collectionId: 'synthetic-collection',
    sourceKind: 'homebox-entity', externalId: 'synthetic-entity' } });
const recordId = 'c1ae4f56-5ab9-4df4-bec8-2707b8a09f44';
const localId = '5ac0cb5e-f8e0-4c8d-8cf2-716ab2e33816';
const content = new Uint8Array([0x53, 0x59, 0x4e, 0x54, 0x48, 0x45, 0x54, 0x49, 0x43, 0x2d, 0x49, 0x4d, 0x41, 0x47, 0x45]);
const selectedAt = '2026-10-10T12:34:56.000Z';
const license = Object.freeze({ status: 'permitted', reference: 'synthetic-license-reference' });
const form = () => ({ statement: 'Synthetic browser regression image', reason: 'Synthetic regression fixture', sourceLicense: { ...license } });
const originalFile = () => new File([content], 'synthetic-capture.png', { type: 'image/png', lastModified: 1_797_000_000_000 });
const selection = () => {
  const original = originalFile();
  // The picker wrapper is a distinct File value; browsers may normalize its MIME label.
  const file = new File([original], original.name, { type: 'IMAGE/PNG', lastModified: original.lastModified });
  return { original, file, capture: { schemaVersion: 1, selectionMethod: 'photo-picker', selectedAt,
    filename: original.name, reportedContentType: original.type, byteOrigin: 'browser-returned-unmodified' } };
};
const admission = () => ({
  record: { recordId, workspaceId: boundary().workspaceId, homeId: boundary().homeId, lifecycle: 'active', revision: 7 },
  guards: [], canReplaceClassification: false,
  attachmentPolicy: { contentTypes: ['image/png'], maximumBytes: 1024,
    licenses: [{ label: 'Synthetic permission', value: { ...license } }] },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeHost() {
  const calls = { current: 0, refreshBoundary: 0, foreground: 0, loadPlace: 0, validateAcknowledgement: 0 };
  let currentBoundary = boundary();
  const host = {
    current: () => { calls.current++; return currentBoundary; },
    refreshBoundary: async signal => {
      calls.refreshBoundary++;
      signal.throwIfAborted();
      currentBoundary = { ...currentBoundary };
      return currentBoundary;
    },
    foreground: () => { calls.foreground++; return true; },
    loadPlace: async () => { calls.loadPlace++; return admission(); },
    validateAcknowledgement: () => { calls.validateAcknowledgement++; },
  };
  return { host, calls };
}

async function saveOne(controller) {
  return controller.save({ localId, selection: selection(), form: form(), targetSourceRef: source(), recordId, optedIn: true });
}

function sameBytes(bytes) {
  return bytes.length === content.length && content.every((value, index) => bytes[index] === value);
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function sha256Hex(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    value => value.toString(16).padStart(2, '0')).join('');
}

async function deleteDatabase() {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DRAFT_DATABASE);
    const timer = setTimeout(() => reject(new Error('Synthetic IndexedDB deletion timed out')), 2_000);
    request.onsuccess = () => { clearTimeout(timer); resolve(); };
    request.onerror = () => { clearTimeout(timer); reject(request.error ?? new Error('Synthetic IndexedDB deletion failed')); };
    request.onblocked = () => { clearTimeout(timer); reject(new Error('Synthetic IndexedDB deletion was blocked by an open test connection')); };
  });
}

async function execute(name) {
  const controllers = [];
  const stores = [];
  const makeController = (newOwner = makeHost()) => {
    const store = openDraftStore();
    stores.push(store);
    const controller = createCaptureDrafts(store, newOwner.host);
    controllers.push(controller);
    return { controller, store, calls: newOwner.calls };
  };
  try {
    if (name === 'retained-original-after-reopen') {
      const first = makeController();
      const id = await saveOne(first.controller);
      first.controller.close();
      const reopened = makeController();
      const summaries = await reopened.controller.list();
      const rows = await reopened.store.read();
      const row = rows.find(candidate => candidate.id === id);
      assert(summaries.length === 1 && summaries[0].state === 'unsent', 'Reopened same-owner draft was missing or changed state');
      assert(row && sameBytes(new Uint8Array(await row.original.arrayBuffer())), 'Reopened IndexedDB original bytes differed');
      assert(row.capture.schemaVersion === 1 && row.capture.filename === 'synthetic-capture.png'
        && row.capture.selectionMethod === 'photo-picker' && row.capture.selectedAt === selectedAt
        && row.capture.reportedContentType === 'image/png' && row.capture.byteOrigin === 'browser-returned-unmodified',
      'Reopened capture provenance differed');
      assert(row.contentType === 'image/png' && row.lastModified === 1_797_000_000_000,
        'Reopened browser file metadata differed');
      assert(reopened.calls.loadPlace === 0 && forbiddenActivity.length === 0,
        'Reopening/listing initiated a fresh information read or network/submission activity');
      return { idb: 'real-chromium-indexeddb', sameOwner: true, bytesPreserved: true, provenancePreserved: true,
        state: 'unsent', loadPlaceCallsOnReopen: reopened.calls.loadPlace, networkOrSubmitCalls: forbiddenActivity.length };
    }

    if (name === 'unknown-attempt-locked-after-reopen') {
      const first = makeController();
      const id = await saveOne(first.controller);
      const review = await first.controller.review(id, new AbortController().signal);
      const submission = await first.controller.beginAttempt(review.token, { confirmed: true }, new AbortController().signal);
      const intent = submission.takeForForegroundSubmit();
      assert(intent.requestId && intent.idempotencyKey, 'Attempt handoff lacked synthetic correlation values');
      first.controller.close();
      const reopened = makeController();
      const callsBeforeReview = { refreshBoundary: reopened.calls.refreshBoundary, loadPlace: reopened.calls.loadPlace };
      const summaries = await reopened.controller.list();
      let locked = false;
      try { await reopened.controller.review(id, new AbortController().signal); }
      catch (error) { locked = error instanceof Error && error.message.includes('outcome is unknown'); }
      const rows = await reopened.store.read();
      const row = rows.find(candidate => candidate.id === id);
      assert(locked, 'Unknown attempt became reviewable after closing and reopening');
      assert(row?.state === 'outcome-unknown' && row.attempt?.requestId === intent.requestId
        && row.attempt?.idempotencyKey === intent.idempotencyKey, 'Unknown attempt marker did not persist exactly');
      assert(row && summaries[0]?.state === 'outcome-unknown', 'Unknown marker disappeared from the reopened owner list');
      const persistedBytes = new Uint8Array(await row.original.arrayBuffer());
      const handedOffBytes = new Uint8Array(await intent.file.arrayBuffer());
      const persistedHash = await sha256Hex(persistedBytes);
      const provenanceMatchesSubmission = row.capture.schemaVersion === 1 && row.capture.selectionMethod === 'photo-picker'
        && row.capture.selectionMethod === submission.capture.selectionMethod
        && row.capture.selectedAt === submission.capture.selectedAt && row.capture.filename === submission.capture.filename
        && row.capture.reportedContentType === 'image/png' && row.capture.reportedContentType === submission.capture.reportedContentType
        && row.capture.byteOrigin === submission.capture.byteOrigin && intent.capture.schemaVersion === row.capture.schemaVersion
        && intent.capture.selectionMethod === row.capture.selectionMethod && intent.capture.selectedAt === row.capture.selectedAt
        && intent.capture.filename === row.capture.filename && intent.capture.reportedContentType === row.capture.reportedContentType
        && intent.capture.byteOrigin === row.capture.byteOrigin && intent.file.name === submission.capture.filename
        && intent.file.type === row.contentType && intent.file.lastModified === row.lastModified;
      assert(equalBytes(persistedBytes, handedOffBytes) && persistedHash === submission.sha256
        && row.sha256 === submission.sha256 && provenanceMatchesSubmission,
      'Reopened unknown attempt original bytes, provenance, or digest differed from the local handoff');
      assert(reopened.calls.loadPlace === callsBeforeReview.loadPlace
        && reopened.calls.refreshBoundary === callsBeforeReview.refreshBoundary,
      'Listing or locked review refreshed information before explicit unknown inspection');
      const inspection = await reopened.controller.inspectUnknown(id, new AbortController().signal);
      assert(inspection.outcome === 'unknown' && inspection.retrySafety === 'not-established'
        && inspection.attempt.requestId === row.attempt.requestId
        && reopened.calls.loadPlace === callsBeforeReview.loadPlace + 1
        && reopened.calls.refreshBoundary === callsBeforeReview.refreshBoundary + 1,
      'Explicit unknown inspection did not return the marker, fresh saved information, and conservative retry status');
      assert(forbiddenActivity.length === 0, 'Locked review or inspection attempted network or form submission');
      return { idb: 'real-chromium-indexeddb', stateAfterReopen: row.state, markerPreserved: true,
        bytesMatchForegroundHandoff: true, provenanceMatchesForegroundHandoff: true, sha256MatchesForegroundHandoff: true,
        reviewLocked: true, explicitInspectionPerformedFreshRead: true, retrySafety: inspection.retrySafety,
        refreshBoundaryCallsForInspection: reopened.calls.refreshBoundary - callsBeforeReview.refreshBoundary,
        loadPlaceCallsForInspection: reopened.calls.loadPlace - callsBeforeReview.loadPlace,
        networkOrSubmitCalls: forbiddenActivity.length, serverSubmission: 'not invoked by this local handoff API' };
    }

    if (name === 'storage-deletion-denies-stale-resume') {
      const owner = makeHost();
      const staged = makeController(owner);
      const id = await saveOne(staged.controller);
      const review = await staged.controller.review(id, new AbortController().signal);
      const callsBeforeDeletion = { refreshBoundary: owner.calls.refreshBoundary, loadPlace: owner.calls.loadPlace,
        validateAcknowledgement: owner.calls.validateAcknowledgement };

      // Simulate explicit synthetic browser/user storage loss only after every
      // connection owned by the staged controller has been closed.
      for (const controller of controllers) controller.close();
      for (const store of stores) store.close();
      await deleteDatabase();

      const reopened = makeController(owner);
      let staleTokenDenied = false;
      try { await staged.controller.beginAttempt(review.token, { confirmed: true }, new AbortController().signal); }
      catch (error) { staleTokenDenied = error instanceof Error && error.message.includes('Review and confirm'); }
      const summaries = await reopened.controller.list();
      let freshReviewUnavailable = false;
      try { await reopened.controller.review(id, new AbortController().signal); }
      catch (error) { freshReviewUnavailable = error instanceof Error && error.message.includes('Local draft is unavailable'); }
      let inspectionUnavailable = false;
      try { await reopened.controller.inspectUnknown(id, new AbortController().signal); }
      catch (error) { inspectionUnavailable = error instanceof Error && error.message.includes('Local draft is unavailable'); }
      const rowsAfterDenials = await reopened.store.read();

      assert(staleTokenDenied, 'Closing the old controller left a review token usable after storage deletion');
      assert(summaries.length === 0 && rowsAfterDenials.length === 0,
        'Replacement feature store recreated or retained a draft after explicit deletion');
      assert(freshReviewUnavailable && inspectionUnavailable,
        'Fresh review or unknown inspection treated deleted storage as an available draft');
      assert(owner.calls.refreshBoundary === callsBeforeDeletion.refreshBoundary
        && owner.calls.loadPlace === callsBeforeDeletion.loadPlace
        && owner.calls.validateAcknowledgement === callsBeforeDeletion.validateAcknowledgement,
      'A stale/deleted draft triggered a fresh information read or acknowledgement validation');
      assert(forbiddenActivity.length === 0, 'Storage deletion case attempted network or form submission');
      return { idb: 'real-chromium-indexeddb', deletion: 'explicit-indexeddb-delete-after-closing-all-test-connections',
        replacementStoreEmpty: true, staleReviewTokenDenied: true, freshReviewUnavailable: true,
        unknownInspectionUnavailable: true, uploadInvocation: 0, acknowledgementValidation: 0,
        networkOrSubmitCalls: forbiddenActivity.length,
        limitation: 'Synthetic application/user storage deletion only; not engine pressure eviction, browser-process loss, power loss, or backup qualification.' };
    }

    if (name === 'concurrent-handoff-single-winner') {
      const first = makeController();
      const id = await saveOne(first.controller);
      const second = makeController();
      const firstReview = await first.controller.review(id, new AbortController().signal);
      const secondReview = await second.controller.review(id, new AbortController().signal);
      const outcomes = await Promise.allSettled([
        first.controller.beginAttempt(firstReview.token, { confirmed: true }, new AbortController().signal),
        second.controller.beginAttempt(secondReview.token, { confirmed: true }, new AbortController().signal),
      ]);
      const winners = outcomes.filter(result => result.status === 'fulfilled');
      const losers = outcomes.filter(result => result.status === 'rejected');
      const rows = await first.store.read();
      const row = rows.find(candidate => candidate.id === id);
      assert(winners.length === 1 && losers.length === 1, 'Concurrent independent connections did not produce exactly one handoff winner');
      const intent = winners.length === 1 ? winners[0].value.takeForForegroundSubmit() : null;
      assert(row?.state === 'outcome-unknown' && intent && row.attempt?.requestId === intent.requestId
        && row.attempt?.idempotencyKey === intent.idempotencyKey,
      'Persisted attempt marker did not match the single handoff winner');
      assert(forbiddenActivity.length === 0, 'Concurrent local handoff attempted network or form submission');
      return { idb: 'real-chromium-indexeddb', connections: 2, handoffWinners: winners.length,
        handoffLosers: losers.length, persistedState: row.state, markerMatchesForegroundHandoff: true,
        networkOrSubmitCalls: forbiddenActivity.length };
    }

    if (name === 'change-callback-abort-preserves-row') {
      const context = makeController();
      const id = await saveOne(context.controller);
      const before = (await context.store.read()).find(row => row.id === id);
      let aborted = false;
      try {
        await context.store.change(() => { throw new Error('Synthetic callback failure before commit'); });
      } catch (error) { aborted = error instanceof Error && error.message === 'Synthetic callback failure before commit'; }
      const after = (await context.store.read()).find(row => row.id === id);
      assert(aborted, 'Injected synchronous edit callback failure did not reject the transaction');
      assert(before && after && before.state === after.state && before.sha256 === after.sha256
        && sameBytes(new Uint8Array(await after.original.arrayBuffer())), 'Aborted change modified or removed the saved original');
      assert(forbiddenActivity.length === 0, 'Transaction abort case attempted network or form submission');
      return { idb: 'real-chromium-indexeddb', outcome: 'synchronous-change-callback-transaction-abort',
        originalPreserved: true, statePreserved: true, networkOrSubmitCalls: forbiddenActivity.length,
        limitation: 'This is an application transaction abort, not browser-process loss, power loss, or disk failure.' };
    }
    throw new Error('Browser case is not in the exact allowlist');
  } finally {
    for (const controller of controllers) controller.close();
    for (const store of stores) store.close();
    await deleteDatabase();
  }
}

async function main() {
  if (params.size !== 1 || !knownCases.has(caseName)) throw new Error('Requested case is not in the exact allowlist');
  // Preserve the native API references only for explicit test instrumentation.
  void originalFetch;
  void originalXhrOpen;
  const evidence = await execute(caseName);
  if (forbiddenActivity.length !== 0) throw new Error(`Forbidden activity: ${forbiddenActivity.join(', ')}`);
  return { ok: true, evidence };
}

main().then(result => {
  document.body.textContent = JSON.stringify(result);
  document.body.dataset.status = 'complete';
}).catch(error => {
  document.body.textContent = JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
  document.body.dataset.status = 'complete';
});
