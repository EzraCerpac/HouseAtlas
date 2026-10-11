import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { stringifyLosslessJson } from '../../../numeric/lossless-json';
import type { NativeGeometryFrame } from '../native-read-types';
import type { SceneAssociationCandidate, SceneAssociationClient, SceneAssociationPrepared,
  SceneAssociationRead } from '../../../../integration/native-scene-association-client';

type Flight = { owner: object; controller: AbortController; submission: boolean;
  kind: 'read' | 'prepare' | 'submit' | 'resolve';
  submittedReview?: SceneAssociationPrepared; pendingNotification?: 'unknown' | 'committed' | null };

const synchronizedHeads = new WeakMap<SceneAssociationClient, WeakMap<object, Map<string, string>>>();
function headKey(result: SceneAssociationRead): string {
  return result.status === 'available' ? `available:${result.recordId}` : `unavailable:${result.reason}`;
}
function knownHeads(client: SceneAssociationClient, binding: object): Map<string, string> {
  let bindings = synchronizedHeads.get(client);
  if (!bindings) { bindings = new WeakMap(); synchronizedHeads.set(client, bindings); }
  let heads = bindings.get(binding);
  if (!heads) { heads = new Map(); bindings.set(binding, heads); }
  return heads;
}

/** The host supplies reviewed evidence IDs and three independent document owners.
 * This leaf only owns the current review interaction and never invents a source. */
