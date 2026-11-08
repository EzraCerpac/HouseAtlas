/** Generated documentary source owner for this browser fixture only. These
 * invented links exercise the real feed/projector; they confer no native authority. */
import type { UnifiedAtlasPort } from '../../src/lantern/unified-atlas/types';
import type { UnifiedAtlasOverlayAvailableFrame } from '../../integration/unified-atlas-overlay-source';
import type { NativeSceneSourceSelection } from '../../src/lantern/scans/native-scene-source-types';
import type { ElectricalFixtureData } from '../../src/lantern/overlays/electricity/fixture-types';
import { ExactDecimal } from '../../src/numeric/decimal';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const createSyntheticDrawingGroups: NonNullable<UnifiedAtlasPort['createOverlays']> = async (_selection, scene, building, signal) => {
  signal.throwIfAborted();
  if (building.buildingId !== 'syn-building-house' || building.nativePlaceId === null) return null;
  const rooms = scene.rooms.filter(room => ['syn-room-hall', 'syn-room-living'].includes(room.roomId));
  const targets = rooms.map((room, i) => ({ packagePlaceKey: `generated-${room.roomId}`, packagePlaceUuid: U(600 + i) }));
  const receipt = { id: 'generated-browser-room-review', sha256: 'a'.repeat(64) };
  const sourceSelection: NativeSceneSourceSelection = {
    sessionIdentity: {}, ...scene.scope, expiresAt: '2099-01-01T00:00:00Z', buildingId: building.nativePlaceId,
    viewKey: 'generated-browser-electrical', sceneEvidenceId: U(610), sceneAssetId: U(611),
    sceneOriginalSha256: 'b'.repeat(64), sceneEvidenceRevision: 1, sceneAssetRevision: ExactDecimal.parse('1'),
    acceptedRoomReceiptId: receipt.id, acceptedRoomReceiptSha256: receipt.sha256,
    acceptedRoomAnchors: targets.map((target, i) => ({ id: `generated-anchor-${i}`, sourceFloorKey: 'generated-floor',
      sourceOriginalSha256: 'c'.repeat(64), targets: [target], unresolvedLabels: [] })), sourceFloorBindings: [],
  };
  const data: ElectricalFixtureData = {
    schema: 'houseatlas.documentary-electrical-fixtures.v1', viewKey: sourceSelection.viewKey, interpretationDate: '2026-01-02',
    symbolLegend: { xMeansSocket: null, socketsPerX: null, receiptId: null }, roomMappingReceipt: receipt, registrationReceipts: [],
    sheets: [{ id: 'generated-sheet', title: 'Generated drawing', pdfPage: 1, originalPhoto: 'generated.jpg',
      originalPhotoSha256: 'd'.repeat(64), renderedPhotoSha256: 'e'.repeat(64), sourceDate: null, regionIds: ['region-0', 'region-1', 'region-2'] }],
    groups: [{ id: 'generated-group', label: 'Generated historic group A', fixtureIds: ['symbol-0', 'symbol-1', 'symbol-2'],
      evidenceBasis: 'historic-drawing-label', currentCircuitId: null, verifiedWiring: false }],
    regions: [0, 1, 2].map(i => ({ id: `region-${i}`, sheetId: 'generated-sheet', label: `Generated region ${i}`,
      sourceOutline: [], outlineClosed: false, sourceBounds: [.1, .1, .9, .9], outlineBasis: 'untraced',
      places: targets[i] ? [{ ...targets[i]!, label: rooms[i]!.label, basis: 'owner-reported' }] : [],
      orientation: 'unregistered', physicalTransform: null })),
    fixtures: [0, 1, 2].map(i => ({ id: `symbol-${i}`, sheetId: 'generated-sheet', regionId: `region-${i}`, clusterId: null,
      kind: 'socket', label: ['Generated hall symbol', 'Generated living symbol', 'Generated unplaced symbol'][i]!, glyph: 'X',
      source: { symbolKey: `generated-symbol-${i}`, originalPhotoSha256: 'd'.repeat(64), renderedPhotoSha256: 'e'.repeat(64),
        normalizedBox: [.3, .3, .4, .4], normalizedPoint: [.35, .35], literalLabels: ['A'], placementDescription: 'Generated drawing symbol' },
      group: { id: 'generated-group', label: 'A', basis: 'label-adjacent', note: 'Generated historical label' }, glyphCount: 1,
      fixtureCount: null, uncertainty: 'Current wiring is unknown', currentState: 'historic-unverified', physicalCoordinate: null, wireRoute: null })),
  };
  const sceneSelection = { ...scene.scope, revision: scene.selection.revision, publicationId: scene.publication.publicationId,
    semanticsSha256: scene.publication.semanticsSha256 };
  const frame: UnifiedAtlasOverlayAvailableFrame = {
    status: 'available', lease: {}, sceneSelection, nativeBuildingId: building.nativePlaceId,
    currentSource: { recordId: U(612), revision: ExactDecimal.parse('1'), payload: {} }, sourceSelection,
    roomBindings: rooms.map((room, i) => ({ roomId: room.roomId, nativePlaceId: room.nativePlaceId!, spaceOccurrenceId: null,
      sourceRoomIds: [`generated-source-room-${i}`], targets: [{ ...targets[i]!, sourceAnchorIds: [`generated-anchor-${i}`] }],
      qualification: 'current-native-room-join', anchor: { kind: 'room-summary' } })),
    network: { status: 'unavailable', reason: 'not-retained' }, electricity: { status: 'unavailable', reason: 'not-retained' },
    electricalFixtures: { status: 'available', data },
  };
  let current = true;
  const listeners = new Set<() => void>();
  const invalidate = () => { current = false; for (const changed of [...listeners]) changed(); };
  window.addEventListener('synthetic-atlas-source-invalidate', invalidate);
  return { request: { sceneSelection, nativeBuildingId: building.nativePlaceId, publicationRooms: rooms }, source: {
    async open(_request, opening) { opening.throwIfAborted(); return frame; },
    isCurrent: owned => current && owned === frame,
    subscribeInvalidation(_owned, changed) { listeners.add(changed); return () => { listeners.delete(changed); }; },
    release() { current = false; },
    dispose() { current = false; listeners.clear(); window.removeEventListener('synthetic-atlas-source-invalidate', invalidate); },
  } };
};
