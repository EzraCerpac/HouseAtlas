import { endpointDeviceId, networkEndpointLabel, networkSharedMediumAssociations } from '../overlays/network/model';
import type { NetworkOverlayDevice, NetworkOverlayEndpoint, NetworkOverlayLink } from '../overlays/network/types';
import type { DocumentaryNetworkGraph } from './runtime-overlays';

export type NetworkConnectionNodeKind = 'device' | 'endpoint';
/** Camera-projected presentation supplied by the scene owner. The owner admits
 * the source/room association before supplying an anchor. These pixels confer
 * no device coordinate, floor membership, cable route or native authority. */
export interface NetworkConnectionAnchor {
  readonly graphKey: string;
  readonly nodeKind: NetworkConnectionNodeKind;
  readonly nodeId: string;
  readonly roomId: string;
  readonly occurrenceId: string;
  readonly point: readonly [number, number];
  readonly basis: 'room-summary' | 'source-position';
  readonly qualification: string;
}
export type NetworkConnectionPlacementReason = 'admitted-anchor' | 'explicit-owner-anchor'
  | 'no-admitted-anchor' | 'owner-without-admitted-anchor' | 'owner-not-in-source' | 'owner-not-recorded' | 'endpoint-not-in-source';
export interface NetworkConnectionNode {
  readonly key: string;
  readonly graphKey: string;
  readonly kind: NetworkConnectionNodeKind;
  readonly id: string;
  readonly label: string;
  readonly device: NetworkOverlayDevice | null;
  readonly endpoint: NetworkOverlayEndpoint | null;
  readonly anchors: readonly NetworkConnectionAnchor[];
  readonly placementReason: NetworkConnectionPlacementReason;
}
export interface NetworkConnectionEnd {
  readonly sourceId: string;
  readonly label: string;
  readonly nodeKey: string | null;
  readonly ownerDeviceKey: string | null;
  readonly anchors: readonly NetworkConnectionAnchor[];
  readonly placementReason: NetworkConnectionPlacementReason;
}
export interface NetworkConnection {
  readonly key: string;
  readonly graphKey: string;
  /** Original source objects, including confidence, dates and uncertainty. */
  readonly link: NetworkOverlayLink;
  readonly source: DocumentaryNetworkGraph['data']['source'];
  readonly qualification: string;
  readonly from: NetworkConnectionEnd;
  readonly to: NetworkConnectionEnd;
  readonly renderable: boolean;
  /** All admitted occurrence pairs; no selected room/building/floor filter. A
   * coincident pair still represents a link and needs a loop/association glyph. */
  readonly placements: readonly {
    readonly key: string;
    readonly from: NetworkConnectionAnchor;
    readonly to: NetworkConnectionAnchor;
    readonly coincident: boolean;
  }[];
}
export interface NetworkConnectionCoverage {
  readonly total: number;
  /** Associated with an admitted display anchor; never a metric position count. */
  readonly anchored: number;
  readonly unplaced: number;
}
/** Derived shared-medium association from the existing source model helper.
 * Original membership links stay in connections and remain independently counted. */
export interface NetworkSharedMediumConnection extends Omit<NetworkConnection, 'link'> {
  readonly segment: NetworkOverlayEndpoint;
  readonly medium: string;
  readonly memberships: readonly NetworkOverlayLink[];
}
export interface NetworkConnections {
  readonly nodes: readonly NetworkConnectionNode[];
  readonly connections: readonly NetworkConnection[];
  readonly sharedMediumAssociations: readonly NetworkSharedMediumConnection[];
  readonly coverage: {
    readonly devices: NetworkConnectionCoverage;
    readonly endpoints: NetworkConnectionCoverage;
    readonly links: NetworkConnectionCoverage;
    readonly sharedMediumAssociations: NetworkConnectionCoverage;
  };
}

export const networkConnectionNodeKey = (graphKey: string, kind: NetworkConnectionNodeKind, id: string): string =>
  JSON.stringify(['houseatlas-network-node.v1', graphKey, kind, id]);
const anchorKey = (anchor: NetworkConnectionAnchor): string => JSON.stringify([
  anchor.graphKey, anchor.nodeKind, anchor.nodeId, anchor.roomId, anchor.occurrenceId,
  anchor.basis, anchor.point, anchor.qualification,
]);
const coverage = (total: number, anchored: number): NetworkConnectionCoverage => ({ total, anchored, unplaced: total - anchored });
const placementsFor = (key: string, from: NetworkConnectionEnd, to: NetworkConnectionEnd): NetworkConnection['placements'] =>
  from.anchors.flatMap(a => to.anchors.map(b => ({
    key: JSON.stringify([key, anchorKey(a), anchorKey(b)]), from: a, to: b,
    coincident: a.point[0] === b.point[0] && a.point[1] === b.point[1],
  })));

/** Pure display association of original topology and already admitted anchors.
 * Reuses the source's device-first endpoint resolver. An endpoint can follow its
 * explicit owner only when that device exists in this exact source graph. Raw
 * IDs in other graphs or other entity types never establish an association.
 * Nothing here derives rooms, physical coordinates, routes, or graph layouts. */
