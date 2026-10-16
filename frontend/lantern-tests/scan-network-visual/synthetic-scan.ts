/** SYNTHETIC in-page read ports for the actual NativeScanAtlas and its network
 * scene layer. Reused generated inputs only: the readme mesh profile, the
 * schematic room anchors and provisional region of the healthy scene-reader
 * fixture and the topology fixture's buildings, plus one same-size synthetic
 * outline beside it. Network records are fictional logical links with no
 * route, coordinate or native place mapping. Every read waits a fixed delay;
 * nothing is fetched, written, persisted or associated. */
import { ExactDecimal } from '../../src/numeric/decimal';
import { MESH_PROFILE, type ScanMeshReadPort } from '../../src/lantern/scans/mesh-profile';
import type { NativeGeometryFrame, NativeGeometryReadClient, NativeScanFloor } from '../../src/lantern/scans/native-read-types';
import type { NativeSceneHost } from '../../src/lantern/scans/native-ui/native-scene-host';
import type { NativeSceneSourceFrame, NativeSceneSourceSelection } from '../../src/lantern/scans/native-scene-source-types';
import type { NativeEvidenceDocumentClient } from '../../src/lantern/scans/native-evidence-document-types';
import type { SceneAssociationClient, SceneAssociationRead } from '../../integration/native-scene-association-client';
import type { NetworkOverlayData, NetworkOverlayDevice, NetworkPlaceAssociation } from '../../src/lantern/overlays/network/types';
import type { DisplayRoomRegion, SchematicRoom } from '../../src/lantern/scans/presentation/types';
import meshProfile from '../readme-house-visual/fixture.json';

type Scope = Readonly<{ workspaceId: string; homeId: string }>;
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ONE = ExactDecimal.parse('1');
const hex = async (bytes: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('');
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted();
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});
const unavailable = () => Promise.reject(new Error('Not available in this read-only fixture'));

/** The one building whose read carries a scene source (the topology fixture's first). */
export const SCENE_BUILDING = U(1);
const MESH_BYTES = new TextEncoder().encode(JSON.stringify(meshProfile));
const meshSha256 = hex(MESH_BYTES.slice());
const viewKeyOf = (buildingId: string) => `syn-scan-view-${buildingId.slice(-4)}`;
const floorKeyOf = (buildingId: string) => `syn-floor-${buildingId.slice(-4)}`;

/** Fake native geometry: one generated floor per building, served with its digest. */
export function createSyntheticScanClient(scope: Scope, delayMs: number): NativeGeometryReadClient {
  const frames = new Set<NativeGeometryFrame>();
  const readPort: ScanMeshReadPort = {
    isCurrent: viewKey => [...frames].some(frame => frame.viewKey === viewKey),
    subscribeInvalidation: () => () => {},
    async read(viewKey, floor, signal) {
      await wait(delayMs, signal);
      return { viewKey, floorKey: floor.key, bytes: MESH_BYTES.slice() };
    },
  };
  return {
    async loadBuilding(buildingId, signal) {
      await wait(delayMs, signal);
      const derivative = await meshSha256, viewKey = viewKeyOf(buildingId);
      const base = { key: floorKeyOf(buildingId), exportLabel: meshProfile.source.floorLabel,
        geometryId: U(701), geometryRevision: ONE, evidenceId: U(702), evidenceRevision: ONE,
        originalAssetId: U(703), originalRevision: ONE, derivativeAssetId: U(704), derivativeRevision: ONE,
        originalLicense: { status: 'unknown', reference: null }, derivativeLicense: { status: 'unknown', reference: null },
        profile: MESH_PROFILE, originalContentType: 'model/vnd.usdz+zip',
        derivativeContentType: 'application/vnd.houseatlas.magicplan-authored-mesh+json' } as const;
      const floor: NativeScanFloor = { ...base, originalSHA256: meshProfile.source.originalSHA256, derivativeSHA256: derivative };
      const frame: NativeGeometryFrame = { lease: {}, viewKey, readPort, floors: [floor],
        descriptor: { schemaVersion: ONE, profile: MESH_PROFILE, scope, buildingId, viewKey,
          floors: [{ floor: { ...base, originalSha256: meshProfile.source.originalSHA256, derivativeSha256: derivative }, readPath: 'synthetic-fixture' }],
          physicalScale: 'unknown', floorAlignment: 'unknown', stageToHouseTransform: null } };
      frames.add(frame);
      return frame;
    },
    isCurrent: frame => frames.has(frame),
    subscribeInvalidation(frame, invalidate) { if (!frames.has(frame)) invalidate(); return () => {}; },
    dispose: () => frames.clear(),
  };
}

// The schematic room anchors of the healthy scene-reader fixture, unchanged.
const RECEIPT_JSON = '{"id":"synthetic-room-receipt","profile":"synthetic-only"}';
const ROOM_LABELS = ['Alpha', 'Beta', 'Unmatched'] as const;

