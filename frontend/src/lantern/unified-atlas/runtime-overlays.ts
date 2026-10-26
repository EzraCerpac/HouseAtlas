import type { UnifiedAtlasOverlayAvailableFrame, UnifiedAtlasOverlayRoomBinding } from '../../../integration/unified-atlas-overlay-source';
import type { DocumentaryOverlayReadPins } from '../scans/native-scene-source-types';
import { networkReviewedPlaces } from '../overlays/network/model';
import type { NetworkOverlayData, NetworkOverlayLink } from '../overlays/network/types';
import type { AtlasScene, OverlayKind } from './types';
import type { AtlasModel, OverlayLayerIndex, OverlayPlacement } from './scene';

export interface DocumentaryRecord {
  readonly key: string; readonly id: string; readonly label: string;
  readonly category: string; readonly detail: string; readonly qualification: string;
  readonly sourceDate: string | null; readonly retrievedAt: string | null;
  readonly connections: readonly string[];
  readonly sourceFacts: readonly SourceFact[];
  /** Other retained observations of this same source entity, not extra devices. */
  readonly observations?: readonly DocumentaryObservation[];
}
export type DocumentaryObservation = Omit<DocumentaryRecord, 'observations'>;
export interface SourceFact { readonly label: string; readonly value: string | null }
export interface RuntimeRoomRecords { readonly network: readonly DocumentaryRecord[]; readonly electrical: readonly DocumentaryRecord[] }
export type SourceAvailability = 'available' | 'partial' | 'unavailable';
export interface RuntimeRecords {
  readonly rooms: ReadonlyMap<string, RuntimeRoomRecords>;
  readonly network: SourceAvailability; readonly electrical: SourceAvailability;
  readonly sourceFacts: readonly SourceFact[];
  readonly unplaced: { readonly network: readonly DocumentaryRecord[]; readonly electrical: readonly DocumentaryRecord[] };
  /** Complete source graph; layout never supplies physical coordinates/routes. */
  readonly networkGraphs?: readonly DocumentaryNetworkGraph[];
}
export interface DocumentaryNetworkGraph {
  readonly key: string;
  readonly data: NetworkOverlayData;
  readonly qualification: string;
  /** Exact parser-owned entity identity; names and raw IDs never join sources. */
  readonly deviceRecordKeys?: ReadonlyMap<string, string>;
  readonly sourceOriginalSha256?: string;
}
/** One building's documentary source state, kept per building so partial
 * coverage is never presented as the whole property. */
export interface BuildingCoverage {
  readonly buildingId: string; readonly label: string;
  /** 'available' or the source owner's reason this building has no frame. */
  readonly reason: string;
  readonly network: SourceAvailability; readonly electrical: SourceAvailability;
}
export interface PropertyRecords extends RuntimeRecords {
  readonly buildings: readonly BuildingCoverage[];
}

const combine = (values: readonly SourceAvailability[]): SourceAvailability =>
  values.length > 0 && values.every(value => value === 'available') ? 'available' : values.some(value => value !== 'unavailable') ? 'partial' : 'unavailable';
export { combine as combineSourceAvailability };

/** Same source entity counts once; differing facts and join observations survive. */
export function mergeDocumentaryRecords(records: readonly DocumentaryRecord[]): DocumentaryRecord[] {
  const entities = new Map<string, Map<string, DocumentaryObservation>>();
  for (const record of records) {
    const { observations, ...first } = record;
    let own = entities.get(record.key); if (!own) { own = new Map(); entities.set(record.key, own); }
    for (const observation of [first, ...(observations ?? [])]) own.set(JSON.stringify(observation), observation);
  }
  return [...entities.values()].map(own => {
    const [first, ...observations] = [...own.values()];
    return observations.length ? { ...first!, observations } : first!;
  });
}

/** Property-wide union. Entity identity excludes building/focus; all differing
 * content and placement observations remain inspectable beneath that entity. */
