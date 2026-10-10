import { useEffect, useRef, useState } from 'react';
import type { Scope, SourceRef } from '../api/generated/contracts';
import type { DraftReview, DraftSummary, DraftUnknownInspection } from '../capture-drafts/types';
import type { StockResultEnvelope } from '../webmcp/stock';
import { sameTarget, type CaptureDraftPort } from './port';

type SaveInput = Parameters<CaptureDraftPort['save']>[0];
export function CaptureDraftPanel({ port, source, recordId, candidate, canSave, parentBusy, onBusy, onSaved, onSubmitted }: {
  port: CaptureDraftPort; source: SourceRef; recordId: string | undefined;
  candidate(): SaveInput | null; canSave: boolean; parentBusy: boolean;
  onBusy(busy: boolean): void; onSaved(): void;
  onSubmitted(result: StockResultEnvelope, localCleanup: 'removed' | 'unconfirmed'): Promise<void>;
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
  const sourceKey = JSON.stringify(source);
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
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (locked.current || parentBusy) return;
    locked.current = true;
    const operation = port.operation(); active.current = operation;
    setBusy(true); onBusy(true); setStatus('');
    try { await action(operation.controller.signal); }
    catch {
      if (!operation.controller.signal.aborted)
        setStatus('Local draft action could not complete. The local file may be unavailable or its submission outcome unknown. View local drafts again.');
    } finally {
      operation.release(); if (active.current === operation) active.current = null;
      locked.current = false; setBusy(false); onBusy(false);
    }
  };
  const list = async (signal: AbortSignal) => {
    if (!(await port.prepare(signal))) throw new Error('Current boundary is unavailable');
    const rows = await port.list(); signal.throwIfAborted();
    setSummaries(rows.filter(row => sameTarget(row.targetSourceRef, source)));
  };
  const save = () => void run(async signal => {
    if (!optedIn) return;
    const input = candidate(); if (!input) return;
    if (!(await port.prepare(signal))) throw new Error('Current boundary is unavailable');
    await port.save(input); signal.throwIfAborted();
    setOptedIn(false); setReview(null); setConfirmed(false); onSaved();
    const rows = await port.list(); signal.throwIfAborted();
    setSummaries(rows.filter(row => sameTarget(row.targetSourceRef, source)));
    setStatus('Unsent draft saved on this browser. Nothing was uploaded.');
  });
  const resume = (id: string) => void run(async signal => {
    setReview(null); setInspection(null); setConfirmed(false);
    if (!(await port.prepare(signal))) throw new Error('Current boundary is unavailable');
    const next = await port.review(id, signal); signal.throwIfAborted();
    if (!sameTarget(next.targetSourceRef, source) || next.recordId !== recordId) throw new Error('Draft target differs');
    setReview(next); setStatus('Review the saved file and values. Upload requires a separate confirmation.');
    requestAnimationFrame(() => { if (!signal.aborted) reviewHeading.current?.focus(); });
  });
  const submit = () => void run(async signal => {
    if (!review || !confirmed || !recordId) return;
    const selected = review; setReview(null); setConfirmed(false);
    const completion = await port.submit(selected, source, recordId, signal);
    signal.throwIfAborted();
    // Release the foreground lease before the ordinary view refresh masks the
    // scope. Local acknowledgement already ran before this refresh.
    active.current?.release();
    if (completion.result['status'] === 'committed') {
      setSummaries([]);
      setStatus(completion.localCleanup === 'removed' ? 'Saved. The local draft was removed.' : 'Saved. Local cleanup could not be confirmed; the local attempt remains locked.');
    } else setStatus('The upload was not committed. The local attempt remains locked with an unknown outcome.');
    await onSubmitted(completion.result, completion.localCleanup);
  });
  const inspect = (id: string) => void run(async signal => {
    setReview(null); setConfirmed(false); setInspection(null);
    if (!(await port.prepare(signal))) throw new Error('Current boundary is unavailable');
    const next = await port.inspectUnknown(id, signal); signal.throwIfAborted();
    if (!sameTarget(next.targetSourceRef, source) || next.recordId !== recordId) throw new Error('Draft target differs');
    setInspection(next); setStatus('Saved information was read. This does not establish the outcome or permission to retry.');
  });
  const discard = (row: DraftSummary) => void run(async signal => {
    if (row.state === 'outcome-unknown' && !loseUnknown) return;
    if (!(await port.prepare(signal))) throw new Error('Current boundary is unavailable');
    await port.discard(row.id, { loseUnknownOutcome: loseUnknown }); signal.throwIfAborted();
    setReview(null); setInspection(null); setConfirmed(false); setLoseUnknown(false);
    const rows = await port.list(); signal.throwIfAborted();
    setSummaries(rows.filter(next => sameTarget(next.targetSourceRef, source)));
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
      <button type="button" disabled={disabled} onClick={() => void run(async signal => { setReview(null); setInspection(null); setConfirmed(false); await list(signal); setStatus('Local drafts loaded for this place and account.'); })}>View local drafts</button>
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
      <div className="actions"><button type="button" disabled={disabled || !confirmed} onClick={submit}>Confirm upload</button>
        <button type="button" disabled={disabled} onClick={() => { port.invalidate(); setReview(null); setConfirmed(false); setStatus('Review cancelled. The unsent local draft remains.'); }}>Cancel review</button></div>
    </section>}
    {inspection && <section aria-label="Unknown capture outcome">
      <h4>Outcome unknown</h4>
      <p>Request {inspection.attempt.requestId} · Started {inspection.attempt.startedAt}</p>
      <p>{inspection.savedPlace ? `Current Atlas revision: ${inspection.savedPlace.record.revision}.` : 'Current Atlas place information is unavailable.'} Retry safety is not established. This draft cannot be uploaded again.</p>
    </section>}
  </div>;
}

/** Stable qualified identity; labels and route positions do not retarget drafts. */
export function captureTargetKey(scope: Scope, key: SourceRef['key']): string {
  return JSON.stringify([scope.workspaceId, scope.homeId, key.sourceInstanceId, key.collectionId, key.sourceKind, key.externalId]);
}
