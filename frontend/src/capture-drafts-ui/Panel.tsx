import { useEffect, useRef, useState } from 'react';
import type { Scope, SourceRef } from '../api/generated/contracts';
import { DRAFT_LIMITS, type DraftReview, type DraftSummary, type DraftUnknownInspection } from '../capture-drafts/types';
import type { DraftLimitError } from '../capture-drafts/validation';
import { sameTarget, type CaptureDraftPort, type DraftCompletion } from './port';

type SaveInput = Parameters<CaptureDraftPort['save']>[0];
export function CaptureDraftPanel({ port, source, recordId, candidate, canSave, canUpload = true, parentBusy, onBusy, onSaved, onSubmitted }: {
  /** Null for a native Atlas place; its drafts are matched by recordId. */
  port: CaptureDraftPort; source: SourceRef | null; recordId: string | undefined;
  candidate(): SaveInput | null; canSave: boolean;
  /** False blocks Confirm upload only; listing, review, inspection and removal stay available. */
  canUpload?: boolean; parentBusy: boolean;
  onBusy(busy: boolean): void; onSaved(): void;
  onSubmitted(completion: DraftCompletion): Promise<void>;
}) {
  const [summaries, setSummaries] = useState<readonly DraftSummary[]>([]);
  const [review, setReview] = useState<DraftReview | null>(null);
  const [inspection, setInspection] = useState<DraftUnknownInspection | null>(null);
  const [status, setStatus] = useState('');
  const [originalUrl, setOriginalUrl] = useState<{ file: File; url: string } | null>(null);
  const [optedIn, setOptedIn] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [loseUnknown, setLoseUnknown] = useState(false), [busy, setBusy] = useState(false);
  const active = useRef<ReturnType<CaptureDraftPort['operation']> | null>(null);
  const locked = useRef(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const reviewed = useRef<string | null>(null);
  const sourceKey = JSON.stringify(source);
  const mine = (row: DraftSummary) => sameTarget(row.targetSourceRef, source) && (source !== null || row.recordId === recordId);
  useEffect(() => {
    if (!review) { setOriginalUrl(null); return; }
    const url = URL.createObjectURL(review.file); setOriginalUrl({ file: review.file, url });
    return () => URL.revokeObjectURL(url);
  }, [review]);
  useEffect(() => {
    const clear = () => {
      setReview(null); setInspection(null); setSummaries([]); setConfirmed(false); setOptedIn(false); setLoseUnknown(false);
    };
    const unsubscribe = port.subscribeInvalidation(clear);
    return () => { unsubscribe(); active.current?.controller.abort(); active.current?.release(); port.invalidate(); };
  }, [port, sourceKey, recordId]);
  const run = async (action: (signal: AbortSignal) => Promise<void>, explain: (error: unknown) => string | null = () => null) => {
    if (locked.current || parentBusy) return;
    locked.current = true;
    const operation = port.operation(); active.current = operation;
    setBusy(true); onBusy(true); setStatus('');
    try { await action(operation.controller.signal); }
    catch (error) {
      if (!operation.controller.signal.aborted)
        setStatus(explain(error) ?? 'Local draft action could not complete. The local file may be unavailable or its submission outcome unknown. View local drafts again.');
    } finally {
      operation.release(); if (active.current === operation) active.current = null;
      locked.current = false; setBusy(false); onBusy(false);
    }
  };
  // Save, list and removal are local only: they use the identity this session already
  // holds, with no network read, so they work offline. Review and upload read the session.
  // A held identity can still be refused for focus alone (activation without focusing the page); say which.
  const held = (refusal: string) => {
    if (port.current()) return true;
    setStatus(`${refusal}: ${port.foreground() ? 'this browser holds no signed-in session for this home.' : 'this page is not in the foreground. Select the page and try again.'}`);
    return false;
  };
  const unheld = 'Local drafts unavailable';
  const save = () => void run(async signal => {
    if (!optedIn) return;
    if (!held('Local draft not saved')) return;
    const input = candidate(); if (!input) return;
    await port.save(input); signal.throwIfAborted();
    setOptedIn(false); setReview(null); setConfirmed(false); onSaved();
    const rows = await port.list(); signal.throwIfAborted();
    setSummaries(rows.filter(mine));
    setStatus('Unsent draft saved on this browser. Nothing was uploaded.');
  }, error => {
    const name = (error as Error | null)?.name;
    if (name === 'QuotaExceededError') return 'Local draft not saved: this browser has no room for the file. Nothing was sent.';
    if (name === 'DraftWriteError') return 'Local draft not saved: this browser could not store the file. Nothing was sent. Try again.';
    return name !== 'DraftLimitError' ? null : (error as DraftLimitError).limit === 'count'
      ? `Local draft not saved: this browser already holds the maximum of ${DRAFT_LIMITS.count} local drafts, including any for other places or accounts.`
      : `Local draft not saved: it would exceed the ${DRAFT_LIMITS.totalBytes / 1024 / 1024} MiB total for local drafts in this browser, including any for other places or accounts.`;
  });
  // The stored rows as they are now, for the current account and this place. Like every
  // other action, a result arriving after this operation was invalidated is discarded.
  const relist = async (signal: AbortSignal) => {
    let rows: DraftSummary[];
    try { rows = (await port.list()).filter(mine); } catch { signal.throwIfAborted(); return null; }
    signal.throwIfAborted(); setSummaries(rows); return rows;
  };
  const resume = (id: string) => void run(async signal => {
    setReview(null); setInspection(null); setConfirmed(false);
    if (!(await port.prepare(signal))) throw new Error('Current boundary is unavailable');
    const next = await port.review(id, signal); signal.throwIfAborted();
    if (!sameTarget(next.targetSourceRef, source) || next.recordId !== recordId) throw new Error('Draft target differs');
    reviewed.current = id; setReview(next); setStatus('Review the saved file and values. Upload requires a separate confirmation.');
    requestAnimationFrame(() => { if (!signal.aborted) reviewHeading.current?.focus(); });
  });
  const submit = () => void run(async signal => {
    if (!review || !confirmed || !recordId || !canUpload) return;
    const selected = review, selectedId = reviewed.current; setReview(null); setConfirmed(false);
    let completion: DraftCompletion;
    try { completion = await port.submit(selected, source, recordId, signal); }
    catch (error) {
      // A failed send leaves the row as stored before sending; show that state now, without a reload.
      signal.throwIfAborted();
      const rows = await relist(signal); signal.throwIfAborted();
      if (rows?.some(row => row.id === selectedId && row.state === 'outcome-unknown')) {
        setStatus('Upload outcome unknown: the server may have saved this file. It will not be sent again automatically. Read its saved information before any further action.');
        return;
      }
      throw error;
    }
    signal.throwIfAborted();
    // Re-list while this operation can still be invalidated, before releasing it.
    if (!completion.committed) { await relist(signal); signal.throwIfAborted(); }
    // Release the foreground lease before the ordinary view refresh masks the
    // scope. Local acknowledgement already ran before this refresh.
    active.current?.release();
    if (completion.committed) {
      setSummaries([]);
      setStatus(completion.localCleanup === 'removed' ? 'Saved. The local draft was removed.' : 'Saved. Local cleanup could not be confirmed; the local attempt remains locked.');
    } else setStatus('The upload was not committed. The local attempt remains locked with an unknown outcome.');
    await onSubmitted(completion);
  });
  const inspect = (id: string) => void run(async signal => {
    setReview(null); setConfirmed(false); setInspection(null);
    if (!(await port.prepare(signal))) throw new Error('Current boundary is unavailable');
    const next = await port.inspectUnknown(id, signal); signal.throwIfAborted();
    if (!sameTarget(next.targetSourceRef, source) || next.recordId !== recordId) throw new Error('Draft target differs');
    setInspection(next); setStatus('Saved information was read. This does not establish the outcome or permission to retry.');
  });
  const discard = (row: DraftSummary) => void run(async signal => {
    if ((row.state === 'outcome-unknown' && !loseUnknown) || !held(unheld)) return;
    await port.discard(row.id, { loseUnknownOutcome: loseUnknown }); signal.throwIfAborted();
    setReview(null); setInspection(null); setConfirmed(false); setLoseUnknown(false);
    const rows = await port.list(); signal.throwIfAborted();
    setSummaries(rows.filter(mine));
    setStatus('Local file removed. This does not cancel any server operation.');
  });
  const unavailable = port.unavailableReason();
  const disabled = busy || parentBusy || !!unavailable;
  return <div className="setting" aria-label="Local capture drafts" aria-busy={busy}>
    <h3>Local drafts</h3>
    {unavailable && <p role="alert">{unavailable}</p>}
    <p>Stored only in this browser: up to 4 files, 10 MiB each, 32 MiB total. Unsent drafts expire after 7 days. Browser cleanup can remove them; this is not a backup.</p>
    <label><input type="checkbox" checked={optedIn} disabled={disabled || !canSave} onChange={event => setOptedIn(event.target.checked)} /> Save this file and reviewed values locally without uploading</label>
    <div className="actions">
      <button type="button" disabled={disabled || !canSave || !optedIn} onClick={save}>Save local draft</button>
      <button type="button" disabled={disabled} onClick={() => void run(async signal => { setReview(null); setInspection(null); setConfirmed(false); if (!held(unheld)) return;
        const rows = await port.list(); signal.throwIfAborted(); setSummaries(rows.filter(mine)); setStatus('Local drafts loaded for this place and account.'); })}>View local drafts</button>
    </div>
    <p role="status" aria-live="polite">{status}</p>
    {summaries.length > 0 && <ul>{summaries.map(row => <li key={row.id}>
      <p>{row.filename} · {row.byteSize} bytes · {row.state === 'unsent' ? row.expired ? 'Expired unsent draft' : 'Unsent draft' : 'Outcome unknown'}</p>
      <p>Saved {row.createdAt}{row.state === 'unsent' ? ` · Expires ${row.expiresAt}` : ''}</p>
      <div className="actions">
        {row.state === 'unsent' ? <button type="button" disabled={disabled || row.expired || !recordId || row.recordId !== recordId} onClick={() => resume(row.id)}>Review {row.filename}</button>
          : <button type="button" disabled={disabled || !recordId || row.recordId !== recordId} onClick={() => inspect(row.id)}>Read saved information for {row.filename}</button>}
        <button type="button" disabled={disabled || (row.state === 'outcome-unknown' && !loseUnknown)} onClick={() => discard(row)}>Remove local {row.filename}</button>
      </div>
    </li>)}</ul>}
    {summaries.some(row => row.state === 'outcome-unknown') && <label><input type="checkbox" checked={loseUnknown} disabled={disabled} onChange={event => setLoseUnknown(event.target.checked)} /> I understand removing an unknown local attempt loses this local file and does not cancel or retry the server operation</label>}
    {review && <section aria-label="Saved capture review">
      <h4 ref={reviewHeading} tabIndex={-1}>Review local draft</h4>
      <p>{review.file.name} · {review.file.size} bytes · {review.file.type}</p>
      {originalUrl?.file === review.file && <a href={originalUrl.url} download={review.file.name}>Download local original for review</a>}
      <dl>
        <dt>Evidence statement</dt><dd>{review.form.statement}</dd>
        <dt>Source licence</dt><dd>{review.form.sourceLicense.status} · {review.form.sourceLicense.reference}</dd>
        <dt>Reason</dt><dd>{review.form.reason}</dd>
        <dt>Browser selection</dt><dd>{review.capture.selectionMethod} · {review.capture.selectedAt}</dd>
        <dt>Original bytes SHA-256</dt><dd>{review.sha256}</dd>
      </dl>
      <p>These saved values are fixed for this attempt. To change them, remove this unsent draft and select the file again. Browser selection time does not establish device capture time.</p>
      <label><input type="checkbox" checked={confirmed} disabled={disabled} onChange={event => setConfirmed(event.target.checked)} /> Upload this saved file and these values to this Atlas place once</label>
      <div className="actions"><button type="button" disabled={disabled || !confirmed || !canUpload} onClick={submit}>Confirm upload</button>
        <button type="button" disabled={disabled} onClick={() => { port.invalidate(); setReview(null); setConfirmed(false); setStatus('Review cancelled. The unsent local draft remains.'); }}>Cancel review</button></div>
    </section>}
    {inspection && <section aria-label="Unknown capture outcome">
      <h4>Outcome unknown</h4>
      <p>Request {inspection.attempt.requestId} · Started {inspection.attempt.startedAt}</p>
      <p>{inspection.savedRevision !== null ? `Current Atlas revision: ${inspection.savedRevision}.` : 'Current Atlas place information is unavailable.'} Retry safety is not established. This draft cannot be uploaded again.</p>
    </section>}
  </div>;
}

/** Stable qualified identity; labels and route positions do not retarget drafts. */
export function captureTargetKey(scope: Scope, key: SourceRef['key']): string {
  return JSON.stringify([scope.workspaceId, scope.homeId, key.sourceInstanceId, key.collectionId, key.sourceKind, key.externalId]);
}
