import { useEffect, useMemo, useState } from 'react';
import type { SceneAssociationCandidate } from '../../../../integration/native-scene-association-client';
import { parseLosslessJson, type JsonForSerialization } from '../../../numeric/lossless-json';
import { NativeSceneAssociation } from './NativeSceneAssociation';
import type { NativeGeometryFrame } from '../native-read-types';
import type { NativeSceneHost } from './native-scene-host';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Explicit Editor input, followed by fresh native owner reads and a closed guarded command.
 * These identifiers cannot authorize a file read or make a scene current. */
export function NativeSceneCandidate({ host, geometry, onSaved }: {
  readonly host: NativeSceneHost; readonly geometry: NativeGeometryFrame; readonly onSaved: () => void;
}) {
  const [primary, setPrimary] = useState(''), [historical, setHistorical] = useState('');
  const [floorJoins, setFloorJoins] = useState(''), [roomJoins, setRoomJoins] = useState(''), [guards, setGuards] = useState('');
  const [submittingCandidate, setSubmittingCandidate] = useState<SceneAssociationCandidate | null>(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [, repaint] = useState(0);
  useEffect(() => host.associations.subscribe(() => repaint(value => value + 1)), [host]);
  const candidate = useMemo<SceneAssociationCandidate | null>(() => {
    if (!UUID.test(primary) || !UUID.test(historical) || primary === historical) return null;
    try {
      const arrays = [floorJoins, roomJoins, guards].map(text => {
        if (text.length > 65536) throw new Error('Input limit');
        const value = parseLosslessJson(text);
        if (!Array.isArray(value) || value.length > 128) throw new Error('Review list unavailable');
        return value as JsonForSerialization[];
      });
      return { buildingId: geometry.descriptor.buildingId, primaryEvidenceId: primary, historicalEvidenceId: historical,
        sourceFloors: arrays[0]!, roomMappings: arrays[1]!, guards: arrays[2]! };
    } catch { return null; }
  }, [geometry, primary, historical, floorJoins, roomJoins, guards]);
  const canReadCurrent = host.associations.getBinding() !== null;
  const canCreate = canReadCurrent && host.associations.canCreate(geometry.descriptor.buildingId);
  const pendingOutcome = host.associations.pending(geometry.descriptor.buildingId).some(item => item.outcome === 'unknown');
  useEffect(() => {
    if (!canCreate) {
      setPrimary(''); setHistorical(''); setFloorJoins(''); setRoomJoins(''); setGuards('');
    }
  }, [canCreate]);
  return <details><summary>Scene association</summary>
    {!canReadCurrent && <p role="status">Current association readback is unavailable because there is no active scene context.
      {pendingOutcome && ' A submitted outcome remains unknown and can be checked when the context returns.'}</p>}
    {canReadCurrent && !canCreate && <p role="status">Preparation is unavailable. {pendingOutcome
      ? 'A submitted outcome is unknown and can be checked below.' : 'The current association remains available to reload.'}</p>}
    {canCreate && <>
      <h3>Review retained scene sources</h3>
      <p>Choose the two saved text originals and review their floor and place joins. Saving a reviewed association makes it available after reload.</p>
      <label>Primary scene evidence<input disabled={refreshPending} value={primary} onChange={event => setPrimary(event.target.value.trim())} maxLength={36} /></label>
      <label>Historical receipt evidence<input disabled={refreshPending} value={historical} onChange={event => setHistorical(event.target.value.trim())} maxLength={36} /></label>
      <details><summary>Exact native joins and current guards</summary>
        <label>Floor joins<textarea disabled={refreshPending} value={floorJoins} onChange={event => setFloorJoins(event.target.value)} maxLength={65536} /></label>
        <label>Place joins<textarea disabled={refreshPending} value={roomJoins} onChange={event => setRoomJoins(event.target.value)} maxLength={65536} /></label>
        <label>Current record guards<textarea disabled={refreshPending} value={guards} onChange={event => setGuards(event.target.value)} maxLength={65536} /></label>
      </details>
      {!candidate && <p role="status">Select both evidence records and their complete joins before review.</p>}
    </>}
    <NativeSceneAssociation client={host.associations} candidate={submittingCandidate ?? (canCreate ? candidate : null)}
      geometry={geometry} canPrepare={canCreate} hasUnsavedDraft={Boolean(primary || historical || floorJoins || roomJoins || guards)}
      onSubmissionStarted={setSubmittingCandidate} onSubmissionSettled={() => setSubmittingCandidate(null)}
      onDiscardDraft={() => { setPrimary(''); setHistorical(''); setFloorJoins(''); setRoomJoins(''); setGuards(''); }}
      onRefreshPendingChanged={setRefreshPending}
      onRefreshed={onSaved} onCommitted={onSaved} />
  </details>;
}
