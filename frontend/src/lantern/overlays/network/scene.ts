import type { NetworkOverlayData, NetworkOverlayDevice, NetworkPackagePlaceSelection, NetworkSceneAnchor, NetworkScenePoint } from './types';
import { networkDevicePlace, networkGraph, networkPlanReferences, networkReviewedPlaces, networkSharedMediumAssociations } from './model';

const validPoint = (point: NetworkScenePoint) => point.length === 2 && point.every(Number.isFinite);

/** Joins documentary identity to an ephemeral host-projected room marker.
 * The scene owner supplies camera math; no source point or device coordinate is used. */
export function networkSceneProjection(data: NetworkOverlayData, anchors: readonly NetworkSceneAnchor[],
  unplacedDock: NetworkScenePoint, ui = 1, context: NetworkPackagePlaceSelection | null = null) {
  const scale = Number.isFinite(ui) && ui > 0 ? ui : 1;
  const dock: NetworkScenePoint = validPoint(unplacedDock) ? unplacedDock : [0, 0];
  const receipt = data.source.roomMappingReceipt;
  const reviewed = networkReviewedPlaces(data, context);
  const eligibleIds = reviewed === null ? null : new Set(reviewed.devices.map(device => device.id));
  const placed = new Map<string, { device: NetworkOverlayDevice; anchor: NetworkSceneAnchor; base: NetworkScenePoint; top: NetworkScenePoint }>();
  const usedIds = new Set<string>();
  for (const anchor of anchors) {
    if (usedIds.has(anchor.id) || !anchor.visible || anchor.basis !== 'schematic-room' || anchor.viewKey !== data.viewKey
      || !receipt || receipt.id !== anchor.receiptId || receipt.sha256 !== anchor.receiptSha256
      || !validPoint(anchor.base) || !validPoint(anchor.top) || anchor.sourceAnchorIds.length === 0) continue;
    usedIds.add(anchor.id);
    const devices = data.devices.filter(device => {
      const place = networkDevicePlace(device);
      if (device.mobility !== 'fixed' || !place || placed.has(device.id) || (eligibleIds !== null && !eligibleIds.has(device.id))
        || place.sourcePlaceId !== anchor.packagePlaceKey || place.sourcePlaceUUID !== anchor.packagePlaceUuid) return false;
      return networkPlanReferences(data, device, context).some(reference => (place.floorKey === null
        ? reference.sourceFloorKey === anchor.floorKey : place.floorKey === anchor.floorKey)
        && reference.mappingReceiptSHA256 === anchor.receiptSha256 && anchor.sourceAnchorIds.includes(reference.sourceAnchorId));
    });
    devices.forEach((device, index) => {
      // Heads fan out in screen pixels to distinguish devices sharing one room.
      // Their stems share the room anchor; these offsets are UI, never locations.
      const offset = (index - (devices.length - 1) / 2) * 30 * scale;
      placed.set(device.id, { device, anchor, base: anchor.base, top: [anchor.top[0] + offset, anchor.top[1]] });
    });
  }
  const graph = networkGraph(data);
  const nodes = graph.nodes.map(node => ({ ...node, marker: placed.get(node.id) ?? null }));
  // A topology association appears in 3D only when both endpoint devices
  // have admitted, currently visible room markers. Records keep every link.
  const edges = graph.edges.flatMap((edge, index) => {
    const from = placed.get(edge.from), to = placed.get(edge.to);
    return from && to ? [{ ...edge, association: null, id: edge.link.id,
      selection: { kind: 'link' as const, id: edge.link.id }, fromPoint: from.top, toPoint: to.top, index }] : [];
  });
  const sharedEdges = networkSharedMediumAssociations(data).flatMap((association, associationIndex) => {
    const from = placed.get(association.from), to = placed.get(association.to);
    return from && to ? [{ link: null, association, id: association.id,
      selection: { kind: 'shared-medium' as const, id: association.id },
      from: association.from, to: association.to, fromPoint: from.top, toPoint: to.top,
      index: graph.edges.length + associationIndex }] : [];
  });
  return { nodes, edges: [...edges, ...sharedEdges], placed: [...placed.values()],
    unplaced: data.devices.filter(device => !placed.has(device.id)), dock, ui: scale };
}
