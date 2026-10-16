import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { HouseScanScene } from '../presentation';
import type { PresentationFloor, SceneLayerContext, SceneOverlay } from '../presentation/types';
import type { NativeSceneSourceFrame } from '../native-scene-source-types';
import { NetworkSceneLayer, NetworkSceneInspector, NetworkSceneSummary, networkSceneProjection } from '../../overlays/network';
import type { NetworkOverlaySelection } from '../../overlays/network';
import { ElectricityFixtureDiagram } from '../../overlays/electricity';
import type { ElectricalFixtureSheet } from '../../overlays/electricity/fixture-types';
import type { NativeEvidenceDocumentClient } from '../native-evidence-document-types';
import type { BuildingModel, Location, TopologyIndex } from '../../topology/model';
import { stageSpan } from '../../observability/stage-timing';
import './native-scene.css';

const NativeSceneDrawing = lazy(() => import('./NativeSceneDrawing').then(module => ({ default: module.NativeSceneDrawing })));

export interface NativeSceneTopologyOwner {
  readonly status: 'loading' | 'ready' | string;
  readonly memberStatus: 'loading' | 'ready' | string;
  readonly memberSourceStatus: string | null;
  readonly buildingId: string | null;
  readonly index: TopologyIndex | null;
  readonly model: BuildingModel | null;
}

/** Resolve an association projection only through the current selected-building
 * membership read and current active topology index. */
export function resolveNativeSceneRoomPlace(source: NativeSceneSourceFrame, roomId: string,
  owner: NativeSceneTopologyOwner): readonly Location[] {
  if (owner.status !== 'ready' || owner.memberStatus !== 'ready' || owner.memberSourceStatus !== 'current'
    || owner.index?.data.sourceStatuses.length !== 4 || owner.index.data.sourceStatuses.some(status => status !== 'current')
    || owner.buildingId !== source.buildingId
    || !owner.index || !owner.model) return [];
  const projected = source.roomSelections.find(row => row.roomId === roomId)?.nativePlaceIds ?? [];
  const memberIds = new Set([owner.model.building.id, ...owner.model.levels.flatMap(level =>
    [level.location.id, ...level.members.map(member => member.id)]), ...owner.model.direct.map(location => location.id)]);
  const resolved = new Map<string, Location>();
  for (const item of projected) {
    if (item.atlasPlaceId === null || !memberIds.has(item.atlasPlaceId)) continue;
    const location = owner.index.locations.get(item.atlasPlaceId);
    if (location?.semantics.length === 1 && location.semantics[0]!.payload.semanticKind !== 'building')
      resolved.set(location.id, location);
  }
  return Object.freeze([...resolved.values()]);
}

export function NativeScenePlaceDetails({ room, places, selectedPlaceId, onSelect, onClear }: {
  readonly room: string; readonly places: readonly Location[]; readonly selectedPlaceId: string | null;
  readonly onSelect: (placeId: string) => void; readonly onClear: () => void;
}) {
  return <section className="native-scene-place-details" aria-label="Atlas place details">
    <h3>{room} · Atlas places</h3>
    <ul>{places.map(place => {
      const selected = selectedPlaceId === place.id;
      return <li key={place.id}>
        <h4>{place.label}</h4>
        <details><summary>Saved record</summary><code>{place.id}</code></details>
        <p>Reviewed as {place.semantics.map(item => item.payload.semanticKind).join(', ')}</p>
        <button type="button" className="chip-btn" aria-label={`${selected ? 'Selected' : 'Select'} Atlas place: ${place.label}`} aria-pressed={selected} onClick={() => onSelect(place.id)}>
          {selected ? 'Selected Atlas place' : 'Select Atlas place'}
        </button>
        {selected && <button type="button" className="chip-btn" onClick={onClear}>Clear selected place</button>}
      </li>;
    })}</ul>
  </section>;
}

/** A direct room action requires one owner-reported sheet and its independently
 * reviewed current PDF reference. A room label or source path grants nothing. */
