/** Invented documentary observations for the example only, plus the fictional
 * panel/circuit projection of ./electrical-data for its drawing group. These
 * carry no native authority, physical device coordinates or installed wiring claim. */
import type { UnifiedAtlasPort } from '../src/lantern/unified-atlas/types';
import type { UnifiedAtlasOverlayAvailableFrame } from '../integration/unified-atlas-overlay-source';
import type { NativeSceneSourceSelection } from '../src/lantern/scans/native-scene-source-types';
import type { ElectricalFixtureData } from '../src/lantern/overlays/electricity/fixture-types';
import type { NetworkLiveFacts, NetworkOverlayData } from '../src/lantern/overlays/network/types';
import { ExactDecimal } from '../src/numeric/decimal';
import { exampleElectricalInput, exampleElectricalProjection } from './electrical-data';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const createExampleOverlays: NonNullable<UnifiedAtlasPort['createOverlays']> = async (_selection, scene, building, signal) => {
  signal.throwIfAborted();
  if (building.buildingId !== 'syn-building-house' || building.nativePlaceId === null) return null;
  const rooms = ['syn-room-hall', 'syn-room-living', 'syn-room-stairs', 'syn-room-bedroom-b'].map(id => scene.rooms.find(room => room.roomId === id));
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
    // One historic drawing group spans both rooms; symbol 3 has no group (unknown).
    groups: [{ id: 'example-group-1', label: 'Fictional drawing group 1', fixtureIds: ['example-symbol-0', 'example-symbol-1', 'example-symbol-3'],
      evidenceBasis: 'historic-drawing-label', currentCircuitId: null, verifiedWiring: false }],
    regions: ['hall', 'living'].map((id, i) => ({ id, sheetId: 'example-sheet', label: `Fictional ${id}`,
      sourceOutline: [], outlineClosed: false, sourceBounds: [.1, .1, .9, .9], outlineBasis: 'untraced',
      places: [{ ...targets[i]!, label: rooms[i]!.label, basis: 'owner-reported' }], orientation: 'unregistered', physicalTransform: null })),
    fixtures: [0, 1, 2, 3].map(i => ({ id: `example-symbol-${i}`, sheetId: 'example-sheet', regionId: i < 3 ? 'hall' : 'living', clusterId: null,
      kind: 'socket', label: `Fictional symbol ${i + 1}`, glyph: 'X', source: { symbolKey: `example-symbol-${i}`,
        originalPhotoSha256: 'd'.repeat(64), renderedPhotoSha256: 'e'.repeat(64), normalizedBox: [.3, .3, .4, .4],
        normalizedPoint: [.35, .35], literalLabels: [], placementDescription: 'Fictional drawing symbol' },
      group: [0, 1, 3].includes(i) ? { id: 'example-group-1', label: 'Fictional drawing group 1', basis: 'label-adjacent', note: 'Invented drawing label; not a circuit' }
        : { id: null, label: null, basis: 'unknown', note: '' }, glyphCount: 1, fixtureCount: null,
      uncertainty: 'Current wiring is unknown', currentState: 'historic-unverified', physicalCoordinate: null, wireRoute: null })),
  };
  // Logical records only: root (Living room) <- switch (Hall) <- streaming box (Living room, tentative);
  // root <- access point (Stairs); switch <- desk computer (Bedroom, upper floor: a link across floors);
  // access point <- speaker (Living room, Wi-Fi); switch <- printer (Living room, medium not recorded);
  // tablet (moves around) and garden camera (no reviewed room) stay unplaced. The access point
  // carries invented Network source facts without reachability; the root, switch, printer and
  // desk computer carry invented collector reachability (full series; gaps; no reply; stale).
  // No cable route, coordinate or radio coverage.
  const placed = (i: number, roomLabel: string) => ({ placeId: null, sourceRoomId: `example-room-${i}`, sourcePlaceId: targets[i]!.packagePlaceKey,
    sourcePlaceUUID: targets[i]!.packagePlaceUuid, planAssociations: [{ sourceAnchorId: `example-anchor-${i}`, sourceFloorKey: 'example-floor',
      sourceFloorLabel: 'Fictional floor', sourceReference: 'Fictional record', sourceHandle: 'example-handle', sourceSHA256: floorHash,
      mappingReceiptSHA256: receipt.sha256 }], roomLabel, detail: '', confidence: 'recorded' as const, basis: 'Fictional association',
    floorKey: null, mappingStatus: 'accepted' as const, coordinate: null });
  const link = (id: string, from: string, to: string, medium: string, confidence: 'recorded' | 'tentative', notes: string,
    kind: 'connection' | 'hypothesis' = 'connection') => ({ id, fromEndpointId: from, toEndpointId: to, kind, medium, confidence, sourceConfidence: null, temporalStatus: confidence, recordedAtPrecision: null,
    basis: 'Fictional association', recordedAt: null, notes, path: null });
  const hour = (end: string, back: number) => new Date(Date.parse(end) - back * 3_600_000).toISOString().replace('.000Z', 'Z');
  /** Invented hourly means ending at `end`; null drops the hour (a gap). */
  const series = (end: string, hours: number, point: (i: number) => { latencyMs: number | null; loss: number | null } | null) =>
    Array.from({ length: hours }, (_, i) => { const p = point(i); return p && { hour: hour(end, hours - 1 - i), ...p }; })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  const reach = (n: number, externalId: string, state: 'reachable' | 'no-reply', at: string, stale: boolean, latencyMs: number | null,
    recentSeries: NonNullable<NetworkLiveFacts['recentSeries']>): NetworkLiveFacts => {
    const freshness = stale ? 'stale' as const : 'recent' as const, snapshot = hour(at, -1 / 60), retrieved = hour(at, -2 / 60);
    return { status: stale ? 'stale' : 'available', source: { workspaceId: scene.scope.workspaceId, homeId: scene.scope.homeId, sourceInstanceId: U(621),
      collectionId: 'example-reachability', sourceKind: 'network-device', externalId }, addresses: [`192.0.2.${n}`],
      observedState: [{ id: `${externalId}-reachability`, kind: 'measured-reachability', value: { state }, factAt: at, sourceSnapshotAt: snapshot,
        retrievedAt: retrieved, vantage: 'Fictional collector', invalidatedAt: null, freshness }],
      lastSeenAt: state === 'reachable' ? at : null, sourceSnapshotAt: snapshot, retrievedAt: retrieved, freshness,
      latencyMs, loss: state === 'reachable' ? 0 : 1, recentSeries };
  };
  const ms = (base: number) => (i: number) => ({ latencyMs: Math.round(base * (1 + 0.25 * Math.sin(i / 4)) * 10) / 10, loss: 0 });
  const network: NetworkOverlayData = {
    viewKey: pins.viewKey, source: { label: 'Fictional network', revision: 'example-1', recordedAt: null, retrievedAt: null,
      status: 'recorded', acceptedAt: null, coverage: 'partial', notes: 'Fictional logical records', roomMappingReceipt: receipt },
    devices: [
      { id: 'example-access-point', label: 'Fictional access point', kind: 'access point', mobility: 'fixed', confidence: 'recorded', notes: '', place: placed(2, 'Stairs'),
        liveFacts: { status: 'available', source: { workspaceId: scene.scope.workspaceId, homeId: scene.scope.homeId, sourceInstanceId: U(620),
          collectionId: 'example-devices', sourceKind: 'network-device', externalId: 'example-ap' }, addresses: ['192.0.2.10'],
          observedState: [{ id: 'example-ap-clients', kind: 'Connected clients', value: 2, factAt: '2026-01-02T08:59:00Z', sourceSnapshotAt: '2026-01-02T09:00:00Z',
            retrievedAt: '2026-01-02T09:01:00Z', vantage: 'Fictional collector', invalidatedAt: null, freshness: 'recent' }],
          lastSeenAt: '2026-01-02T08:59:00Z', sourceSnapshotAt: '2026-01-02T09:00:00Z', retrievedAt: '2026-01-02T09:01:00Z', freshness: 'recent' } },
      { id: 'example-root', label: 'Fictional network root', kind: 'router', sourceRoot: true, mobility: 'fixed', confidence: 'recorded', notes: '', place: placed(1, 'Living room'),
        liveFacts: reach(1, 'example-root', 'reachable', '2026-01-02T08:58:00Z', false, 1.4, series('2026-01-02T08:00:00Z', 48, ms(1.2))) },
      { id: 'example-switch', label: 'Fictional switch', kind: 'switch', mobility: 'fixed', confidence: 'recorded', notes: '', place: placed(0, 'Hall'),
        liveFacts: reach(2, 'example-switch', 'reachable', '2026-01-02T08:58:00Z', false, 2.1, series('2026-01-02T08:00:00Z', 48,
          i => i >= 10 && i <= 13 || i === 30 ? null : i === 40 ? { latencyMs: null, loss: null } : i === 20 ? { latencyMs: 3.2, loss: 0.25 } : ms(1.9)(i))) },
      { id: 'example-streaming-box', label: 'Fictional streaming box', kind: 'media player', mobility: 'fixed', confidence: 'tentative', notes: '', place: placed(1, 'Living room') },
      { id: 'example-desk-computer', label: 'Fictional desk computer', kind: 'computer', mobility: 'fixed', confidence: 'recorded', notes: '', place: placed(3, 'Bedroom'),
        liveFacts: reach(3, 'example-desk-computer', 'reachable', '2026-01-01T18:04:00Z', true, 12.6, series('2026-01-01T18:00:00Z', 24, ms(12))) },
      { id: 'example-speaker', label: 'Fictional speaker', kind: 'speaker', mobility: 'fixed', confidence: 'recorded', notes: '', place: placed(1, 'Living room') },
      { id: 'example-printer', label: 'Fictional printer', kind: 'printer', mobility: 'fixed', confidence: 'recorded', notes: '', place: placed(1, 'Living room'),
        liveFacts: reach(4, 'example-printer', 'no-reply', '2026-01-02T08:58:00Z', false, null, series('2026-01-02T08:00:00Z', 48,
          i => i < 36 ? ms(4)(i) : { latencyMs: null, loss: 1 })) },
      { id: 'example-tablet', label: 'Fictional tablet', kind: 'tablet', mobility: 'mobile', confidence: 'recorded', notes: '', place: null },
      { id: 'example-garden-camera', label: 'Fictional garden camera', kind: 'camera', mobility: 'fixed', confidence: 'recorded', notes: '', place: null }],
    endpoints: [], links: [
      link('example-link', 'example-access-point', 'example-root', 'ethernet', 'recorded', 'Logical association only; no cable route'),
      link('example-link-switch', 'example-switch', 'example-root', 'ethernet', 'recorded', 'Logical association only; no cable route'),
      link('example-link-box', 'example-streaming-box', 'example-switch', 'wifi', 'tentative', 'Unconfirmed; invented for the example'),
      link('example-link-desk', 'example-desk-computer', 'example-switch', 'ethernet', 'recorded', 'Logical association only; no cable route'),
      link('example-link-speaker', 'example-speaker', 'example-access-point', 'wifi', 'recorded', 'Logical association only; no radio coverage'),
      link('example-link-printer', 'example-printer', 'example-switch', '', 'recorded', 'Medium not recorded; invented for the example'),
      link('example-link-tablet', 'example-tablet', 'example-access-point', 'wifi', 'recorded', 'Logical association only'),
      link('example-link-camera', 'example-garden-camera', 'example-access-point', 'wifi', 'tentative', 'Invented for the example', 'hypothesis')],
  };
  const sceneSelection = { ...scene.scope, revision: scene.selection.revision, publicationId: scene.publication.publicationId,
    semanticsSha256: scene.publication.semanticsSha256 };
  const roomBindings = rooms.map((room, i) => ({ roomId: room!.roomId, nativePlaceId: room!.nativePlaceId!, spaceOccurrenceId: null,
    sourceRoomIds: [`example-room-${i}`], targets: [{ ...targets[i]!, sourceAnchorIds: [`example-anchor-${i}`] }],
    qualification: 'current-native-room-join' as const, anchor: { kind: 'room-summary' as const } }));
  // The panel/circuit projection names the exact ledger bytes this frame shows.
  const ledgerSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(electricalFixtures))))]
    .map(n => n.toString(16).padStart(2, '0')).join('');
  signal.throwIfAborted();
  const projection = exampleElectricalProjection(exampleElectricalInput(scene.scope, pins.viewKey, electricalFixtures, ledgerSha256, rooms[0]!.nativePlaceId!));
  const frame: UnifiedAtlasOverlayAvailableFrame = { status: 'available', lease: {}, sceneSelection, nativeBuildingId: building.nativePlaceId,
    currentSource: { recordId: U(612), revision: ExactDecimal.parse('1'), payload: {} }, sourceSelection: pins, roomBindings,
    network: { status: 'available', data: network }, electricity: { status: 'unavailable', reason: 'not-retained' },
    electricalFixtures: { status: 'available', data: electricalFixtures },
    electricalData: { ledger: { workspaceId: scene.scope.workspaceId, homeId: scene.scope.homeId, sceneEvidenceId: pins.sceneEvidenceId,
      sceneOriginalSha256: pins.sceneOriginalSha256, viewKey: pins.viewKey, sha256: ledgerSha256 }, projection, roomBindings } };
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
