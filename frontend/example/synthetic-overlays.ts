/** Invented documentary observations for the example only. These carry no
 * native authority, physical device coordinates or installed wiring claim. */
import type { UnifiedAtlasPort } from '../src/lantern/unified-atlas/types';
import type { UnifiedAtlasOverlayAvailableFrame } from '../integration/unified-atlas-overlay-source';
import type { NativeSceneSourceSelection } from '../src/lantern/scans/native-scene-source-types';
import type { ElectricalFixtureData } from '../src/lantern/overlays/electricity/fixture-types';
import type { NetworkOverlayData } from '../src/lantern/overlays/network/types';
import { ExactDecimal } from '../src/numeric/decimal';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const createExampleOverlays: NonNullable<UnifiedAtlasPort['createOverlays']> = async (_selection, scene, building, signal) => {
  signal.throwIfAborted();
  if (building.buildingId !== 'syn-building-house' || building.nativePlaceId === null) return null;
  const rooms = ['syn-room-hall', 'syn-room-living', 'syn-room-stairs'].map(id => scene.rooms.find(room => room.roomId === id));
  if (rooms.some(room => !room || room.buildingId !== building.buildingId || room.nativePlaceId === null)) return null;
  const targets = rooms.map((room, i) => ({ packagePlaceKey: `generated-${room!.roomId}`, packagePlaceUuid: U(600 + i) }));
  const receipt = { id: 'example-room-review', sha256: 'a'.repeat(64) }, floorHash = 'c'.repeat(64);
  const pins: NativeSceneSourceSelection = {
    sessionIdentity: {}, ...scene.scope, expiresAt: '2099-01-01T00:00:00Z', buildingId: building.nativePlaceId,
    viewKey: 'example-documentary', sceneEvidenceId: U(610), sceneAssetId: U(611), sceneOriginalSha256: 'b'.repeat(64),
    sceneEvidenceRevision: 1, sceneAssetRevision: ExactDecimal.parse('1'), acceptedRoomReceiptId: receipt.id,
    acceptedRoomReceiptSha256: receipt.sha256, acceptedRoomAnchors: targets.map((target, i) => ({ id: `example-anchor-${i}`,
      sourceFloorKey: 'example-floor', sourceOriginalSha256: floorHash, targets: [target], unresolvedLabels: [] })), sourceFloorBindings: [],
  };
  const electricalFixtures: ElectricalFixtureData = {
    schema: 'houseatlas.documentary-electrical-fixtures.v1', viewKey: pins.viewKey, interpretationDate: '2026-01-02',
    symbolLegend: { xMeansSocket: null, socketsPerX: null, receiptId: null }, roomMappingReceipt: receipt, registrationReceipts: [],
    sheets: [{ id: 'example-sheet', title: 'Fictional drawing', pdfPage: 1, originalPhoto: 'fictional.jpg',
      originalPhotoSha256: 'd'.repeat(64), renderedPhotoSha256: 'e'.repeat(64), sourceDate: null, regionIds: ['hall', 'living'] }],
    groups: [], regions: ['hall', 'living'].map((id, i) => ({ id, sheetId: 'example-sheet', label: `Fictional ${id}`,
      sourceOutline: [], outlineClosed: false, sourceBounds: [.1, .1, .9, .9], outlineBasis: 'untraced',
      places: [{ ...targets[i]!, label: rooms[i]!.label, basis: 'owner-reported' }], orientation: 'unregistered', physicalTransform: null })),
    fixtures: [0, 1, 2, 3].map(i => ({ id: `example-symbol-${i}`, sheetId: 'example-sheet', regionId: i < 3 ? 'hall' : 'living', clusterId: null,
      kind: 'socket', label: `Fictional symbol ${i + 1}`, glyph: 'X', source: { symbolKey: `example-symbol-${i}`,
        originalPhotoSha256: 'd'.repeat(64), renderedPhotoSha256: 'e'.repeat(64), normalizedBox: [.3, .3, .4, .4],
        normalizedPoint: [.35, .35], literalLabels: [], placementDescription: 'Fictional drawing symbol' },
      group: { id: null, label: null, basis: 'unknown', note: '' }, glyphCount: 1, fixtureCount: null,
      uncertainty: 'Current wiring is unknown', currentState: 'historic-unverified', physicalCoordinate: null, wireRoute: null })),
  };
  const network: NetworkOverlayData = {
    viewKey: pins.viewKey, source: { label: 'Fictional network', revision: 'example-1', recordedAt: null, retrievedAt: null,
      status: 'recorded', acceptedAt: null, coverage: 'partial', notes: 'Fictional logical records', roomMappingReceipt: receipt },
    devices: [{ id: 'example-access-point', label: 'Fictional access point', kind: 'access point', mobility: 'fixed', confidence: 'recorded', notes: '',
      place: { placeId: null, sourceRoomId: 'example-room-stairs', sourcePlaceId: targets[2]!.packagePlaceKey, sourcePlaceUUID: targets[2]!.packagePlaceUuid,
        planAssociations: [{ sourceAnchorId: 'example-anchor-2', sourceFloorKey: 'example-floor', sourceFloorLabel: 'Fictional floor',
          sourceReference: 'Fictional record', sourceHandle: 'example-handle', sourceSHA256: floorHash, mappingReceiptSHA256: receipt.sha256 }],
        roomLabel: 'Stairs', detail: '', confidence: 'recorded', basis: 'Fictional association', floorKey: null, mappingStatus: 'accepted', coordinate: null } },
    { id: 'example-root', label: 'Fictional network root', kind: 'router', sourceRoot: true, mobility: 'fixed', confidence: 'recorded', notes: '', place: null }],
    endpoints: [], links: [{ id: 'example-link', fromEndpointId: 'example-access-point', toEndpointId: 'example-root', kind: 'connection', medium: 'ethernet',
      confidence: 'recorded', sourceConfidence: null, temporalStatus: 'recorded', recordedAtPrecision: null, basis: 'Fictional association',
      recordedAt: null, notes: 'Logical association only; no cable route', path: null }],
  };
  const sceneSelection = { ...scene.scope, revision: scene.selection.revision, publicationId: scene.publication.publicationId,
    semanticsSha256: scene.publication.semanticsSha256 };
  const frame: UnifiedAtlasOverlayAvailableFrame = { status: 'available', lease: {}, sceneSelection, nativeBuildingId: building.nativePlaceId,
    currentSource: { recordId: U(612), revision: ExactDecimal.parse('1'), payload: {} }, sourceSelection: pins,
    roomBindings: rooms.map((room, i) => ({ roomId: room!.roomId, nativePlaceId: room!.nativePlaceId!, spaceOccurrenceId: null,
      sourceRoomIds: [`example-room-${i}`], targets: [{ ...targets[i]!, sourceAnchorIds: [`example-anchor-${i}`] }],
      qualification: 'current-native-room-join', anchor: { kind: 'room-summary' } })),
    network: { status: 'available', data: network }, electricity: { status: 'unavailable', reason: 'not-retained' },
    electricalFixtures: { status: 'available', data: electricalFixtures } };
  let current = true, opened = false;
  let openingSignal: AbortSignal | null = null;
  const listeners = new Set<() => void>();
  const retire = () => { if (!current) return; current = false; signal.removeEventListener('abort', retire);
    openingSignal?.removeEventListener('abort', retire); openingSignal = null;
    for (const changed of [...listeners]) changed(); listeners.clear(); };
  signal.addEventListener('abort', retire, { once: true });
  const request = { sceneSelection, nativeBuildingId: building.nativePlaceId, publicationRooms: rooms.map(room => room!) };
  return { request, source: {
    async open(input, opening) { opening.throwIfAborted(); if (!current || opened || input !== request) throw new Error('Example overlay owner is retired');
      opened = true; openingSignal = opening; opening.addEventListener('abort', retire, { once: true }); return frame; },
    isCurrent: owned => current && opened && owned === frame,
    subscribeInvalidation(owned, changed) { if (current && opened && owned === frame) listeners.add(changed); return () => { listeners.delete(changed); }; },
    release(owned) { if (owned === frame) retire(); }, dispose() { retire(); },
  } };
};
