/** Generic source-only host demo for the mounted source ports: the actual
 * LanternHost with the browser-only model chooser in Atlas and native v2 source
 * Documents in Library. The production Documents reader runs unchanged against
 * a synthetic in-page transport; every other application fetch is unavailable. */
import { createRoot } from 'react-dom/client';
import { LanternHost } from '../../src/lantern/Host';
import type { AtlasSessionInfo } from '../../src/app/session';
import type { ReadyView } from '../../src/app/types';
import type { SourceDocumentsPort } from '../../src/lantern/source-documents/types';
import { createNativeSourceDocumentReader } from '../../integration/native-source-document-reader';
import fixture from '../core-read-visual/fixture.json';
import { createSyntheticDocumentServer } from './synthetic-documents';
import { createSyntheticSitePort } from './synthetic-site';
import type { SourceModelPort } from '../../src/lantern/source-ports';
import { StageTimings } from '../stage-timings/StageTimings';

// No real session, account, native transport, cookies or provider is consulted.
globalThis.fetch = async () => new Response(null, { status: 404 });
const session: AtlasSessionInfo = {
  schemaVersion: 1,
  actorId: '00000000-0000-4000-8000-000000000802',
  csrfToken: 'synthetic-unused',
  expiresAt: '2099-01-01T00:00:00Z',
};
const scope = fixture.scope;
// One stable synthetic owner: the allocation objects never change on this page.
const binding = { sessionIdentity: session, expiresAt: session.expiresAt, scope };
const sourceDocuments: SourceDocumentsPort = {
  createReader: () => createSyntheticDocumentServer(scope).then(server => createNativeSourceDocumentReader({
    origin: server.origin, transport: server.transport, getBinding: () => binding, subscribeBinding: () => () => {},
  })),
};

// Browser-only model files with no electrical provider, plus one fictional
// site publication through an in-page fake port.
const sourceModels: SourceModelPort = { localFiles: 'browser-only', site: createSyntheticSitePort() };

const root = createRoot(document.getElementById('root')!);
root.render(<LanternHost view={fixture.view as ReadyView}
  actions={{ reload: async () => true, switchHome: () => {}, busy: false, notice: '',
    session: { ...session, signOut: async () => {} } }}
  nativeContent={null} sourceModels={sourceModels} sourceDocuments={sourceDocuments} />);
// Anonymous site and model stage timings, below the host and bounded.
const timings = createRoot(document.getElementById('timings')!);
timings.render(<div className="lantern-host" style={{ height: 'auto', padding: 16 }}><StageTimings areas={['site', 'model']} /></div>);
window.addEventListener('pagehide', () => { root.unmount(); timings.unmount(); }, { once: true });
