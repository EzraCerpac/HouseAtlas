import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NativeGeometryFrame, NativeGeometryReadClient } from '../native-read-types';
import { readScanMesh } from '../mesh-profile';
import { HouseScanScene } from '../presentation';
import type { PresentationFloor, SceneOverlay } from '../presentation/types';
import { useStore } from '../../state/store';
import { useTopology } from '../../topology/TopologyProvider';
import { RoomIndex } from '../../views/RoomsView';
import type { NativeGeometryWriteClient } from '../native-write-types';
import { NativeGeometryIntake, type NativeGeometryIntakeAssociation } from './NativeGeometryIntake';

const Context = createContext<NativeGeometryReadClient | undefined>(undefined);
const IntakeContext = createContext<{ readonly write: NativeGeometryWriteClient | undefined;
  readonly association: NativeGeometryIntakeAssociation | undefined }>({ write: undefined, association: undefined });
const buildingReadMessages = {
  loading: 'Loading building records…', unavailable: 'Building records could not be loaded. Reload the saved view to retry.',
  denied: 'Access to building records is denied.', expired: 'The session for this read has expired.',
  timedOut: 'Building records could not be loaded within the read deadline.', tooLarge: 'Building records exceed the read limit.',
  continuationUnavailable: 'Building records could not be continued. Reload the saved view.',
  changed: 'Building records differ between reads. Reload the saved view.',
};
export function NativeGeometryProvider({ client, writeClient, associationClient, children }: {
  readonly client: NativeGeometryReadClient | undefined; readonly children: ReactNode;
  readonly writeClient?: NativeGeometryWriteClient | undefined; readonly associationClient?: NativeGeometryIntakeAssociation | undefined;
}) {
  const intake = useMemo(() => ({ write: writeClient, association: associationClient }), [writeClient, associationClient]);
  return <Context.Provider value={client}><IntakeContext.Provider value={intake}>{children}</IntakeContext.Provider></Context.Provider>;
}
export function useNativeGeometryClient(): NativeGeometryReadClient | undefined { return useContext(Context); }

type Loaded = { readonly owner: object; readonly frame: NativeGeometryFrame; readonly floors: readonly PresentationFloor[] };
/** Uses only an actual current native descriptor and its owned mesh read port.
 * No household data, room aliases, physical transform or asset path is supplied
 * by this host presentation. The existing Rooms & places UI remains reachable. */
