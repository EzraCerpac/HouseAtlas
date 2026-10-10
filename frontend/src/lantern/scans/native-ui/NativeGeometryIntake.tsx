import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NativeGeometryLicense, NativeGeometryOriginalType, NativeGeometryPrepared, NativeGeometryWriteClient } from '../native-write-types';
import type { NativeAssociationAdmission, NativeAssociationClient, NativeAssociationPending, NativeAssociationPrepared } from '../native-association-types';
import { stringifyLosslessJson } from '../../../numeric/lossless-json';
import { useStore } from '../../state/store';
import { useTopology } from '../../topology/TopologyProvider';

/** Read-only confirmation retention is owned by the canonical host session/home,
 * independently of command admission. Its opaque owner grants no write authority. */
export interface NativeGeometryIntakeAssociation extends NativeAssociationClient {
  getRetention(scope: NativeAssociationPrepared['binding']['scope']): {
    readonly owner: object; readonly rows: readonly NativeAssociationPending[];
  } | null;
}

type Draft = { original: File | null; derivative: File | null; format: NativeGeometryOriginalType;
  originalReason: string; derivativeReason: string; originalLicense: NativeGeometryLicense['status'];
  derivativeLicense: NativeGeometryLicense['status']; originalReference: string; derivativeReference: string;
  originalId: string; derivativeId: string };
const blank = (): Draft => ({ original: null, derivative: null, format: 'model/vnd.usdz+zip', originalReason: '',
  derivativeReason: '', originalLicense: 'unknown', derivativeLicense: 'unknown', originalReference: '', derivativeReference: '',
  originalId: '', derivativeId: '' });
type Phase = 'Preparing original' | 'Saving original' | 'Preparing derivative' | 'Saving derivative' | 'Reading association records' | 'Saving association';
function ExactDetails({ label, text }: { readonly label: string; readonly text: () => string }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>{label}</summary>
    {open && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '24rem', overflow: 'auto' }}>{text()}</pre>}
  </details>;
}

/** The clients retain submitted intents. This form owns only unsubmitted local
 * selection/review state and never clears, retries or recreates their ledgers. */
