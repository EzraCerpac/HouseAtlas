/** Generated presentation only: the original fictional Alder house, with the
 * same StoreProvider house override as readme-house-visual. This mounts the
 * actual App and DetailPanel; it grants no HomeBox/native authority. There is
 * no session, reader, acquisition port or admitted write. Application fetches
 * are unavailable. Use the separate source-host fixture for actual Host and
 * retained-record Search, and Saved fixtures for native-shaped room records. */
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReadyView } from '../../src/app/types';
import { App } from '../../src/lantern/App';
import { projectView } from '../../src/lantern/adapters/read';
import { NativeActions } from '../../src/lantern/components/NativeActions';
import { NativeGeometryProvider } from '../../src/lantern/scans/native-ui/NativeScanAtlas';
import { StoreProvider, useStore } from '../../src/lantern/state/store';
import { TopologyProvider } from '../../src/lantern/topology/TopologyProvider';
import { fictionalHouse } from '../readme-house-visual/house';
import fixture from '../core-read-visual/fixture.json';
import '../../src/lantern/styles/fonts.css';
import '../../src/lantern/styles/tokens.css';
import '../../src/lantern/styles/app.css';
import '../../src/lantern/styles/atlas.css';
import '../../src/lantern/styles/panels.css';
import '../../src/lantern/styles/integration.css';
import '../../src/lantern/styles/topology.css';

globalThis.fetch = async () => new Response(null, { status: 404 });
const projection = { ...projectView({ ...fixture.view, canEdit: false } as ReadyView,
  { status: 'unavailable' }, { status: 'unavailable' }), house: fictionalHouse };
const requestedRoom = new URL(location.href).searchParams.get('room');
const selectedRoom = fictionalHouse.spaces.find(room => room.id === requestedRoom)?.id ?? 'sp-workshop';
const actions = { reload: async () => false, switchHome: () => {}, nativeContent: null };

function FictionalApp() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: 'view', view: 'rooms' });
    dispatch({ type: 'select', sel: { kind: 'space', id: selectedRoom } });
  }, [dispatch]);
  return <>
    <TopologyProvider><NativeGeometryProvider client={undefined}><App /></NativeGeometryProvider></TopologyProvider>
    <NativeActions />
  </>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<StoreProvider projection={projection} actions={actions}><FictionalApp /></StoreProvider>);
window.addEventListener('pagehide', () => root.unmount(), { once: true });
