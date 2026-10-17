import { isExactDecimal } from '../numeric/decimal';
import type { LosslessJson } from '../numeric/lossless-json';
import type { AtlasScene } from '../lantern/unified-atlas/types';
import { projectDocumentaryFacts, mergeDocumentaryRecords, type DocumentaryRecord, type PropertyRecords, type DocumentaryFacts, type SourceAvailability } from '../lantern/unified-atlas/runtime-overlays';
import type { NetworkOverlayData, NetworkOverlayEndpoint, NetworkOverlayLink } from '../lantern/overlays/network/types';
import { canonicalPack, jsonRow, needPack, type JsonRow } from './manifest';
import { readSavedDocumentaryDetails } from '../../integration/native-scene-source-client';
import { readDocumentarySupport, documentaryReferences } from '../../integration/native-scene-documentary-support';
import { parseLosslessJson } from '../numeric/lossless-json';
import { savedDigest } from './store';
import type { SavedAtlasRead } from './saved-atlas-port';
import type { DocumentaryOverlayReadPins, NativeSceneAcceptedAnchor, NativeSceneAcceptedRoomMapping, NativeSceneFloorBinding } from '../lantern/scans/native-scene-source-types';
import { SAVED_OVERLAY_SECTIONS, type SavedPackSections } from './saved-pack-sections';

export interface SavedOverlayResult {
  readonly kind: 'saved'; readonly state: 'complete' | 'partial' | 'unavailable'; readonly records: PropertyRecords;
  readonly capturedAt: string; readonly snapshotId: string; readonly localRevision: string; readonly reasons: readonly string[];
  readonly retained: { readonly inventory: readonly LosslessJson[]; readonly documents: readonly LosslessJson[];
    readonly availableResourceSha256: readonly string[] };
}
const object = (v: LosslessJson | undefined): JsonRow | null => v !== null && typeof v === 'object' && !Array.isArray(v) && !isExactDecimal(v) ? v : null;
const rows = (v: LosslessJson | undefined): readonly LosslessJson[] => Array.isArray(v) ? v : [];
const text = (v: LosslessJson | undefined): string | null => typeof v === 'string' ? v : null;
const exact = (v: LosslessJson | undefined): string | null => isExactDecimal(v) ? v.token : text(v);
const printed = (v: LosslessJson | undefined) => v === undefined ? null : canonicalPack(v);

/** Supported generic retained facts only. No title, parent, topology edge or
 * room identity alone establishes electrical classification or placement. */
