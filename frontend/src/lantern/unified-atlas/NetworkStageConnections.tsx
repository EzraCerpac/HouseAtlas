import type { CSSProperties } from 'react';
import { TONE_COLOR } from '../canonical-ifc/tones';
import { projectNetworkConnections, type NetworkConnectionEnd, type NetworkConnections } from './network-connections';
import { networkLinkStyle, uncertainLink, type NetworkLinkStyle } from './network-map';
import type { StageTrace } from './NetworkGraph';
import type { RuntimeRecords } from './runtime-overlays';

/** One device's display anchor: its glyph on the stage (or its room's anchor
 * when the glyph is not drawn). Never a device position, cable route or a
 * new room association; the room comes from the reviewed room mapping. */
export interface NetworkDeviceAnchor {
  readonly graphKey: string;
  readonly deviceId: string;
  readonly roomId: string;
  readonly occurrenceId: string;
  readonly point: readonly [number, number];
}

export function networkRoomConnections(records: RuntimeRecords | null, devices: readonly NetworkDeviceAnchor[]): NetworkConnections {
  return projectNetworkConnections(records?.networkGraphs ?? [], devices.map(row => ({ graphKey: row.graphKey, nodeKind: 'device' as const,
    nodeId: row.deviceId, roomId: row.roomId, occurrenceId: row.occurrenceId, point: row.point,
    basis: 'room-summary' as const, qualification: 'Reviewed room association; display summary, not a device coordinate' })));
}

/** Length of a link's stub toward another floor's plan, in pixels: clear of
 * the glyph's own target, so the floor badge at its end never overlaps it. */
export const networkStubLength = (coarse: boolean) => coarse ? 48 : 36;
/** The stub's far end: from the shown end toward the other, or straight down
 * (clear of the room's name above its glyphs) when they coincide. */
export function networkStubEnd(near: readonly [number, number], far: readonly [number, number], stub: number): readonly [number, number] {
  const dx = far[0] - near[0], dy = far[1] - near[1], length = Math.hypot(dx, dy);
  return length < 1 ? [near[0], near[1] + stub] : [near[0] + dx / length * stub, near[1] + dy / length * stub];
}

const DASH: Record<NetworkLinkStyle, string | undefined> = { wired: undefined, wireless: '7 5', unknown: '1 5' };

/** The reported links between device glyphs. Nothing chosen, they stay faint;
 * a chosen room, device or link brings its own links to full strength. Spread
 * floors keep links between floors faint until an end is chosen; a plan draws a
 * link to another floor as a stub (its floor badge is the stage's). A traced
 * route from the graph overrides all of this. Full identities, dates and
 * uncertainty stay in the cards and the graph. */