export function NativeScanAtlas({ client }: { readonly client: NativeGeometryReadClient }) {
  const { projection } = useStore(), topology = useTopology();
  const intake = useContext(IntakeContext);
  const view = projection.view;
  const [attempt, setAttempt] = useState(0), [overlay, setOverlay] = useState<SceneOverlay>('spaces');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [outcome, setOutcome] = useState<{ readonly owner: object; readonly status: 'loading' | 'unavailable' | 'empty' } | null>(null);
  const [denied, setDenied] = useState<NativeGeometryFrame | null>(null);
  const surface = useRef<HTMLDivElement>(null), displayed = useRef<NativeGeometryFrame | null>(null);
  const buildings = topology.status === 'ready' ? topology.index?.buildings ?? [] : [];
  const buildingId = topology.buildingId ?? (buildings.length === 1 ? buildings[0]!.id : null);
  const building = buildings.find(row => row.id === buildingId);
  const owner = useMemo(() => ({ client, view, index: topology.index, buildingId: building?.id ?? null, attempt }),
    [client, view, topology.index, building?.id, attempt]);
  const current = useRef(owner); current.current = owner;
  useEffect(() => topology.activate(), [topology.activate]);
  useEffect(() => {
    const controller = new AbortController(); let released = false;
    let unsubscribe: () => void = () => undefined;
    const live = () => !released && !controller.signal.aborted && current.current === owner;
    setLoaded(null); setDenied(null); setOutcome(null);
    if (!building || topology.status !== 'ready') return () => { released = true; controller.abort(); };
    setOutcome({ owner, status: 'loading' });
    void (async () => {
      const frame = await client.loadBuilding(building.id, controller.signal);
      if (!live()) return;
      if (!client.isCurrent(frame) || frame.descriptor.scope.workspaceId !== view.scope.workspaceId
        || frame.descriptor.scope.homeId !== view.scope.homeId || frame.descriptor.buildingId !== building.id) {
        setOutcome({ owner, status: 'unavailable' }); controller.abort(); return;
      }
      unsubscribe = client.subscribeInvalidation(frame, () => {
        // Withdraw the actual bitmap and scene controls synchronously. React's
        // queued state change is not the native lease's visibility fence.
        if (displayed.current === frame && surface.current) surface.current.hidden = true;
        if (!live()) return;
        setDenied(frame); setLoaded(null); setOutcome({ owner, status: 'unavailable' }); controller.abort();
      });
      if (!live()) return;
      if (!client.isCurrent(frame)) { setOutcome({ owner, status: 'unavailable' }); controller.abort(); return; }
      if (frame.floors.length === 0) { setOutcome({ owner, status: 'empty' }); return; }
      // A bounded presentation shows at most three export floors. Additional
      // retained floors remain explicitly counted, never silently discarded.
      const selected = frame.floors.slice(0, 3);
      let floors: readonly PresentationFloor[] = selected.map((floor, index) => ({ key: floor.key,
        label: floor.exportLabel, short: String(index + 1), profile: null }));
      for (const floor of selected) {
        try {
          const profile = await readScanMesh(frame.readPort, frame.viewKey, floor, controller.signal);
          if (!live() || !client.isCurrent(frame)) return;
          floors = floors.map(row => row.key === floor.key ? { ...row, profile } : row);
        } catch {
          if (!live() || !client.isCurrent(frame)) return;
          floors = floors.map(row => row.key === floor.key ? { ...row, unavailable: 'Scan unavailable or unsupported.' } : row);
        }
      }
      if (live() && client.isCurrent(frame)) setLoaded({ owner, frame, floors });
    })().catch(() => { if (live()) setOutcome({ owner, status: 'unavailable' }); });
    return () => { released = true; controller.abort(); unsubscribe(); };
  }, [client, owner, building, topology.status, view]);
  const observation = loaded?.owner === owner && loaded.frame !== denied && client.isCurrent(loaded.frame) ? loaded : null;
  const status = outcome?.owner === owner ? outcome.status : 'loading';
  useLayoutEffect(() => {
    displayed.current = observation?.frame ?? null;
    if (surface.current) surface.current.hidden = !observation || !client.isCurrent(observation.frame) || current.current !== owner;
  }, [client, observation, owner]);
  return <div className="native-scan-atlas">
    <div className="filter-row" role="group" aria-label="Scan building">
      {buildings.map(row => <button key={row.id} type="button" className="chip-btn" aria-pressed={building?.id === row.id}
        onClick={() => topology.chooseBuilding(row.id)}>{row.label}</button>)}
      {building && <button type="button" className="text-btn" onClick={() => setAttempt(value => value + 1)}>Refresh scans</button>}
    </div>
    {!building ? <p role="status">{topology.status !== 'ready' ? buildingReadMessages[topology.status]
      : buildings.length ? 'Select a reviewed building to read its scans.' : 'No reviewed building available for scans.'}</p>
      : observation ? <>
        <div ref={surface}>
        <HouseScanScene active viewKey={observation.frame.viewKey} floors={observation.floors} rooms={[]}
          overlay={overlay} onOverlayChange={setOverlay} renderDetails={() => overlay !== 'spaces'
            ? <p className="stage-ui scene-failure" role="status">{overlay === 'network' ? 'Network' : 'Electrical'} scene data is not available in this native read.</p> : null} />
        </div>
        {observation.frame.floors.length > 3 && <p>{observation.frame.floors.length} exported floors retained; showing the first three in native descriptor order.</p>}
      </> : <p role="status">{status === 'empty' ? 'No committed scan association for this building.'
        : status === 'unavailable' ? 'Scans are unavailable for this current session and building. Refresh scans to check again.' : 'Loading building scans…'}</p>}
    {intake.write && intake.association && <NativeGeometryIntake write={intake.write} association={intake.association}
      buildingId={building?.id ?? null} onAssociated={() => {
        if (current.current !== owner) return;
        topology.reload(); setAttempt(value => value + 1);
      }} />}
    <details><summary>Rooms &amp; places</summary><RoomIndex /></details>
  </div>;
}