export function NativeGeometryIntake({ write, association, buildingId, onAssociated }: {
  readonly write: NativeGeometryWriteClient; readonly association: NativeGeometryIntakeAssociation;
  readonly buildingId: string | null; readonly onAssociated: () => void;
}) {
  const { projection, actions } = useStore(), topology = useTopology(), id = useId();
  const view = projection.view, expiry = actions.session?.expiresAt;
  const writeBinding = write.getBinding(), associationBinding = association.getBinding();
  const retention = association.getRetention(view.scope), retentionOwner = retention?.owner ?? null;
  const owner = useMemo(() => ({ view, expiry, writeBinding, associationBinding, retentionOwner, write, association }),
    [view, expiry, writeBinding, associationBinding, retentionOwner, write, association]);
  const current = useRef(owner); current.current = owner;
  const surface = useRef<HTMLDivElement>(null), originalInput = useRef<HTMLInputElement>(null), derivativeInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const flight = useRef<{ readonly owner: typeof owner; readonly controller: AbortController; readonly phase: Phase } | null>(null);
  const [, repaint] = useState(0);
  const [stored, setStored] = useState<{ owner: typeof owner; draft: Draft } | null>(null);
  const draft = stored?.owner === owner ? stored.draft : blank();
  const [prepared, setPrepared] = useState<{ owner: typeof owner; intent: NativeGeometryPrepared } | null>(null);
  const [notice, setNotice] = useState<{ owner: typeof owner; text: string } | null>(null);
  const [phase, setPhase] = useState<{ owner: typeof owner; text: Phase } | null>(null);
  const rows = writeBinding ? write.pending(writeBinding) : [];
  const associations = retention?.rows ?? [];
  const held = rows.some(row => row.outcome === 'unknown') || associations.some(row => row.outcome === 'unknown');
  const originals = rows.filter(row => row.outcome === 'committed' && row.receipt?.kind === 'original');
  const original = originals.find(row => row.receipt?.assetId === draft.originalId);
  const derivatives = rows.filter(row => row.outcome === 'committed' && row.receipt?.kind === 'derivative'
    && row.prepared.originalAssetId === original?.receipt?.assetId);
  const derivative = derivatives.find(row => row.receipt?.assetId === draft.derivativeId);
  const building = topology.status === 'ready' ? topology.index?.buildings.find(row => row.id === buildingId) : undefined;
  const semantics = building?.semantics.length === 1 ? building.semantics[0] : undefined;
  const associationKey = useMemo(() => ({ owner, index: topology.index, building, semantics, original, derivative }),
    [owner, topology.index, building, semantics, original?.receipt, derivative?.receipt]);
  const selected = useRef(associationKey); selected.current = associationKey;
  const callback = useRef(onAssociated); callback.current = onAssociated;
  const [admitted, setAdmitted] = useState<{ key: typeof associationKey; admission: NativeAssociationAdmission } | null>(null);
  const [associationIntent, setAssociationIntent] = useState<{ key: typeof associationKey; intent: NativeAssociationPrepared } | null>(null);
  const [review, setReview] = useState<{ key: typeof associationKey; statement: string; reason: string } | null>(null);
  const currentReview = review?.key === associationKey ? review : { statement: '', reason: '' };
  const admission = admitted?.key === associationKey ? admitted.admission : null;
  const associationPrepared = associationIntent?.key === associationKey ? associationIntent.intent : null;
  const custodyPrepared = prepared?.owner === owner ? prepared.intent : null;
  const sameScope = (binding: typeof writeBinding) => binding === null || (binding.scope.workspaceId === view.scope.workspaceId && binding.scope.homeId === view.scope.homeId);
  const currentOwner = () => current.current === owner && Number.isFinite(Date.parse(expiry ?? '')) && Date.parse(expiry!) > Date.now()
    && write.getBinding() === writeBinding && association.getBinding() === associationBinding
    && association.getRetention(view.scope)?.owner === retentionOwner && sameScope(writeBinding) && sameScope(associationBinding);
  const currentSelection = () => selected.current === associationKey && currentOwner();
  const unknown = () => (writeBinding && write.pending(writeBinding).some(row => row.outcome === 'unknown'))
    || association.getRetention(view.scope)?.rows.some(row => row.outcome === 'unknown');
  const available = currentOwner() && writeBinding !== null;
  const observable = currentOwner() && (writeBinding !== null || associations.length > 0);
  const busy = phase?.owner === owner;

  useLayoutEffect(() => {
    mounted.current = true;
    // Uncontrolled FileLists must not outlive the same allocation fence as
    // their rendered metadata, even when a new view arrives without an event.
    if (originalInput.current) originalInput.current.value = '';
    if (derivativeInput.current) derivativeInput.current.value = '';
    setStored(prior => prior?.owner === owner ? prior : null);
    setPrepared(prior => prior?.owner === owner ? prior : null);
    setNotice(prior => prior?.owner === owner ? prior : null);
    setPhase(prior => prior?.owner === owner ? prior : null);
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const withdraw = () => {
      if (surface.current) surface.current.hidden = true;
      const pending = flight.current; flight.current = null;
      pending?.controller.abort();
      if (originalInput.current) originalInput.current.value = '';
      if (derivativeInput.current) derivativeInput.current.value = '';
      setStored(null); setPrepared(null); setNotice(null); setPhase(null);
    };
    const changed = () => {
      if (stopped) return;
      if (!currentOwner()) withdraw();
      repaint(value => value + 1);
    };
    const stops = [write.subscribe(changed), association.subscribe(changed), write.subscribePending(changed), association.subscribePending(changed)];
    const expire = () => {
      if (stopped) return;
      if (timer !== undefined) clearTimeout(timer);
      const remaining = Date.parse(expiry ?? '') - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) changed();
      else timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
    };
    const visible = () => { if (document.visibilityState === 'visible') expire(); };
    document.addEventListener('visibilitychange', visible); window.addEventListener('focus', expire); window.addEventListener('pageshow', expire);
    if (surface.current) surface.current.hidden = !observable;
    expire();
    return () => {
      stopped = true; mounted.current = false;
      if (timer !== undefined) clearTimeout(timer);
      for (const stop of stops) stop();
      document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', expire); window.removeEventListener('pageshow', expire);
      if (flight.current?.owner === owner) { const pending = flight.current; flight.current = null; pending.controller.abort(); }
      if (originalInput.current) originalInput.current.value = '';
      if (derivativeInput.current) derivativeInput.current.value = '';
      if (surface.current) surface.current.hidden = true;
    };
  }, [owner]);
  useLayoutEffect(() => {
    // A building, accepted-classification or selected-custody change cannot
    // publish a late read/commit for the former association selection.
    const pending = flight.current;
    if (pending?.phase === 'Reading association records' || pending?.phase === 'Saving association') {
      flight.current = null; pending.controller.abort(); setPhase(null);
    }
  }, [associationKey]);
  const edit = (patch: Partial<Draft>) => {
    if (!mounted.current || !currentOwner() || flight.current) return;
    setStored(prior => ({ owner, draft: { ...(prior?.owner === owner ? prior.draft : blank()), ...patch } }));
    setPrepared(null); setNotice(null);
  };
  const editReview = (patch: Partial<{ statement: string; reason: string }>) => {
    if (!mounted.current || !currentSelection() || flight.current) return;
    setReview(prior => ({ key: associationKey, ...(prior?.key === associationKey ? prior : { statement: '', reason: '' }), ...patch }));
    setAssociationIntent(null); setNotice(null);
  };
  const run = async (name: Phase, operation: (signal: AbortSignal, live: () => boolean) => Promise<void>, forAssociation = false) => {
    if (!mounted.current || !currentOwner() || flight.current || unknown() || (forAssociation && !currentSelection())) return;
    const pending = { owner, controller: new AbortController(), phase: name }; flight.current = pending;
    const live = () => mounted.current && flight.current === pending && !pending.controller.signal.aborted && currentOwner()
      && (!forAssociation || currentSelection());
    setNotice(null); setPhase({ owner, text: name });
    try { await operation(pending.controller.signal, live); }
    catch (error) { if (live()) setNotice({ owner, text: error instanceof Error ? error.message : 'Native scan action could not be completed.' }); }
    finally { if (flight.current === pending) { flight.current = null; if (mounted.current && currentOwner()) { setPhase(null); repaint(value => value + 1); } } }
  };
  const prepareCustody = (kind: 'original' | 'derivative') => {
    if (!writeBinding || !write.canPrepare(writeBinding)) return;
    const file = kind === 'original' ? draft.original : draft.derivative;
    if (!file || (kind === 'derivative' && (!original?.receipt || original.prepared.contentType !== 'model/vnd.usdz+zip'))) return;
    void run(kind === 'original' ? 'Preparing original' : 'Preparing derivative', async (signal, live) => {
      const input = { file, filename: file.name, reason: kind === 'original' ? draft.originalReason : draft.derivativeReason,
        sourceLicense: { status: kind === 'original' ? draft.originalLicense : draft.derivativeLicense,
          reference: (kind === 'original' ? draft.originalReference : draft.derivativeReference) || null } };
      const intent = kind === 'original' ? await write.prepareOriginal(writeBinding, { ...input, contentType: draft.format }, signal)
        : await write.prepareDerivative(writeBinding, original!.receipt!, input, signal);
      if (live()) setPrepared({ owner, intent });
    });
  };
  const commitCustody = () => {
    const intent = custodyPrepared;
    if (!intent || !writeBinding || intent.binding !== writeBinding || !write.canPrepare(writeBinding)) return;
    void run(intent.kind === 'original' ? 'Saving original' : 'Saving derivative', async (signal, live) => {
      setPrepared(null); // Consume the visible confirmation before calling the one-shot owner.
      const receipt = await write.commit(intent, signal);
      if (!live()) return;
      setStored(prior => ({ owner, draft: { ...(prior?.owner === owner ? prior.draft : blank()),
        ...(receipt.kind === 'original' ? { original: null, originalId: receipt.assetId, derivativeId: '' } : { derivative: null, derivativeId: receipt.assetId }) } }));
      if (receipt.kind === 'original' && originalInput.current) originalInput.current.value = '';
      if (receipt.kind === 'derivative' && derivativeInput.current) derivativeInput.current.value = '';
      setNotice({ owner, text: `${receipt.kind === 'original' ? 'Original' : 'Derivative'} custody committed. It is not associated with a building.` });
    });
  };
  const loadAssociation = () => {
    if (!associationBinding || !building || !semantics || !original?.receipt || !derivative?.receipt) return;
    void run('Reading association records', async (signal, live) => {
      setAdmitted(null); setAssociationIntent(null);
      const value = await association.load(associationBinding, { buildingId: building.id, semanticsId: semantics.target.recordId,
        originalAssetId: original.receipt!.assetId, derivativeAssetId: derivative.receipt!.assetId }, signal);
      if (live()) setAdmitted({ key: associationKey, admission: value });
    }, true);
  };
  const prepareAssociation = () => {
    if (!admission || !mounted.current || !currentSelection() || flight.current || unknown()) return;
    try { const intent = association.prepare(admission, { statement: currentReview.statement, reason: currentReview.reason });
      if (currentSelection()) setAssociationIntent({ key: associationKey, intent });
    } catch (error) { setNotice({ owner, text: error instanceof Error ? error.message : 'Association could not be prepared.' }); }
  };
  const commitAssociation = () => {
    const intent = associationPrepared;
    if (!intent || !associationBinding || intent.binding !== associationBinding) return;
    void run('Saving association', async (signal, live) => {
      setAssociationIntent(null); setAdmitted(null);
      await association.commit(intent, signal);
      if (!live()) return;
      setNotice({ owner, text: 'Building association committed. Refreshing its saved scans.' });
      callback.current();
    }, true);
  };
  const licenseFields = (kind: 'original' | 'derivative') => {
    const originalForm = kind === 'original', status = originalForm ? draft.originalLicense : draft.derivativeLicense;
    return <><div className="field"><label htmlFor={`${id}-${kind}-license`}>Source license status</label>
      <select id={`${id}-${kind}-license`} value={status} onChange={event => {
        const value = event.currentTarget.value;
        if (value === 'unknown' || value === 'permitted' || value === 'restricted') edit(originalForm ? { originalLicense: value } : { derivativeLicense: value });
      }}><option value="unknown">Unknown</option><option value="permitted">Permitted</option><option value="restricted">Restricted</option></select></div>
      <div className="field"><label htmlFor={`${id}-${kind}-reference`}>License reference (optional)</label>
        <input id={`${id}-${kind}-reference`} maxLength={4096} value={originalForm ? draft.originalReference : draft.derivativeReference}
          onChange={event => edit(originalForm ? { originalReference: event.currentTarget.value } : { derivativeReference: event.currentTarget.value })} /></div></>;
  };
  const blocked = busy || held || !available || !writeBinding || !write.canPrepare(writeBinding);
  return <section className="topology-building" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>Import scans</h2>
    {!available && <p role="status">Native scan custody is unavailable for this session and home.</p>}
    <div ref={surface} hidden={!observable}>
      <p className="body-text muted">Original files and derivatives are saved separately. Building association needs a separate review and confirmation.</p>
      <p className="body-text muted">Workspace <code>{view.scope.workspaceId}</code> · Home <code>{view.scope.homeId}</code></p>
      {held && <p role="alert">A scan confirmation has an unknown outcome. Further intake for this home context is blocked. Inspect its retained request below; do not resubmit it.</p>}
      {!held && writeBinding && !write.canPrepare(writeBinding) && <p role="status">New custody cannot be prepared in this current native context.</p>}
      {busy && <p role="status">{phase.text}…</p>}
      {notice?.owner === owner && <p role="status">{notice.text}</p>}
      <fieldset disabled={blocked}><legend>Original custody</legend>
        <div className="field"><label htmlFor={`${id}-format`}>Original format</label><select id={`${id}-format`} value={draft.format}
          onChange={event => { const value = event.currentTarget.value; if (value === 'model/vnd.usdz+zip' || value === 'application/x-step') edit({ format: value }); }}>
          <option value="model/vnd.usdz+zip">USDZ</option><option value="application/x-step">IFC</option></select></div>
        <div className="field"><label htmlFor={`${id}-original`}>Original file (up to 10 MiB)</label><input id={`${id}-original`} ref={originalInput}
          type="file" accept=".usdz,.ifc" onChange={event => edit({ original: event.currentTarget.files?.[0] ?? null })} /></div>
        {draft.original && <p>{draft.original.name} · {draft.original.size} bytes · {draft.format}</p>}
        {draft.original && (draft.original.size === 0 || draft.original.size > 10 * 1024 * 1024) && <p role="status">Select a nonempty original file of at most 10 MiB.</p>}
        {licenseFields('original')}
        <div className="field"><label htmlFor={`${id}-original-reason`}>Original custody reason</label><textarea id={`${id}-original-reason`} maxLength={1024}
          value={draft.originalReason} onChange={event => edit({ originalReason: event.currentTarget.value })} /></div>
        <button className="btn" type="button" disabled={!draft.original || draft.original.size === 0 || draft.original.size > 10 * 1024 * 1024 || !draft.originalReason.trim()} onClick={() => prepareCustody('original')}>Prepare original</button>
      </fieldset>
      <div className="field"><label htmlFor={`${id}-original-choice`}>Committed original</label><select id={`${id}-original-choice`} disabled={busy || held || !available}
        value={original?.receipt?.assetId ?? ''} onChange={event => edit({ originalId: event.currentTarget.value, derivativeId: '' })}>
        <option value="">Select an original custody receipt</option>{originals.map(row => <option key={row.receipt!.assetId} value={row.receipt!.assetId}>{row.prepared.filename} · {row.receipt!.assetId}</option>)}</select></div>
      <fieldset disabled={blocked || !original?.receipt || original.prepared.contentType !== 'model/vnd.usdz+zip'}><legend>Derivative custody</legend>
        <p className="body-text muted">Select the authored mesh JSON paired with this USDZ original. IFC derivative custody is not supported by the native owner.</p>
        <div className="field"><label htmlFor={`${id}-derivative`}>Paired authored mesh JSON (up to 8 MiB)</label><input id={`${id}-derivative`} ref={derivativeInput}
          type="file" accept=".json,application/vnd.houseatlas.magicplan-authored-mesh+json" onChange={event => edit({ derivative: event.currentTarget.files?.[0] ?? null })} /></div>
        {draft.derivative && <p>{draft.derivative.name} · {draft.derivative.size} bytes · application/vnd.houseatlas.magicplan-authored-mesh+json</p>}
        {draft.derivative && (draft.derivative.size === 0 || draft.derivative.size > 8 * 1024 * 1024) && <p role="status">Select a nonempty paired derivative of at most 8 MiB.</p>}
        {licenseFields('derivative')}
        <div className="field"><label htmlFor={`${id}-derivative-reason`}>Derivative custody reason</label><textarea id={`${id}-derivative-reason`} maxLength={1024}
          value={draft.derivativeReason} onChange={event => edit({ derivativeReason: event.currentTarget.value })} /></div>
        <button className="btn" type="button" disabled={!draft.derivative || draft.derivative.size === 0 || draft.derivative.size > 8 * 1024 * 1024 || !draft.derivativeReason.trim()} onClick={() => prepareCustody('derivative')}>Prepare derivative</button>
      </fieldset>
      {custodyPrepared && <section aria-label="Prepared custody review"><h3>Prepared {custodyPrepared.kind}</h3>
        <dl className="facts"><div><dt>File</dt><dd>{custodyPrepared.filename}</dd></div><div><dt>MIME</dt><dd>{custodyPrepared.contentType}</dd></div>
          <div><dt>Bytes</dt><dd>{custodyPrepared.byteSize}</dd></div><div><dt>SHA-256</dt><dd><code>{custodyPrepared.sha256}</code></dd></div>
          <div><dt>License</dt><dd>{custodyPrepared.sourceLicense.status} · {custodyPrepared.sourceLicense.reference ?? 'No reference'}</dd></div>
          {custodyPrepared.originalAssetId && <div><dt>Original asset</dt><dd><code>{custodyPrepared.originalAssetId}</code></dd></div>}</dl>
        <ExactDetails label="Prepared custody metadata" text={() => custodyPrepared.metadata} />
        <button className="btn btn-primary" type="button" disabled={blocked} onClick={commitCustody}>Confirm {custodyPrepared.kind} custody once</button>
      </section>}
      <fieldset disabled={busy || held || !available || !associationBinding}><legend>Building association</legend>
        <p>Reviewed building: {building?.label ?? 'Select a reviewed building above.'}</p>
        {building && semantics && <p>Building <code>{building.id}</code> · Accepted classification <code>{semantics.target.recordId}</code></p>}
        {!associationBinding && <p role="status">The current native command catalog does not admit building association.</p>}
        <div className="field"><label htmlFor={`${id}-derivative-choice`}>Committed paired derivative</label><select id={`${id}-derivative-choice`}
          value={derivative?.receipt?.assetId ?? ''} onChange={event => edit({ derivativeId: event.currentTarget.value })}>
          <option value="">Select a derivative custody receipt</option>{derivatives.map(row => <option key={row.receipt!.assetId} value={row.receipt!.assetId}>{row.prepared.filename} · {row.receipt!.assetId}</option>)}</select></div>
        <button className="btn" type="button" disabled={!building || !semantics || !original?.receipt || !derivative?.receipt} onClick={loadAssociation}>Read current association records</button>
        {admission && <><p role="status">Current building, classification, assets and referenced evidence loaded for this review.</p>
          <ExactDetails label="Current association records and exact revisions" text={() => stringifyLosslessJson([...admission.records])} />
          <div className="field"><label htmlFor={`${id}-statement`}>Reviewed association statement</label><textarea id={`${id}-statement`} maxLength={4096}
            value={currentReview.statement} onChange={event => editReview({ statement: event.currentTarget.value })} /></div>
          <div className="field"><label htmlFor={`${id}-association-reason`}>Association reason</label><textarea id={`${id}-association-reason`} maxLength={1024}
            value={currentReview.reason} onChange={event => editReview({ reason: event.currentTarget.value })} /></div>
          <button className="btn" type="button" disabled={!currentReview.statement.trim() || !currentReview.reason.trim()} onClick={prepareAssociation}>Prepare building association</button></>}
        {associationPrepared && <><p>The prepared association preserves unknown coordinate units, scale and transform, with no room mappings.</p>
          <ExactDetails label="Prepared three-command association request" text={() => associationPrepared.body} />
          <button className="btn btn-primary" type="button" onClick={commitAssociation}>Confirm building association once</button></>}
      </fieldset>
      <h3>Retained custody requests and receipts</h3>
      <p className="body-text muted">These client-memory records survive form remounts in this session and home context. They are not durable after a page reload.</p>
      {rows.length === 0 && <p>No submitted custody request in this current context.</p>}
      {rows.map(row => <section key={row.prepared.requestId} aria-label={`${row.prepared.kind} custody ${row.outcome}`}>
        <p>{row.prepared.filename} · {row.prepared.kind} · {row.outcome} · {row.receipt?.association ?? 'Association not established'}</p>
        <p>Request <code>{row.prepared.requestId}</code> · SHA-256 <code>{row.prepared.sha256}</code> · {row.prepared.byteSize} bytes · {row.prepared.sourceLicense.status}</p>
        {row.receipt && <p>Asset <code>{row.receipt.assetId}</code></p>}
        <ExactDetails label="Retained custody metadata" text={() => row.prepared.metadata} />
        {row.receipt && <ExactDetails label="Correlated custody receipt (original number tokens)" text={() => row.receipt!.responseBody} />}
      </section>)}
      <h3>Retained association confirmations and receipts</h3>
      <p className="body-text muted">A confirmed intent without a correlated receipt remains unknown, including an aborted or pre-dispatch failure. Missing command admission does not release its hold.</p>
      {associations.length === 0 && <p>No confirmed building association in this current context.</p>}
      {associations.map(row => <section key={row.prepared.requestId} aria-label={`Building association ${row.outcome}`}>
        <p>Building <code>{row.prepared.selection.buildingId}</code> · {row.outcome}</p>
        <ExactDetails label="Retained association request" text={() => row.prepared.body} />
        {row.receipt && <ExactDetails label="Correlated association receipt (original number tokens)" text={() => stringifyLosslessJson(row.receipt!)} />}
      </section>)}
    </div>
  </section>;
}
