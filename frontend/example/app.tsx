/** SYNTHETIC example house: the actual LanternHost and unified Atlas over
 * the generated fictional publication used by the capture fixtures, with Home
 * records derived from that same publication (./household). Every record,
 * label, identifier and coordinate is invented. Application reads are
 * in-page fakes; no session credentials, native transport, provider or
 * account are used. It never falls back to, or mixes with, a real Home.
 * Loaded only by ./main after ./isolation has run.
 *
 * `building`, `floor`, `room` and `view` URL parameters name the Atlas
 * starting view (./household exampleStart; rule in docs/demo/README.md). */
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LanternHost } from '../src/lantern/Host';
import type { SourceModelPort } from '../src/lantern/source-ports';
import type { SourceDocumentsPort } from '../src/lantern/source-documents/types';
import type { ModelOverviewSelection } from '../src/lantern/source-models/overview-types';
import { createNativeSourceDocumentReader } from '../integration/native-source-document-reader';
import { readUnifiedAtlas } from '../integration/unified-atlas-reader';
import { createSyntheticDocumentServer } from '../lantern-tests/source-host-visual/synthetic-documents';
import { createSyntheticSitePort } from '../lantern-tests/source-host-visual/synthetic-site';
import { atlasScenePath, buildSyntheticAtlas, composeAtlasEnvelope, createAtlasTransport, SYNTHETIC_ATLAS } from '../lantern-tests/unified-atlas/synthetic-atlas';
import { createSyntheticDrawingGroups } from '../lantern-tests/unified-atlas-regression/synthetic-drawing-groups';
import { EXAMPLE_SCOPE as scope, exampleHomeView, exampleStart } from './household';

const EXPIRES = '2099-01-01T00:00:00Z';

// One fixed local owner for the in-page document reader; not a session.
const binding = { sessionIdentity: Object.freeze({}), expiresAt: EXPIRES, scope };
const sourceDocuments: SourceDocumentsPort = {
  createReader: () => createSyntheticDocumentServer(scope).then(server => createNativeSourceDocumentReader({
    origin: server.origin, transport: server.transport, getBinding: () => binding, subscribeBinding: () => () => {},
  })),
};

/** One generated publication feeds both the Atlas and the Home records. The
 * home name is the persistent label on every screen of the shell. */
async function example() {
  const generated = await buildSyntheticAtlas(scope);
  const composed = await composeAtlasEnvelope(generated.companionBytes, generated.glb, SYNTHETIC_ATLAS.revision);
  const transport = createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(composed.scope),
    envelopeBytes: composed.envelopeBytes, href: composed.href, glb: generated.glb, sha256: composed.sha256,
    manifestSha256: composed.manifestSha256, revision: SYNTHETIC_ATLAS.revision });
  const selection: ModelOverviewSelection = { owner: {}, scope: composed.scope, expiresAt: EXPIRES,
    publicationId: composed.publicationId, manifestSha256: composed.manifestSha256 };
  const current = () => selection, subscribe = () => () => {};
  const models: SourceModelPort = {
    site: createSyntheticSitePort(),
    // The production reader, guards and admission against the in-page HTTPS fake.
    atlas: { current, subscribe, createOverlays: createSyntheticDrawingGroups,
      async read(requested, signal) {
        const read = await readUnifiedAtlas({ selection: requested, signal,
          origin: SYNTHETIC_ATLAS.origin, isCurrent: () => requested === selection, transport });
        // A new array on every read: the Atlas applies a start once per scene, never per array.
        const start = exampleStart(generated.companion, new URLSearchParams(location.search));
        return start.length === 0 ? read : { ...read, start };
      } },
  };
  return { view: exampleHomeView(generated.companion), models };
}

// pagehide unmounts the tree, so its effects release the WebGL/WebGPU
// renderer, GLB workers and readers while the page is hidden; a page restored
// from the back/forward cache mounts a fresh tree instead of staying blank.
const element = document.getElementById('root')!;
let root: Root | null = null;
function mount() {
  const current = createRoot(element);
  root = current;
  const render = (node: ReactNode) => { if (root === current) current.render(node); };
  void example().then(({ view, models }) => render(<LanternHost view={view}
    actions={{ reload: async () => true, switchHome: () => {}, busy: false, notice: '' }}
    nativeContent={null} sourceModels={models} sourceDocuments={sourceDocuments} />),
  error => render(<p role="alert">{error instanceof Error ? error.message : 'The example house could not start.'}</p>));
}
mount();
window.addEventListener('pagehide', () => { root?.unmount(); root = null; });
window.addEventListener('pageshow', event => { if (event.persisted && root === null) mount(); });
