import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { stringifyLosslessJson } from '../../../numeric/lossless-json';
import type { NativeGeometryFrame } from '../native-read-types';
import type { SceneAssociationCandidate, SceneAssociationClient, SceneAssociationPrepared,
  SceneAssociationRead } from '../../../../integration/native-scene-association-client';

type Flight = { owner: object; controller: AbortController };

/** The host supplies reviewed evidence IDs and three independent document owners.
 * This leaf only owns the current review interaction and never invents a source. */
export function NativeSceneAssociation({ client, candidate, geometry, canPrepare, onRefreshed, onCommitted }: {
  readonly client: SceneAssociationClient;
  readonly candidate: SceneAssociationCandidate | null;
  readonly geometry: NativeGeometryFrame | null;
  readonly canPrepare: boolean;
  readonly onRefreshed?: () => void;
  readonly onCommitted?: () => void;
}) {
  const binding = client.getBinding();
  const owner = useMemo(() => ({ client, binding, candidate, geometry }), [client, binding, candidate, geometry]);
  const current = useRef(owner); current.current = owner;
  const refreshed = useRef(onRefreshed); refreshed.current = onRefreshed;
  const committed = useRef(onCommitted); committed.current = onCommitted;
  const surface = useRef<HTMLElement>(null), flight = useRef<Flight | null>(null);
  const [statement, setStatement] = useState(''), [reason, setReason] = useState('');
  const [prepared, setPrepared] = useState<{ owner: object; value: SceneAssociationPrepared } | null>(null);
  const [read, setRead] = useState<{ owner: object; value: SceneAssociationRead } | null>(null);
  const [status, setStatus] = useState<{ owner: object; text: string } | null>(null);
  const [busy, setBusy] = useState<{ owner: object; text: string } | null>(null);
  const [, repaint] = useState(0);
  const active = () => current.current === owner && client.getBinding() === binding && binding !== null;
  const buildingId = geometry?.descriptor.buildingId ?? null;
  const reviewCandidate = candidate && buildingId === candidate.buildingId ? candidate : null;
  const review = prepared?.owner === owner ? prepared.value : null;
  const observation = read?.owner === owner ? read.value : null;
  const visible = active() && (!review || client.isPreparedCurrent(review));

  useLayoutEffect(() => { setStatement(''); setReason(''); setPrepared(null); setRead(null); setStatus(null); setBusy(null); }, [owner]);

  useLayoutEffect(() => {
    if (surface.current) surface.current.hidden = !visible;
    const invalidate = () => {
      if (surface.current) surface.current.hidden = true;
      flight.current?.controller.abort(); flight.current = null;
      if (prepared?.owner === owner) client.releasePrepared(prepared.value);
      setPrepared(null); setRead(null); setStatus(null); setBusy(null);
      repaint(value => value + 1);
    };
    const stop = client.subscribe(() => { if (!active() || review && !client.isPreparedCurrent(review)) invalidate();
      else repaint(value => value + 1); });
    return () => { stop();
      if (flight.current?.owner === owner) { flight.current.controller.abort(); flight.current = null; }
      if (prepared?.owner === owner) client.releasePrepared(prepared.value);
      if (surface.current) surface.current.hidden = true;
    };
  }, [client, owner, visible, prepared]);

  useEffect(() => {
    if (!buildingId || !geometry || !active()) return;
    const controller = new AbortController();
    void client.readCurrent(buildingId, geometry, controller.signal).then(result => {
      if (current.current !== owner || controller.signal.aborted || !active()) return;
      setRead({ owner, value: result });
    }).catch(() => {
      if (current.current === owner && !controller.signal.aborted) setStatus({ owner, text: 'Current association is unavailable.' });
    });
    return () => controller.abort();
  }, [client, owner, buildingId, geometry]);

  const execute = (label: string, work: (signal: AbortSignal) => Promise<void>) => {
    if (!buildingId || !geometry || !active() || flight.current) return;
    const running: Flight = { owner, controller: new AbortController() }; flight.current = running;
    setBusy({ owner, text: label }); setStatus(null);
    void work(running.controller.signal).catch(error => {
      if (flight.current === running && active()) setStatus({ owner,
        text: error instanceof Error ? error.message : 'Scene association is unavailable.' });
    }).finally(() => { if (flight.current === running) { flight.current = null; setBusy(null); } });
  };
  const refresh = () => execute('Reading current association', async signal => {
    const result = await client.readCurrent(buildingId!, geometry!, signal);
    if (!active() || signal.aborted) return;
    setRead({ owner, value: result }); refreshed.current?.();
  });
  const prepare = () => execute('Reviewing retained originals', async signal => {
    if (!canPrepare || !reviewCandidate) return;
    if (review) client.releasePrepared(review);
    setPrepared(null);
    const value = await client.prepare(reviewCandidate, geometry!, statement, reason, signal);
    if (!active() || signal.aborted) { client.releasePrepared(value); return; }
    setPrepared({ owner, value });
  });
  const submit = () => execute('Saving reviewed association', async signal => {
    if (!canPrepare || !review || !reviewCandidate) return;
    try {
      const result = await client.submit(review, geometry!, signal);
      if (!active() || signal.aborted) return;
      setRead({ owner, value: result });
      setStatus({ owner, text: 'Reviewed association saved and current head verified.' });
      committed.current?.();
    } finally { client.releasePrepared(review); if (active()) setPrepared(null); }
  });
  const unresolved = buildingId ? client.pending(buildingId).filter(item => item.outcome === 'unknown') : [];
  const resolve = () => execute('Checking saved outcome', async signal => {
    const intent = unresolved[0]?.prepared; if (!intent) return;
    const result = await client.resolve(intent, geometry!, signal);
    if (!active() || signal.aborted) return;
    setRead({ owner, value: result });
    setStatus({ owner, text: result.status === 'available' && result.recordId === intent.targetId
      ? 'Reviewed association found as the current head.' : 'Outcome remains unresolved; no new write was sent.' });
  });

  return <section ref={surface} hidden={!visible} aria-label="Native scene association review">
    <h3>Scene association</h3>
    {!buildingId || !geometry ? <p role="status">No current native geometry is available for association readback.</p> : <>
      <p>Building {buildingId}</p>
      {reviewCandidate ? <>
      <p>Primary scene evidence {reviewCandidate.primaryEvidenceId}</p>
      <p>Historical receipt evidence {reviewCandidate.historicalEvidenceId}</p>
      </> : canPrepare && <p role="status">No current retained scene candidate is available for review.</p>}
      <button type="button" onClick={refresh} disabled={!!busy}>Reload current association</button>
      {observation && <p role="status">{observation.status === 'available'
        ? `Current association ${observation.recordId}` : observation.reason === 'no-current-association'
          ? 'No reviewed association is current.' : 'The current association source is unavailable.'}</p>}
      {reviewCandidate && canPrepare && <><label>Review statement<textarea value={statement} onChange={event => {
        if (review) client.releasePrepared(review); setPrepared(null); setStatement(event.target.value);
      }} maxLength={4096} /></label>
      <label>Reason<textarea value={reason} onChange={event => {
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