export function NativeSceneAssociation({ client, candidate, geometry, canPrepare, hasUnsavedDraft, onSubmissionStarted,
  onSubmissionSettled, onRefreshed, onCommitted, onDiscardDraft, onRefreshPendingChanged }: {
  readonly client: SceneAssociationClient;
  readonly candidate: SceneAssociationCandidate | null;
  readonly geometry: NativeGeometryFrame | null;
  readonly canPrepare: boolean;
  readonly hasUnsavedDraft: boolean;
  readonly onSubmissionStarted: (candidate: SceneAssociationCandidate) => void;
  readonly onSubmissionSettled: () => void;
  readonly onRefreshed?: () => void;
  readonly onCommitted?: () => void;
  readonly onDiscardDraft?: () => void;
  readonly onRefreshPendingChanged?: (pending: boolean) => void;
}) {
  const binding = client.getBinding();
  const owner = useMemo(() => ({ client, binding, geometry }), [client, binding, geometry]);
  const current = useRef(owner); current.current = owner;
  const refreshed = useRef(onRefreshed); refreshed.current = onRefreshed;
  const committed = useRef(onCommitted); committed.current = onCommitted;
  const surface = useRef<HTMLElement>(null), flight = useRef<Flight | null>(null);
  const [statement, setStatement] = useState(''), [reason, setReason] = useState('');
  const [prepared, setPrepared] = useState<{ owner: object; value: SceneAssociationPrepared } | null>(null);
  const [read, setRead] = useState<{ owner: object; value: SceneAssociationRead } | null>(null);
  const [status, setStatus] = useState<{ owner: object; text: string } | null>(null);
  const [busy, setBusy] = useState<{ owner: object; text: string } | null>(null);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const [, repaint] = useState(0);
  const active = () => current.current === owner && client.getBinding() === binding && binding !== null;
  const buildingId = geometry?.descriptor.buildingId ?? null;
  const reviewCandidate = candidate && buildingId === candidate.buildingId ? candidate : null;
  const heads = binding ? knownHeads(client, binding) : null;
  const review = prepared?.owner === owner ? prepared.value : null;
  const reviewRef = useRef(review); reviewRef.current = review;
  const preparedRef = useRef(prepared); preparedRef.current = prepared;
  const observation = read?.owner === owner ? read.value : null;
  const submissionInFlight = flight.current?.owner === owner && flight.current.submission;
  const visible = active() && (!review || client.isPreparedCurrent(review) || submissionInFlight);

  useLayoutEffect(() => { setStatement(''); setReason(''); setPrepared(null); setRead(null); setStatus(null); setBusy(null); setConfirmRefresh(false); }, [owner]);

  useLayoutEffect(() => {
    if (flight.current?.owner === owner && flight.current.kind === 'prepare') {
      flight.current.controller.abort(); flight.current = null; setBusy(null);
    }
    setPrepared(existing => {
      if (existing?.owner === owner) client.releasePrepared(existing.value);
      return null;
    });
    setStatement(''); setReason('');
  }, [candidate, client, owner]);

  useLayoutEffect(() => { if (surface.current) surface.current.hidden = !visible; }, [owner, visible]);

  useLayoutEffect(() => () => {
    if (flight.current?.owner === owner) { flight.current.controller.abort(); flight.current = null; }
    const activePrepared = preparedRef.current;
    if (activePrepared?.owner === owner) client.releasePrepared(activePrepared.value);
    if (surface.current) surface.current.hidden = true;
  }, [client, owner]);

  useLayoutEffect(() => {
    if (surface.current) surface.current.hidden = !visible;
    const invalidate = () => {
      if (surface.current) surface.current.hidden = true;
      flight.current?.controller.abort(); flight.current = null;
      if (reviewRef.current) client.releasePrepared(reviewRef.current);
      setPrepared(null); setRead(null); setStatus(null); setBusy(null);
      repaint(value => value + 1);
    };
    const stop = client.subscribe(() => {
      const running = flight.current;
      const submittedOutcome = running?.owner === owner && running.submission && running.submittedReview
        ? client.pending(buildingId ?? '').find(item => item.prepared === running.submittedReview)?.outcome : undefined;
      const submittedPending = !!running && submittedOutcome !== undefined
        && submittedOutcome === running.pendingNotification;
      if (submittedPending) running.pendingNotification = submittedOutcome === 'unknown' ? 'committed' : null;
      const currentReview = reviewRef.current;
      if (!submittedPending && (!active() || currentReview && !client.isPreparedCurrent(currentReview))) invalidate();
      else repaint(value => value + 1); });
    if (!active()) invalidate();
    return stop;
  }, [client, owner]);

  useEffect(() => {
    if (!buildingId || !geometry || !active()) return;
    const synchronizeInitialHead = !!heads && !!refreshed.current && !heads.has(buildingId);
    if (synchronizeInitialHead) onRefreshPendingChanged?.(true);
    const controller = new AbortController();
    void client.readCurrent(buildingId, geometry, controller.signal).then(result => {
      if (current.current !== owner || controller.signal.aborted || !active()) return;
      const key = headKey(result);
      if (heads && refreshed.current && heads.get(buildingId) !== key) {
        heads.set(buildingId, key);
        setRead(null); setStatus({ owner, text: 'Refreshing the displayed scene to match the current association.' });
        if (synchronizeInitialHead) onRefreshPendingChanged?.(false);
        refreshed.current(); return;
      }
      heads?.set(buildingId, key);
      if (synchronizeInitialHead) onRefreshPendingChanged?.(false);
      setRead({ owner, value: result });
    }).catch(() => {
      if (current.current === owner && !controller.signal.aborted) {
        if (synchronizeInitialHead) onRefreshPendingChanged?.(false);
        setStatus({ owner, text: 'Current association is unavailable.' });
      }
    });
    return () => controller.abort();
  }, [client, owner, buildingId, geometry, onRefreshPendingChanged]);

  const execute = (label: string, work: (signal: AbortSignal) => Promise<void>, submission = false,
    settled?: () => void, kind: Flight['kind'] = 'read') => {
    if (!buildingId || !geometry || !active() || flight.current) return false;
    const running: Flight = { owner, controller: new AbortController(), submission, kind }; flight.current = running;
    setBusy({ owner, text: label }); setStatus(null);
    void work(running.controller.signal).catch(error => {
      if (flight.current === running && active()) setStatus({ owner,
        text: error instanceof Error ? error.message : 'Scene association is unavailable.' });
    }).finally(() => { if (flight.current === running) { flight.current = null; setBusy(null); } settled?.(); });
    return true;
  };
  const refresh = (discardDraft = false) => {
    if (discardDraft) onRefreshPendingChanged?.(true);
    const started = execute('Reading current association', async signal => {
      const result = await client.readCurrent(buildingId!, geometry!, signal);
      if (!active() || signal.aborted) return;
      heads?.set(buildingId!, headKey(result));
      setRead({ owner, value: result }); refreshed.current?.();
    }, false, discardDraft ? () => onRefreshPendingChanged?.(false) : undefined);
    if (!started && discardDraft) onRefreshPendingChanged?.(false);
  };
  const requestRefresh = () => {
    if (hasUnsavedDraft || statement || reason) { setConfirmRefresh(true); return; }
    refresh(true);
  };
  const prepare = () => execute('Reviewing retained originals', async signal => {
    if (!canPrepare || !reviewCandidate) return;
    if (review) client.releasePrepared(review);
    setPrepared(null);
    const value = await client.prepare(reviewCandidate, geometry!, statement, reason, signal);
    if (!active() || signal.aborted) { client.releasePrepared(value); return; }
    setPrepared({ owner, value });
  }, false, undefined, 'prepare');
  const submit = () => execute('Saving reviewed association', async signal => {
    if (!canPrepare || !review || !reviewCandidate) return;
    onSubmissionStarted(reviewCandidate);
    try {
      if (flight.current?.owner === owner) {
        flight.current.submittedReview = review; flight.current.pendingNotification = 'unknown';
      }
      const result = await client.submit(review, geometry!, signal);
      if (!active() || signal.aborted) return;
      heads?.set(buildingId!, headKey(result));
      setRead({ owner, value: result });
      setStatus({ owner, text: 'Reviewed association saved and current head verified.' });
      committed.current?.();
    } finally {
      client.releasePrepared(review); if (active()) setPrepared(null); onSubmissionSettled();
    }
  }, true, undefined, 'submit');
  const unresolved = buildingId ? client.pending(buildingId).filter(item => item.outcome === 'unknown') : [];
  const resolve = () => execute('Checking saved outcome', async signal => {
    const intent = unresolved[0]?.prepared; if (!intent) return;
    const result = await client.resolve(intent, geometry!, signal);
    if (!active() || signal.aborted) return;
    const committed = client.pending(buildingId!).some(item => item.prepared === intent && item.outcome === 'committed');
    if (result.status === 'available' && result.recordId === intent.targetId && committed) {
      heads?.set(buildingId!, headKey(result));
      setRead({ owner, value: result });
      setStatus({ owner, text: 'Reviewed association found as the current head.' });
      refreshed.current?.();
    } else setStatus({ owner, text: 'Outcome remains unresolved; no new write was sent.' });
  }, false, undefined, 'resolve');

  return <section ref={surface} hidden={!visible} aria-label="Native scene association review">
    <h3>Scene association</h3>
    {!buildingId || !geometry ? <p role="status">No current native geometry is available for association readback.</p> : <>
      <p>Building {buildingId}</p>
      {reviewCandidate && canPrepare ? <>
      <p>Primary scene evidence {reviewCandidate.primaryEvidenceId}</p>
      <p>Historical receipt evidence {reviewCandidate.historicalEvidenceId}</p>
      </> : canPrepare && <p role="status">No current retained scene candidate is available for review.</p>}
      <button type="button" onClick={requestRefresh} disabled={!!busy}>Reload current association</button>
      {confirmRefresh && <div role="alertdialog" aria-label="Confirm association reload">
        <p>Reloading will refresh the displayed scene and discard this unfinished review draft.</p>
        <button type="button" onClick={() => {
          setConfirmRefresh(false); onDiscardDraft?.(); setStatement(''); setReason('');
          if (review) client.releasePrepared(review); setPrepared(null); refresh(true);
        }}>Discard draft and reload</button>
        <button type="button" onClick={() => setConfirmRefresh(false)}>Keep editing</button>
      </div>}
      {observation && <p role="status">{observation.status === 'available'
        ? `Current association ${observation.recordId}` : observation.reason === 'no-current-association'
          ? 'No reviewed association is current.' : 'The current association source is unavailable.'}</p>}
      {reviewCandidate && canPrepare && <><label>Review statement<textarea disabled={!!busy} value={statement} onChange={event => {
        if (review) client.releasePrepared(review); setPrepared(null); setStatement(event.target.value);
      }} maxLength={4096} /></label>
      <label>Reason<textarea disabled={!!busy} value={reason} onChange={event => {
        if (review) client.releasePrepared(review); setPrepared(null); setReason(event.target.value);
      }} maxLength={4096} /></label>
      <button type="button" onClick={prepare} disabled={!!busy || !canPrepare || !client.canCreate(buildingId) || !statement.trim() || !reason.trim() || unresolved.length > 0}>
        Review retained originals
      </button>
      {review && <details open><summary>Exact proposed receipt and mappings</summary>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '22rem', overflow: 'auto' }}>
          {stringifyLosslessJson(review.payload)}
        </pre>
      </details>}
      {review && canPrepare && <button type="button" onClick={submit} disabled={!!busy || !canPrepare || !client.canCreate(buildingId) || !client.isPreparedCurrent(review) || unresolved.length > 0}>
        Submit reviewed association
      </button>}</>}
      {unresolved.length > 0 && <>
        <p role="status">A submitted association has an unknown outcome. Check the saved head before another write.</p>
        <button type="button" onClick={resolve} disabled={!!busy}>Check saved outcome</button>
      </>}
      {busy?.owner === owner && <p role="status">{busy.text}…</p>}
      {status?.owner === owner && <p role="status">{status.text}</p>}
    </>}
  </section>;
}
