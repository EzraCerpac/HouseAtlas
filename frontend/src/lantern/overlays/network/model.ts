import type { NetworkOverlayData, NetworkOverlayDevice, NetworkOverlayLink, NetworkOverlaySelection, NetworkPackagePlaceSelection, NetworkPlaceAssociation } from './types';

export function groupNetworkDevices(devices: readonly NetworkOverlayDevice[]) {
  const rooms = new Map<string, { key: string; label: string; devices: NetworkOverlayDevice[] }>();
  const unsited: NetworkOverlayDevice[] = [], excluded: NetworkOverlayDevice[] = [];
  for (const device of devices) {
    if (device.mobility === 'mobile' || device.mobility === 'nonspatial') { excluded.push(device); continue; }
    if (device.place === null) { unsited.push(device); continue; }
    // Native IDs and documentary source room IDs have distinct namespaces.
    // An association without either identity stays separate, even if labels match.
    const key = device.place.placeId !== null ? `atlas:${device.place.placeId}`
      : device.place.sourcePlaceId ? `documentary:${device.place.sourcePlaceId}`
        : device.place.sourceRoomId !== null ? `network:${device.place.sourceRoomId}` : `device:${device.id}`;
    const room = rooms.get(key);
    rooms.set(key, { key, label: room?.label ?? device.place.roomLabel, devices: [...(room?.devices ?? []), device] });
  }
  return { rooms: [...rooms.values()], unsited, excluded };
}

export function networkSelection(data: NetworkOverlayData, selection: NetworkOverlaySelection | null) {
  if (selection === null) return null;
  if (selection.kind === 'device') {
    const device = data.devices.find(entry => entry.id === selection.id);
    return device ? { kind: 'device' as const, device } : null;
  }
  const link = data.links.find(entry => entry.id === selection.id);
  return link ? { kind: 'link' as const, link } : null;
}

export function networkEndpointLabel(data: NetworkOverlayData, id: string): string {
  const device = data.devices.find(entry => entry.id === id);
  if (device) return device.label;
  const endpoint = data.endpoints.find(entry => entry.id === id);
  if (!endpoint) return `Unresolved endpoint (${id})`;
  const owner = data.devices.find(entry => entry.id === endpoint.ownerDeviceId);
  return owner ? `${owner.label} (${endpoint.label})` : endpoint.label;
}

export function networkLinkLabel(data: NetworkOverlayData, link: NetworkOverlayLink): string {
  return `${networkEndpointLabel(data, link.fromEndpointId)} ↔ ${networkEndpointLabel(data, link.toEndpointId)}`;
}

export function devicePlacement(device: NetworkOverlayDevice): string {
  if (device.mobility === 'mobile') return 'Mobile · excluded from floor placement';
  if (device.mobility === 'nonspatial') return 'Nonspatial endpoint · excluded from floor placement';
  if (device.place === null) return 'Room unknown · unsited';
  return `${device.place.roomLabel}${device.place.detail ? ` · ${device.place.detail}` : ''}`;
}

export function endpointDeviceId(data: NetworkOverlayData, id: string): string | null {
  return data.devices.some(device => device.id === id) ? id : data.endpoints.find(endpoint => endpoint.id === id)?.ownerDeviceId ?? null;
}

export function networkDevicePlace(device: NetworkOverlayDevice): NetworkPlaceAssociation | null {
  return device.mobility === 'mobile' || device.mobility === 'nonspatial' ? null : device.place;
}

export function networkReviewedPlaces(data: NetworkOverlayData, context: NetworkPackagePlaceSelection | null) {
  if (context === null) return null;
  const receipt = data.source.roomMappingReceipt;
  const eligible = context.status === 'accepted' && context.viewKey === data.viewKey
    && receipt?.id === context.receiptId && receipt.sha256 === context.receiptSha256;
  const devices = eligible ? data.devices.filter(device => {
    const place = networkDevicePlace(device);
    return place && context.targets.some(target => target.packagePlaceKey === place.sourcePlaceId
      && target.packagePlaceUuid === place.sourcePlaceUUID)
      && place.planAssociations?.some(reference => reference.mappingReceiptSHA256 === context.receiptSha256
        && context.sourceAnchorIds.includes(reference.sourceAnchorId));
  }) : [];
  return { eligible, devices };
}

export function networkPlanReferences(data: NetworkOverlayData, device: NetworkOverlayDevice, context: NetworkPackagePlaceSelection | null = null) {
  const place = networkDevicePlace(device), receipt = data.source.roomMappingReceipt;
  if (!place?.sourcePlaceId || !place.sourcePlaceUUID || !receipt) return [];
  if (context !== null && !networkReviewedPlaces(data, context)?.devices.some(entry => entry.id === device.id)) return [];
  return (place.planAssociations ?? []).filter(reference => reference.mappingReceiptSHA256 === receipt.sha256
    && (context === null || context.sourceAnchorIds.includes(reference.sourceAnchorId)));
}

/** Adapts Lantern's breadth-first logical layout. These SVG pixels never become
 * scene anchors, source coordinates, floor membership or physical cable routes. */
export function networkGraph(data: NetworkOverlayData) {
  const nodes = [
    ...data.devices.map(device => ({ id: device.id, label: device.label, kind: 'device' as const, device })),
    ...data.endpoints.filter(endpoint => endpoint.kind !== 'interface' || endpoint.ownerDeviceId === null)
      .map(endpoint => ({ id: endpoint.id, label: endpoint.label, kind: endpoint.kind, device: null })),
  ];
  const nodeId = (id: string) => endpointDeviceId(data, id) ?? id;
  const known = new Set(nodes.map(node => node.id));
  const edges = data.links.map(link => ({ link, from: nodeId(link.fromEndpointId), to: nodeId(link.toEndpointId) }));
  for (const edge of edges) for (const id of [edge.from, edge.to]) {
    if (!known.has(id)) {
      nodes.push({ id, label: networkEndpointLabel(data, id), kind: 'unresolved', device: null }); known.add(id);
    }
  }
  const root = nodes.find(node => node.device?.kind.toLowerCase() === 'router') ?? nodes[0];
  const depth = new Map<string, number>();
  const queue: string[] = [];
  if (root) { depth.set(root.id, 0); queue.push(root.id); }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const edge of edges) {
      const other = edge.from === id ? edge.to : edge.to === id ? edge.from : null;
      if (other !== null && !depth.has(other)) { depth.set(other, depth.get(id)! + 1); queue.push(other); }
    }
  }
  const columns = new Map<number, typeof nodes>();
  for (const node of nodes) {
    const column = depth.get(node.id);
    if (column !== undefined) columns.set(column, [...(columns.get(column) ?? []), node]);
  }
  const columnCount = Math.max(1, columns.size), rows = Math.max(1, ...[...columns.values()].map(column => column.length));
  const width = Math.max(840, columnCount * 210), connectedHeight = rows * 112 + 70;
  const positions = new Map<string, readonly [number, number]>();
  for (const [column, entries] of columns) entries.forEach((node, i) => {
    positions.set(node.id, [100 + column * (width - 200) / Math.max(1, columnCount - 1), 56 + i * 112]);
  });
  const disconnected = nodes.filter(node => !depth.has(node.id));
  disconnected.forEach((node, i) => positions.set(node.id,
    [100 + (i % 4) * (width - 200) / 3, connectedHeight + 72 + Math.floor(i / 4) * 112]));
  const height = connectedHeight + (disconnected.length ? Math.ceil(disconnected.length / 4) * 112 + 55 : 0);
  return { nodes, edges, positions, width, height, disconnectedY: disconnected.length ? connectedHeight + 20 : null };
}