export function projectNetworkConnections(graphs: readonly DocumentaryNetworkGraph[],
  anchors: readonly NetworkConnectionAnchor[]): NetworkConnections {
  const admitted = new Map<string, Map<string, NetworkConnectionAnchor>>();
  for (const anchor of anchors) {
    const key = networkConnectionNodeKey(anchor.graphKey, anchor.nodeKind, anchor.nodeId);
    let own = admitted.get(key); if (!own) { own = new Map(); admitted.set(key, own); }
    own.set(anchorKey(anchor), anchor);
  }
  const direct = (key: string) => [...(admitted.get(key)?.values() ?? [])].sort((a, b) => {
    const p = anchorKey(a), q = anchorKey(b); return p < q ? -1 : p > q ? 1 : 0;
  });
  const nodes: NetworkConnectionNode[] = [], connections: NetworkConnection[] = [];
  const sharedMediumAssociations: NetworkSharedMediumConnection[] = [];
  for (const graph of graphs) {
    const { key: graphKey, data } = graph;
    const ownNodes = new Map<string, NetworkConnectionNode>();
    for (const device of data.devices) {
      const key = networkConnectionNodeKey(graphKey, 'device', device.id), own = direct(key);
      const node: NetworkConnectionNode = { key, graphKey, kind: 'device', id: device.id, label: device.label,
        device, endpoint: null, anchors: own, placementReason: own.length ? 'admitted-anchor' : 'no-admitted-anchor' };
      nodes.push(node); ownNodes.set(key, node);
    }
    for (const endpoint of data.endpoints) {
      const key = networkConnectionNodeKey(graphKey, 'endpoint', endpoint.id), own = direct(key);
      const owner = endpoint.ownerDeviceId === null ? undefined
        : ownNodes.get(networkConnectionNodeKey(graphKey, 'device', endpoint.ownerDeviceId));
      const followed = own.length ? own : owner?.anchors ?? [];
      const placementReason: NetworkConnectionPlacementReason = own.length ? 'admitted-anchor'
        : owner ? owner.anchors.length ? 'explicit-owner-anchor' : 'owner-without-admitted-anchor'
          : endpoint.ownerDeviceId === null ? 'owner-not-recorded' : 'owner-not-in-source';
      const node: NetworkConnectionNode = { key, graphKey, kind: 'endpoint', id: endpoint.id, label: endpoint.label,
        device: null, endpoint, anchors: followed, placementReason };
      nodes.push(node); ownNodes.set(key, node);
    }
    const resolve = (id: string): NetworkConnectionEnd => {
      // The established contract resolves a direct device before an endpoint.
      // Both original typed records remain distinct in nodes, even with raw ID reuse.
      const deviceKey = networkConnectionNodeKey(graphKey, 'device', id);
      const node = ownNodes.get(deviceKey) ?? ownNodes.get(networkConnectionNodeKey(graphKey, 'endpoint', id));
      const ownerId = endpointDeviceId(data, id);
      const owner = ownerId === null ? undefined : ownNodes.get(networkConnectionNodeKey(graphKey, 'device', ownerId));
      return { sourceId: id, label: networkEndpointLabel(data, id), nodeKey: node?.key ?? null,
        ownerDeviceKey: owner?.key ?? null, anchors: node?.anchors ?? [],
        placementReason: node?.placementReason ?? 'endpoint-not-in-source' };
    };
    data.links.forEach((link, index) => {
      const key = JSON.stringify(['houseatlas-network-link.v1', graphKey, index, link.id]);
      const from = resolve(link.fromEndpointId), to = resolve(link.toEndpointId);
      const placements = placementsFor(key, from, to);
      connections.push({ key, graphKey, link, source: data.source, qualification: graph.qualification,
        from, to, renderable: placements.length > 0, placements });
    });
    for (const association of networkSharedMediumAssociations(data)) {
      const key = JSON.stringify(['houseatlas-network-shared-medium.v1', graphKey, association.id]);
      const from = resolve(association.from), to = resolve(association.to), placements = placementsFor(key, from, to);
      sharedMediumAssociations.push({ key, graphKey, source: data.source, qualification: graph.qualification,
        segment: association.segment, medium: association.medium, memberships: association.memberships,
        from, to, renderable: placements.length > 0, placements });
    }
  }
  const devices = nodes.filter(node => node.kind === 'device'), endpoints = nodes.filter(node => node.kind === 'endpoint');
  return { nodes, connections, sharedMediumAssociations, coverage: {
    devices: coverage(devices.length, devices.filter(node => node.anchors.length > 0).length),
    endpoints: coverage(endpoints.length, endpoints.filter(node => node.anchors.length > 0).length),
    links: coverage(connections.length, connections.filter(edge => edge.renderable).length),
    sharedMediumAssociations: coverage(sharedMediumAssociations.length, sharedMediumAssociations.filter(edge => edge.renderable).length),
  } };
}
