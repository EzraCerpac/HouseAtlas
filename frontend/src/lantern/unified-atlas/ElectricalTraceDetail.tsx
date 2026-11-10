import { useMemo } from 'react';
import type { ElectricalGroup } from './electrical-group';
import { traceElectricalGroup, type ElectricalTraceSource, type TraceRow } from './electrical-trace';
import type { AtlasModel } from './scene';

const BASIS: Readonly<Record<string, string>> = { 'owner-report': 'Owner report', 'label-match': 'Label match', test: 'Test', unknown: 'Unknown' };
const CONFIDENCE: Readonly<Record<string, string>> = { low: 'Low', medium: 'Medium', high: 'High', unknown: 'Unknown' };
const known = (table: Readonly<Record<string, string>>, value: string) => Object.hasOwn(table, value) ? table[value]! : 'Unknown';

/** Reviewed circuit, breaker and panel for one historic drawing group. Room
 * level only: a panel room is the reviewed association, never a position. */
export function ElectricalTraceDetail({ group, source, model, onRoom }: {
  readonly group: ElectricalGroup; readonly source: ElectricalTraceSource; readonly model: AtlasModel;
  readonly onRoom: (roomId: string) => void;
}) {
  const trace = useMemo(() => traceElectricalGroup(group, source), [group, source]);
  return <div className="ua-electrical-trace" role="group" aria-label="Circuit and panel">
    <h4>Circuit and panel</h4>
    {trace.status === 'refused'
      ? <p className="ua-records-state">{trace.reason === 'source-too-large' ? 'Electrical data too large to show.' : 'Electrical data does not match this drawing group.'}</p>
      : <>
        {trace.rows.length === 0 && <p className="ua-records-state">No reviewed circuit mapping.</p>}
        {trace.rows.length > 0 && <ul>{trace.rows.map(row => <li key={row.mappingId}><TraceRowDetail row={row} model={model} onRoom={onRoom} /></li>)}</ul>}
        {trace.rows.length > 0 && trace.uncovered.length > 0 && <p>No reviewed circuit: {trace.uncovered.map(row => row.label ?? 'unavailable member').join(', ')}.</p>}
      </>}
  </div>;
}

function TraceRowDetail({ row, model, onRoom }: { readonly row: TraceRow; readonly model: AtlasModel; readonly onRoom: (roomId: string) => void }) {
  const target = row.coverage.kind === 'group' ? 'Whole group' : row.coverage.label ?? 'Unavailable member';
  const circuit = row.circuit, details = circuit?.details;
  const room = circuit?.panel?.room;
  const atlasRoom = room?.kind === 'room' ? model.roomsById.get(room.roomId) : undefined;
  const occurrence = atlasRoom?.occurrenceIds.find(id => model.selectable.has(id));
  return <>
    <p>{target}</p>
    <dl className="ua-facts">
      {circuit ? <>
        <div><dt>Circuit</dt><dd>{circuit.label ?? 'Unlabelled circuit'}</dd></div>
        {details && 'position' in details && <div><dt>Panel position</dt><dd>{details.position?.label ?? 'Unknown'}</dd></div>}
        {details && 'ratingAmperes' in details && <div><dt>Rating</dt><dd>{typeof details.ratingAmperes === 'number' ? `${details.ratingAmperes} A` : 'Unknown'}</dd></div>}
        {details && 'protection' in details && <div><dt>Protection</dt><dd>{details.protection ?? 'Unknown'}</dd></div>}
        <div><dt>Panel</dt><dd>{circuit.panel ? circuit.panel.label ?? 'Unlabelled panel' : 'Not recorded'}</dd></div>
        {circuit.panel && <div><dt>Panel room</dt><dd>{atlasRoom && occurrence
          ? <button type="button" className="text-btn" onClick={() => onRoom(atlasRoom.roomId)}>{atlasRoom.label}</button>
          : room?.kind === 'not-recorded' ? 'Not recorded' : room?.kind === 'unknown' ? 'Unknown' : 'Not placed in this Atlas'}</dd></div>}
      </> : <div><dt>Circuit</dt><dd>Withheld: {row.reasons.join('; ')}</dd></div>}
      <div><dt>Basis</dt><dd>{known(BASIS, row.basis)}</dd></div>
      <div><dt>Confidence</dt><dd>{known(CONFIDENCE, row.confidence)}</dd></div>
      {row.uncertainty !== null && <div><dt>Uncertainty</dt><dd>{row.uncertainty}</dd></div>}
      {circuit && <div><dt>Test</dt><dd>{row.test ? `Circuit association confirmed by test, observed ${row.test.observedAt}. ${row.test.method}` : 'Not confirmed by test'}</dd></div>}
    </dl>
  </>;
}
