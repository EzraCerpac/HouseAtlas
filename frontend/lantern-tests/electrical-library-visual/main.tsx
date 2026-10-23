/** Real Library and electrical section under the existing store/topology
 * providers. Shared Host wiring belongs to the integration owner. */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { projectView } from '../../src/lantern/adapters/read';
import { StoreProvider } from '../../src/lantern/state/store';
import { TopologyProvider } from '../../src/lantern/topology/TopologyProvider';
import { LibraryView } from '../../src/lantern/views/LibraryView';
import { ElectricalLibrary } from '../../src/lantern/electrical-library/ElectricalLibrary';
import { createSyntheticElectricalLibrary } from './synthetic-electrical';
import '../../src/lantern/styles/fonts.css';
import '../../src/lantern/styles/tokens.css';
import '../../src/lantern/styles/app.css';
import '../../src/lantern/styles/panels.css';
import '../../src/lantern/styles/integration.css';

// Every application request is explicitly fake; there is no live fallback.
globalThis.fetch = async () => { throw new Error('No external fetch in this fictional fixture'); };
const fixture = await createSyntheticElectricalLibrary(new URLSearchParams(location.search).get('mode') === 'legacy' ? 'legacy' : 'pdf');
const projection = projectView(fixture.view);
Object.assign(window, { __electricalFixture: { counts: fixture.counts, pdfSha: fixture.pdfSha,
  byteSize: fixture.pdf.length, pdfEvidenceId: fixture.pdfEvidenceId, pdfAssetId: fixture.pdfAssetId } });
function Fixture() {
  const [shown, setShown] = useState(true);
  return <StoreProvider projection={projection} actions={{ reload: async () => true, switchHome: () => {}, busy: false, notice: '',
    session: { ...fixture.session, signOut: async () => {} } }}>
    <TopologyProvider client={fixture.topology}>
      <main className="lantern-host" style={{ padding: 20, height: 'auto' }}>
        <p>SYNTHETIC fixture · generated documents and fake native readers only</p>
        <button type="button" onClick={() => setShown(value => !value)}>{shown ? 'Leave Library' : 'Return to Library'}</button>
        {shown && <><LibraryView /><ElectricalLibrary port={fixture.port} /></>}
      </main>
    </TopologyProvider>
  </StoreProvider>;
}
const root = createRoot(document.getElementById('root')!); root.render(<Fixture />);
window.addEventListener('pagehide', () => root.unmount(), { once: true });
