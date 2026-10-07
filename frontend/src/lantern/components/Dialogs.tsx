import { useMemo, useState, type FormEvent } from 'react';
import type { Claim, Doc, DocKind, Item, Task } from '../data/types';
import { CLAIM_HELP, CLAIM_LABEL, docsFor, kindOf, nameOf, writesFor } from '../data/query';
import { DEMO_TODAY, addDays, demoNowIso, fmtDate, fmtDateTime } from '../data/time';
import { makeWrite, useCanWrite, useStore, type Dialog } from '../state/store';
import { Field, Modal, SimNote } from './Modal';
import { MEDIA_TRAY, MediaScene } from './Art';
import { Note, StorageTag } from './ui';
import { PreviewDialog } from './Previews';

let localSeq = 1;

export function DialogHost() {
  const { state } = useStore();
  const d = state.dialog;
  if (!d) return null;
  return <DialogSwitch d={d} />;
}

function DialogSwitch({ d }: { d: Dialog }) {
  switch (d.type) {
    case 'editItem':
      return <EditItemDialog itemId={d.itemId} />;
    case 'link':
      return <LinkDialog targetId={d.targetId} />;
    case 'media':
      return <MediaDialog targetId={d.targetId} />;
    case 'complete':
      return <CompleteDialog taskId={d.taskId} />;
    case 'schedule':
      return <ScheduleDialog targetId={d.targetId} afterTaskId={d.afterTaskId} />;
    case 'preview':
      return <PreviewDialog docId={d.docId} />;
    case 'conflict':
      return <ConflictDialog writeId={d.writeId} />;
    default:
      return null;
  }
}

function useClose() {
  const { dispatch } = useStore();
  return (discarded?: boolean) => {
    dispatch({ type: 'dialog', dialog: null });
    if (discarded) dispatch({ type: 'toast', text: 'Discarded. Nothing was changed.', tone: 'info' });
  };
}

function Blocked({ title, reason }: { title: string; reason: string }) {
  const close = useClose();
  return (
    <Modal title={title} onClose={() => close()} footer={<button type="button" className="btn btn-primary" onClick={() => close()}>Close</button>}>
      <Note tone="warn">{reason}</Note>
    </Modal>
  );
}

// ---------------- Edit belonging ----------------

const CLAIMS: Claim[] = ['owner', 'confirmed', 'disputed', 'unknown'];

