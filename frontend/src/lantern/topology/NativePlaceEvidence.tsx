import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { NativePlaceBinding } from '../../api/native-place-client';
import type { NativeEvidenceAdmission, NativeEvidenceClient, NativeEvidencePending, NativeEvidencePrepared } from '../../api/native-evidence-client';
import { EvidencePicker } from '../../capture-evidence/EvidencePicker';
import type { EvidenceSelection } from '../../capture-evidence/selection';
import { stringifyLosslessJson } from '../../numeric/lossless-json';
import type { Location, TopologyIndex } from './model';
import { LinkedEvidence } from '../components/LinkedEvidence';

/** A native record row owns no source fallback, persistence or submitted-request replay. */
export function NativePlaceEvidence({ client, binding, location, index, refresh }: {
  client: NativeEvidenceClient; binding: NativePlaceBinding; location: Location; index: TopologyIndex; refresh(): void;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [admission, setAdmission] = useState<NativeEvidenceAdmission | null>(null), [selection, setSelection] = useState<EvidenceSelection | null>(null);
  const [offers, setOffers] = useState<ReadonlyMap<NativeEvidencePrepared, string>>(new Map());
  const [, changed] = useState(0);
  const active = useRef<AbortController | null>(null), submitting = useRef(false);
  const opener = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null), restoreOpener = useRef(false);
  const classification = location.semantics.length === 1 ? location.semantics[0] : undefined;
  const eligible = classification?.lifecycle === 'active' && classification.payload.reviewStatus === 'accepted'
    && !index.data.bindings.some(b => b.lifecycle === 'active' && b.payload.atlasId === location.id);
  const identity = index.data.identities.find(record => record.lifecycle === 'active' && record.target.recordId === location.id && record.payload.kind === 'location');
  const recordId = classification?.target.recordId;
  const current = () => client.getBinding() === binding;
  let homeAttempts: readonly NativeEvidencePending[] = [];
  try { if (current()) homeAttempts = client.pending(binding); } catch { /* Superseded/expired session reveals no prior inputs. */ }
  const attempts = homeAttempts.filter(attempt => attempt.prepared.recordId === recordId);
  const unknown = homeAttempts.some(attempt => attempt.outcome === 'unknown');
  useEffect(() => client.subscribePending(() => changed(v => v + 1)), [client]);
  useLayoutEffect(() => {
    const clear = () => {
      active.current?.abort(); active.current = null; submitting.current = false;
      setOpen(false); setAdmission(null); setSelection(null); setOffers(new Map()); setBusy(false); setStatus('');
    };
    clear();
    const unsubscribe = client.subscribe(() => { if (!current()) clear(); });
    return () => { unsubscribe(); active.current?.abort(); active.current = null; };
  }, [client, binding, recordId]);
  useLayoutEffect(() => {
    if (open) heading.current?.focus();
    else if (restoreOpener.current) { restoreOpener.current = false; opener.current?.focus(); }
  }, [open]);
  const start = () => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setBusy(true); return controller;
  };
  const live = (controller: AbortController) => !controller.signal.aborted && active.current === controller && current();
  const finish = (controller: AbortController) => { if (live(controller)) { active.current = null; setBusy(false); submitting.current = false; } };
  const load = async () => {
    if (busy || !current() || !recordId || !eligible) return;
    setOpen(true); setStatus('Loading native evidence information…');
    const controller = start();
    try {
      const value = await client.load(binding, recordId, controller.signal);
      if (!live(controller)) return;
      if (value.identity.recordId !== location.id) throw new Error('Selected native identity changed');
      setAdmission(value); setStatus(value.canAttachEvidence ? '' : 'Evidence attachment is unavailable for the current access.');
    } catch { if (live(controller)) { setAdmission(null); setStatus('Current native evidence information could not be loaded.'); } }
    finally { finish(controller); }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || submitting.current || unknown || !selection || !admission?.attachmentPolicy || !admission.canAttachEvidence || !current()) return;
    const fields = new FormData(event.currentTarget), statement = String(fields.get('statement') ?? '').trim(), reason = String(fields.get('reason') ?? '').trim();
    const license = fields.get('license');
    if (license !== '0' || !statement || [...statement].length > 4096 || !reason || [...reason].length > admission.maximumReasonCodePoints) {
      setStatus('Select the license and check the statement and reason limits.'); return;
    }
    submitting.current = true;
    const controller = start(); let prepared: NativeEvidencePrepared | null = null;
    setStatus('Checking file and reading fresh native admission…');
    try {
      prepared = await client.prepare(admission, { selection, statement, reason, sourceLicense: admission.attachmentPolicy.licenses[0]!.value }, controller.signal);
      if (!live(controller)) return;
      setStatus('Uploading native evidence…');
      const result = await client.commit(prepared, controller.signal);
      if (!live(controller)) return;
      if (result.outcome !== 'committed') throw new Error('Native evidence completion is unknown');
      setSelection(null); setAdmission(null); setOpen(false); restoreOpener.current = true;
      setStatus('Saved native evidence. Reloading Atlas records…'); refresh();
    } catch {
      if (live(controller)) {
        let completionUnknown = false;
        try { completionUnknown = client.pending(binding).some(attempt => attempt.outcome === 'unknown'); }
        catch { /* Expired or superseded session cannot expose prior attempt state. */ }
        setStatus(completionUnknown ? 'Completion is unknown. The evidence may have been saved. Do not resend; inspect saved information.'
          : 'The file or fresh admission could not be prepared. Check the field limits, format and current access.');
      }
    } finally { finish(controller); }
  };
  const inspect = async (attempt: NativeEvidencePending) => {
    if (busy || !current()) return;
    const controller = start(); setStatus('Reading saved native information…');
    try {
      const result = await client.inspect(binding, attempt.prepared, controller.signal);
      if (!live(controller)) return;
      if (result.admission.identity.recordId !== location.id) throw new Error('Selected native identity changed');
      setAdmission(result.admission); setStatus('Saved native information read. Completion remains unknown; retry safety is not established.');
    } catch { if (live(controller)) setStatus('Saved native information could not be read. Completion remains unknown; do not resend.'); }
    finally { finish(controller); }
  };
  const original = async (attempt: NativeEvidencePending) => {
    if (busy || !current()) return;
    const controller = start(); setStatus('Checking retained original availability…');
    setOffers(old => { const next = new Map(old); next.delete(attempt.prepared); return next; });
    try {
      const offer = await client.resolveOriginal(binding, attempt.prepared, controller.signal);
      if (!live(controller)) return;
      if (offer) { setOffers(old => new Map(old).set(attempt.prepared, offer.href)); setStatus('Original download available. Access and retained bytes are checked again on use.'); }
      else setStatus('No original download is available from the current native read.');
    } catch { if (live(controller)) setStatus('Original download availability could not be established.'); }
    finally { finish(controller); }
  };
  if (!eligible || !recordId || !current()) return null;
  return <div className="topology-evidence">
    {identity && <details><summary>Native identity evidence ({identity.payload.evidenceIds.length})</summary>
      {identity.payload.evidenceIds.map(id => <div key={id}><span>Evidence ID: {id}</span><LinkedEvidence evidenceId={id} /></div>)}
    </details>}
    {!open && <button ref={opener} type="button" disabled={busy || unknown} onClick={() => void load()}>Add native evidence</button>}
    {unknown && !attempts.some(attempt => attempt.outcome === 'unknown') && <p role="status">A native evidence submission in this home has unknown completion. Do not resend; inspect saved information in its originating row.</p>}
    <p role="status" aria-live="polite">{status}</p>
    {open && <section aria-label={`Native evidence for ${location.label}`} aria-busy={busy}>
      <h3 ref={heading} tabIndex={-1}>Add native evidence</h3>
      <p>Atlas identity: {location.id} · classification: {recordId}</p>
      {admission?.canAttachEvidence && admission.attachmentPolicy && <form className="session-form" onSubmit={event => void submit(event)}>
        <EvidencePicker policy={admission.attachmentPolicy} busy={busy || unknown} value={selection} onChange={setSelection} />
        <label><span>Evidence statement (maximum 4096 characters)</span><textarea name="statement" required disabled={busy || unknown} /></label>
        <p className="body-text muted">Evidence basis is unknown. The fact date is not supplied; the server records retrieval time. Browser selection labels are unverified.</p>
        <label><span>Source license</span><select name="license" defaultValue="" required disabled={busy || unknown}>
          <option value="">Select license</option>{admission.attachmentPolicy.licenses.map((choice, i) => <option key={i} value={String(i)}>{choice.label}</option>)}
        </select></label>
        <label><span>Reason (maximum 1024 characters)</span><input name="reason" required disabled={busy || unknown} /></label>
        <button type="submit" disabled={busy || unknown || !selection}>Upload native evidence</button>
      </form>}
      {!admission && <button type="button" disabled={busy} onClick={() => void load()}>Reload native admission</button>}
      <button type="button" onClick={() => {
        active.current?.abort(); active.current = null; submitting.current = false; restoreOpener.current = true;
        setOpen(false); setAdmission(null); setSelection(null); setBusy(false);
      }}>Close</button>
    </section>}
    {attempts.map(attempt => <details key={attempt.prepared.requestId}>
      <summary>{attempt.outcome === 'committed' ? 'Native evidence saved' : 'Native evidence completion unknown'} · {attempt.prepared.requestId}</summary>
      {attempt.outcome === 'unknown' ? <>
        <p>Do not resend this request. A saved-information read cannot establish rollback or safe retry. Attempt information is held in memory for this application session.</p>
        <button type="button" disabled={busy} onClick={() => void inspect(attempt)}>Inspect saved native information</button>
      </> : <>
        <p>Evidence ID: {attempt.evidenceId} · original asset ID: {attempt.assetId}</p>
        <button type="button" disabled={busy} onClick={() => void original(attempt)}>Check original download</button>
        {offers.get(attempt.prepared) && <a href={offers.get(attempt.prepared)} download rel="noopener" referrerPolicy="same-origin" onClick={event => { if (!current()) event.preventDefault(); }}>Download original</a>}
        {attempt.receipt && <details><summary>Native command receipt</summary><pre>{stringifyLosslessJson(attempt.receipt)}</pre></details>}
      </>}
    </details>)}
  </div>;
}