function sceneRooms(floorKey: string, receipt: { id: string; sha256: string }): SchematicRoom[] {
  return ROOM_LABELS.map((label, index) => ({ id: `room-${label.toLowerCase()}`, floorKey, label,
    packagePlaceKey: `package:${label}`, packagePlaceUuid: U(20 + index), sourceAnchorIds: [`anchor:${label}`],
    receiptId: receipt.id, receiptSha256: receipt.sha256, xFraction: .2 + index * .2, yFraction: .5, basis: 'schematic-room' }));
}

/** Explicitly synthetic display outlines for Alpha and Beta, in the mesh
 * canvas's 0–1 frame, so the actual room regions can be pointed at and
 * switched. Alpha's is the healthy reader fixture's provisional region; Beta's
 * is the same size beside it. Unmatched keeps no outline. They are not
 * measured rooms and carry no place binding beyond the rooms above. */
const OUTLINES: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  Alpha: [[.1, .4], [.3, .4], [.3, .6], [.1, .6]],
  Beta: [[.32, .4], [.52, .4], [.52, .6], [.32, .6]],
};
function sceneRegions(rooms: readonly SchematicRoom[]): DisplayRoomRegion[] {
  return rooms.flatMap(room => {
    const outline = OUTLINES[room.label];
    return outline ? [{ roomId: room.id, floorKey: room.floorKey, packagePlaceKey: room.packagePlaceKey, packagePlaceUuid: room.packagePlaceUuid,
      receiptId: room.receiptId, receiptSha256: room.receiptSha256, sourceAnchorIds: room.sourceAnchorIds, polygons: [outline],
      geometryQualification: 'Synthetic provisional region', sourceGeometryHandles: [`synthetic:${room.label.toLowerCase()}`] }] : [];
  });
}

/** Fictional devices in two of those rooms plus records that stay unplaced. */
function sceneNetwork(viewKey: string, floorKey: string, rooms: readonly SchematicRoom[], receipt: { id: string; sha256: string }): NetworkOverlayData {
  const place = (room: SchematicRoom, detail: string): NetworkPlaceAssociation => ({ placeId: null, sourceRoomId: null,
    sourcePlaceId: room.packagePlaceKey, sourcePlaceUUID: room.packagePlaceUuid, roomLabel: room.label, detail,
    planAssociations: [{ sourceAnchorId: room.sourceAnchorIds[0]!, sourceFloorKey: floorKey, sourceFloorLabel: meshProfile.source.floorLabel,
      sourceReference: 'R1', sourceHandle: 'SYNTHETIC-TEXT-HANDLE', sourceSHA256: meshProfile.source.originalSHA256, mappingReceiptSHA256: receipt.sha256 }],
    confidence: 'accepted', basis: 'Accepted synthetic overlay fixture.', floorKey: null, mappingStatus: 'accepted', coordinate: null });
  const device = (id: string, label: string, kind: string, mobility: NetworkOverlayDevice['mobility'], at: NetworkPlaceAssociation | null): NetworkOverlayDevice =>
    ({ id, label, kind, mobility, confidence: 'accepted', notes: 'Synthetic source note.', place: at });
  const [alpha, beta] = rooms as [SchematicRoom, SchematicRoom];
  const link = (id: string, from: string, to: string, medium: string) => ({ id, fromEndpointId: from, toEndpointId: to, kind: 'connection' as const,
    medium, confidence: 'accepted' as const, sourceConfidence: null, temporalStatus: 'current', recordedAtPrecision: null,
    basis: 'Synthetic source record.', recordedAt: null, notes: 'Logical association only.', path: null });
  return { viewKey,
    source: { label: 'Synthetic network records', revision: null, recordedAt: null, retrievedAt: null, status: 'recorded', acceptedAt: null,
      coverage: 'partial', notes: 'Generated for fixtures; no real network.', roomMappingReceipt: receipt },
    devices: [
      device('syn-gateway', 'Synthetic gateway', 'router', 'fixed', place(alpha, 'Shelf 1')),
      device('syn-switch', 'Synthetic switch', 'switch', 'fixed', place(alpha, 'Shelf 2')),
      device('syn-access-point', 'Synthetic access point', 'access-point', 'fixed', place(beta, 'Ceiling')),
      device('syn-phone', 'Synthetic phone', 'phone', 'mobile', null),
      device('syn-unrecorded', 'Synthetic unrecorded switch', 'switch', 'fixed', null),
    ],
    endpoints: [
      { id: 'syn-if-gw-1', label: 'lan1', kind: 'interface', ownerDeviceId: 'syn-gateway', notes: '' },
      { id: 'syn-if-gw-2', label: 'lan2', kind: 'interface', ownerDeviceId: 'syn-gateway', notes: '' },
      { id: 'syn-if-sw', label: 'uplink', kind: 'interface', ownerDeviceId: 'syn-switch', notes: '' },
      { id: 'syn-if-ap', label: 'eth0', kind: 'interface', ownerDeviceId: 'syn-access-point', notes: '' },
    ],
    links: [link('syn-link-gw-ap', 'syn-if-gw-1', 'syn-if-ap', 'ethernet'), link('syn-link-gw-sw', 'syn-if-gw-2', 'syn-if-sw', 'ethernet'),
      link('syn-link-ap-phone', 'syn-if-ap', 'syn-phone', 'wifi')],
  };
}

