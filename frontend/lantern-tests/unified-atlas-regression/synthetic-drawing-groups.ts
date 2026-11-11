/** Generated documentary source owner for this browser fixture only. These
 * invented links exercise the real feed/projector; they confer no native authority. */
import type { UnifiedAtlasPort } from '../../src/lantern/unified-atlas/types';
import type { UnifiedAtlasOverlayAvailableFrame } from '../../integration/unified-atlas-overlay-source';
import type { NativeSceneSourceSelection } from '../../src/lantern/scans/native-scene-source-types';
import type { ElectricalFixtureData } from '../../src/lantern/overlays/electricity/fixture-types';
import { ExactDecimal } from '../../src/numeric/decimal';
import type { OverlayFeedEnvironment } from '../../src/lantern/unified-atlas/overlay-feed';
import { modelUpdatesAllowed } from '../../src/lantern/unified-atlas/model-updates';

// Test expectation for the existing feed delay; a production change must update this fixture.
const EXPECTED_REOPEN_DELAY_MS = 15_000;
/** Page-owned, generated-only scheduler and read gates; never native authority. */
export function createDrawingGroupControl() {
  let disposed = false, armed = false, consumed = false, completed = false, captured: { run: () => void; active: boolean } | null = null;
  let admitted = false, invalidated = false, failed = false;
  let admittedOwner: object | null = null, admittedCurrent: (() => boolean) | null = null, armedOwner: object | null = null;
  let houseEntered = false, studioEntered = false, houseReleased = false, studioReleased = false;
  const pending = new Set<() => void>();
  const status = (value: string) => {
    if (failed) return;
    document.documentElement.dataset.drawingGroupControl = value;
    if (value === 'error') failed = true;
  };
  const gate = (kind: 'house' | 'studio', signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    if (disposed || failed || !consumed || (kind === 'house' ? houseEntered : studioEntered)) { status('error'); reject(new Error('Generated gate unavailable')); return; }
    if (kind === 'house') houseEntered = true; else studioEntered = true;
    status(houseEntered && studioEntered ? 'both-waiting' : `${kind}-waiting`);
    let done = false;
    const cleanup = () => { signal.removeEventListener('abort', abort); pending.delete(cancel); delete releases[kind]; };
    const finish = () => { if (done) return; done = true; cleanup(); if (kind === 'house') completed = true; resolve(); };
    const cancel = () => { if (done) return; done = true; cleanup(); reject(new Error('Generated gate cancelled')); };
    const abort = () => cancel();
    pending.add(cancel); signal.addEventListener('abort', abort, { once: true });
    const release = () => { if (kind === 'house' ? houseReleased : studioReleased) finish(); };
    releases[kind] = release; release();
  });
  const releases: Partial<Record<'house' | 'studio', () => void>> = {};
  const environment: OverlayFeedEnvironment = {
    setTimeout(run, ms) {
      if (!armed) {
        if (captured && ms === EXPECTED_REOPEN_DELAY_MS) status('error');
        return globalThis.setTimeout(run, ms);
      }
      if (disposed || captured || !admitted || !invalidated || ms !== EXPECTED_REOPEN_DELAY_MS) { status('error'); throw new Error('Unexpected generated timer'); }
      captured = { run, active: true }; armed = false; status('timer-captured'); return captured;
    },
    clearTimeout(handle) {
      if (handle === captured && captured) { captured.active = false; return; }
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    subscribeOnline(changed) {
      const online = () => { if (!disposed && (armed || captured?.active || consumed)) status('error'); changed(); };
      window.addEventListener('online', online); return () => window.removeEventListener('online', online);
    },
    now: () => Date.now(), mayReadUnasked: modelUpdatesAllowed,
  };
  const command = (event: Event) => {
    const value = (event as CustomEvent).detail;
    if (value === 'arm' && !disposed && !failed && admitted && admittedOwner && admittedCurrent?.() && !armed && !captured && !consumed) { armed = true; armedOwner = admittedOwner; invalidated = false; status('armed'); }
    else if (value === 'consume' && !failed && captured?.active && !consumed) { captured.active = false; consumed = true; captured.run(); }
    else if (value === 'studio' && !failed && consumed && !studioReleased) { studioReleased = true; releases.studio?.(); status('studio-released'); }
    else if (value === 'house' && !failed && consumed && !houseReleased && studioReleased) { houseReleased = true; releases.house?.(); status('released'); }
    else if (value === 'cancel') dispose();
    else status('error');
  };
  const dispose = () => {
    if (disposed) return;
    const clean = !failed && !armed && captured !== null && !captured.active && consumed && completed
      && houseEntered && studioEntered && houseReleased && studioReleased && pending.size === 0
      && !releases.house && !releases.studio;
    disposed = true; armed = false;
    if (captured) captured.active = false;
    for (const cancel of [...pending]) cancel();
    admittedOwner = null; armedOwner = null; admittedCurrent = null;
    window.removeEventListener('synthetic-drawing-control', command);
    if (!failed) status('disposed');
    document.documentElement.dataset.drawingGroupCleanup = failed ? 'disposed-after-error' : clean ? 'disposed-clean' : 'disposed-incomplete';
  };
  window.addEventListener('synthetic-drawing-control', command);
  const createOverlays: NonNullable<UnifiedAtlasPort['createOverlays']> = async (selection, scene, building, signal) => {
    signal.throwIfAborted();
    if (consumed && !completed && building.buildingId === 'syn-building-studio') { await gate('studio', signal); signal.throwIfAborted(); return null; }
    const handle = await createSyntheticDrawingGroups(selection, scene, building, signal);
    if (!handle || building.buildingId !== 'syn-building-house') return handle;
    const owner = {};
    return { ...handle, source: { ...handle.source,
      subscribeInvalidation(frame, changed) { return handle.source.subscribeInvalidation(frame, () => {
        if (armed) { if (armedOwner === owner && admittedOwner === owner) invalidated = true; else status('error'); }
        changed();
      }); },
      async open(request, opening) {
      if (consumed && !completed) await gate('house', opening);
      opening.throwIfAborted();
      const frame = await handle.source.open(request, opening);
      opening.throwIfAborted();
      if (disposed || frame.status !== 'available' || !handle.source.isCurrent(frame)) throw new Error('Generated owner retired');
      admitted = true;
      admittedOwner = owner; admittedCurrent = () => handle.source.isCurrent(frame);
      return frame;
    } } };
  };
  return { environment, createOverlays, dispose };
}

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
