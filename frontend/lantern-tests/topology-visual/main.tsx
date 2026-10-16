/** Local-only generic visual evidence. All application fetches are stubbed. */
import { createRoot } from 'react-dom/client';
import { LanternHost } from '../../src/lantern/Host';
import type { ReadyView } from '../../src/app/types';
import { createSyntheticTopology, fixture, session } from './synthetic-topology';
// No native transport, session cookie, provider or external fallback.
globalThis.fetch = async () => new Response(null, { status: 404 });
const topology = createSyntheticTopology();
createRoot(document.getElementById('root')!).render(<LanternHost view={fixture.view as ReadyView} actions={{reload:async()=>true,switchHome:()=>{},busy:false,notice:'',
  session:{...session,signOut:async()=>{}}}} nativeContent={null} {...(new URLSearchParams(window.location.search).get('mode') === 'unavailable' ? {} : {topology})}/>);
