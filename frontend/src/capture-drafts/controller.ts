import type { PlaceEditAdmission } from '../app/editing.ts';
import type { SourceRef } from '../api/generated/contracts.ts';
import { DRAFT_LIMITS, type CaptureSelection, type DraftBoundary, type DraftForm, type DraftHost, type DraftOwner,
  type DraftReview, type DraftRow, type DraftStore, type DraftSubmission, type DraftSummary, type DraftTargetOwner, type DraftUnknownInspection, type DraftUploadIntent } from './types.ts';
import { digest, DraftWriteError, timestamp, validateForm, validateOwner, validateRow, validateRows, validateSource } from './validation.ts';
import { validateDraftReceipt } from './receipt.ts';

const sameOwner = (a: DraftOwner, b: DraftOwner) => a.actorId === b.actorId && a.workspaceId === b.workspaceId && a.homeId === b.homeId;
function owner(boundary: DraftBoundary): DraftOwner {
  const result = { actorId: boundary.actorId, workspaceId: boundary.workspaceId, homeId: boundary.homeId };
  validateOwner(result); return result;
}
function originalFile(row: DraftRow): File {
  return new File([row.original], row.capture.filename, { type: row.contentType, lastModified: row.lastModified });
}
// Stable field order binds all immutable metadata as well as the original hash.
function manifest(row: DraftRow): string {
  const source = row.targetSourceRef, key = source?.key;
  return JSON.stringify([row.format, row.id, row.owner.actorId, row.owner.workspaceId, row.owner.homeId,
    source?.workspaceId ?? null, source?.homeId ?? null, key?.sourceInstanceId ?? null, key?.collectionId ?? null, key?.sourceKind ?? null, key?.externalId ?? null,
    row.recordId, row.original.size, row.contentType, row.lastModified, row.sha256, row.capture.schemaVersion, row.capture.selectionMethod, row.capture.selectedAt,
    row.capture.filename, row.capture.reportedContentType, row.capture.byteOrigin, row.form.statement, row.form.sourceLicense.status, row.form.sourceLicense.reference,
    row.form.reason]);
}
function freezeData<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}
function checkAdmission(admission: PlaceEditAdmission | null, row: DraftRow): asserts admission is PlaceEditAdmission {
  const record = admission?.record, policy = admission?.attachmentPolicy;
  if (!record || record.recordId !== row.recordId || record.workspaceId !== row.owner.workspaceId || record.homeId !== row.owner.homeId
    || record.lifecycle !== 'active' || !Number.isSafeInteger(record.revision) || record.revision < 1
    || !policy || row.original.size > policy.maximumBytes || !policy.contentTypes.includes(row.contentType)
    || !policy.licenses.some(choice => choice.value.status === row.form.sourceLicense.status && choice.value.reference === row.form.sourceLicense.reference))
    throw new Error('Read current Atlas information and review this attachment before submitting');
}
type Prepared = Awaited<ReturnType<DraftTargetOwner['prepare']>>;
interface Target {
  admit(signal: AbortSignal): Promise<void>;
  prepare(file: File, signal: AbortSignal): Promise<Prepared>;
  saved(signal: AbortSignal): Promise<Pick<DraftUnknownInspection, 'savedPlace' | 'savedRevision'>>;
}
/** A source row uses the built-in stock upload intent and receipt checks; a
 * row without a source uses the host's target owner, or is refused. */
