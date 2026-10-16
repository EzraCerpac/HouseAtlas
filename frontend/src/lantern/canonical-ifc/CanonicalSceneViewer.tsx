import { useEffect, useMemo, useRef, useState } from 'react';
import { readCanonicalSceneV2, type CanonicalAdapterResult, type CanonicalScenePort, type SceneRequest } from './adapter';
import { CanonicalModelViewer } from './CanonicalModelViewer';
import type { OverlayLayer } from './model';
import { scopedMemoryKey, type ViewerMemoryPort } from './selection';
import { retriesFor, takeRetry, type StaleRetries } from './stale-retry';
import './canonical-ifc.css';

export interface CanonicalSceneViewerProps {
  /** Injected owned transport; this component never chooses an endpoint. */
  readonly port: CanonicalScenePort;
  readonly request: SceneRequest;
  readonly memory?: ViewerMemoryPort | null;
  /** Host-supplied overlay layers; only layers of the snapshot's publication join. */
  readonly overlays?: readonly OverlayLayer[];
}

type Phase = { readonly owner: object; readonly result: CanonicalAdapterResult | null };
const MESSAGES = {
  'not-ready': 'This building has no ready model publication.',
  'scope-mismatch': 'The model response did not match this building and publication. Nothing from it is shown.',
  invalid: 'The model publication could not be read. Nothing from it is shown.',
  'artifact-mismatch': 'A pinned model file is missing or differs from its publication. Nothing from it is shown.',
  unsupported: 'This model publication uses a format this viewer does not support yet.',
  'source-unavailable': 'The model publication could not be loaded.',
} as const;

/** Reads one whole scene snapshot per request owner. Late responses from an
 * earlier owner, aborted request or superseded selection are discarded; a
 * stale selection re-reads the whole snapshot, never part of it. */
export function CanonicalSceneViewer({ port, request, memory = null, overlays }: CanonicalSceneViewerProps) {
  const { workspaceId, homeId, buildingId } = request.scope;
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase | null>(null);
  const current = useRef<object | null>(null), staleRetries = useRef<StaleRetries | null>(null);
  const stableRequest = useMemo<SceneRequest>(() => ({ scope: { workspaceId, homeId, buildingId }, publicationId: request.publicationId, buildingLabel: request.buildingLabel }),
    [workspaceId, homeId, buildingId, request.publicationId, request.buildingLabel]);
  // The retry allowance belongs to the port and request; each attempt is a new read owner.
  const identity = useMemo(() => ({ port, request: stableRequest }), [port, stableRequest]);
  const owner = useMemo(() => ({ identity, attempt }), [identity, attempt]);

  useEffect(() => {
    const controller = new AbortController();
    current.current = owner;
    setPhase({ owner, result: null });
    readCanonicalSceneV2(port, stableRequest, controller.signal).then(result => {
      if (controller.signal.aborted || current.current !== owner) return;
      const budget = retriesFor(staleRetries.current, identity), next = result.status === 'stale' ? takeRetry(budget) : null;
      if (next) { staleRetries.current = next; setAttempt(value => value + 1); return; }
      staleRetries.current = result.status === 'stale' ? budget : null;
      if (result.status === 'revoked') memory?.remove?.(scopedMemoryKey({ workspaceId, homeId }, buildingId));
      setPhase({ owner, result });
    }, () => { if (!controller.signal.aborted && current.current === owner)
      setPhase({ owner, result: { status: 'unavailable', reason: 'source-unavailable', detail: 'Read failed' } }); });
    return () => { controller.abort(); if (current.current === owner) current.current = null; };
  }, [owner, identity, port, stableRequest, memory, workspaceId, homeId, buildingId]);

  const result = phase?.owner === owner ? phase.result : null;
  // Host overlays attach to the snapshot without re-reading it; admission withholds other publications.
  const presentation = useMemo(() => result?.status === 'available'
    ? { ...result.presentation, overlays: (overlays ?? []).filter(layer => layer.publicationId === result.fence.publicationId) } : null, [result, overlays]);

  if (presentation) return <CanonicalModelViewer presentation={presentation} memory={memory} />;
  const retry = <button type="button" className="chip-btn" onClick={() => { staleRetries.current = null; setAttempt(value => value + 1); }}>Check again</button>;
  return <div className="cifc cifc-unavailable" role="status" aria-busy={result === null}>
    <h2>{request.buildingLabel}</h2>
    {result === null ? <p>Loading model publication…</p>
      : result.status === 'stale' ? <><p>The selected publication changed while loading.</p>{retry}</>
      : result.status === 'revoked' ? <><p>This model publication was withdrawn.</p>{retry}</>
      : result.status === 'unavailable' ? <><p>{MESSAGES[result.reason]}</p>{retry}</> : null}
  </div>;
}