export function projectSavedAtlasOverlays(input: SavedPackSections, scene: AtlasScene, historical: SavedHistoricalFacts = { facts: [], reasons: [] },
  selectable: ReadonlySet<string> = new Set(scene.coverage.selectable ?? scene.occurrences.map(row => row.spaceOccurrenceId))): SavedOverlayResult {
  const { house, roots, manifest } = input, reasons: string[] = [];
  const scoped = (row: JsonRow) => row.workspaceId === house.scope.workspaceId && row.homeId === house.scope.homeId;
  const qualify = (section: 'atlas' | 'network'): SourceAvailability => {
    const state = manifest.sections[section];
    const root = roots[section];
    const withheld = rows(root?.caches).some(value => object(value)?.status === 'access-revoked')
      || manifest.exclusions.some(row => row.section === section && row.code === 'source-withheld');
    if (!root || state.state === 'unavailable' || state.state === 'not-configured') return 'unavailable';
    return state.state === 'complete' && state.requiredBytesComplete && !withheld ? 'available' : 'partial';
  };
  for (const section of SAVED_OVERLAY_SECTIONS) {
    const state = manifest.sections[section];
    if (state.state !== 'complete' && state.state !== 'not-configured') reasons.push(`${section}: ${state.state}`);
    if (!roots[section]) reasons.push(`${section}: retained section unavailable`);
  }
  for (const exclusion of manifest.exclusions) reasons.push(`${exclusion.section}: ${exclusion.code}: ${exclusion.label}`);
  const records = rows(roots.atlas?.records).map(object).filter((row): row is JsonRow => row !== null && scoped(row));
  const electrical: DocumentaryRecord[] = [], network: DocumentaryRecord[] = [];
  const electricalRelation = (row: JsonRow) => {
    const payload = object(row.payload);
    return row.recordType === 'relation' && (payload?.kind === 'circuit-supplies'
      || payload?.kind === 'documented-connection' && payload.medium === 'electricity');
  };
  const circuitEvidence = new Set(records.filter(row => row.recordType === 'circuit' || electricalRelation(row)).flatMap(row => rows(object(row.payload)?.evidenceIds).filter((id): id is string => typeof id === 'string')));
  let unsupported = 0;
  for (const row of records) {
    const payload = object(row.payload), id = text(row.recordId), revision = exact(row.revision);
    if (!payload || !id || !revision) { unsupported++; continue; }
    const circuit = row.recordType === 'circuit', relation = electricalRelation(row), evidence = row.recordType === 'evidence' && circuitEvidence.has(id);
    if (!circuit && !relation && !evidence) { if (!['scene-association', 'asset', 'evidence'].includes(text(row.recordType) ?? '')) unsupported++; continue; }
    const provenance = object(payload.provenance);
    electrical.push({ key: `atlas:${JSON.stringify([row.recordType, id])}`, id, label: text(payload.label) ?? text(payload.statement) ?? id,
      category: circuit ? 'Recorded circuit' : relation ? 'Recorded electrical relation' : 'Electrical evidence', detail: printed(payload) ?? '',
      qualification: 'Captured documentary fact; room placement, current installation and wire route unknown',
      sourceDate: text(provenance?.factAt), retrievedAt: text(provenance?.retrievedAt),
      connections: relation ? [`${printed(payload.from) ?? 'unknown'} ↔ ${printed(payload.to) ?? 'unknown'}`] : [],
      sourceFacts: [{ label: 'Record revision', value: revision }, { label: 'Record lifecycle', value: text(row.lifecycle) },
        { label: 'Created at', value: text(row.createdAt) }, { label: 'Updated at', value: text(row.updatedAt) },
        { label: 'Provenance', value: printed(payload.provenance) }, { label: 'Uncertainty', value: printed(payload.uncertainty ?? provenance?.uncertainty) }, { label: 'Original record', value: printed(row) }] });
  }
  const endpoints = new Map<string, NetworkOverlayEndpoint>(), links: NetworkOverlayLink[] = [];
  for (const value of rows(roots.network?.relations)) {
    const row = object(value); if (!row || !scoped(row)) { unsupported++; continue; }
    const id = text(row.externalId), source = text(row.sourceInstanceId), collection = text(row.collectionId), revision = exact(row.sourceRevision);
    const from = object(row.from), to = object(row.to);
    if (!id || !source || !collection || (row.sourceRevision !== null && revision === null) || !from || !to
      || !['network-connection', 'network-segment-membership', 'network-association'].includes(text(row.kind) ?? '')) { unsupported++; continue; }
    const key = JSON.stringify([source, collection, id]);
    const endpoint = (side: JsonRow, direction: string) => {
      const originalId = text(side.id), kind = text(side.kind), identity = JSON.stringify([source, collection, kind, originalId, originalId === null ? [id, direction] : null]);
      const label = text(side.description) ?? originalId ?? 'Unresolved endpoint';
      endpoints.set(identity, { id: identity, label, kind: kind === 'segment' || kind === 'interface' ? kind : kind === 'unresolved' ? 'unresolved' : 'named-endpoint',
        ownerDeviceId: null, notes: printed(side) ?? '' }); return { identity, label };
    };
    const a = endpoint(from, 'from'), b = endpoint(to, 'to');
    links.push({ id: key, fromEndpointId: a.identity, toEndpointId: b.identity,
      kind: row.kind === 'network-segment-membership' ? 'segment-membership' : 'connection', medium: text(row.medium) ?? 'unknown',
      confidence: 'unknown', sourceConfidence: text(row.sourceConfidence), temporalStatus: text(row.temporalStatus) ?? 'unknown',
      recordedAtPrecision: null, basis: text(row.evidenceBasis) ?? 'unknown', recordedAt: text(row.factAt), notes: text(row.notes) ?? '', path: null });
    network.push({ key: `network:${key}`, id, label: `${a.label} ↔ ${b.label}`, category: 'Recorded connection',
      detail: [text(row.kind), text(row.medium), text(row.temporalStatus), text(row.notes)].filter(Boolean).join(' · '),
      qualification: 'Captured logical relation; no physical cable route or device position', sourceDate: text(row.factAt), retrievedAt: text(row.retrievedAt), connections: [],
      sourceFacts: [{ label: 'Source revision', value: revision }, { label: 'Source snapshot at', value: text(row.sourceSnapshotAt) },
        { label: 'Source confidence', value: text(row.sourceConfidence) }, { label: 'Original relation', value: printed(row) }] });
  }
  if (unsupported) reasons.push(`${unsupported} retained record facets have no supported Atlas overlay projection`);
  reasons.push(...historical.reasons);
  if (!historical.facts.length) reasons.push('No verified historical record-to-room placement closure; generic records remain unplaced');
  const electricalState = qualify('atlas'), networkState = qualify('network');
  const data: NetworkOverlayData = { viewKey: `saved/${house.localRevision}/${house.snapshotId}`,
    source: { label: 'Saved network relations', revision: null, recordedAt: null, retrievedAt: null, status: 'recorded', acceptedAt: null,
      coverage: networkState === 'available' ? 'complete' : networkState === 'partial' ? 'partial' : 'unknown', notes: 'Logical topology only; captured source facts remain per relation' },
    devices: [], endpoints: [...endpoints.values()], links };
  const property: { -readonly [K in keyof PropertyRecords]: PropertyRecords[K] } = { rooms: new Map(), electrical: electricalState, network: networkState,
    unplaced: { electrical: mergeDocumentaryRecords(electrical), network: mergeDocumentaryRecords(network) },
    networkGraphs: links.length ? [{ key: data.viewKey, data, qualification: 'Saved logical topology; physical routes and positions unknown' }] : [],
    buildings: scene.buildings.map(building => ({ buildingId: building.buildingId, label: building.label, reason: 'saved-unplaced-records', electrical: electricalState, network: networkState })),
    sourceFacts: [{ label: 'Saved capture time', value: house.capturedAt }, { label: 'Snapshot', value: house.snapshotId },
      { label: 'Local revision', value: house.localRevision }, { label: 'Atlas sources', value: printed(roots.atlas?.sources) },
      { label: 'Atlas caches', value: printed(roots.atlas?.caches) }, { label: 'Network sources', value: printed(roots.network?.sources) },
      { label: 'Network caches', value: printed(roots.network?.caches) }, ...reasons.map(value => ({ label: 'Saved coverage', value }))] };
  for (const facts of historical.facts) {
    const projected = projectDocumentaryFacts(scene, facts, selectable);
    const combinedRooms = property.rooms as Map<string, import('../lantern/unified-atlas/runtime-overlays').RuntimeRoomRecords>;
    for (const [id, room] of projected.rooms) {
      const previous = combinedRooms.get(id);
      combinedRooms.set(id, { electrical: mergeDocumentaryRecords([...(previous?.electrical ?? []), ...room.electrical]),
        network: mergeDocumentaryRecords([...(previous?.network ?? []), ...room.network]) });
    }
    for (const kind of ['electrical', 'network'] as const) {
      property.unplaced = { ...property.unplaced, [kind]: [...property.unplaced[kind], ...projected.unplaced[kind]] };
    }
    property.networkGraphs = [...new Map([...(property.networkGraphs ?? []), ...(projected.networkGraphs ?? [])].map(graph => [graph.key, graph])).values()];
    const capturedNetwork = facts.network.status === 'available' && facts.network.data.source.coverage !== 'complete' ? 'partial' : projected.network;
    const combine = (a: SourceAvailability, b: SourceAvailability): SourceAvailability => a === 'available' && b === 'available' ? 'available'
      : a === 'unavailable' && b === 'unavailable' ? 'unavailable' : 'partial';
    property.buildings = property.buildings.map(row => scene.buildings.find(building => building.buildingId === row.buildingId)?.nativePlaceId === facts.pins.buildingId
      ? { ...row, network: combine(row.network, capturedNetwork), electrical: combine(row.electrical, projected.electrical), reason: 'captured historical source coverage; no current native authorization' } : row);
    property.sourceFacts = [...property.sourceFacts, ...projected.sourceFacts];
  }
  for (const kind of ['network', 'electrical'] as const) {
    const placed = new Set([...property.rooms.values()].flatMap(room => room[kind].map(record => record.key)));
    // Keep every placed/unplaced observation until the complete canonical merge.
    const all = mergeDocumentaryRecords([...property.rooms.values()].flatMap(room => [...room[kind]]).concat([...property.unplaced[kind]]));
    const byKey = new Map(all.map(record => [record.key, record]));
    for (const [roomId, room] of property.rooms) (property.rooms as Map<string, typeof room>).set(roomId, { ...room, [kind]: room[kind].map(record => byKey.get(record.key)!) });
    property.unplaced = { ...property.unplaced, [kind]: all.filter(record => !placed.has(record.key)) };
    const states = property.buildings.map(row => row[kind]);
    property[kind] = states.every(state => state === 'available') ? 'available' : states.every(state => state === 'unavailable') ? 'unavailable' : 'partial';
  }
  const supportedStates = [property.electrical, property.network];
  return { kind: 'saved', state: supportedStates.every(state => state === 'unavailable') ? 'unavailable'
    : supportedStates.every(state => state === 'available') && unsupported === 0 && historical.reasons.length === 0 ? 'complete' : 'partial',
    records: property, capturedAt: house.capturedAt, snapshotId: house.snapshotId, localRevision: house.localRevision, reasons,
    retained: { inventory: rows(roots.inventory?.entities), documents: rows(roots.documents?.documents), availableResourceSha256: [...input.availability.keys()] } };
}