function targetFor(row: DraftRow, host: DraftHost): Target {
  const source = row.targetSourceRef;
  if (source === null) {
    const owner = host.placeTarget;
    if (!owner) throw new Error('This local draft target is unavailable');
    const view = { owner: row.owner, recordId: row.recordId, contentType: row.contentType, sha256: row.sha256,
      capture: structuredClone(row.capture), form: structuredClone(row.form), byteSize: row.original.size };
    return { admit: signal => owner.admit(view, signal), prepare: (file, signal) => owner.prepare(view, file, signal),
      saved: async signal => ({ savedPlace: null, savedRevision: await owner.revision(view, signal) }) };
  }
  const load = async (signal: AbortSignal) => {
    const admission = await host.loadPlace(structuredClone(source), signal); signal.throwIfAborted(); return admission;
  };
  return {
    async admit(signal) { checkAdmission(await load(signal), row); },
    async prepare(file, signal) {
      const admission = await load(signal); checkAdmission(admission, row);
      const requestId = crypto.randomUUID(), idempotencyKey = crypto.randomUUID(), identityId = admission.record.payload.atlasId;
      const intent: DraftUploadIntent = Object.freeze({
        requestId, idempotencyKey, context: Object.freeze({ workspaceId: row.owner.workspaceId, homeId: row.owner.homeId }),
        recordId: row.recordId, expectedRevision: admission.record.revision, guards: freezeData(structuredClone(admission.guards)),
        file, statement: row.form.statement, sourceLicense: Object.freeze(structuredClone(row.form.sourceLicense)), reason: row.form.reason,
        capture: Object.freeze(structuredClone(row.capture)),
      });
      return { requestId, idempotencyKey, handoff: intent, acknowledge(result) {
        const response = result as Record<string, unknown> | null;
        const scope = response?.['resolvedScope'] as Record<string, unknown> | undefined;
        if (!response || response['status'] !== 'committed' || response['requestId'] !== requestId || response['commandId'] !== 'atlas.batch.execute'
          || scope?.['workspaceId'] !== row.owner.workspaceId || scope?.['homeId'] !== row.owner.homeId)
          throw new TypeError('Server acknowledgement differs from the local attempt');
        host.validateAcknowledgement(result, intent);
        validateDraftReceipt(result, intent, identityId, row.sha256);
      } };
    },
    async saved(signal) {
      const savedPlace = await load(signal);
      if (savedPlace && (savedPlace.record.recordId !== row.recordId || savedPlace.record.workspaceId !== row.owner.workspaceId
        || savedPlace.record.homeId !== row.owner.homeId)) throw new Error('Saved information scope differs from the local attempt');
      return { savedPlace, savedRevision: savedPlace ? String(savedPlace.record.revision) : null };
    },
  };
}
/** Stores local originals and hands one foreground attempt to the capture owner.
 * It has no upload, fetch, reconnect, timer-submission or retry capability. */