export function mergeRuntimeRecords(model: AtlasModel, rows: readonly { readonly buildingId: string; readonly reason: string; readonly records: RuntimeRecords | null }[]): PropertyRecords {
  const rooms = new Map<string, RuntimeRoomRecords>();
  for (const row of rows) if (row.records) for (const [roomId, records] of row.records.rooms) {
    const previous = rooms.get(roomId);
    rooms.set(roomId, { network: mergeDocumentaryRecords([...(previous?.network ?? []), ...records.network]),
      electrical: mergeDocumentaryRecords([...(previous?.electrical ?? []), ...records.electrical]) });
  }
  const unplaced = { network: [] as DocumentaryRecord[], electrical: [] as DocumentaryRecord[] };
  for (const kind of ['network', 'electrical'] as const) {
    const placed = new Set([...rooms.values()].flatMap(records => records[kind].map(record => record.key)));
    const all = mergeDocumentaryRecords([...rooms.values()].flatMap(records => [...records[kind]])
      .concat(rows.flatMap(row => [...(row.records?.unplaced[kind] ?? [])])));
    const byKey = new Map(all.map(record => [record.key, record]));
    for (const [roomId, records] of rooms) rooms.set(roomId, { ...records,
      [kind]: records[kind].map(record => mergeDocumentaryRecords([record, byKey.get(record.key)!])[0]!) });
    unplaced[kind] = all.filter(record => !placed.has(record.key));
  }
  const buildings = rows.map<BuildingCoverage>(row => ({ buildingId: row.buildingId, label: model.buildingsById.get(row.buildingId)!.label,
    reason: row.records ? row.reason === 'stored-copy' ? row.reason : 'available' : row.reason, network: row.records?.network ?? 'unavailable', electrical: row.records?.electrical ?? 'unavailable' }));
  const several = rows.length > 1;
  return { rooms, unplaced, buildings,
    networkGraphs: [...new Map(rows.flatMap(row => (row.records?.networkGraphs ?? []).map(graph => [graph.key, graph] as const))).values()],
    network: combine(buildings.map(row => row.network)), electrical: combine(buildings.map(row => row.electrical)),
    sourceFacts: rows.flatMap(row => (row.records?.sourceFacts ?? []).map(fact => several
      ? { label: `${model.buildingsById.get(row.buildingId)!.label}: ${fact.label}`, value: fact.value } : fact)) };
}

/** Source-frame lookup only; this creates no room-placement authority. */
export function documentaryNetworkIndex(data: NetworkOverlayData) {
  const devices = new Map(data.devices.map(device => [device.id, device]));
  const endpoints = new Map<string, { label: string; deviceId: string | null }>();
  for (const endpoint of data.endpoints) {
    const owner = endpoint.ownerDeviceId === null ? undefined : devices.get(endpoint.ownerDeviceId);
    endpoints.set(endpoint.id, { label: owner ? `${owner.label} (${endpoint.label})` : endpoint.label, deviceId: endpoint.ownerDeviceId });
  }
  // The existing helpers resolve a device ID before an endpoint ID.
  for (const device of data.devices) endpoints.set(device.id, { label: device.label, deviceId: device.id });
  const incident = new Map<string, NetworkOverlayLink[]>(), labels = new Map<NetworkOverlayLink, string>();
  const descriptions = new Map<NetworkOverlayLink, string>();
  for (const link of data.links) {
    const from = endpoints.get(link.fromEndpointId), to = endpoints.get(link.toEndpointId);
    const label = `${from?.label ?? `Unresolved endpoint (${link.fromEndpointId})`} ↔ ${to?.label ?? `Unresolved endpoint (${link.toEndpointId})`}`;
    labels.set(link, label);
    descriptions.set(link, [label, link.medium, `Curated confidence: ${link.confidence}`, `Source confidence: ${link.sourceConfidence ?? 'unknown'}`,
      `Recorded: ${link.recordedAt ?? 'unknown'} (${link.recordedAtPrecision ?? 'precision unknown'})`, link.temporalStatus, link.basis, link.notes].filter(Boolean).join(' · '));
    for (const id of new Set([from?.deviceId, to?.deviceId])) {
      if (id == null) continue;
      let own = incident.get(id); if (!own) { own = []; incident.set(id, own); }
      own.push(link);
    }
  }
  const facts = new Map<string, string>(), connections = new Map<string, readonly string[]>();
  for (const device of data.devices) {
    const own = incident.get(device.id) ?? [];
    facts.set(device.id, JSON.stringify(own));
    connections.set(device.id, own.map(link => descriptions.get(link)!));
  }
  return { incident, labels, facts, connections };
}
export function matchesOverlayScene(frame: UnifiedAtlasOverlayAvailableFrame, scene: AtlasScene, buildingId: string): boolean {
  const s = frame.sceneSelection, p = scene.publication;
  return s.workspaceId === scene.scope.workspaceId && s.homeId === scene.scope.homeId
    && s.publicationId === p.publicationId && s.revision === scene.selection.revision && s.semanticsSha256 === p.semanticsSha256
    && scene.buildings.some(building => building.buildingId === buildingId && building.nativePlaceId === frame.nativeBuildingId);
}