export interface SavedHistoricalFacts { readonly facts: readonly DocumentaryFacts[]; readonly reasons: readonly string[] }
/** Admit actual retained association/primary/support closure. This creates only
 * factual byte pins; no native selection, frame, session, lease or preview manifest. */
export async function readSavedHistoricalFacts(input: SavedPackSections, read: SavedAtlasRead, signal: AbortSignal): Promise<SavedHistoricalFacts> {
  const facts: DocumentaryFacts[] = [], reasons: string[] = [];
  const records = rows(input.roots.atlas?.records).map(object).filter((row): row is JsonRow => row !== null);
  const scope = input.house.scope, scene = read.scene;
  if (!records.some(row => row.recordType === 'scene-association')) return { facts, reasons };
  const { createExactStockResultValidator } = await import('../numeric/schema-validator'); signal.throwIfAborted();
  const validator = createExactStockResultValidator();
  const guard = () => signal.throwIfAborted();
  const requiredText = (value: LosslessJson | undefined) => { const result = text(value); needPack(result); return result; };
  const revision = (value: LosslessJson | undefined) => {
    needPack(isExactDecimal(value) && /^[1-9][0-9]*$/.test(value.token)); return value;
  };
  const find = (type: string, id: string, rev: LosslessJson | undefined) => {
    const expected = revision(rev), matches = records.filter(row => row.recordType === type && row.recordId === id
      && row.workspaceId === scope.workspaceId && row.homeId === scope.homeId && row.lifecycle === 'active'
      && isExactDecimal(row.revision) && row.revision.compare(expected) === 0);
    needPack(matches.length === 1); return matches[0]!;
  };
  const heads: JsonRow[] = [];
  const associations = records.filter(row => row.recordType === 'scene-association' && row.workspaceId === scope.workspaceId && row.homeId === scope.homeId);
  for (const buildingId of new Set(associations.map(row => text(object(row.payload)?.buildingId)))) {
    try {
      needPack(buildingId);
      const chain = associations.filter(row => object(row.payload)?.buildingId === buildingId);
      needPack(chain.every(row => row.lifecycle === 'active' && validator.validateNativeEvidenceShape('scene-association', row)));
      const byId = new Map(chain.map(row => [requiredText(row.recordId), row])); needPack(byId.size === chain.length);
      const roots = chain.filter(row => jsonRow(row.payload).previousAssociationId === null); needPack(roots.length === 1);
      const children = new Map<string, JsonRow>();
      for (const row of chain) {
        const payload = jsonRow(row.payload), version = BigInt(revision(payload.associationVersion).token);
        if (payload.previousAssociationId === null) needPack(version === 1n);
        else {
          const previousId = requiredText(payload.previousAssociationId), previous = byId.get(previousId);
          needPack(previous && !children.has(previousId) && version === BigInt(revision(jsonRow(previous.payload).associationVersion).token) + 1n);
          children.set(previousId, row);
        }
      }
      const visited = new Set<string>(); let head = roots[0]!;
      for (;;) {
        const id = requiredText(head.recordId); needPack(!visited.has(id)); visited.add(id);
        const next = children.get(id); if (!next) break; head = next;
      }
      needPack(visited.size === chain.length); heads.push(head);
    } catch { reasons.push(`Building ${buildingId ?? 'unknown'}: captured association chain unavailable`); }
  }
  for (const association of heads) {
    guard();
    try {
      needPack(validator.validateNativeEvidenceShape('scene-association', association));
      needPack(association.workspaceId === scope.workspaceId && association.homeId === scope.homeId);
      const p = jsonRow(association.payload), buildingId = requiredText(p.buildingId);
      const building = scene.buildings.find(row => row.nativePlaceId === buildingId);
      const sourceBuildingLabel = building?.label ?? `Retained building ${buildingId} (not mapped in this model)`;
      const documents = rows(p.sourceDocuments).map(value => jsonRow(value));
      needPack(documents.length === 2);
      const primary = documents.find(row => row.role === 'primary-scene'), supportPin = documents.find(row => row.role === 'documentary-sheet');
      needPack(primary && supportPin);
      const retained = (pin: JsonRow) => {
        const sha = requiredText(pin.originalSha256), assetId = requiredText(pin.originalAssetId), evidenceId = requiredText(pin.evidenceId);
        const asset = find('asset', assetId, pin.originalAssetRevision), evidence = find('evidence', evidenceId, pin.evidenceRevision);
        const assetPayload = jsonRow(asset.payload), evidencePayload = jsonRow(evidence.payload);
        const bytes = input.originals.get(sha); needPack(bytes && assetPayload.owner === 'atlas' && assetPayload.purpose === 'evidence-original' && assetPayload.availability === 'available' && pin.contentType === 'text/plain' && assetPayload.sha256 === sha && assetPayload.contentType === pin.contentType
          && isExactDecimal(assetPayload.byteSize) && assetPayload.byteSize.toSafeInteger() === bytes.byteLength);
        needPack(rows(evidencePayload.references).length === 1 && rows(evidencePayload.references).some(raw => { const ref = object(raw); return ref?.kind === 'atlas-asset' && ref.assetId === assetId; }));
        return bytes;
      };
      const buildingMembers = records.filter(row => row.lifecycle === 'active' && row.workspaceId === scope.workspaceId && row.homeId === scope.homeId
        && (row.recordType === 'identity' && row.recordId === buildingId || row.recordType === 'location-semantics'
          && object(row.payload)?.atlasId === buildingId && object(row.payload)?.semanticKind === 'building' && object(row.payload)?.reviewStatus === 'accepted'));
      needPack(buildingMembers.some(row => rows(object(row.payload)?.evidenceIds).includes(primary.evidenceId!)));
      const primaryBytes = retained(primary), supportBytes = retained(supportPin), receipt = jsonRow(p.acceptedReceipt);
      const literal = requiredText(receipt.canonicalJson), parsed = jsonRow(parseLosslessJson(literal));
      needPack(canonicalPack(parsed) === literal && parsed.profile === 'houseatlas.native-scene-room-review.v1'
        && parsed.receiptId === receipt.receiptId && parsed.sourceReceiptSha256 === supportPin.originalSha256
        && canonicalPack(parsed.anchors!) === canonicalPack(receipt.anchors!)
        && await savedDigest(new TextEncoder().encode(literal).buffer) === receipt.canonicalSha256); guard();
      const primaryRoot = jsonRow(parseLosslessJson(new TextDecoder('utf-8', { fatal: true }).decode(primaryBytes)));
      needPack(primaryRoot.receiptCanonicalJson === literal);
      // Closed schema validated the string-only anchor and mapping trees. Their
      // cross-membership below still has to match the exact captured receipt.
      const acceptedRoomAnchors = JSON.parse(canonicalPack(receipt.anchors!)) as NativeSceneAcceptedAnchor[];
      const acceptedRoomMappings = JSON.parse(canonicalPack(p.roomMappings!)) as NativeSceneAcceptedRoomMapping[];
      const documentEvidenceIds = documents.map(doc => requiredText(doc.evidenceId));
      for (const mapping of acceptedRoomMappings) {
        needPack(mapping.evidenceIds.length === 2 && documentEvidenceIds.every(id => mapping.evidenceIds.includes(id)));
        for (const id of mapping.sourceAnchorIds) {
          const anchor = acceptedRoomAnchors.find(row => row.id === id);
          needPack(anchor && anchor.sourceFloorKey === mapping.sourceFloorKey && anchor.sourceOriginalSha256 === mapping.sourceOriginalSha256);
        }
        for (const target of mapping.targets) needPack(mapping.sourceAnchorIds.some(id => acceptedRoomAnchors.find(row => row.id === id)?.targets.some(pair =>
          pair.packagePlaceKey === target.packagePlaceKey && pair.packagePlaceUuid === target.packagePlaceUuid)));
      }
      const sourceFloorBindings = rows(p.sourceFloors).map(value => {
        const floor = jsonRow(value), plain = JSON.parse(canonicalPack(floor)) as Omit<NativeSceneFloorBinding, 'nativeGeometryRevision'>;
        return { ...plain, nativeGeometryRevision: revision(floor.nativeGeometryRevision) };
      });
      let pins: DocumentaryOverlayReadPins = { ...scope, buildingId,
        viewKey: JSON.stringify(['saved', input.house.localRevision, input.house.snapshotId, association.recordId]),
        sceneEvidenceId: requiredText(primary.evidenceId), sceneAssetId: requiredText(primary.originalAssetId), sceneOriginalSha256: requiredText(primary.originalSha256),
        sceneEvidenceRevision: revision(primary.evidenceRevision).toSafeInteger()!, sceneAssetRevision: revision(primary.originalAssetRevision),
        acceptedRoomReceiptId: requiredText(receipt.receiptId), acceptedRoomReceiptSha256: requiredText(receipt.canonicalSha256),
        acceptedRoomAnchors, acceptedRoomMappings, sourceFloorBindings };
      const support = await readDocumentarySupport(supportBytes, guard); guard();
      let pdfRetained = false;
      if (support) {
        const pdf = support.pdf;
        try {
          const asset = find('asset', pdf.assetId, pdf.assetRevision), evidence = find('evidence', pdf.evidenceId, parseLosslessJson(String(pdf.evidenceRevision)));
          const assetPayload = jsonRow(asset.payload), refs = rows(jsonRow(evidence.payload).references), pdfBytes = input.originals.get(pdf.sha256);
          pdfRetained = Boolean(pdfBytes && assetPayload.owner === 'atlas' && assetPayload.purpose === 'evidence-original' && assetPayload.availability === 'available'
            && assetPayload.sha256 === pdf.sha256 && assetPayload.contentType === 'application/pdf' && isExactDecimal(assetPayload.byteSize)
            && assetPayload.byteSize.compare(pdf.byteSize) === 0 && pdf.byteSize.toSafeInteger() === pdfBytes.byteLength
            && refs.length === 1 && object(refs[0])?.kind === 'atlas-asset' && object(refs[0])?.assetId === pdf.assetId
            && buildingMembers.some(row => rows(object(row.payload)?.evidenceIds).includes(pdf.evidenceId)));
        } catch { /* Optional PDF metadata is unavailable; no native file action. */ }
        if (!pdfRetained) reasons.push(`${sourceBuildingLabel}: captured PDF correlation unavailable`);
      }
      if (support && pdfRetained && requiredText(p.reviewStatement).endsWith(support.reviewMarker) && support.pdf.workspaceId === scope.workspaceId
        && support.pdf.homeId === scope.homeId && support.pdf.buildingId === buildingId) {
        // Correlations are captured reference metadata only; no live PDF action.
        pins = { ...pins, drawingSupport: { evidenceId: requiredText(supportPin.evidenceId), evidenceRevision: revision(supportPin.evidenceRevision).toSafeInteger()!,
          assetId: requiredText(supportPin.originalAssetId), assetRevision: revision(supportPin.originalAssetRevision), originalSha256: requiredText(supportPin.originalSha256), reviewMarker: support.reviewMarker } };
        pins = { ...pins, drawingReferences: documentaryReferences(support, pins) };
      }
      const details = await readSavedDocumentaryDetails(pins, primaryBytes, supportBytes, guard); guard();
      const roomBindings: DocumentaryFacts['roomBindings'] = (read.roomLinks?.data.links ?? []).flatMap(link => {
        const room = scene.rooms.find(row => row.roomId === link.roomId && row.buildingId === building?.buildingId && row.nativePlaceId === link.nativePlaceId);
        if (!room) return [];
        const matching = acceptedRoomMappings.filter(mapping => mapping.targets.some(target => target.atlasPlaceId === link.nativePlaceId
          && target.packagePlaceKey === link.packagePlaceKey && target.packagePlaceUuid === link.packagePlaceUuid));
        const anchors = [...new Set(matching.flatMap(mapping => mapping.sourceAnchorIds).filter(id => acceptedRoomAnchors.some(anchor => anchor.id === id
          && anchor.targets.some(target => target.packagePlaceKey === link.packagePlaceKey && target.packagePlaceUuid === link.packagePlaceUuid))))];
        if (!matching.length || !anchors.length) return [];
        return [{ roomId: room.roomId, nativePlaceId: link.nativePlaceId, spaceOccurrenceId: null, sourceRoomIds: matching.map(row => row.sourceRoomId),
          targets: [{ packagePlaceKey: link.packagePlaceKey, packagePlaceUuid: link.packagePlaceUuid, sourceAnchorIds: anchors }],
          qualification: 'captured-room-identity-join' as const, anchor: { kind: 'room-summary' as const } }];
      });
      facts.push({ mode: 'saved-documentary-snapshot', pins, roomBindings, network: details.network, electricity: details.electricity,
        electricalFixtures: details.electricalFixtures, drawingProvenance: details.capturedDrawingProvenance,
        observationFacts: [{ label: 'Retained association', value: requiredText(association.recordId) },
          { label: 'Captured association revision', value: exact(association.revision) },
          { label: 'Historical source', value: 'Verified retained primary/support closure; no current native authorization' }] });
      if (!roomBindings.length) reasons.push(`${sourceBuildingLabel}: retained historical records have no captured room identity join`);
    } catch (error) {
      guard(); reasons.push(`Scene association ${text(association.recordId) ?? 'unknown'}: historical primary/support closure unavailable`);
    }
  }
  return { facts, reasons };
}