export function createCaptureDrafts(store: DraftStore, host: DraftHost, now: () => number = Date.now) {
  const reviews = new Map<object, { row: DraftRow; boundary: DraftBoundary }>();
  let submissions = new WeakMap<object, { boundary: DraftBoundary; prepared: Prepared; generation: number; taken: boolean }>();
  let generation = 0;
  function boundary(): DraftBoundary {
    const current = host.current();
    if (!current || !current.sessionEpoch || typeof current.sessionEpoch !== 'object') throw new Error('Sign in and select the draft home');
    owner(current);
    return { ...owner(current), sessionEpoch: current.sessionEpoch };
  }
  function check(captured: DraftBoundary, atGeneration: number, foreground = false): void {
    const current = boundary();
    if (atGeneration !== generation || !sameOwner(captured, current) || current.sessionEpoch !== captured.sessionEpoch
      || (foreground && !host.foreground())) throw new Error('Review this draft in the current foreground session');
  }
  async function refresh(captured: DraftBoundary, atGeneration: number, signal: AbortSignal): Promise<void> {
    const fresh = await host.refreshBoundary(signal);
    signal.throwIfAborted();
    if (!fresh || !sameOwner(captured, fresh) || fresh.sessionEpoch !== captured.sessionEpoch)
      throw new Error('Review this draft in the current foreground session');
    check(captured, atGeneration, true);
  }
  async function rowFor(id: string, captured: DraftBoundary): Promise<DraftRow> {
    const rows = await store.read(); validateRows(rows);
    const row = rows.find(candidate => candidate.id === id && sameOwner(candidate.owner, captured));
    if (!row) throw new Error('Local draft is unavailable for this account and home');
    return row;
  }
  function unsent(row: DraftRow): void {
    if (row.state !== 'unsent') throw new Error('Submission outcome is unknown. Read saved information before any further action');
    if (now() >= Date.parse(row.expiresAt)) throw new Error('Local draft has expired. Remove it or select the file again');
  }
  return {
    /** Opt-in is per save, never inferred from installation or past sessions. */
    async save(input: { localId: string; selection: CaptureSelection; form: DraftForm; targetSourceRef: SourceRef | null; recordId: string; optedIn: true }): Promise<string> {
      if (input.optedIn !== true || !host.foreground()) throw new Error('Confirm saving a local unsent draft in the foreground');
      const captured = boundary(), atGeneration = generation;
      if (input.targetSourceRef === null) { if (!host.placeTarget) throw new Error('This local draft target is unavailable'); }
      else validateSource(input.targetSourceRef);
      validateForm(input.form);
      const file = input.selection.file, original = input.selection.original;
      if (!(file instanceof File) || !(original instanceof File) || file.size < 1 || file.size > DRAFT_LIMITS.fileBytes
        || original.size !== file.size || original.name !== file.name || original.lastModified !== file.lastModified
        || !['image/png', 'image/jpeg', 'application/pdf', 'text/plain'].includes(file.type)
        || input.selection.capture.filename !== original.name || input.selection.capture.reportedContentType !== original.type)
        throw new TypeError('Select an unchanged browser-returned file within the local limit');
      timestamp(input.selection.capture.selectedAt);
      // Snapshot only allowed fields before the first await. The stored Blob is built from bytes read once,
      // so it no longer depends on the picker's file; the buffer is released after this save.
      const time = now(), createdAt = new Date(time).toISOString();
      const snapshot = original.slice(0, original.size, file.type);
      const stored = new Blob([await snapshot.arrayBuffer()], { type: file.type });
      const row: DraftRow = {
        format: 'houseatlas-local-capture-draft/1', id: input.localId, owner: owner(captured),
        targetSourceRef: structuredClone(input.targetSourceRef), recordId: input.recordId,
        original: stored, contentType: file.type, lastModified: original.lastModified, sha256: '',
        capture: structuredClone(input.selection.capture),
        form: structuredClone(input.form), createdAt, expiresAt: new Date(time + DRAFT_LIMITS.unsentLifetimeMs).toISOString(),
        state: 'unsent', attempt: null,
      };
      const saved: DraftRow = { ...row, sha256: await digest(row.original) };
      if (await digest(file) !== saved.sha256) throw new TypeError('Capture wrapper bytes differ from the browser-returned original');
      validateRow(saved); check(captured, atGeneration, true);
      const write = () => store.change(rows => {
        check(captured, atGeneration, true); validateRows(rows);
        const existing = rows.find(candidate => candidate.id === saved.id);
        if (existing) {
          if (existing.state !== 'unsent' || manifest(existing) !== manifest(saved))
            throw new Error('Local capture identity already exists with different values or an unknown outcome');
          return { rows, value: undefined };
        }
        const next = [...rows, saved]; validateRows(next); return { rows: next, value: undefined };
      });
      // Chromium can abort a write with a non-quota DataError ("Failed to write blobs"). The aborted transaction stored
      // nothing, so one fresh attempt with the same bytes cannot duplicate a row; a second abort is reported, not retried.
      const blobWriteAbort = (error: unknown) => (error as { name?: unknown } | null)?.name === 'DataError';
      try { await write(); }
      catch (error) {
        if (!blobWriteAbort(error)) throw error;
        try { await write(); } catch (retry) { throw blobWriteAbort(retry) ? new DraftWriteError() : retry; }
      }
      check(captured, atGeneration, true);
      return saved.id;
    },
    async list(): Promise<readonly DraftSummary[]> {
      const captured = boundary(), atGeneration = generation;
      const rows = await store.read(); validateRows(rows); check(captured, atGeneration);
      return rows.filter(row => sameOwner(row.owner, captured)).map(row => ({ id: row.id, targetSourceRef: structuredClone(row.targetSourceRef),
        recordId: row.recordId, filename: row.capture.filename, byteSize: row.original.size, createdAt: row.createdAt,
        expiresAt: row.expiresAt, state: row.state, expired: row.state === 'unsent' && now() >= Date.parse(row.expiresAt) }));
    },
    /** Explicit resume action. Nothing stored can stand in for a fresh admission. */
    async review(id: string, signal: AbortSignal): Promise<DraftReview> {
      signal.throwIfAborted();
      const captured = boundary(), atGeneration = generation; check(captured, atGeneration, true);
      const row = await rowFor(id, captured); unsent(row);
      if (await digest(row.original) !== row.sha256) throw new Error('Local original bytes no longer match');
      signal.throwIfAborted(); check(captured, atGeneration, true);
      await refresh(captured, atGeneration, signal);
      await targetFor(row, host).admit(signal);
      signal.throwIfAborted(); check(captured, atGeneration, true);
      const token = Object.freeze({});
      // Keep a private snapshot; caller edits to displayed values cannot change submission.
      if (reviews.size >= DRAFT_LIMITS.count) reviews.delete(reviews.keys().next().value!);
      reviews.set(token, { row, boundary: captured });
      return { token, file: originalFile(row), form: structuredClone(row.form), targetSourceRef: structuredClone(row.targetSourceRef),
        recordId: row.recordId, capture: structuredClone(row.capture), sha256: row.sha256 };
    },
    /** Call only for a user-confirmed submit. This returns values, never sends them.
     * The durable unknown marker precedes handoff even if dispatch never starts. */
    async beginAttempt(token: object, consent: { confirmed: true }, signal: AbortSignal): Promise<DraftSubmission> {
      const review = reviews.get(token); reviews.delete(token);
      if (!review || consent.confirmed !== true) throw new Error('Review and confirm this local draft again');
      const captured = review.boundary, atGeneration = generation;
      signal.throwIfAborted(); check(captured, atGeneration, true); unsent(review.row);
      await refresh(captured, atGeneration, signal);
      // Build every fallible value before persistence. A lost handoff after the
      // marker is intentionally unknown and can only be inspected/removed.
      const prepared = await targetFor(review.row, host).prepare(originalFile(review.row), signal);
      signal.throwIfAborted(); check(captured, atGeneration, true);
      const attempt = { requestId: prepared.requestId, idempotencyKey: prepared.idempotencyKey, startedAt: new Date(now()).toISOString() };
      const attempted: DraftRow = { ...review.row, state: 'outcome-unknown', attempt };
      const privateAttempt = { boundary: captured, prepared, generation: atGeneration, taken: false };
      const submission: DraftSubmission = Object.freeze({ draftId: attempted.id, capture: Object.freeze(structuredClone(attempted.capture)), sha256: attempted.sha256,
        takeForForegroundSubmit: () => {
          signal.throwIfAborted(); check(captured, atGeneration, true);
          if (!submissions.has(submission) || privateAttempt.taken) throw new Error('Local attempt was already handed off or invalidated');
          privateAttempt.taken = true;
          return prepared.handoff;
        } });
      await store.change(rows => {
        signal.throwIfAborted(); check(captured, atGeneration, true); validateRows(rows);
        const stored = rows.find(row => row.id === attempted.id && sameOwner(row.owner, captured));
        if (!stored || stored.state !== 'unsent' || manifest(stored) !== manifest(attempted)
          || stored.createdAt !== attempted.createdAt || stored.expiresAt !== attempted.expiresAt)
          throw new Error('Local draft changed or was already handed off');
        unsent(stored);
        return { rows: rows.map(row => row.id === attempted.id ? attempted : row), value: undefined };
      });
      signal.throwIfAborted(); check(captured, atGeneration, true);
      submissions.set(submission, privateAttempt);
      return submission;
    },
    /** Only a genuine correlated server acknowledgement releases local originals.
     * A known commit and its local cleanup result are distinct outcomes. */
    async acknowledge(submission: DraftSubmission, result: unknown): Promise<{
      state: 'server-acknowledged'; requestId: string; localCleanup: 'removed' | 'unconfirmed';
    }> {
      const privateAttempt = submissions.get(submission);
      if (!privateAttempt || !privateAttempt.taken) throw new Error('Original foreground attempt is unavailable');
      const atGeneration = privateAttempt.generation; check(privateAttempt.boundary, atGeneration);
      privateAttempt.prepared.acknowledge(result);
      // Validation belongs to this exact attempt. A response object validated
      // during an earlier acknowledgement cannot certify another attempt.
      submissions.delete(submission);
      let localCleanup: 'removed' | 'unconfirmed' = 'unconfirmed';
      try {
        check(privateAttempt.boundary, atGeneration);
        await store.change(rows => {
          check(privateAttempt.boundary, atGeneration); validateRows(rows);
          const stored = rows.find(row => row.id === submission.draftId);
          if (!stored || !sameOwner(stored.owner, privateAttempt.boundary) || stored.state !== 'outcome-unknown'
            || stored.attempt?.requestId !== privateAttempt.prepared.requestId || stored.attempt?.idempotencyKey !== privateAttempt.prepared.idempotencyKey)
            throw new Error('Local attempt no longer matches');
          return { rows: rows.filter(row => row.id !== submission.draftId), value: undefined };
        });
        check(privateAttempt.boundary, atGeneration);
        localCleanup = 'removed';
      } catch { /* The correlated commit is known; local cleanup is not. */ }
      return { state: 'server-acknowledged', requestId: privateAttempt.prepared.requestId, localCleanup };
    },
    /** Read-only assistance after interruption/reopen. Never turns absence or
     * current evidence into retry permission, and never reconstructs a request. */
    async inspectUnknown(id: string, signal: AbortSignal): Promise<DraftUnknownInspection> {
      signal.throwIfAborted();
      const captured = boundary(), atGeneration = generation; check(captured, atGeneration, true);
      const row = await rowFor(id, captured);
      if (row.state !== 'outcome-unknown' || !row.attempt) throw new Error('No unknown local attempt exists');
      await refresh(captured, atGeneration, signal);
      const saved = await targetFor(row, host).saved(signal);
      signal.throwIfAborted(); check(captured, atGeneration, true);
      return { draftId: row.id, attempt: structuredClone(row.attempt), targetSourceRef: structuredClone(row.targetSourceRef), recordId: row.recordId,
        sha256: row.sha256, ...saved, outcome: 'unknown', retrySafety: 'not-established' };
    },
    /** Explicit local removal; after handoff it never cancels a server operation. */
    async discard(id: string, consent: { loseUnknownOutcome: boolean }): Promise<void> {
      const captured = boundary(), atGeneration = generation;
      await store.change(rows => {
        check(captured, atGeneration); validateRows(rows);
        const row = rows.find(row => row.id === id && sameOwner(row.owner, captured));
        if (!row) throw new Error('Local draft is unavailable for this account and home');
        if (row.state === 'outcome-unknown' && !consent.loseUnknownOutcome) throw new Error('Removing this local file does not cancel an unknown server outcome');
        return { rows: rows.filter(row => row.id !== id), value: undefined };
      });
      reviews.clear();
    },
    /** Explicit sign-out cleanup, called before the host ends this session.
     * Other accounts remain untouched; this actor's drafts in all homes are removed. */
    async clearAccount(consent: { loseLocalCaptures: true }): Promise<void> {
      if (consent.loseLocalCaptures !== true) throw new Error('Confirm removal of local captures');
      const captured = boundary(), atGeneration = generation;
      await store.change(rows => {
        check(captured, atGeneration); validateRows(rows);
        return { rows: rows.filter(row => row.owner.actorId !== captured.actorId), value: undefined };
      });
      this.invalidate();
    },
    /** Host calls synchronously on logout, identity/home/session change or unmount. */
    invalidate(): void { generation++; reviews.clear(); submissions = new WeakMap(); },
    close(): void { generation++; reviews.clear(); submissions = new WeakMap(); store.close(); },
  };
}