export function correlatedRoomDrawing(source: NativeSceneSourceFrame, roomId: string,
  evidenceIds: readonly string[]): ElectricalFixtureSheet | null {
  if (source.rooms.status !== 'available' || source.electricalFixtures.status !== 'available') return null;
  const room = source.rooms.data.rooms.find(item => item.id === roomId);
  const selection = source.roomSelections.find(item => item.roomId === roomId)?.selection;
  const fixtures = source.electricalFixtures.data;
  if (!room || selection?.status !== 'accepted' || selection.viewKey !== source.viewKey
    || !fixtures.roomMappingReceipt || selection.receiptId !== fixtures.roomMappingReceipt.id
    || selection.receiptSha256 !== fixtures.roomMappingReceipt.sha256
    || !selection.targets.some(target => target.packagePlaceKey === room.packagePlaceKey
      && target.packagePlaceUuid === room.packagePlaceUuid)) return null;
  const sheetIds = new Set(fixtures.regions.filter(region => region.places.some(place =>
    place.basis === 'owner-reported' && place.packagePlaceKey === room.packagePlaceKey
    && place.packagePlaceUuid === room.packagePlaceUuid)).map(region => region.sheetId));
  if (sheetIds.size !== 1) return null;
  const sheet = fixtures.sheets.find(item => sheetIds.has(item.id));
  if (!sheet || !source.drawingReferences?.some(reference => reference.sheetId === sheet.id
    && reference.pdfPage === sheet.pdfPage && reference.originalPhotoSha256 === sheet.originalPhotoSha256
    && reference.renderedPhotoSha256 === sheet.renderedPhotoSha256
    && evidenceIds.includes(reference.evidenceId))) return null;
  return sheet;
}

/** Only owner-fenced retained source data enters this presentation. Registration
 * remains separate: source-diagram glyphs are never promoted to physical pins. */
