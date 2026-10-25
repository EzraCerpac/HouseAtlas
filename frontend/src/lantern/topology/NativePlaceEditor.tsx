import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { NativePlaceAdmission, NativePlaceBinding, NativePlaceClient, NativePlacePrepared } from '../../api/native-place-client';
import { getOutbox } from '../../outbox/index.ts';
import { PLACE_CREATE, PLACE_NAME } from '../../outbox/kinds.ts';
import { QueuedNote } from '../../outbox/ui.tsx';
import type { Location, TopologyIndex } from './model';

/** Direct human input uses the existing admitted native commands, independently of source projections. */
export function NativePlaceEditor({ client, binding, index, location, refresh }: {
  client: NativePlaceClient; binding: NativePlaceBinding; index: TopologyIndex; location?: Location; refresh(): void;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [admission, setAdmission] = useState<NativePlaceAdmission | null>(null);
  const [saved, setSaved] = useState(false), [queuedId, setQueuedId] = useState<string | null>(null);
  const [kind, setKind] = useState<'building' | 'room'>('building');
  const active = useRef<AbortController | null>(null);
  const opener = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const restoreOpener = useRef(false);
  useLayoutEffect(() => {
    if (open) heading.current?.focus();
    else if (restoreOpener.current) { restoreOpener.current = false; opener.current?.focus(); }
  }, [open]);
  const current = () => client.getBinding() === binding;
  useEffect(() => () => active.current?.abort(), []);
  const eligible = location ? location.semantics.length === 1 && client.canRename(binding) : client.canCreate(binding, false);
  if (!eligible) return null;
  const begin = async () => {
    if (!current()) return;
    setOpen(true); setStatus(''); setBusy(true); setSaved(false); setQueuedId(null);
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
    if (busy || saved || !current() || (location && !admission)) return;
    const fields = new FormData(event.currentTarget), label = String(fields.get('label') ?? ''), statement = String(fields.get('statement') ?? '').trim(), reason = String(fields.get('reason') ?? '').trim();
    const remove = fields.get('remove') === 'on';
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setStatus('Saving Atlas place…');
    let prepared: NativePlacePrepared;
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
    } catch {
      if (!controller.signal.aborted && current()) { setBusy(false); setStatus('The form could not be prepared. Check the field limits and current access.'); }
      return;
    }
    try {
      // The prepared batch goes through the device's outbox: sent at once when
      // the server answers, kept on this device when it does not.
      const record = location?.semantics[0]?.target.recordId;
      const queued = await getOutbox().submit({
        kind: location ? PLACE_NAME : PLACE_CREATE,
        label: location ? (remove ? `Remove the name of ${location.label}` : `Rename ${location.label} to ${label}`) : `Add ${kind} ${label}`,
        target: { recordType: 'location-semantics', recordId: record ?? prepared.requestId },
        intent: { label: remove ? '' : label, statement, reason, ...(record ? { recordId: record } : { kind }) },
        commandId: prepared.commandId, requestId: prepared.requestId, body: prepared.body,
      });
      if (controller.signal.aborted || !current()) {
        // The editor closed while the change was sent; the views still need it.
        if (queued.state === 'synced') refresh();
        return;
      }
      setSaved(true);
      if (queued.state === 'synced') { setStatus('Saved. Reloading Atlas records…'); refresh(); }
      else { setStatus(''); setQueuedId(queued.id); }
    } catch {
      if (!controller.signal.aborted && current()) setStatus('The change could not be saved on this device. Sign in and try again.');
    } finally { if (!controller.signal.aborted && current()) setBusy(false); }
  };
  if (!open) return <button ref={opener} type="button" onClick={() => void begin()}>{location ? 'Edit Atlas name' : 'Add Atlas place'}</button>;
  return <section aria-label={location ? 'Atlas name editing' : 'Add Atlas place'} aria-busy={busy}>
    <h3 ref={heading} tabIndex={-1}>{location ? 'Atlas name' : 'Add Atlas place'}</h3>
    <p role="status" aria-live="polite">{status}</p>
    {queuedId && <QueuedNote id={queuedId} />}
    {(!location || admission) && <form className="session-form" onSubmit={event => void submit(event)}>
      {!location && <label><span>Classification</span><select name="kind" value={kind} disabled={busy || saved} onChange={event => setKind(event.target.value as 'building' | 'room')}><option value="building">Building</option><option value="room">Room</option></select></label>}
      <label><span>Atlas name (maximum 256 characters)</span><input name="label" defaultValue={admission?.record.payload.label ?? ''} required disabled={busy || saved} /></label>
      {location && <label><input type="checkbox" name="remove" disabled={busy || saved} onChange={event => {
        const label = event.currentTarget.form?.elements.namedItem('label');
        if (label instanceof HTMLInputElement) { label.required = !event.currentTarget.checked; label.disabled = event.currentTarget.checked; }
      }} />Remove Atlas name</label>}
      {!location && kind === 'room' && <label><span>Reviewed building membership</span><select name="building" defaultValue="" disabled={busy || saved || !client.canCreate(binding, true)}><option value="">Not supplied</option>{index.buildings.filter(value => value.semantics.length === 1).map(value => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label>}
      <label><span>Your naming and membership statement (maximum 4096 characters)</span><textarea name="statement" required disabled={busy || saved} /></label>
      <p className="body-text muted">This saves your report as evidence. The fact date is not supplied; receipt time is recorded.</p>
      <label><span>Reason (maximum 1024 characters)</span><input name="reason" required disabled={busy || saved} /></label>
      <button type="submit" disabled={busy || saved}>{location ? 'Save Atlas name' : 'Create Atlas place'}</button>
    </form>}
    <button type="button" disabled={busy} onClick={() => { active.current?.abort(); restoreOpener.current = true; setOpen(false); setAdmission(null); }}>Close</button>
  </section>;
}