function EditItemDialog({ itemId }: { itemId: string }) {
  const { house, dispatch } = useStore();
  const close = useClose();
  const can = useCanWrite('HomeBox');
  const item = house.items.find((i) => i.id === itemId);
  const [name, setName] = useState(item?.name ?? '');
  const [spaceId, setSpaceId] = useState(item?.spaceId ?? (item?.containerId ? house.containers.find((c) => c.id === item.containerId)?.spaceId ?? '' : ''));
  const [containerId, setContainerId] = useState(item?.containerId ?? '');
  const [claim, setClaim] = useState<Claim>(item?.locationClaim ?? 'owner');
  const [evidence, setEvidence] = useState('');
  const [note, setNote] = useState(item?.note ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!item) return null;
  if (!can.ok) return <Blocked title={`Edit ${item.name}`} reason={can.reason!} />;

  const evidenceDocs = docsFor(house, item.id).filter((d) => d.storage === 'stored' && (d.kind === 'photo' || d.kind === 'report' || d.kind === 'receipt'));
  const containers = house.containers.filter((c) => c.spaceId === spaceId);
  const floors = [...house.floors].sort((a, b) => b.order - a.order);
  const effectiveClaim: Claim = spaceId ? claim : 'unknown';
  const origSpace = item.spaceId ?? house.containers.find((c) => c.id === item.containerId)?.spaceId ?? '';
  const dirty =
    name.trim() !== item.name ||
    spaceId !== origSpace ||
    containerId !== (item.containerId ?? '') ||
    effectiveClaim !== item.locationClaim ||
    note.trim() !== (item.note ?? '');
  const pending = writesFor(house, item.id);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const n = name.trim();
    if (!n) errs.name = 'Enter a name.';
    else if (n.length > 60) errs.name = `Keep the name to 60 characters. It is ${n.length} now.`;
    if (effectiveClaim === 'confirmed' && claim !== item.locationClaim && !evidence) {
      errs.evidence = 'Confirmed needs evidence. Pick a photo or document, or choose Owner reported.';
    }
    if (note.trim().length > 280) errs.note = 'Keep the note to 280 characters.';
    if (!dirty) errs.form = 'Nothing has changed yet. Edit a field or cancel.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const set: Partial<Item> = {};
    const changes: string[] = [];
    if (n !== item.name) {
      set.name = n;
      changes.push(`rename to "${n}"`);
    }
    if (spaceId !== origSpace || containerId !== (item.containerId ?? '')) {
      set.spaceId = spaceId || undefined;
      set.containerId = containerId || undefined;
      set.pos = undefined;
      const where = containerId ? nameOf(house, containerId) : spaceId ? nameOf(house, spaceId) : 'unknown location';
      changes.push(`move to ${where}`);
    }
    if (effectiveClaim !== item.locationClaim) {
      set.locationClaim = effectiveClaim;
      changes.push(`location ${CLAIM_LABEL[effectiveClaim].toLowerCase()}`);
    }
    if (note.trim() !== (item.note ?? '')) {
      set.note = note.trim() || undefined;
      changes.push('update note');
    }
    const title = `${item.name}: ${changes.join(', ')}`;
    dispatch({ type: 'queueWrite', write: makeWrite({ title, targetId: item.id, system: 'HomeBox', patch: { op: 'updateItem', id: item.id, set } }) });
    if (evidence && effectiveClaim === 'confirmed') {
      dispatch({
        type: 'queueWrite',
        write: makeWrite({ title: `Use "${nameOf(house, evidence)}" as location evidence`, targetId: item.id, system: 'Atlas', patch: { op: 'none' } }),
      });
    }
    dispatch({ type: 'dialog', dialog: null });
    dispatch({ type: 'toast', text: 'Sending to HomeBox. Watch the status on the record.', tone: 'info' });
  };

  return (
    <Modal
      title={`Edit ${item.name}`}
      kicker="Belonging, kept in HomeBox"
      onClose={() => close(dirty)}
      footer={
        <>
          <SimNote />
          <button type="button" className="btn" onClick={() => close(dirty)}>
            Cancel
          </button>
          <button type="submit" form="edit-item" className="btn btn-primary">
            Save changes
          </button>
        </>
      }
    >
      <form id="edit-item" className="form" onSubmit={submit} noValidate>
        {pending.length > 0 && <Note tone="warn">Another change to this belonging is still in progress. Saving now may need review.</Note>}
        {errors.form && (
          <p className="form-error" role="alert">
            {errors.form}
          </p>
        )}
        <Field id="f-name" label="Name" error={errors.name ?? ''}>
          <input id="f-name" data-autofocus value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'f-name-error' : undefined} />
        </Field>
        <div className="field-row">
          <Field id="f-room" label="Room" hint="Moving to another room clears the exact spot on the plan.">
            <select
              id="f-room"
              value={spaceId}
              onChange={(e) => {
                setSpaceId(e.target.value);
                setContainerId('');
              }}
            >
              <option value="">Location unknown</option>
              {floors.map((f) => (
                <optgroup key={f.id} label={f.name}>
                  {house.spaces
                    .filter((s) => s.floorId === f.id && s.kind !== 'stair')
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field id="f-container" label="Storage in that room">
            <select id="f-container" value={containerId} onChange={(e) => setContainerId(e.target.value)} disabled={!spaceId || containers.length === 0}>
              <option value="">{containers.length ? 'Not in storage' : 'No storage recorded here'}</option>
              {containers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <fieldset className="field radio-cards">
          <legend>How sure is the location?</legend>
          {!spaceId && <p className="field-hint">With no room, the location is recorded as unknown.</p>}
          {CLAIMS.map((c) => (
            <label key={c} className={`radio-card${effectiveClaim === c ? ' is-on' : ''}`}>
              <input type="radio" name="claim" value={c} checked={effectiveClaim === c} disabled={!spaceId} onChange={() => setClaim(c)} />
              <span className="radio-title">{CLAIM_LABEL[c]}</span>
              <span className="radio-help">{CLAIM_HELP[c]}</span>
            </label>
          ))}
        </fieldset>
        {effectiveClaim === 'confirmed' && claim !== item.locationClaim && (
          <Field id="f-evidence" label="Evidence for the location" error={errors.evidence ?? ''}>
            <select id="f-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} aria-invalid={!!errors.evidence}>
              <option value="">Choose a stored photo or document</option>
              {evidenceDocs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field id="f-note" label="Note" error={errors.note ?? ''} hint={`${note.trim().length} of 280 characters`}>
          <textarea id="f-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!errors.note} />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------- Link document ----------------

function LinkDialog({ targetId }: { targetId: string }) {
  const { house, dispatch } = useStore();
  const close = useClose();
  const [mode, setMode] = useState<'stored' | 'link'>('stored');
  const [query, setQuery] = useState('');
  const [docId, setDocId] = useState('');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('https://');
  const [kind, setKind] = useState<DocKind>('manual');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const targetName = nameOf(house, targetId);
  const candidates = useMemo(
    () =>
      house.docs
        .filter((d) => d.storage === 'stored' && !d.linkedTo.includes(targetId))
        .filter((d) => !query.trim() || d.title.toLowerCase().includes(query.trim().toLowerCase())),
    [house.docs, query, targetId],
  );
  const dirty = !!docId || title.trim() !== '' || url !== 'https://';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (mode === 'stored') {
      if (!docId) errs.doc = 'Choose a stored document to link.';
    } else {
      if (!title.trim()) errs.title = 'Enter a title so people know what the link is.';
      else if (title.trim().length > 80) errs.title = 'Keep the title to 80 characters.';
      let parsed: URL | null = null;
      try {
        parsed = new URL(url.trim());
      } catch {
        parsed = null;
      }
      if (!parsed || !parsed.hostname.includes('.')) errs.url = 'Enter a full web address, like https://example.org/manual.';
      else if (parsed.protocol !== 'https:') errs.url = 'Use an https:// address.';
      else if (house.docs.some((d) => d.url === parsed!.href)) errs.url = 'This address is already in the library. Link the existing entry instead.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (mode === 'stored') {
      const doc = house.docs.find((d) => d.id === docId)!;
      dispatch({
        type: 'queueWrite',
        write: makeWrite({ title: `Link "${doc.title}" to ${targetName}`, targetId, system: 'Atlas', patch: { op: 'linkDoc', docId, targetId } }),
      });
    } else {
      const doc: Doc = {
        id: `doc-local-${localSeq++}`,
        title: title.trim(),
        kind,
        storage: 'link',
        url: new URL(url.trim()).href,
        linkCheckedAt: demoNowIso(),
        source: 'Link added in Atlas',
        addedBy: 'You',
        addedAt: demoNowIso(),
        linkedTo: [targetId],
        version: 1,
        preview: 'none',
        owner: 'Atlas',
      };
      dispatch({
        type: 'queueWrite',
        write: makeWrite({ title: `Add link "${doc.title}" to ${targetName}`, targetId, system: 'Atlas', patch: { op: 'addDoc', doc } }),
      });
    }
    dispatch({ type: 'dialog', dialog: null });
    dispatch({ type: 'toast', text: 'Linking. The record will update when it is saved.', tone: 'info' });
  };

  return (
    <Modal
      title={`Link a document to ${targetName}`}
      kicker="Links are kept in Atlas"
      onClose={() => close(dirty)}
      footer={
        <>
          <SimNote />
          <button type="button" className="btn" onClick={() => close(dirty)}>
            Cancel
          </button>
          <button type="submit" form="link-doc" className="btn btn-primary">
            Link document
          </button>
        </>
      }
    >
      <form id="link-doc" className="form" onSubmit={submit} noValidate>
        <div className="seg seg-wide" role="radiogroup" aria-label="Kind of document">
          <button type="button" role="radio" aria-checked={mode === 'stored'} onClick={() => setMode('stored')} data-autofocus>
            Stored document
          </button>
          <button type="button" role="radio" aria-checked={mode === 'link'} onClick={() => setMode('link')}>
            External link
          </button>
        </div>
        {mode === 'stored' ? (
          <>
            <p className="field-hint">A stored document is a file already kept with the household records. Linking it here does not copy it.</p>
            <Field id="f-q" label="Filter the library">
              <input id="f-q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Manual, receipt, report" />
            </Field>
            <fieldset className="field">
              <legend className="sr-only">Stored documents</legend>
              {errors.doc && (
                <p className="field-error" role="alert">
                  {errors.doc}
                </p>
              )}
              <ul className="choice-list">
                {candidates.map((d) => (
                  <li key={d.id}>
                    <label className={`choice${docId === d.id ? ' is-on' : ''}`}>
                      <input type="radio" name="doc" value={d.id} checked={docId === d.id} onChange={() => setDocId(d.id)} />
                      <span className="choice-title">{d.title}</span>
                      <StorageTag doc={d} />
                    </label>
                  </li>
                ))}
                {!candidates.length && <li className="empty">No stored documents match. Try another word, or add an external link.</li>}
              </ul>
            </fieldset>
          </>
        ) : (
          <>
            <p className="field-hint">An external link keeps only the address. The file stays on someone else’s site and may change or disappear.</p>
            <Field id="f-title" label="Title" error={errors.title ?? ''}>
              <input id="f-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!errors.title} />
            </Field>
            <Field id="f-url" label="Web address" error={errors.url ?? ''} hint="Demo addresses on example.invalid are fine. Atlas will not open or fetch it.">
              <input id="f-url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={!!errors.url} />
            </Field>
            <Field id="f-kind" label="What it is">
              <select id="f-kind" value={kind} onChange={(e) => setKind(e.target.value as DocKind)}>
                <option value="manual">Manual or guide</option>
                <option value="report">Report or certificate</option>
                <option value="receipt">Receipt</option>
              </select>
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}

// ---------------- Add photo ----------------

function MediaDialog({ targetId }: { targetId: string }) {
  const { house, dispatch } = useStore();
  const close = useClose();
  const can = useCanWrite('HomeBox');
  const [scene, setScene] = useState('');
  const [caption, setCaption] = useState('');
  const [taken, setTaken] = useState(DEMO_TODAY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const targetName = nameOf(house, targetId);
  if (!can.ok) return <Blocked title={`Add a photo to ${targetName}`} reason={can.reason!} />;
  const dirty = !!scene || !!caption.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!scene) errs.scene = 'Choose a picture from the demo tray.';
    if (!caption.trim()) errs.caption = 'Add a caption that says what the photo shows.';
    else if (caption.trim().length > 80) errs.caption = 'Keep the caption to 80 characters.';
    if (!taken) errs.taken = 'Enter the date the photo was taken.';
    else if (taken > DEMO_TODAY) errs.taken = 'The date can’t be in the future.';
    else if (taken < '1990-01-01') errs.taken = 'Use a date from 1990 onwards.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const slug = caption.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 32);
    const doc: Doc = {
      id: `doc-local-${localSeq++}`,
      title: caption.trim(),
      kind: 'photo',
      storage: 'stored',
      fileName: `${slug || 'photo'}.jpg`,
      sizeKb: 1100 + caption.length * 13,
      source: 'Uploaded to HomeBox (simulated)',
      addedBy: 'You',
      addedAt: demoNowIso(),
      capturedAt: `${taken}T12:00:00`,
      linkedTo: [targetId],
      version: 1,
      preview: 'media',
      mediaVariant: MEDIA_TRAY.find((m) => m.id === scene)?.scene,
      owner: 'HomeBox',
    };
    dispatch({ type: 'queueWrite', write: makeWrite({ title: `Add photo "${doc.title}" to ${targetName}`, targetId, system: 'HomeBox', patch: { op: 'addDoc', doc } }) });
    dispatch({ type: 'dialog', dialog: null });
    dispatch({ type: 'toast', text: 'Uploading to HomeBox (simulated).', tone: 'info' });
  };

  return (
    <Modal
      wide
      title={`Add a photo to ${targetName}`}
      kicker="Files are kept in HomeBox"
      onClose={() => close(dirty)}
      footer={
        <>
          <SimNote />
          <button type="button" className="btn" onClick={() => close(dirty)}>
            Cancel
          </button>
          <button type="submit" form="add-media" className="btn btn-primary">
            Add photo
          </button>
        </>
      }
    >
      <form id="add-media" className="form" onSubmit={submit} noValidate>
        <fieldset className="field">
          <legend>Demo media tray</legend>
          <p className="field-hint">This demo cannot read files from your device. Pick one of these sample pictures instead.</p>
          {errors.scene && (
            <p className="field-error" role="alert">
              {errors.scene}
            </p>
          )}
          <div className="media-grid">
            {MEDIA_TRAY.map((m, i) => (
              <label key={m.id} className={`media-choice${scene === m.id ? ' is-on' : ''}`}>
                <input type="radio" name="scene" value={m.id} checked={scene === m.id} onChange={() => setScene(m.id)} data-autofocus={i === 0 ? true : undefined} />
                <MediaScene scene={m.scene} />
                <span>{m.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field-row">
          <Field id="f-cap" label="Caption" error={errors.caption ?? ''}>
            <input id="f-cap" value={caption} onChange={(e) => setCaption(e.target.value)} aria-invalid={!!errors.caption} />
          </Field>
          <Field id="f-taken" label="Taken on" error={errors.taken ?? ''}>
            <input id="f-taken" type="date" value={taken} max={DEMO_TODAY} onChange={(e) => setTaken(e.target.value)} aria-invalid={!!errors.taken} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

// ---------------- Complete upkeep ----------------

function CompleteDialog({ taskId }: { taskId: string }) {
  const { house, dispatch } = useStore();
  const close = useClose();
  const can = useCanWrite('HomeBox');
  const task = house.tasks.find((t) => t.id === taskId);
  const [date, setDate] = useState(DEMO_TODAY);
  const [who, setWho] = useState('You');
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'form' | 'next'>('form');
  const [nextDate, setNextDate] = useState(() => addDays(DEMO_TODAY, 30));
  const [nextError, setNextError] = useState('');
  if (!task) return null;
  if (!can.ok) return <Blocked title={`Mark "${task.title}" done`} reason={can.reason!} />;
  const target = nameOf(house, task.targetId);
  const docs = house.docs.filter((d) => d.storage === 'stored' && (d.linkedTo.includes(task.targetId) || d.linkedTo.includes(task.id)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!date) errs.date = 'Enter the date it was done.';
    else if (date > DEMO_TODAY) errs.date = 'The date can’t be in the future.';
    else if (date < '2000-01-01') errs.date = 'Use a date from 2000 onwards.';
    if (note.trim().length > 200) errs.note = 'Keep the note to 200 characters.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    dispatch({
      type: 'queueWrite',
      write: makeWrite({
        title: `Complete "${task.title}" for ${target}`,
        targetId: task.id,
        system: 'HomeBox',
        patch: { op: 'completeTask', id: task.id, completedAt: date, completedBy: who, note: note.trim() || undefined, evidenceIds: evidence },
      }),
    });
    setStep('next');
  };

  const scheduleNext = (e: FormEvent) => {
    e.preventDefault();
    if (!nextDate || nextDate <= DEMO_TODAY) {
      setNextError('Choose a date after today.');
      return;
    }
    const t: Task = { id: `mt-local-${localSeq++}`, title: task.title, targetId: task.targetId, due: nextDate, status: 'scheduled', cadence: task.cadence, evidenceIds: [], docIds: task.docIds };
    dispatch({ type: 'queueWrite', write: makeWrite({ title: `Schedule "${task.title}" for ${fmtDate(nextDate)}`, targetId: task.targetId, system: 'HomeBox', patch: { op: 'addTask', task: t } }) });
    dispatch({ type: 'dialog', dialog: null });
    dispatch({ type: 'toast', text: `Scheduling the next one for ${fmtDate(nextDate)}.`, tone: 'info' });
  };

  if (step === 'next') {
    return (
      <Modal
        title="Marked as done"
        kicker={task.title}
        onClose={() => close()}
        footer={
          <>
            <button type="button" className="btn" onClick={() => close()}>
              Not now
            </button>
            <button type="submit" form="next-task" className="btn btn-primary">
              Schedule next
            </button>
          </>
        }
      >
        <p className="body-text">The completion is being saved to HomeBox. You will see the result on the task.</p>
        <Note>Repeats are never created automatically. If you want another one, set the date yourself.</Note>
        <form id="next-task" className="form" onSubmit={scheduleNext} noValidate>
          <Field id="f-next" label="Next due date" error={nextError} hint={task.cadence ? `Usual rhythm: ${task.cadence}` : ''}>
            <input id="f-next" type="date" data-autofocus value={nextDate} min={addDays(DEMO_TODAY, 1)} onChange={(e) => setNextDate(e.target.value)} />
          </Field>
          <div className="quick-dates" role="group" aria-label="Quick dates">
            {[7, 30, 90, 182, 365].map((n) => (
              <button key={n} type="button" className="chip-btn" onClick={() => setNextDate(addDays(DEMO_TODAY, n))}>
                {n < 30 ? `${n} days` : n < 360 ? `${Math.round(n / 30)} months` : '1 year'}
              </button>
            ))}
          </div>
        </form>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Mark "${task.title}" done`}
      kicker={`Upkeep for ${target}, kept in HomeBox`}
      onClose={() => close(!!note.trim() || evidence.length > 0)}
      footer={
        <>
          <SimNote />
          <button type="button" className="btn" onClick={() => close(!!note.trim() || evidence.length > 0)}>
            Cancel
          </button>
          <button type="submit" form="complete-task" className="btn btn-primary">
            Mark done
          </button>
        </>
      }
    >
      <form id="complete-task" className="form" onSubmit={submit} noValidate>
        <div className="field-row">
          <Field id="f-done" label="Done on" error={errors.date ?? ''}>
            <input id="f-done" type="date" data-autofocus value={date} max={DEMO_TODAY} onChange={(e) => setDate(e.target.value)} aria-invalid={!!errors.date} />
          </Field>
          <Field id="f-who" label="Done by">
            <select id="f-who" value={who} onChange={(e) => setWho(e.target.value)}>
              {['You', ...house.people].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field id="f-cnote" label="What was done" error={errors.note ?? ''} hint="Optional. Useful next time.">
          <textarea id="f-cnote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!errors.note} />
        </Field>
        <fieldset className="field">
          <legend>Evidence</legend>
          {docs.length ? (
            <ul className="choice-list">
              {docs.map((d) => (
                <li key={d.id}>
                  <label className={`choice${evidence.includes(d.id) ? ' is-on' : ''}`}>
                    <input type="checkbox" checked={evidence.includes(d.id)} onChange={(e) => setEvidence(e.target.checked ? [...evidence, d.id] : evidence.filter((x) => x !== d.id))} />
                    <span className="choice-title">{d.title}</span>
                    <StorageTag doc={d} />
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="field-hint">No stored documents on this record yet. Add a photo afterwards if you have one.</p>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

// ---------------- Schedule ----------------

function ScheduleDialog({ targetId, afterTaskId }: { targetId: string; afterTaskId?: string | undefined }) {
  const { house, dispatch } = useStore();
  const close = useClose();
  const can = useCanWrite('HomeBox');
  const after = house.tasks.find((t) => t.id === afterTaskId);
  const [title, setTitle] = useState(after?.title ?? '');
  const [due, setDue] = useState(addDays(DEMO_TODAY, 30));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const targetName = nameOf(house, targetId);
  if (!can.ok) return <Blocked title={`Schedule upkeep for ${targetName}`} reason={can.reason!} />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = 'Say what needs doing.';
    else if (title.trim().length > 70) errs.title = 'Keep it to 70 characters.';
    if (!due) errs.due = 'Choose a due date.';
    else if (due < DEMO_TODAY) errs.due = 'Choose today or a later date.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const t: Task = { id: `mt-local-${localSeq++}`, title: title.trim(), targetId, due, status: 'scheduled', cadence: after?.cadence, evidenceIds: [], docIds: after?.docIds };
    dispatch({ type: 'queueWrite', write: makeWrite({ title: `Schedule "${t.title}" for ${fmtDate(due)}`, targetId, system: 'HomeBox', patch: { op: 'addTask', task: t } }) });
    dispatch({ type: 'dialog', dialog: null });
    dispatch({ type: 'toast', text: 'Scheduling. It will appear under Upkeep once saved.', tone: 'info' });
  };

  return (
    <Modal
      title={`Schedule upkeep for ${targetName}`}
      kicker="Kept in HomeBox"
      onClose={() => close(!!title.trim() && title !== (after?.title ?? ''))}
      footer={
        <>
          <SimNote />
          <button type="button" className="btn" onClick={() => close()}>
            Cancel
          </button>
          <button type="submit" form="schedule-task" className="btn btn-primary">
            Schedule
          </button>
        </>
      }
    >
      <form id="schedule-task" className="form" onSubmit={submit} noValidate>
        <Field id="f-ttl" label="What needs doing" error={errors.title ?? ''}>
          <input id="f-ttl" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!errors.title} />
        </Field>
        <Field id="f-due" label="Due" error={errors.due ?? ''} hint="This schedules one occurrence. Nothing repeats automatically.">
          <input id="f-due" type="date" value={due} min={DEMO_TODAY} onChange={(e) => setDue(e.target.value)} aria-invalid={!!errors.due} />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------- Conflict review ----------------

function ConflictDialog({ writeId }: { writeId: string }) {
  const { house, dispatch } = useStore();
  const close = useClose();
  const w = house.writes.find((x) => x.id === writeId);
  const [choice, setChoice] = useState<'theirs' | 'mine' | 'custom' | ''>('');
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');
  if (!w || !w.conflict) {
    return <Blocked title="Conflict" reason="This change has already been resolved." />;
  }
  const c = w.conflict;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!choice) return setError('Choose which version to keep.');
    if (choice === 'custom' && !custom.trim()) return setError('Write the combined value, or pick one of the versions.');
    dispatch({ type: 'resolveConflict', id: w.id, choice, value: custom });
    dispatch({ type: 'dialog', dialog: null });
    dispatch({
      type: 'toast',
      text: choice === 'theirs' ? `Kept "${c.theirs}". Your change was discarded.` : `Sending your version on top of revision ${c.theirsRev}.`,
      tone: 'info',
    });
  };
  const kind = kindOf(w.targetId);
  return (
    <Modal
      wide
      title="Review a conflicting change"
      kicker={`${w.system}, ${nameOf(house, w.targetId)}`}
      onClose={() => close()}
      footer={
        <>
          <SimNote />
          <button type="button" className="btn" onClick={() => close()}>
            Decide later
          </button>
          <button type="submit" form="conflict" className="btn btn-primary">
            Resolve
          </button>
        </>
      }
    >
      <p className="body-text">
        Your change was based on revision {c.baseRev}. Since then, {c.theirsBy} saved revision {c.theirsRev} at {fmtDateTime(c.theirsAt)}. Nothing is overwritten until you choose.
      </p>
      <div className="compare" role="table" aria-label={`${c.field} versions`}>
        <div role="row" className="compare-row compare-base">
          <span role="cell" className="compare-label">
            Before (revision {c.baseRev})
          </span>
          <span role="cell" className="compare-value">
            {c.base}
          </span>
        </div>
        <div role="row" className="compare-row compare-theirs">
          <span role="cell" className="compare-label">
            Now in {w.system} ({c.theirsBy}, revision {c.theirsRev})
          </span>
          <span role="cell" className="compare-value">
            {c.theirs}
          </span>
        </div>
        <div role="row" className="compare-row compare-mine">
          <span role="cell" className="compare-label">{w.origin === 'assistant' ? 'Proposed by the assistant' : 'Your change'}</span>
          <span role="cell" className="compare-value">
            {c.mine}
          </span>
        </div>
      </div>
      <form id="conflict" className="form" onSubmit={submit} noValidate>
        <fieldset className="field radio-cards">
          <legend>{c.field}: which should it be?</legend>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <label className={`radio-card${choice === 'theirs' ? ' is-on' : ''}`}>
            <input type="radio" name="res" checked={choice === 'theirs'} onChange={() => setChoice('theirs')} data-autofocus />
            <span className="radio-title">Keep “{c.theirs}”</span>
            <span className="radio-help">Discard your change. Nothing is sent.</span>
          </label>
          <label className={`radio-card${choice === 'mine' ? ' is-on' : ''}`}>
            <input type="radio" name="res" checked={choice === 'mine'} onChange={() => setChoice('mine')} />
            <span className="radio-title">Use “{c.mine}”</span>
            <span className="radio-help">Send it again, based on revision {c.theirsRev}.</span>
          </label>
          <label className={`radio-card${choice === 'custom' ? ' is-on' : ''}`}>
            <input type="radio" name="res" checked={choice === 'custom'} onChange={() => setChoice('custom')} />
            <span className="radio-title">Write a combined version</span>
            <span className="radio-help">For example, keep both pieces of information.</span>
          </label>
        </fieldset>
        {choice === 'custom' && (
          <Field id="f-custom" label={`Combined ${c.field.toLowerCase()}`}>
            <input id="f-custom" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={kind === 'container' ? 'Hall meter cupboard (gas and electric)' : ''} />
          </Field>
        )}
      </form>
    </Modal>
  );
}