/** Fake scene host: a current association for SCENE_BUILDING only, a read-only
 * association client (no binding, so nothing can be prepared or saved) and a
 * drawing client with no drawings. */
export function createSyntheticSceneHost(scope: Scope, delayMs: number): NativeSceneHost {
  const frames = new Set<NativeSceneSourceFrame>();
  const receiptReady = hex(new TextEncoder().encode(RECEIPT_JSON)).then(sha256 => ({ id: 'synthetic-room-receipt', sha256 }));
  const selectionFor = async (geometry: NativeGeometryFrame): Promise<NativeSceneSourceSelection> => {
    const receipt = await receiptReady, floorKey = geometry.floors[0]!.key;
    return { sessionIdentity: Object.freeze({}), workspaceId: scope.workspaceId, homeId: scope.homeId, buildingId: geometry.descriptor.buildingId,
      viewKey: geometry.viewKey, expiresAt: '2099-01-01T00:00:00Z', sceneEvidenceId: U(710), sceneAssetId: U(711),
      sceneOriginalSha256: 'c'.repeat(64), sceneEvidenceRevision: 1, sceneAssetRevision: ONE,
      acceptedRoomReceiptId: receipt.id, acceptedRoomReceiptSha256: receipt.sha256,
      acceptedRoomAnchors: sceneRooms(floorKey, receipt).map(room => ({ id: room.sourceAnchorIds[0]!, sourceFloorKey: floorKey,
        sourceOriginalSha256: meshProfile.source.originalSHA256, targets: [{ packagePlaceKey: room.packagePlaceKey, packagePlaceUuid: room.packagePlaceUuid }],
        unresolvedLabels: [] })),
      sourceFloorBindings: [] };
  };
  const associations: SceneAssociationClient = {
    getBinding: () => null, canCreate: () => false, subscribe: () => () => {}, pending: () => [], isPreparedCurrent: () => false,
    async readCurrent(buildingId, geometry, signal): Promise<SceneAssociationRead> {
      await wait(delayMs, signal);
      if (buildingId !== SCENE_BUILDING) return { status: 'unavailable', reason: 'no-current-association' };
      return { status: 'available', recordId: U(712), revision: ONE, payload: {}, selection: await selectionFor(geometry) };
    },
    capturePrevious: unavailable, validatePrevious: unavailable, prepare: unavailable, submit: unavailable, resolve: unavailable,
    releasePrepared: () => {}, dispose: () => {},
  };
  const drawings: NativeEvidenceDocumentClient = { open: unavailable, isCurrent: () => false, getBlob: () => null,
    subscribeInvalidation: (_frame, changed) => { changed(); return () => {}; }, release: () => {}, dispose: () => {} };
  return {
    associations, drawings,
    select: () => true,
    clear: () => {},
    sources: {
      async open(selection, geometry, signal) {
        await wait(delayMs, signal);
        const receipt = await receiptReady, floorKey = geometry.floors[0]!.key, rooms = sceneRooms(floorKey, receipt);
        const frame: NativeSceneSourceFrame = { lease: {}, viewKey: geometry.viewKey, buildingId: selection.buildingId,
          sourceEvidenceId: selection.sceneEvidenceId, sourceAssetId: selection.sceneAssetId, sourceOriginalSha256: selection.sceneOriginalSha256,
          receiptId: receipt.id, receiptSha256: receipt.sha256,
          rooms: { status: 'available', data: { rooms, regions: sceneRegions(rooms) } },
          roomSelections: rooms.map(room => ({ roomId: room.id, nativePlaceIds: [],
            selection: { viewKey: geometry.viewKey, status: 'accepted', receiptId: receipt.id, receiptSha256: receipt.sha256,
              sourceAnchorIds: room.sourceAnchorIds, targets: [{ packagePlaceKey: room.packagePlaceKey, packagePlaceUuid: room.packagePlaceUuid }], unresolvedLabels: [] } })),
          network: { status: 'available', data: sceneNetwork(geometry.viewKey, floorKey, rooms, receipt) },
          electricity: { status: 'unavailable', reason: 'not-retained' },
          electricalFixtures: { status: 'unavailable', reason: 'not-retained' },
          document: { lease: {}, evidenceId: selection.sceneEvidenceId, evidenceRevision: 1, mode: 'original-download',
            asset: { assetId: selection.sceneAssetId, revision: ONE, contentType: 'text/plain', sha256: selection.sceneOriginalSha256,
              byteSize: ONE, purpose: 'evidence-original', previewPolicy: 'download-only', sourceLicense: { status: 'unknown', reference: null },
              evidenceIds: [selection.sceneEvidenceId] } },
          geometry };
        frames.add(frame);
        return frame;
      },
      isCurrent: frame => frames.has(frame),
      subscribeInvalidation(frame, changed) { if (!frames.has(frame)) changed(); return () => {}; },
      release: frame => { frames.delete(frame); },
      dispose: () => frames.clear(),
    },
  };
}
