/** Shipped SYNTHETIC example house: the actual LanternHost and unified Atlas
 * over the generated fictional publication used by the capture fixtures.
 * Every record, label, identifier and coordinate is invented. No session,
 * cookie, native transport, provider or account is used; all reads are
 * in-page fakes (see ./isolation). It never falls back to, or mixes with, a
 * real Home.
 *
 * `?building=<id>` opens the Atlas on one generated building
 * (`syn-building-house` or `syn-building-studio`); an unknown ID is ignored. */
import './isolation';
import { createRoot } from 'react-dom/client';
import { LanternHost } from '../src/lantern/Host';
import type { ReadyView } from '../src/app/types';
import type { SourceModelPort } from '../src/lantern/source-ports';
import type { SourceDocumentsPort } from '../src/lantern/source-documents/types';
import type { ModelOverviewSelection } from '../src/lantern/source-models/overview-types';
import { createNativeSourceDocumentReader } from '../integration/native-source-document-reader';
import { readUnifiedAtlas } from '../integration/unified-atlas-reader';
import fixture from '../lantern-tests/core-read-visual/fixture.json';
import { createSyntheticDocumentServer } from '../lantern-tests/source-host-visual/synthetic-documents';
import { createSyntheticSitePort } from '../lantern-tests/source-host-visual/synthetic-site';
import { atlasScenePath, buildSyntheticAtlas, composeAtlasEnvelope, createAtlasTransport, SYNTHETIC_ATLAS } from '../lantern-tests/unified-atlas/synthetic-atlas';

const LABEL = 'Synthetic example house';
const EXPIRES = '2099-01-01T00:00:00Z';
const scope = fixture.scope;
// The home name is the persistent label on every screen of the shell.
const view = { ...fixture.view, homeLabel: LABEL, homes: fixture.view.homes.map(home => ({ ...home, label: LABEL })) } as unknown as ReadyView;
const entry = new URLSearchParams(location.search).get('building');

// One fixed local owner for the in-page document reader; not a session.
const binding = { sessionIdentity: Object.freeze({}), expiresAt: EXPIRES, scope };
const sourceDocuments: SourceDocumentsPort = {
  createReader: () => createSyntheticDocumentServer(scope).then(server => createNativeSourceDocumentReader({
    origin: server.origin, transport: server.transport, getBinding: () => binding, subscribeBinding: () => () => {},
  })),
};

async function sourceModels(): Promise<SourceModelPort> {
  const generated = await buildSyntheticAtlas(scope);
  const composed = await composeAtlasEnvelope(generated.companionBytes, generated.glb, SYNTHETIC_ATLAS.revision);
  const transport = createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(composed.scope),
    envelopeBytes: composed.envelopeBytes, href: composed.href, glb: generated.glb, sha256: composed.sha256,
    manifestSha256: composed.manifestSha256, revision: SYNTHETIC_ATLAS.revision });
  const selection: ModelOverviewSelection = { owner: {}, scope: composed.scope, expiresAt: EXPIRES,
    publicationId: composed.publicationId, manifestSha256: composed.manifestSha256 };
  const current = () => selection, subscribe = () => () => {};
  return {
    localFiles: 'browser-only', site: createSyntheticSitePort(),
    overview: { current, subscribe, async read(_selection, signal) {
      signal.throwIfAborted();
      return { blob: new Blob([generated.glb], { type: 'model/gltf-binary' }), label: 'Synthetic unified model',
        publicationId: selection.publicationId, sourceNote: 'Generated example model.', components: [] };
    } },
    // The production reader, guards and admission against the in-page HTTPS fake.
    atlas: { current, subscribe, entryBuildingId: () => entry,
      async read(requested, signal) {
        const read = await readUnifiedAtlas({ selection: requested, signal,
          origin: SYNTHETIC_ATLAS.origin, isCurrent: () => requested === selection, transport });
        return entry === null ? read : { ...read, entryBuildingId: entry };
      } },
  };
}

const root = createRoot(document.getElementById('root')!);
void sourceModels().then(models => root.render(<LanternHost view={view}
  actions={{ reload: async () => true, switchHome: () => {}, busy: false, notice: '' }}
  nativeContent={null} sourceModels={models} sourceDocuments={sourceDocuments} />),
error => root.render(<p role="alert">{error instanceof Error ? error.message : 'The example house could not start.'}</p>));
window.addEventListener('pagehide', () => root.unmount(), { once: true });
