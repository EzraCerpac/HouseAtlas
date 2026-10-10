import type { PlaceEditAdmission, UploadPlaceEvidence } from '../app/editing.ts';
import type { SourceRef } from '../api/generated/contracts.ts';
import { DRAFT_LIMITS, type CaptureSelection, type DraftBoundary, type DraftForm, type DraftHost, type DraftOwner,
  type DraftReview, type DraftRow, type DraftStore, type DraftSubmission, type DraftSummary, type DraftUnknownInspection, type DraftUploadIntent } from './types.ts';
import { digest, timestamp, validateForm, validateOwner, validateRow, validateRows, validateSource } from './validation.ts';

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
  const key = row.targetSourceRef.key;
  return JSON.stringify([row.format, row.id, row.owner.actorId, row.owner.workspaceId, row.owner.homeId,
    row.targetSourceRef.workspaceId, row.targetSourceRef.homeId, key.sourceInstanceId, key.collectionId, key.sourceKind, key.externalId,
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
/** Stores local originals and hands one foreground attempt to the capture owner.
 * It has no upload, fetch, reconnect, timer-submission or retry capability. */
export function createCaptureDrafts(store: DraftStore, host: DraftHost, now: () => number = Date.now) {
  const reviews = new Map<object, { row: DraftRow; boundary: DraftBoundary }>();
  let submissions = new WeakMap<object, { boundary: DraftBoundary; intent: UploadPlaceEvidence; generation: number; taken: boolean }>();
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
    async save(input: { localId: string; selection: CaptureSelection; form: DraftForm; targetSourceRef: SourceRef; recordId: string; optedIn: true }): Promise<string> {
      if (input.optedIn !== true || !host.foreground()) throw new Error('Confirm saving a local unsent draft in the foreground');
      const captured = boundary(), atGeneration = generation;
      validateSource(input.targetSourceRef); validateForm(input.form);
      const file = input.selection.file, original = input.selection.original;
      if (!(file instanceof File) || !(original instanceof File) || file.size < 1 || file.size > DRAFT_LIMITS.fileBytes
        || original.size !== file.size || original.name !== file.name || original.lastModified !== file.lastModified
        || !['image/png', 'image/jpeg', 'application/pdf', 'text/plain'].includes(file.type)
        || input.selection.capture.filename !== original.name || input.selection.capture.reportedContentType !== original.type)
        throw new TypeError('Select an unchanged browser-returned file within the local limit');
      timestamp(input.selection.capture.selectedAt);
      // Snapshot only allowed fields before the first await, including Blob bytes.
      const time = now(), createdAt = new Date(time).toISOString();
      const row: DraftRow = {
        format: 'houseatlas-local-capture-draft/1', id: input.localId, owner: owner(captured),
        targetSourceRef: structuredClone(input.targetSourceRef), recordId: input.recordId,
        original: original.slice(0, original.size, file.type), contentType: file.type, lastModified: original.lastModified, sha256: '',
        capture: structuredClone(input.selection.capture),
        form: structuredClone(input.form), createdAt, expiresAt: new Date(time + DRAFT_LIMITS.unsentLifetimeMs).toISOString(),
        state: 'unsent', attempt: null,
      };
      const saved: DraftRow = { ...row, sha256: await digest(row.original) };
      if (await digest(file) !== saved.sha256) throw new TypeError('Capture wrapper bytes differ from the browser-returned original');
      validateRow(saved); check(captured, atGeneration, true);
      await store.change(rows => {
        check(captured, atGeneration, true); validateRows(rows);
        const existing = rows.find(candidate => candidate.id === saved.id);
        if (existing) {
          if (existing.state !== 'unsent' || manifest(existing) !== manifest(saved))
            throw new Error('Local capture identity already exists with different values or an unknown outcome');
          return { rows, value: undefined };
        }
        const next = [...rows, saved]; validateRows(next); return { rows: next, value: undefined };
      });
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
      const admission = await host.loadPlace(structuredClone(row.targetSourceRef), signal);
      signal.throwIfAborted(); check(captured, atGeneration, true); checkAdmission(admission, row);
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
      const admission = await host.loadPlace(structuredClone(review.row.targetSourceRef), signal);
      signal.throwIfAborted(); check(captured, atGeneration, true); checkAdmission(admission, review.row);
      const attempt = { requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), startedAt: new Date(now()).toISOString() };
      const attempted: DraftRow = { ...review.row, state: 'outcome-unknown', attempt };
      // Build every fallible value before persistence. A lost handoff after the
      // marker is intentionally unknown and can only be inspected/removed.
      const intent: DraftUploadIntent = Object.freeze({
        requestId: attempt.requestId, idempotencyKey: attempt.idempotencyKey, context: Object.freeze({ workspaceId: captured.workspaceId, homeId: captured.homeId }),
        recordId: attempted.recordId, expectedRevision: admission.record.revision, guards: freezeData(structuredClone(admission.guards)),
        file: originalFile(attempted), statement: attempted.form.statement, sourceLicense: Object.freeze(structuredClone(attempted.form.sourceLicense)), reason: attempted.form.reason,
        capture: Object.freeze(structuredClone(attempted.capture)),
      });
      const privateAttempt = { boundary: captured, intent, generation: atGeneration, taken: false };
      const submission: DraftSubmission = Object.freeze({ draftId: attempted.id, capture: Object.freeze(structuredClone(attempted.capture)), sha256: attempted.sha256,
        takeForForegroundSubmit: () => {
          signal.throwIfAborted(); check(captured, atGeneration, true);
          if (!submissions.has(submission) || privateAttempt.taken) throw new Error('Local attempt was already handed off or invalidated');
          privateAttempt.taken = true;
          return intent;
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
    /** Only a genuine correlated server acknowledgement releases local originals. */
    async acknowledge(submission: DraftSubmission, result: unknown): Promise<{ state: 'server-acknowledged'; requestId: string }> {
      const privateAttempt = submissions.get(submission);
      if (!privateAttempt || !privateAttempt.taken) throw new Error('Original foreground attempt is unavailable');
      const atGeneration = privateAttempt.generation; check(privateAttempt.boundary, atGeneration);
      const response = result as Record<string, unknown> | null;
      const scope = response?.['resolvedScope'] as Record<string, unknown> | undefined;
      if (!response || response['requestId'] !== privateAttempt.intent.requestId || response['commandId'] !== 'atlas.batch.execute'
        || scope?.['workspaceId'] !== privateAttempt.boundary.workspaceId || scope?.['homeId'] !== privateAttempt.boundary.homeId)
        throw new TypeError('Server acknowledgement differs from the local attempt');
      host.validateAcknowledgement(result, privateAttempt.intent);
      check(privateAttempt.boundary, atGeneration);
      await store.change(rows => {
        check(privateAttempt.boundary, atGeneration); validateRows(rows);
        const stored = rows.find(row => row.id === submission.draftId);
        if (!stored || !sameOwner(stored.owner, privateAttempt.boundary) || stored.state !== 'outcome-unknown'
          || stored.attempt?.requestId !== privateAttempt.intent.requestId || stored.attempt?.idempotencyKey !== privateAttempt.intent.idempotencyKey)
          throw new Error('Local attempt no longer matches');
        return { rows: rows.filter(row => row.id !== submission.draftId), value: undefined };
      });
      submissions.delete(submission);
      check(privateAttempt.boundary, atGeneration);
      return { state: 'server-acknowledged', requestId: privateAttempt.intent.requestId };
    },
    /** Read-only assistance after interruption/reopen. Never turns absence or
     * current evidence into retry permission, and never reconstructs a request. */
    async inspectUnknown(id: string, signal: AbortSignal): Promise<DraftUnknownInspection> {
      signal.throwIfAborted();
      const captured = boundary(), atGeneration = generation; check(captured, atGeneration, true);
      const row = await rowFor(id, captured);
      if (row.state !== 'outcome-unknown' || !row.attempt) throw new Error('No unknown local attempt exists');
      await refresh(captured, atGeneration, signal);
      const savedPlace = await host.loadPlace(structuredClone(row.targetSourceRef), signal);
      signal.throwIfAborted(); check(captured, atGeneration, true);
      if (savedPlace && (savedPlace.record.recordId !== row.recordId || savedPlace.record.workspaceId !== captured.workspaceId
        || savedPlace.record.homeId !== captured.homeId)) throw new Error('Saved information scope differs from the local attempt');
      return { draftId: row.id, attempt: structuredClone(row.attempt), targetSourceRef: structuredClone(row.targetSourceRef), recordId: row.recordId,
        sha256: row.sha256, savedPlace, outcome: 'unknown', retrySafety: 'not-established' };
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