export function NetworkStageConnections({ connections, selected, focusNode = null, focusLink = null, trace = null, fade = 1, shown, stubs = 0,
  spread = false, floorOf, hitWidth = 0 }: {
  readonly connections: NetworkConnections; readonly selected: string | null;
  /** The chosen device's node key, and the chosen link's key. */
  readonly focusNode?: string | null; readonly focusLink?: string | null;
  /** A device's route to the root, chosen in the network graph. */
  readonly trace?: StageTrace | null;
  /** Opacity of every untraced association. */
  readonly fade?: number;
  /** When set, only ends in rooms it admits are drawn (a plan's own floors). */
  readonly shown?: ((occurrenceId: string) => boolean) | undefined;
  /** A link with one end shown is drawn as a stub this long toward the other; none when 0. */
  readonly stubs?: number;
  /** Spread floors: links between floors stay faint until an end is chosen. */
  readonly spread?: boolean;
  readonly floorOf?: ((occurrenceId: string) => string | undefined) | undefined;
  /** Width of each link's tap target, in pixels; none when 0. */
  readonly hitWidth?: number;
}) {
  const order = trace ? new Map(trace.linkIds.map((id, at) => [id, at])) : null;
  const ends = (row: { readonly from: NetworkConnectionEnd; readonly to: NetworkConnectionEnd }) =>
    [row.from.ownerDeviceKey ?? row.from.nodeKey, row.to.ownerDeviceKey ?? row.to.nodeKey];
  const rows = [
    ...connections.connections.map(row => ({ ...row, medium: row.link.medium, tappable: true,
      style: networkLinkStyle(row.link, [row.from, row.to]), uncertain: uncertainLink(row.link),
      hop: order && row.graphKey === trace!.graphKey ? order.get(row.link.id) ?? null : null,
      reversed: trace?.reversedLinkIds.has(row.link.id) ?? false,
      detail: [row.link.kind, row.link.sourceConfidence, row.link.temporalStatus, row.link.recordedAt, row.link.basis, row.link.notes].filter(Boolean).join(' · ') })),
    // A shared medium is on the route when the route passes through its segment
    // between the two devices it associates.
    ...connections.sharedMediumAssociations.map(row => ({ ...row, tappable: false,
      style: networkLinkStyle({ kind: 'connection', medium: row.medium, temporalStatus: '', basis: '', notes: '' }),
      uncertain: row.memberships.some(uncertainLink),
      hop: order && row.graphKey === trace!.graphKey && trace!.segmentIds.has(row.segment.id)
        && trace!.deviceOrder.has(row.from.sourceId) && trace!.deviceOrder.has(row.to.sourceId)
        ? Math.min(...row.memberships.map(link => order.get(link.id) ?? Infinity)) : null,
      reversed: (trace?.deviceOrder.get(row.from.sourceId) ?? 0) > (trace?.deviceOrder.get(row.to.sourceId) ?? 0),
      detail: 'Shared-medium association from recorded segment memberships' })),
  ].map(row => ({ ...row, hop: row.hop === Infinity ? null : row.hop }));
  const chosen = focusNode !== null || focusLink !== null || selected !== null;
  const drawn = rows.flatMap((row, index) => row.placements.flatMap(placement => {
    const traced = row.hop !== null;
    if (!traced && fade <= 0) return [];
    const fromShown = !shown || shown(placement.from.occurrenceId), toShown = !shown || shown(placement.to.occurrenceId);
    if (!fromShown && !toShown) return [];
    const stub = !(fromShown && toShown);
    if (stub && (traced || !stubs)) return [];
    const focused = !trace && (focusLink === row.key || (focusNode !== null && ends(row).includes(focusNode))
      || (focusNode === null && focusLink === null && (selected === placement.from.occurrenceId || selected === placement.to.occurrenceId)));
    const across = floorOf !== undefined && floorOf(placement.from.occurrenceId) !== floorOf(placement.to.occurrenceId);
    // A traced hop draws from the chosen device's side toward the root.
    const [start, end] = traced && row.reversed ? [placement.to, placement.from] : [placement.from, placement.to];
    const [x1, y1] = stub && !toShown ? placement.from.point : stub ? placement.to.point : start.point;
    const [x2, y2] = stub ? networkStubEnd([x1, y1], (toShown ? placement.from : placement.to).point, stubs) : end.point;
    const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy);
    const bend = stub ? 0 : ((index % 5) - 2) * 5;
    const loop = 22 + (index % 5) * 5;
    const path = placement.coincident && !stub
      ? `M ${x1} ${y1} c ${-loop} ${-loop * 1.2} ${loop} ${-loop * 1.2} 0 0`
      : `M ${x1} ${y1} Q ${(x1 + x2) / 2 - dy / length * bend} ${(y1 + y2) / 2 + dx / length * bend} ${x2} ${y2}`;
    const strength = traced ? 1 : trace ? .14 : focused ? 1 : chosen ? .2 : spread && across ? .14 : .5;
    return [{ key: placement.key, row, path, traced, focused, opacity: traced ? 1 : strength * (row.uncertain && !traced ? .55 : 1) * fade }];
  }));
  return <>
    <g pointerEvents="none" fill="none" stroke={TONE_COLOR.network} strokeWidth={1.8} strokeLinecap="round"
      data-network-associations="room-summary" className={trace ? 'ua-net-tracing' : undefined}>
      {drawn.map(({ key, row, path, traced, focused, opacity }) =>
        <path key={key} d={path} vectorEffect="non-scaling-stroke" opacity={opacity}
          strokeWidth={traced ? 3.4 : focused ? 2.6 : 1.8} strokeDasharray={traced ? undefined : DASH[row.style]}
          className={traced ? 'ua-net-trace' : focused ? 'ua-net-focus' : undefined} data-link-style={row.style}
          pathLength={traced ? 1 : undefined} style={traced ? { '--hop': row.hop } as CSSProperties : undefined}>
          <title>{`${row.from.label} ↔ ${row.to.label} · ${row.medium} · Logical association, no cable route · ${row.qualification} · ${row.detail}`}</title>
        </path>)}
    </g>
    {hitWidth > 0 && !trace && <g className="ua-net-hits" fill="none" stroke="transparent" strokeWidth={hitWidth}>
      {drawn.filter(({ row }) => row.tappable).map(({ key, row, path }) =>
        <path key={key} d={path} vectorEffect="non-scaling-stroke" pointerEvents="stroke" data-network-link={row.key} />)}
    </g>}
  </>;
}