/** Plain source facts shared by native and explicitly saved presentation.
 * No field can confer a frame, session, lease or currentness. */
export interface DocumentaryFacts {
  readonly mode: 'current-native' | 'saved-documentary-snapshot';
  readonly pins: DocumentaryOverlayReadPins;
  readonly roomBindings: readonly (Omit<UnifiedAtlasOverlayRoomBinding, 'qualification'> & {
    readonly qualification: 'current-native-room-join' | 'captured-room-identity-join';
  })[];
  readonly network: UnifiedAtlasOverlayAvailableFrame['network'];
  readonly electricity: UnifiedAtlasOverlayAvailableFrame['electricity'];
  readonly electricalFixtures: UnifiedAtlasOverlayAvailableFrame['electricalFixtures'];
  readonly drawingProvenance?: unknown;
  readonly observationFacts: readonly SourceFact[];
}

/** Call only while the genuine source owner's current frame remains owned. */
export function documentaryRoomRecords(scene: AtlasScene, frame: UnifiedAtlasOverlayAvailableFrame, selectable: ReadonlySet<string>): RuntimeRecords {
  return projectDocumentaryFacts(scene, { mode: 'current-native', pins: frame.sourceSelection,
    roomBindings: frame.roomBindings, network: frame.network, electricity: frame.electricity,
    electricalFixtures: frame.electricalFixtures, drawingProvenance: frame.drawingProvenance,
    observationFacts: [{ label: 'Native association', value: frame.currentSource.recordId },
      { label: 'Native association revision', value: frame.currentSource.revision.toString() }] }, selectable);
}

