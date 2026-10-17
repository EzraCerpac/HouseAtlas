import type { UnifiedAtlasOverlayAvailableFrame } from '../../../integration/unified-atlas-overlay-source';
import { networkReviewedPlaces, networkLinkLabel, endpointDeviceId } from '../overlays/network/model';
import type { AtlasScene, OverlayKind } from './types';
import type { AtlasModel, OverlayLayerIndex, OverlayPlacement } from './scene';

export interface DocumentaryRecord {
  readonly key: string; readonly id: string; readonly label: string;
  readonly category: string; readonly detail: string; readonly qualification: string;
  readonly sourceDate: string | null; readonly retrievedAt: string | null;
  readonly connections: readonly string[];
  readonly sourceFacts: readonly SourceFact[];
}
export interface SourceFact { readonly label: string; readonly value: string | null }
export interface RuntimeRoomRecords { readonly network: readonly DocumentaryRecord[]; readonly electrical: readonly DocumentaryRecord[] }
export interface RuntimeRecords {
  readonly rooms: ReadonlyMap<string, RuntimeRoomRecords>;
  readonly network: 'available' | 'unavailable'; readonly electrical: 'available' | 'partial' | 'unavailable';
  readonly sourceFacts: readonly SourceFact[];
  readonly unplaced: { readonly network: readonly DocumentaryRecord[]; readonly electrical: readonly DocumentaryRecord[] };
}
export function matchesOverlayScene(frame: UnifiedAtlasOverlayAvailableFrame, scene: AtlasScene, buildingId: string): boolean {
  const s = frame.sceneSelection, p = scene.publication;
  return s.workspaceId === scene.scope.workspaceId && s.homeId === scene.scope.homeId
    && s.publicationId === p.publicationId && s.revision === scene.selection.revision && s.semanticsSha256 === p.semanticsSha256
    && scene.buildings.some(building => building.buildingId === buildingId && building.nativePlaceId === frame.nativeBuildingId);
}

/** Call only with the current source owner's frame. Joins use its independently
 * reviewed package/native mappings; immutable producer status is never upgraded.
 * Documentary IDs stay in their source namespaces, not producer/native records. */
