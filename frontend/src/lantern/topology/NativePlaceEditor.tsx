import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { NativePlaceAdmission, NativePlaceBinding, NativePlaceClient, NativePlacePrepared, NativePlacePending } from '../../api/native-place-client';
import { stringifyLosslessJson } from '../../numeric/lossless-json';
import type { Location, TopologyIndex } from './model';

/** Direct human input uses the existing admitted native commands, independently of source projections. */
export function NativePlaceEditor({ client, binding, index, location, refresh }: {
  client: NativePlaceClient; binding: NativePlaceBinding; index: TopologyIndex; location?: Location; refresh(): void;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [admission, setAdmission] = useState<NativePlaceAdmission | null>(null);
  const [pending, setPending] = useState<NativePlacePrepared | null>(null);
  const [receipt, setReceipt] = useState('');
  const [kind, setKind] = useState<'building' | 'room'>('building');
  const active = useRef<AbortController | null>(null);
  const opener = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const restoreOpener = useRef(false);
  const [, changed] = useState(0);
  useEffect(() => client.subscribePending(() => changed(value => value + 1)), [client]);
  useLayoutEffect(() => {
    if (open) heading.current?.focus();
    else if (restoreOpener.current) { restoreOpener.current = false; opener.current?.focus(); }
  }, [open]);
  const current = () => client.getBinding() === binding;
  const unresolved = current() && client.pending(binding).some(entry => entry.outcome === 'unknown');
  useEffect(() => () => active.current?.abort(), []);
  const eligible = location ? location.semantics.length === 1 && client.canRename(binding) : client.canCreate(binding, false);
  if (!eligible) return null;
  const begin = async () => {
    if (!current()) return;
    setOpen(true); setStatus(''); setBusy(true); setReceipt('');
    const controller = new AbortController(); active.current = controller;
    try {
      if (location) {
        const next = await client.load(binding, location.semantics[0]!.target.recordId, controller.signal);
        if (!controller.signal.aborted && current()) setAdmission(next);
      }
    } catch { if (!controller.signal.aborted && current()) setStatus('Current Atlas naming information could not be loaded.'); }
    finally { if (!controller.signal.aborted && current()) { setBusy(false); heading.current?.focus(); } }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || pending || unresolved || !current() || (location && !admission)) return;
    const fields = new FormData(event.currentTarget), label = String(fields.get('label') ?? ''), statement = String(fields.get('statement') ?? '').trim(), reason = String(fields.get('reason') ?? '').trim();
    const remove = fields.get('remove') === 'on';
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setStatus('Saving Atlas place…'); setReceipt('');
    let prepared: NativePlacePrepared | null = null;
    try {
      if (location && admission) prepared = client.prepareRename(admission, { label: remove ? null : label, statement, reason });
      else {
        const buildingId = String(fields.get('building') ?? '');
        const building = buildingId ? index.buildings.find(value => value.id === buildingId && value.semantics.length === 1) : undefined;
        const identity = building && index.data.identities.find(value => value.target.recordId === building.id);
        if (buildingId && (!building || !identity)) throw new Error('Reviewed building changed');
        prepared = client.prepareCreate(binding, { label, kind, statement, reason,
          ...(building && identity ? { building: { identity, classification: building.semantics[0]! } } : {}) });
      }
      setPending(prepared);
      const result = await client.commit(prepared, controller.signal);
      if (controller.signal.aborted || !current()) return;
      setReceipt(stringifyLosslessJson(result.receipt));
      if (result.status === 'committed') {
        setStatus('Saved. Reloading Atlas records…'); refresh();
      } else {
        // A canonical non-commit result is preserved; no automatic retry or inferred cancellation.
        setStatus('The host did not report a committed change. Inspect the command receipt.');
      }
    } catch {
      if (!controller.signal.aborted && current()) setStatus(prepared
        ? 'Completion is unknown. This request may have been saved. Inspect its saved receipt; do not resubmit this form.'
        : 'The form could not be prepared. Check the field limits and current access.');
    } finally { if (!controller.signal.aborted && current()) setBusy(false); }
  };
  if (!open) return <button ref={opener} type="button" onClick={() => void begin()}>{location ? 'Edit Atlas name' : 'Add Atlas place'}</button>;
  return <section aria-label={location ? 'Atlas name editing' : 'Add Atlas place'} aria-busy={busy}>
    <h3 ref={heading} tabIndex={-1}>{location ? 'Atlas name' : 'Add Atlas place'}</h3>
    <p role="status" aria-live="polite">{status}</p>
    {(!location || admission) && <form className="session-form" onSubmit={event => void submit(event)}>
      {!location && <label><span>Classification</span><select name="kind" value={kind} disabled={busy || !!pending || unresolved} onChange={event => setKind(event.target.value as 'building' | 'room')}><option value="building">Building</option><option value="room">Room</option></select></label>}
      <label><span>Atlas name (maximum 256 characters)</span><input name="label" defaultValue={admission?.record.payload.label ?? ''} required disabled={busy || !!pending || unresolved} /></label>
      {location && <label><input type="checkbox" name="remove" disabled={busy || !!pending || unresolved} onChange={event => {
        const label = event.currentTarget.form?.elements.namedItem('label');
        if (label instanceof HTMLInputElement) { label.required = !event.currentTarget.checked; label.disabled = event.currentTarget.checked; }
      }} />Remove Atlas name</label>}
      {!location && kind === 'room' && <label><span>Reviewed building membership</span><select name="building" defaultValue="" disabled={busy || !!pending || unresolved || !client.canCreate(binding, true)}><option value="">Not supplied</option>{index.buildings.filter(value => value.semantics.length === 1).map(value => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label>}
      <label><span>Your naming and membership statement (maximum 4096 characters)</span><textarea name="statement" required disabled={busy || !!pending || unresolved} /></label>
      <p className="body-text muted">This saves your report as evidence. The fact date is not supplied; receipt time is recorded.</p>
      <label><span>Reason (maximum 1024 characters)</span><input name="reason" required disabled={busy || !!pending || unresolved} /></label>
      <button type="submit" disabled={busy || !!pending || unresolved}>{location ? 'Save Atlas name' : 'Create Atlas place'}</button>
    </form>}
    {pending && <p>Request ID: {pending.requestId}</p>}
    {receipt && <details><summary>Command receipt</summary><pre>{receipt}</pre></details>}
    <button type="button" disabled={busy} onClick={() => { active.current?.abort(); restoreOpener.current = true; setOpen(false); setAdmission(null); }}>Close</button>
  </section>;
}

/** The client owns submitted bytes across disposable forms and coherent view reloads. */
export function NativePlaceReceipts({ client, binding, refresh }: { client: NativePlaceClient; binding: NativePlaceBinding; refresh(): void }) {
  const [, changed] = useState(0), [busy, setBusy] = useState<string | null>(null), [status, setStatus] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => client.subscribePending(() => changed(value => value + 1)), [client]);
  useEffect(() => {
    setBusy(null); setStatus('');
    return () => controller.current?.abort();
  }, [binding]);
  let entries: readonly NativePlacePending[] = [];
  try { entries = client.pending(binding); } catch { /* A superseded context renders no prior input. */ }
  const inspect = async (prepared: NativePlacePrepared) => {
    if (busy || client.getBinding() !== binding) return;
    const active = new AbortController(); controller.current = active;
    setBusy(prepared.requestId); setStatus('Reading saved receipt…');
    try {
      const result = await client.inspect(binding, prepared, active.signal);
      if (active.signal.aborted || client.getBinding() !== binding) return;
      setStatus(result.status === 'ready' ? 'Saved receipt read. Retry safety is not established.' : 'Saved receipt could not be read.');
      if (result.status === 'ready' && result.receipt.inspection.outcome === 'retained-commit') refresh();
    } catch { if (!active.signal.aborted && client.getBinding() === binding) setStatus('Saved receipt could not be read.'); }
    finally { if (controller.current === active) controller.current = null; if (!active.signal.aborted && client.getBinding() === binding) setBusy(null); }
  };
  if (!entries.length) return null;
  return <section aria-label="Submitted Atlas place requests">
    <h3>Submitted Atlas place requests</h3><p role="status" aria-live="polite">{status}</p>
    {entries.map(entry => <details key={entry.prepared.requestId}>
      <summary>{entry.outcome === 'committed' ? 'Saved' : 'Completion unknown'} · {entry.prepared.requestId}</summary>
      <button type="button" disabled={busy !== null} onClick={() => void inspect(entry.prepared)}>Inspect saved receipt</button>
      <p>Retained Atlas stock only. Retry safety is not established.</p>
      <details><summary>Original submitted input</summary><pre>{entry.prepared.body}</pre></details>
      {entry.receipt && <details><summary>Original command receipt</summary><pre>{stringifyLosslessJson(entry.receipt)}</pre></details>}
      {entry.inspection?.status === 'ready' && <>
        {!entry.inspection.receipt.committedResult && <p>No matching retained commit was found at this snapshot. This does not establish rollback or safe retry.</p>}
        {entry.inspection.receipt.committedResult && <p>Original media release and HTTP delivery are not established.</p>}
        <pre aria-label="Native place saved receipt">{stringifyLosslessJson(entry.inspection.receipt)}</pre>
      </>}
    </details>)}
  </section>;
}