/** Pure documentary projection; saved identity evidence never becomes a native grant. */
export function projectDocumentaryFacts(scene: AtlasScene, facts: DocumentaryFacts, selectable: ReadonlySet<string>): RuntimeRecords {
  const rooms = new Map<string, RuntimeRoomRecords>();
  const networkData = facts.network.status === 'available' ? facts.network.data : null;
  const networkIndex = networkData ? documentaryNetworkIndex(networkData) : null;
  for (const binding of facts.roomBindings) {
    const room = scene.rooms.find(row => row.roomId === binding.roomId);
    if (!room || room.nativePlaceId !== binding.nativePlaceId || binding.qualification !== (facts.mode === 'current-native' ? 'current-native-room-join' : 'captured-room-identity-join')
      || !room.occurrenceIds.some(id => selectable.has(id))) continue;
    const receiptId = facts.pins.acceptedRoomReceiptId, receiptSha256 = facts.pins.acceptedRoomReceiptSha256;
    if (receiptId === null || receiptSha256 === null) continue;
    const targets = binding.targets;
    const sourceAnchorIds = [...new Set(targets.flatMap(target => target.sourceAnchorIds))];
    const anchors = facts.pins.acceptedRoomAnchors.filter(anchor => sourceAnchorIds.includes(anchor.id));
    const unresolvedLabels = [...new Set([...anchors.flatMap(anchor => anchor.unresolvedLabels),
      ...(facts.pins.acceptedRoomMappings ?? []).filter(mapping => binding.sourceRoomIds.includes(mapping.sourceRoomId)).flatMap(mapping => mapping.unresolvedLabels ?? [])])];
    // A mixed or unresolved source component cannot be partially located. Its
    // original documentary records remain in the unplaced list below.
    if (unresolvedLabels.length || anchors.some(anchor => anchor.targets.length !== 1)) continue;
    const context = { status: 'accepted' as const, receiptId, receiptSha256,
      sourceAnchorIds, targets, unresolvedLabels };
    const network: DocumentaryRecord[] = [], electrical: DocumentaryRecord[] = [];
    if (facts.network.status === 'available') {
      const data = facts.network.data;
      for (const device of networkReviewedPlaces(data, { ...context, viewKey: data.viewKey })?.devices ?? []) {
        if (device.mobility !== 'fixed') continue;
        network.push({ key: `device:${device.id}`, id: device.id, label: device.label, category: 'Recorded device',
          detail: [device.kind, device.mobility, device.confidence, device.notes, device.place?.basis].filter(Boolean).join(' · '),
          qualification: `${data.source.status}; ${data.source.coverage} source coverage`, sourceDate: data.source.recordedAt,
          retrievedAt: data.source.retrievedAt,
          sourceFacts: [{ label: 'Source revision', value: data.source.revision }, { label: 'Source notes', value: data.source.notes },
            { label: 'Accepted at', value: data.source.acceptedAt }, { label: 'Recorded at', value: data.source.recordedAt },
            { label: 'Retrieved at', value: data.source.retrievedAt },
            { label: 'Connection source facts', value: networkIndex!.facts.get(device.id)! }],
          connections: networkIndex!.connections.get(device.id)! });
      }
    }
    const matches = (place: { packagePlaceKey: string; packagePlaceUuid: string }) => targets.some(target =>
      target.packagePlaceKey === place.packagePlaceKey && target.packagePlaceUuid === place.packagePlaceUuid);
    if (facts.electricity.status === 'available') for (const sheet of facts.electricity.data.sheets) {
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
    if (facts.electricalFixtures.status === 'available') {
      const data = facts.electricalFixtures.data;
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
  const unplacedNetwork: DocumentaryRecord[] = networkData ? networkData.devices
    .filter(device => !placedNetwork.has(`device:${device.id}`)).map(device => {
      const data = networkData;
      return { key: `device:${device.id}`, id: device.id, label: device.label, category: 'Recorded device',
        detail: [device.kind, device.mobility, device.confidence, device.notes].filter(Boolean).join(' · '),
        qualification: device.mobility === 'mobile' || device.mobility === 'nonspatial' ? 'Excluded from room placement' : 'No unambiguous reviewed room placement',
        sourceDate: data?.source.recordedAt ?? null, retrievedAt: data?.source.retrievedAt ?? null, connections: [],
        sourceFacts: [{ label: 'Recorded device', value: JSON.stringify(device) }, { label: 'Network source', value: JSON.stringify(data.source) },
          { label: 'Connection source facts', value: networkIndex!.facts.get(device.id)! }] };
    }) : [];
  // Topology never becomes a cable route or device position. Keep every link
  // and endpoint available even when neither end has a located device.
  if (networkData) {
    for (const link of networkData.links) unplacedNetwork.push({ key: `link:${link.id}`, id: link.id,
      label: networkIndex!.labels.get(link)!, category: 'Recorded connection',
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
  if (facts.electricity.status === 'available') for (const sheet of facts.electricity.data.sheets) {
    if (placedElectrical.has(`sheet:${sheet.id}`)) continue;
    unplacedElectrical.push({ key: `sheet:${sheet.id}`, id: sheet.id, label: sheet.titleAsRead, category: 'Electrical drawing',
      detail: `Page ${sheet.source.pdfPage}`, qualification: 'No unambiguous reviewed room placement; documentary evidence only',
      sourceDate: sheet.source.sourceDate, retrievedAt: sheet.source.retrievedAt, connections: [],
      sourceFacts: [{ label: 'Drawing and source facts', value: JSON.stringify(sheet) }] });
  }
  if (facts.electricalFixtures.status === 'available') for (const fixture of facts.electricalFixtures.data.fixtures) {
    if (placedElectrical.has(`symbol:${fixture.id}`)) continue;
    const data = facts.electricalFixtures.data;
    unplacedElectrical.push({ key: `symbol:${fixture.id}`, id: fixture.id, label: fixture.label, category: 'Historical symbol',
      detail: fixture.source.placementDescription, qualification: 'No unambiguous reviewed room placement; historic and unverified',
      sourceDate: data.sheets.find(sheet => sheet.id === fixture.sheetId)?.sourceDate ?? null, retrievedAt: null, connections: [],
      sourceFacts: [{ label: 'Source symbol', value: JSON.stringify(fixture) }, { label: 'Interpretation date', value: data.interpretationDate },
        { label: 'Symbol interpretation', value: JSON.stringify(data.symbolLegend) }] });
  }
  const electricity = facts.electricity.status === 'available', fixtures = facts.electricalFixtures.status === 'available';
  const source = facts.pins;
  const recordKey = (kind: string, id: string) => JSON.stringify(['houseatlas-documentary-record.v1', source.workspaceId,
    source.homeId, 'primary-scene', source.sceneEvidenceId, kind, id]);
  const stamp = (record: DocumentaryRecord, roomId: string | null): DocumentaryRecord => ({ ...record,
    key: recordKey(record.key.slice(0, record.key.indexOf(':')), record.id),
    sourceFacts: [...record.sourceFacts,
      { label: 'Source evidence', value: source.sceneEvidenceId },
      { label: 'Source evidence revision', value: String(source.sceneEvidenceRevision) },
      { label: 'Source original SHA256', value: source.sceneOriginalSha256 },
      { label: 'Source asset', value: source.sceneAssetId },
      { label: 'Source asset revision', value: source.sceneAssetRevision.toString() },
      ...facts.observationFacts,
      { label: 'Room review receipt', value: source.acceptedRoomReceiptId },
      { label: 'Room review SHA256', value: source.acceptedRoomReceiptSha256 },
      { label: 'Room association in this observation', value: roomId },
      { label: 'Drawing provenance', value: facts.drawingProvenance ? JSON.stringify(facts.drawingProvenance) : null }] });
  const stampedRooms = new Map([...rooms].map(([roomId, records]) => [roomId, {
    network: records.network.map(record => stamp(record, roomId)), electrical: records.electrical.map(record => stamp(record, roomId)) }]));
  return { rooms: stampedRooms, unplaced: { network: unplacedNetwork.map(record => stamp(record, null)), electrical: unplacedElectrical.map(record => stamp(record, null)) }, network: facts.network.status === 'available' ? 'available' : 'unavailable', electrical: electricity && fixtures ? 'available' : electricity || fixtures ? 'partial' : 'unavailable',
    networkGraphs: networkData ? [{ key: JSON.stringify([source.workspaceId, source.homeId, source.sceneEvidenceId, source.sceneOriginalSha256]),
      deviceRecordKeys: new Map(networkData.devices.map(device => [device.id, recordKey('device', device.id)])),
      sourceOriginalSha256: source.sceneOriginalSha256,
      data: networkData, qualification: facts.mode === 'saved-documentary-snapshot'
        ? 'Saved logical network; no physical routes or current authorization' : 'Recorded logical network; no physical routes' }] : [],
    sourceFacts: [...facts.observationFacts,
      { label: 'Room review receipt', value: facts.pins.acceptedRoomReceiptId },
      { label: 'Room review SHA256', value: facts.pins.acceptedRoomReceiptSha256 },
      { label: 'Unresolved source components', value: JSON.stringify([...new Set([
        ...facts.pins.acceptedRoomAnchors.flatMap(anchor => anchor.unresolvedLabels),
        ...(facts.pins.acceptedRoomMappings ?? []).flatMap(mapping => mapping.unresolvedLabels ?? [])])]) },
      { label: 'Drawing provenance', value: facts.drawingProvenance ? JSON.stringify(facts.drawingProvenance) : null }] };
}

/** Room-summary markers use existing room occurrences, never source-image positions. */
export function documentaryOverlayIndex(model: AtlasModel, records: RuntimeRecords, kind: OverlayKind): OverlayLayerIndex {
  const placed = new Map<string, OverlayPlacement>(), all = new Set<string>();
  for (const [roomId, rows] of records.rooms) {
    const selected = rows[kind]; if (!selected.length) continue;
    const occurrenceIds = model.roomsById.get(roomId)!.occurrenceIds.filter(id => model.selectable.has(id));
    const recordIds = [...new Set(selected.map(record => record.key))]; recordIds.forEach(id => all.add(id));
    for (const occurrenceId of occurrenceIds) placed.set(occurrenceId, { kind, roomId, occurrenceId, recordCount: recordIds.length, recordIds, positions: [], bindings: [] });
  }
  for (const record of records.unplaced[kind]) all.add(record.key);
  return { kind, placed, unplaced: [], records: all.size, unplacedRecords: new Set(records.unplaced[kind].map(record => record.key)).size };
}
