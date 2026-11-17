import type { NetworkOverlayDevice, NetworkOverlayLink } from '../overlays/network/types';
import { isHypothesisLink } from './network-trace';
import type { NetworkConnectionEnd } from './network-connections';
import type { RuntimeRecords } from './runtime-overlays';

/** How a reported link is drawn on the map. Never a cable route: only the
 * recorded medium, read from the source's own word for it. */
export type NetworkLinkStyle = 'wired' | 'wireless' | 'unknown';
const WIRED = /ethernet|\bcable|wired|fib(?:re|er)|coax|copper|powerline|\bplc\b|moca|\bpoe\b|\bcat ?\d|\blan\b|\busb\b/i;
const WIRELESS = /wi-?fi|wireless|\bwlan\b|802\.11|radio|bluetooth|zigbee|z-?wave|\bthread\b|\blte\b|\b[345]g\b|cellular/i;

/** Wired solid, wireless dashed; an unknown medium, an unresolved end or
 * a hypothesis takes the third style, labelled in the Network key. */
export function networkLinkStyle(link: Pick<NetworkOverlayLink, 'kind' | 'medium' | 'temporalStatus' | 'basis' | 'notes'>,
  ends: readonly Pick<NetworkConnectionEnd, 'nodeKey'>[] = []): NetworkLinkStyle {
  if (link.kind === 'unresolved-path' || isHypothesisLink(link as NetworkOverlayLink) || ends.some(end => end.nodeKey === null)) return 'unknown';
  const wireless = WIRELESS.test(link.medium), wired = WIRED.test(link.medium);
  return wired === wireless ? 'unknown' : wired ? 'wired' : 'wireless';
}
/** Anything short of a recorded or accepted link is drawn fainter. */
export const uncertainLink = (link: Pick<NetworkOverlayLink, 'confidence'>): boolean =>
  link.confidence !== 'accepted' && link.confidence !== 'recorded';

/** Why a device has no room on the map. Only the reviewed room mapping places one. */
export type NetworkUnplacedReason = 'moves-around' | 'no-reviewed-room';
export const NETWORK_UNPLACED_LABEL: Record<NetworkUnplacedReason, string> = { 'moves-around': 'Moves around', 'no-reviewed-room': 'No reviewed room' };
export const networkUnplacedReason = (device: Pick<NetworkOverlayDevice, 'mobility'>): NetworkUnplacedReason =>
  device.mobility === 'mobile' ? 'moves-around' : 'no-reviewed-room';

/** Devices whose own reviewed room record names this room in the same source
 * observation. Names, graph positions and raw IDs never place a device. */
export function admittedNetworkDevices(records: RuntimeRecords | null): readonly { readonly graphKey: string; readonly deviceId: string; readonly roomId: string }[] {
  const rows: { graphKey: string; deviceId: string; roomId: string }[] = [];
  for (const graph of records?.networkGraphs ?? []) {
    if (!graph.deviceRecordKeys || !graph.sourceOriginalSha256) continue;
    const devicesByRecord = new Map<string, string[]>();
    for (const device of graph.data.devices) {
      const key = graph.deviceRecordKeys.get(device.id); if (!key) continue;
      const own = devicesByRecord.get(key) ?? []; own.push(device.id); devicesByRecord.set(key, own);
    }
    for (const [roomId, room] of records!.rooms) for (const record of room.network) {
      const deviceIds = devicesByRecord.get(record.key); if (!deviceIds) continue;
      const admitted = [record, ...(record.observations ?? [])].some(observation =>
        observation.sourceFacts.some(fact => fact.label === 'Source original SHA256' && fact.value === graph.sourceOriginalSha256)
        && observation.sourceFacts.some(fact => fact.label === 'Room association in this observation' && fact.value === roomId));
      if (admitted) for (const deviceId of deviceIds) rows.push({ graphKey: graph.key, deviceId, roomId });
    }
  }
  return rows;
}

/** Glyphs drawn around one room anchor before the rest fold into a +n chip. */
export const NETWORK_GLYPHS = 3;
/** One glyph's slot along the row, in pixels: its whole touch target on a coarse pointer. */
export const networkGlyphSlot = (coarse: boolean) => coarse ? 44 : 26;
/** Slots a room's devices take: every device up to the limit, else the limit and a chip. */
export const networkGlyphSlots = (devices: number) => devices <= NETWORK_GLYPHS ? devices : NETWORK_GLYPHS + 1;
/** Centre of slot `at` in a row of `slots` centred on the anchor. */
export const networkGlyphOffset = (at: number, slots: number, coarse: boolean) => (at - (slots - 1) / 2) * networkGlyphSlot(coarse);