export function documentaryRoomRecords(scene: AtlasScene, frame: UnifiedAtlasOverlayAvailableFrame, selectable: ReadonlySet<string>): RuntimeRecords {
  const rooms = new Map<string, RuntimeRoomRecords>();
  for (const binding of frame.roomBindings) {
    const room = scene.rooms.find(row => row.roomId === binding.roomId);
    if (!room || room.nativePlaceId !== binding.nativePlaceId || binding.qualification !== 'current-native-room-join'
      || !room.occurrenceIds.some(id => selectable.has(id))) continue;
    const receiptId = frame.sourceSelection.acceptedRoomReceiptId, receiptSha256 = frame.sourceSelection.acceptedRoomReceiptSha256;
    if (receiptId === null || receiptSha256 === null) continue;
    const targets = binding.targets;
    const sourceAnchorIds = [...new Set(targets.flatMap(target => target.sourceAnchorIds))];
    const anchors = frame.sourceSelection.acceptedRoomAnchors.filter(anchor => sourceAnchorIds.includes(anchor.id));
    const unresolvedLabels = [...new Set([...anchors.flatMap(anchor => anchor.unresolvedLabels),
      ...(frame.sourceSelection.acceptedRoomMappings ?? []).filter(mapping => binding.sourceRoomIds.includes(mapping.sourceRoomId)).flatMap(mapping => mapping.unresolvedLabels ?? [])])];
    // A mixed or unresolved source component cannot be partially located. Its
    // original documentary records remain in the unplaced list below.
    if (unresolvedLabels.length || anchors.some(anchor => anchor.targets.length !== 1)) continue;
    const context = { status: 'accepted' as const, receiptId, receiptSha256,
      sourceAnchorIds, targets, unresolvedLabels };
    const network: DocumentaryRecord[] = [], electrical: DocumentaryRecord[] = [];
    if (frame.network.status === 'available') {
      const data = frame.network.data;
      for (const device of networkReviewedPlaces(data, { ...context, viewKey: data.viewKey })?.devices ?? []) {
        if (device.mobility !== 'fixed') continue;
        network.push({ key: `device:${device.id}`, id: device.id, label: device.label, category: 'Recorded device',
          detail: [device.kind, device.mobility, device.confidence, device.notes, device.place?.basis].filter(Boolean).join(' · '),
          qualification: `${data.source.status}; ${data.source.coverage} source coverage`, sourceDate: data.source.recordedAt,
          retrievedAt: data.source.retrievedAt,
          sourceFacts: [{ label: 'Source revision', value: data.source.revision }, { label: 'Source notes', value: data.source.notes },
            { label: 'Accepted at', value: data.source.acceptedAt }, { label: 'Recorded at', value: data.source.recordedAt },
            { label: 'Retrieved at', value: data.source.retrievedAt },
            { label: 'Connection source facts', value: JSON.stringify(data.links.filter(link => endpointDeviceId(data, link.fromEndpointId) === device.id || endpointDeviceId(data, link.toEndpointId) === device.id)) }],
          connections: data.links.filter(link => endpointDeviceId(data, link.fromEndpointId) === device.id || endpointDeviceId(data, link.toEndpointId) === device.id)
            .map(link => [networkLinkLabel(data, link), link.medium, `Curated confidence: ${link.confidence}`, `Source confidence: ${link.sourceConfidence ?? 'unknown'}`, `Recorded: ${link.recordedAt ?? 'unknown'} (${link.recordedAtPrecision ?? 'precision unknown'})`, link.temporalStatus, link.basis, link.notes].filter(Boolean).join(' · ')) });
      }
    }
    const matches = (place: { packagePlaceKey: string; packagePlaceUuid: string }) => targets.some(target =>
      target.packagePlaceKey === place.packagePlaceKey && target.packagePlaceUuid === place.packagePlaceUuid);
    if (frame.electricity.status === 'available') for (const sheet of frame.electricity.data.sheets) {
      if (!sheet.roomAssociations.some(matches)) continue;
      electrical.push({ key: `sheet:${sheet.id}`, id: sheet.id, label: sheet.titleAsRead, category: 'Electrical drawing',
        detail: [`Page ${sheet.source.pdfPage}`, sheet.directReading.text, sheet.drawingAssociation.text, sheet.openUncertainty].filter(Boolean).join(' · '),
        qualification: 'Documentary evidence; does not establish installed wiring', sourceDate: sheet.source.sourceDate,
        retrievedAt: sheet.source.retrievedAt, connections: [], sourceFacts: [
          { label: 'Source fact date', value: sheet.source.factAt }, { label: 'Interpretation date', value: sheet.source.interpretationDate },
          { label: 'Original photo SHA256', value: sheet.source.sha256 }, { label: 'Source photo', value: sheet.source.photo },
          { label: 'Direct reading', value: JSON.stringify(sheet.directReading) }, { label: 'Drawing association', value: JSON.stringify(sheet.drawingAssociation) },
          { label: 'Room associations', value: JSON.stringify(sheet.roomAssociations) }] });
    }
    if (frame.electricalFixtures.status === 'available') {
      const data = frame.electricalFixtures.data;
      if (data.roomMappingReceipt?.id === receiptId && data.roomMappingReceipt.sha256 === receiptSha256) {
        const regions = new Set(data.regions.filter(region => region.places.some(matches)).map(region => region.id));
        for (const fixture of data.fixtures) if (regions.has(fixture.regionId)) {
          const sheet = data.sheets.find(row => row.id === fixture.sheetId);
          electrical.push({ key: `symbol:${fixture.id}`, id: fixture.id, label: fixture.label, category: 'Historical symbol',
            detail: [fixture.kind, fixture.source.placementDescription, fixture.group.label ? `Historical group ${fixture.group.label}` : null,
              fixture.group.note, fixture.uncertainty].filter(Boolean).join(' · '),
            qualification: 'Historic, unverified; no current circuit or wire route', sourceDate: sheet?.sourceDate ?? null, retrievedAt: null,
            connections: [], sourceFacts: [{ label: 'Interpretation date', value: data.interpretationDate },
              { label: 'Original photo SHA256', value: fixture.source.originalPhotoSha256 },
              { label: 'Source symbol', value: JSON.stringify(fixture.source) }, { label: 'Historical group', value: JSON.stringify(fixture.group) },
              { label: 'Glyph count', value: fixture.glyphCount === null ? null : String(fixture.glyphCount) },
              { label: 'Fixture count (documentary)', value: fixture.fixtureCount === null ? null : String(fixture.fixtureCount) },
              { label: 'Symbol interpretation', value: JSON.stringify(data.symbolLegend) }] });
        }
      }
    }
    rooms.set(room.roomId, { network: [...new Map(network.map(record => [record.key, record])).values()],
      electrical: [...new Map(electrical.map(record => [record.key, record])).values()] });
  }
  const placedNetwork = new Set([...rooms.values()].flatMap(row => row.network.map(record => record.key)));
  const placedElectrical = new Set([...rooms.values()].flatMap(row => row.electrical.map(record => record.key)));
  const networkData = frame.network.status === 'available' ? frame.network.data : null;
  const unplacedNetwork: DocumentaryRecord[] = networkData ? networkData.devices
    .filter(device => !placedNetwork.has(`device:${device.id}`)).map(device => {
      const data = networkData;
      return { key: `device:${device.id}`, id: device.id, label: device.label, category: 'Recorded device',
        detail: [device.kind, device.mobility, device.confidence, device.notes].filter(Boolean).join(' · '),
        qualification: device.mobility === 'mobile' || device.mobility === 'nonspatial' ? 'Excluded from room placement' : 'No unambiguous reviewed room placement',
        sourceDate: data?.source.recordedAt ?? null, retrievedAt: data?.source.retrievedAt ?? null, connections: [],
        sourceFacts: [{ label: 'Recorded device', value: JSON.stringify(device) }, { label: 'Network source', value: JSON.stringify(data.source) },
          { label: 'Connection source facts', value: JSON.stringify(data.links.filter(link => endpointDeviceId(data, link.fromEndpointId) === device.id || endpointDeviceId(data, link.toEndpointId) === device.id)) }] };
    }) : [];
  // Topology never becomes a cable route or device position. Keep every link
  // and endpoint available even when neither end has a located device.
  if (networkData) {
    for (const link of networkData.links) unplacedNetwork.push({ key: `link:${link.id}`, id: link.id,
      label: networkLinkLabel(networkData, link), category: 'Recorded connection',
      detail: [link.medium, link.temporalStatus, link.notes].filter(Boolean).join(' · '),
      qualification: `${networkData.source.status}; logical connection, no physical route`,
      sourceDate: link.recordedAt, retrievedAt: networkData.source.retrievedAt, connections: [],
      sourceFacts: [{ label: 'Connection source facts', value: JSON.stringify(link) }, { label: 'Network source', value: JSON.stringify(networkData.source) }] });
    for (const endpoint of networkData.endpoints) unplacedNetwork.push({ key: `endpoint:${endpoint.id}`, id: endpoint.id,
      label: endpoint.label, category: 'Network endpoint', detail: [endpoint.kind, endpoint.notes].filter(Boolean).join(' · '),
      qualification: `${networkData.source.status}; topology only, no physical position`,
      sourceDate: networkData.source.recordedAt, retrievedAt: networkData.source.retrievedAt, connections: [],
      sourceFacts: [{ label: 'Endpoint source facts', value: JSON.stringify(endpoint) }, { label: 'Network source', value: JSON.stringify(networkData.source) }] });
  }
  const unplacedElectrical: DocumentaryRecord[] = [];
  if (frame.electricity.status === 'available') for (const sheet of frame.electricity.data.sheets) {
    if (placedElectrical.has(`sheet:${sheet.id}`)) continue;
    unplacedElectrical.push({ key: `sheet:${sheet.id}`, id: sheet.id, label: sheet.titleAsRead, category: 'Electrical drawing',
      detail: `Page ${sheet.source.pdfPage}`, qualification: 'No unambiguous reviewed room placement; documentary evidence only',
      sourceDate: sheet.source.sourceDate, retrievedAt: sheet.source.retrievedAt, connections: [],
      sourceFacts: [{ label: 'Drawing and source facts', value: JSON.stringify(sheet) }] });
  }
  if (frame.electricalFixtures.status === 'available') for (const fixture of frame.electricalFixtures.data.fixtures) {
    if (placedElectrical.has(`symbol:${fixture.id}`)) continue;
    const data = frame.electricalFixtures.data;
    unplacedElectrical.push({ key: `symbol:${fixture.id}`, id: fixture.id, label: fixture.label, category: 'Historical symbol',
      detail: fixture.source.placementDescription, qualification: 'No unambiguous reviewed room placement; historic and unverified',
      sourceDate: data.sheets.find(sheet => sheet.id === fixture.sheetId)?.sourceDate ?? null, retrievedAt: null, connections: [],
      sourceFacts: [{ label: 'Source symbol', value: JSON.stringify(fixture) }, { label: 'Interpretation date', value: data.interpretationDate },
        { label: 'Symbol interpretation', value: JSON.stringify(data.symbolLegend) }] });
  }
  const electricity = frame.electricity.status === 'available', fixtures = frame.electricalFixtures.status === 'available';
  return { rooms, unplaced: { network: unplacedNetwork, electrical: unplacedElectrical }, network: frame.network.status, electrical: electricity && fixtures ? 'available' : electricity || fixtures ? 'partial' : 'unavailable',
    sourceFacts: [{ label: 'Native association', value: frame.currentSource.recordId },
      { label: 'Native association revision', value: frame.currentSource.revision.toString() },
      { label: 'Room review receipt', value: frame.sourceSelection.acceptedRoomReceiptId },
      { label: 'Room review SHA256', value: frame.sourceSelection.acceptedRoomReceiptSha256 },
      { label: 'Unresolved source components', value: JSON.stringify([...new Set([
        ...frame.sourceSelection.acceptedRoomAnchors.flatMap(anchor => anchor.unresolvedLabels),
        ...(frame.sourceSelection.acceptedRoomMappings ?? []).flatMap(mapping => mapping.unresolvedLabels ?? [])])]) },
      { label: 'Drawing provenance', value: frame.drawingProvenance ? JSON.stringify(frame.drawingProvenance) : null }] };
}

/** Room-summary markers use existing room occurrences, never source-image positions. */
export function documentaryOverlayIndex(model: AtlasModel, records: RuntimeRecords, kind: OverlayKind): OverlayLayerIndex {
  const placed = new Map<string, OverlayPlacement>(), all = new Set<string>();
  for (const [roomId, rows] of records.rooms) {
    const selected = rows[kind]; if (!selected.length) continue;
    const occurrenceIds = model.roomsById.get(roomId)!.occurrenceIds.filter(id => model.selectable.has(id));
    const recordIds = selected.map(record => record.key); recordIds.forEach(id => all.add(id));
    for (const occurrenceId of occurrenceIds) placed.set(occurrenceId, { kind, roomId, occurrenceId, recordCount: recordIds.length, recordIds, positions: [], bindings: [] });
  }
  for (const record of records.unplaced[kind]) all.add(record.key);
  return { kind, placed, unplaced: [], records: all.size, unplacedRecords: records.unplaced[kind].length };
}
