import { useState } from 'react';
import { HouseScanScene } from '../presentation';
import type { PresentationFloor, SceneLayerContext, SceneOverlay } from '../presentation/types';
import type { NativeSceneSourceFrame } from '../native-scene-source-types';
import { NetworkSceneLayer, NetworkSceneInspector, NetworkSceneSummary, networkSceneProjection } from '../../overlays/network';
import type { NetworkOverlaySelection } from '../../overlays/network';
import { ElectricityFixtureDiagram } from '../../overlays/electricity';
import type { ElectricalFixtureSheet } from '../../overlays/electricity/fixture-types';
import type { NativeEvidenceDocumentClient } from '../native-evidence-document-types';
import { NativeSceneDrawing } from './NativeSceneDrawing';
import './native-scene.css';

/** Only owner-fenced retained source data enters this presentation. Registration
 * remains separate: source-diagram glyphs are never promoted to physical pins. */
export function NativeSceneLayers({ source, floors, overlay, onOverlayChange, drawings, evidenceIds, currentSource }: {
  readonly source: NativeSceneSourceFrame; readonly floors: readonly PresentationFloor[];
  readonly overlay: SceneOverlay; readonly onOverlayChange: (overlay: SceneOverlay) => void;
  readonly drawings: NativeEvidenceDocumentClient; readonly evidenceIds: readonly string[];
  readonly currentSource: () => boolean;
}) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [networkSelection, setNetworkSelection] = useState<NetworkOverlaySelection | null>(null);
  const [records, setRecords] = useState<'devices' | 'links' | 'unplaced' | null>(null);
  const [fixturesOpen, setFixturesOpen] = useState(false);
  const [regionId, setRegionId] = useState<string | null>(null), [fixtureId, setFixtureId] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<ElectricalFixtureSheet | null>(null);
  const rooms = source.rooms.status === 'available' ? source.rooms.data.rooms : [];
  const regions = source.rooms.status === 'available' ? source.rooms.data.regions : [];
  const network = source.network.status === 'available' ? source.network.data : null;
  const fixtures = source.electricalFixtures.status === 'available' ? source.electricalFixtures.data : null;
  const packageSelection = (context: SceneLayerContext) => source.roomSelections
    .find(row => row.roomId === context.selectedRoom?.id)?.selection ?? null;
  return <HouseScanScene active viewKey={source.viewKey} floors={floors} rooms={rooms} roomRegions={regions}
    selectedRoomId={roomId} onRoomSelectionChange={room => {
      setRoomId(room?.id ?? null); setRegionId(null); setFixtureId(null); setGroup(null); setDrawing(null);
      setNetworkSelection(null); setRecords(null);
    }} overlay={overlay} onOverlayChange={value => {
      onOverlayChange(value); setFixturesOpen(false); setNetworkSelection(null); setRecords(null); setDrawing(null);
    }} renderRoomActions={() => fixtures ? <button type="button" className="chip-btn"
      onClick={() => { setFixturesOpen(true); onOverlayChange('electrical'); }}>Drawings &amp; fixtures</button> : null}
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
              if (sheet && currentSource()) setDrawing(sheet);
            }} />
          <p>Source diagrams remain historical and unregistered.</p>
        </section>}
        {overlay === 'electrical' && drawing && <NativeSceneDrawing key={drawing.id} client={drawings}
          sheet={drawing} evidenceIds={evidenceIds}
          reference={source.drawingReferences?.find(reference => reference.sheetId === drawing.id)} provenance={source.drawingProvenance}
          current={currentSource} onClose={() => setDrawing(null)} />}
      </>;
    }} />;
}
