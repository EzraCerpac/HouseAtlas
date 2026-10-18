import { TONE_COLOR } from '../canonical-ifc/tones';
import { projectNetworkConnections, type NetworkConnectionAnchor, type NetworkConnections } from './network-connections';
import type { RuntimeRecords } from './runtime-overlays';

/** Display anchors retain the current occurrence and camera projection. They
 * never establish a device position, cable route, or a new room association. */
export interface NetworkRoomAnchor {
  readonly roomId: string;
  readonly occurrenceId: string;
  readonly point: readonly [number, number];
}

export function networkRoomConnections(records: RuntimeRecords | null, rooms: readonly NetworkRoomAnchor[]): NetworkConnections {
  const graphs = records?.networkGraphs ?? [], anchors: NetworkConnectionAnchor[] = [];
  for (const graph of graphs) {
    if (!graph.deviceRecordKeys || !graph.sourceOriginalSha256) continue;
    const devicesByRecord = new Map<string, string[]>();
    for (const device of graph.data.devices) {
      const key = graph.deviceRecordKeys.get(device.id); if (!key) continue;
      const own = devicesByRecord.get(key) ?? []; own.push(device.id); devicesByRecord.set(key, own);
    }
    for (const room of rooms) {
      const own = records?.rooms.get(room.roomId)?.network ?? [];
      for (const record of own) {
        const deviceIds = devicesByRecord.get(record.key); if (!deviceIds) continue;
        const admitted = [record, ...(record.observations ?? [])].some(observation =>
          observation.sourceFacts.some(fact => fact.label === 'Source original SHA256' && fact.value === graph.sourceOriginalSha256)
          && observation.sourceFacts.some(fact => fact.label === 'Room association in this observation' && fact.value === room.roomId));
        if (!admitted) continue;
        for (const nodeId of deviceIds) anchors.push({ graphKey: graph.key, nodeKind: 'device', nodeId, ...room,
          basis: 'room-summary', qualification: 'Reviewed room association; display summary, not a device coordinate' });
      }
    }
  }
  return projectNetworkConnections(graphs, anchors);
}

/** Noninteractive topology decoration keeps existing stage picking intact.
 * Full identities, dates and uncertainty remain in the source records/graph. */
export function NetworkStageConnections({ connections, selected }: {
  readonly connections: NetworkConnections; readonly selected: string | null;
}) {
  const rows = [
    ...connections.connections.map(row => ({ ...row, medium: row.link.medium,
      detail: [row.link.kind, row.link.sourceConfidence, row.link.temporalStatus, row.link.recordedAt, row.link.basis, row.link.notes].filter(Boolean).join(' · ') })),
    ...connections.sharedMediumAssociations.map(row => ({ ...row, detail: 'Shared-medium association from recorded segment memberships' })),
  ];
  return <g pointerEvents="none" fill="none" stroke={TONE_COLOR.network} strokeWidth={1.8} strokeDasharray="6 4"
    data-network-associations="room-summary">
    {rows.flatMap((row, index) => row.placements.map(placement => {
      const [x1, y1] = placement.from.point, [x2, y2] = placement.to.point;
      const focused = selected === placement.from.occurrenceId || selected === placement.to.occurrenceId;
      const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy);
      const bend = ((index % 5) - 2) * 5;
      const loop = 22 + (index % 5) * 5;
      const path = placement.coincident
        ? `M ${x1} ${y1} c ${-loop} ${-loop * 1.2} ${loop} ${-loop * 1.2} 0 0`
        : `M ${x1} ${y1} Q ${(x1 + x2) / 2 - dy / length * bend} ${(y1 + y2) / 2 + dx / length * bend} ${x2} ${y2}`;
      return <path key={placement.key} d={path} vectorEffect="non-scaling-stroke" opacity={focused ? 1 : .65}
        strokeWidth={focused ? 2.8 : 1.8}>
        <title>{`${row.from.label} ↔ ${row.to.label} · ${row.medium} · Logical room association, no cable route · ${row.qualification} · ${row.detail}`}</title>
      </path>;
    }))}
  </g>;
}