export function NativeSceneLayers({ source, floors, overlay, onOverlayChange, drawings, evidenceIds, currentSource, nativePlaceForRoom }: {
  readonly source: NativeSceneSourceFrame; readonly floors: readonly PresentationFloor[];
  readonly overlay: SceneOverlay; readonly onOverlayChange: (overlay: SceneOverlay) => void;
  readonly drawings: NativeEvidenceDocumentClient; readonly evidenceIds: readonly string[];
  readonly currentSource: () => boolean;
  readonly nativePlaceForRoom: (roomId: string) => readonly Location[];
}) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [networkSelection, setNetworkSelection] = useState<NetworkOverlaySelection | null>(null);
  const [records, setRecords] = useState<'devices' | 'links' | 'unplaced' | null>(null);
  const [fixturesOpen, setFixturesOpen] = useState(false);
  const [regionId, setRegionId] = useState<string | null>(null), [fixtureId, setFixtureId] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<ElectricalFixtureSheet | null>(null);
  const [sourceActionFailure, setSourceActionFailure] = useState<{ source: NativeSceneSourceFrame; message: string } | null>(null);
  const [selectedNativePlaceId, setSelectedNativePlaceId] = useState<string | null>(null);
  // Anonymous timing from an actual room selection to the frame after it commits.
  const roomTiming = useRef<((end: { outcome: 'shown' | 'withdrawn' }) => void) | null>(null);
  useEffect(() => {
    const end = roomTiming.current;
    if (!end) return;
    if (roomId === null) { roomTiming.current = null; end({ outcome: 'withdrawn' }); return; }
    const frame = requestAnimationFrame(() => { if (roomTiming.current === end) { roomTiming.current = null; end({ outcome: 'shown' }); } });
    return () => cancelAnimationFrame(frame);
  }, [roomId]);
  useEffect(() => () => { roomTiming.current?.({ outcome: 'withdrawn' }); roomTiming.current = null; }, []);
  const rooms = source.rooms.status === 'available' ? source.rooms.data.rooms : [];
  const regions = source.rooms.status === 'available' ? source.rooms.data.regions : [];
  const network = source.network.status === 'available' ? source.network.data : null;
  const fixtures = source.electricalFixtures.status === 'available' ? source.electricalFixtures.data : null;
  const openDrawing = (sheet: ElectricalFixtureSheet) => {
    if (!currentSource()) {
      setSourceActionFailure({ source, message: 'This drawing is no longer current. Refresh scans to check again.' });
      return;
    }
    setSourceActionFailure(null);
    setDrawing(sheet);
  };
  const packageSelection = (context: SceneLayerContext) => source.roomSelections
    .find(row => row.roomId === context.selectedRoom?.id)?.selection ?? null;
  return <HouseScanScene active viewKey={source.viewKey} floors={floors} rooms={rooms} roomRegions={regions}
    selectedRoomId={roomId} onRoomSelectionChange={room => {
      if (room && room.id !== roomId) {
        roomTiming.current?.({ outcome: 'withdrawn' });
        roomTiming.current = stageSpan('scan-atlas', 'room-switch', { switch: roomId !== null });
      }
      setRoomId(room?.id ?? null); setRegionId(null); setFixtureId(null); setGroup(null); setDrawing(null); setSourceActionFailure(null);
      setNetworkSelection(null); setRecords(null); setSelectedNativePlaceId(null);
    }} overlay={overlay} onOverlayChange={value => {
      onOverlayChange(value); setFixturesOpen(false); setNetworkSelection(null); setRecords(null); setDrawing(null); setSourceActionFailure(null);
    }} renderRoomActions={room => {
      const nativePlaces = nativePlaceForRoom(room.id);
      const showNativePlaces = nativePlaces.length > 0 && !networkSelection && records === null && !fixturesOpen && !drawing;
      const roomDrawing = correlatedRoomDrawing(source, room.id, evidenceIds);
      return <>
        {showNativePlaces && <NativeScenePlaceDetails room={room.label} places={nativePlaces}
          selectedPlaceId={selectedNativePlaceId}
          onSelect={id => { if (currentSource()) setSelectedNativePlaceId(id); }}
          onClear={() => setSelectedNativePlaceId(null)} />}
        {fixtures && <button type="button" className="chip-btn"
          onClick={() => { setFixturesOpen(true); onOverlayChange('electrical'); }}>Drawings &amp; fixtures</button>}
        {roomDrawing && <button type="button" className="chip-btn" onClick={() => openDrawing(roomDrawing)}>
          Open reference drawing</button>}
        {!fixturesOpen && sourceActionFailure?.source === source && <p role="status">{sourceActionFailure.message}</p>}
      </>;
    }}
    renderLayer={context => overlay === 'network' && network ? <NetworkSceneLayer active viewKey={source.viewKey}
      data={network} anchors={context.anchors} unplacedDock={context.unplacedDock} ui={context.ui}
      selectedPackagePlaces={packageSelection(context)} selection={networkSelection} onSelectionChange={setNetworkSelection}
      onOpenUnplaced={() => setRecords('unplaced')} /> : null}
    renderDetails={context => {
      const selection = packageSelection(context);
      const placed = network ? networkSceneProjection(network, context.anchors, context.unplacedDock, context.ui, selection)
        .placed.map(item => item.device.id) : [];
      return <>
        {overlay === 'network' && <>
          <NetworkSceneSummary active viewKey={source.viewKey} data={network} placedDeviceIds={placed}
            onOpen={() => setRecords('devices')} />
          <NetworkSceneInspector active viewKey={source.viewKey} data={network} selection={networkSelection}
            records={records} placedDeviceIds={placed} selectedPackagePlaces={selection}
            onSelectionChange={setNetworkSelection} onClose={() => { setNetworkSelection(null); setRecords(null); }} />
        </>}
        {overlay === 'electrical' && !fixturesOpen && <button type="button" className="legend stage-ui native-fixture-summary"
          onClick={() => setFixturesOpen(true)}>Electrical drawings{fixtures ? ` · ${fixtures.fixtures.length} source symbols` : ' · unavailable'}</button>}
        {overlay === 'electrical' && fixturesOpen && <section className="stage-ui native-fixture-details" aria-label="Saved electrical diagrams">
          <header><button type="button" className="chip-btn" onClick={() => setFixturesOpen(false)}>Close drawings</button></header>
          <ElectricityFixtureDiagram active viewKey={source.viewKey} data={fixtures} selectedPackagePlaces={selection}
            selectedRegionId={regionId} selectedFixtureId={fixtureId} selectedGroup={group}
            onRegionChange={setRegionId} onFixtureChange={setFixtureId} onGroupChange={setGroup}
            onOpenSource={(sheetId, page) => {
              const sheet = fixtures?.sheets.find(item => item.id === sheetId && item.pdfPage === page);
              if (!sheet) {
                setSourceActionFailure({ source, message: 'The selected drawing is unavailable in this view.' });
              } else openDrawing(sheet);
            }} />
          {sourceActionFailure?.source === source && <p role="status">{sourceActionFailure.message}</p>}
          <p>Source diagrams remain historical and unregistered.</p>
        </section>}
        {drawing && <Suspense fallback={<p role="status">Opening drawing viewer…</p>}>
          <NativeSceneDrawing key={drawing.id} client={drawings}
            sheet={drawing} evidenceIds={evidenceIds}
            reference={source.drawingReferences?.find(reference => reference.sheetId === drawing.id)} provenance={source.drawingProvenance}
            current={currentSource} onClose={() => setDrawing(null)} />
        </Suspense>}
      </>;
    }} />;
}
