/** Generic source-only host demo for the mounted source ports: the actual
 * LanternHost with the browser-only model chooser in Atlas and native v2 source
 * Documents in Library. The production Documents reader runs unchanged against
 * a synthetic in-page transport; every other application fetch is unavailable.
 *
 * `?atlas=generated` adds the unified Atlas: the production scene reader runs
 * against a synthetic in-page HTTPS transport serving the generated
 * publication. `?atlas-scene=<path>&atlas-model=<path>` uses an externally
 * supplied companion and its GLB instead; both paths must be same-origin and
 * are read once before the stub below. Nothing is written or kept. */
import { createRoot } from 'react-dom/client';
import { LanternHost } from '../../src/lantern/Host';
import type { AtlasSessionInfo } from '../../src/app/session';
import type { ReadyView } from '../../src/app/types';
import type { SourceDocumentsPort } from '../../src/lantern/source-documents/types';
import { createNativeSourceDocumentReader } from '../../integration/native-source-document-reader';
import { readUnifiedAtlas } from '../../integration/unified-atlas-reader';
import fixture from '../core-read-visual/fixture.json';
import { createSyntheticDocumentServer } from './synthetic-documents';
import { createSyntheticSitePort } from './synthetic-site';
import { atlasScenePath, buildSyntheticAtlas, composeAtlasEnvelope, createAtlasTransport, SYNTHETIC_ATLAS } from '../unified-atlas/synthetic-atlas';
import type { SourceModelPort } from '../../src/lantern/source-ports';
import type { ModelOverviewSelection } from '../../src/lantern/source-models/overview-types';
import { StageTimings } from '../stage-timings/StageTimings';

// Kept only for the explicit same-origin fixture paths below.
const pageFetch = globalThis.fetch.bind(globalThis);
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

/** Optional unified Atlas source: generated, or an explicit same-origin pair. */
async function atlasInput(): Promise<{ readonly companionBytes: Uint8Array<ArrayBuffer>; readonly glb: Uint8Array<ArrayBuffer> } | null> {
  const params = new URLSearchParams(location.search);
  const scenePath = params.get('atlas-scene'), modelPath = params.get('atlas-model');
  if ((scenePath === null) !== (modelPath === null)) throw new Error('Give both atlas-scene and atlas-model, or neither.');
  if (scenePath !== null && modelPath !== null) {
    const read = async (path: string) => {
      const url = new URL(path, location.href);
      if (url.origin !== location.origin) throw new Error('Atlas fixture paths must be on this origin.');
      const response = await pageFetch(url, { cache: 'no-store', redirect: 'error', credentials: 'omit' });
      if (!response.ok) throw new Error(`Atlas fixture path unavailable: ${url.pathname}`);
      return new Uint8Array(await response.arrayBuffer());
    };
    const [companionBytes, glb] = await Promise.all([read(scenePath), read(modelPath)]);
    return { companionBytes, glb };
  }
  if (params.get('atlas') !== 'generated') return null;
  const generated = await buildSyntheticAtlas(scope);
  return { companionBytes: generated.companionBytes, glb: generated.glb };
}

async function sourceModels(): Promise<SourceModelPort> {
  // Browser-only model files with no electrical provider, plus one fictional
  // site publication through an in-page fake port.
  const base: SourceModelPort = { localFiles: 'browser-only', site: createSyntheticSitePort() };
  const input = await atlasInput();
  if (!input) return base;
  // The host composition the backend performs: selection revision, pins and read href.
  const composed = await composeAtlasEnvelope(input.companionBytes, input.glb, SYNTHETIC_ATLAS.revision);
  const transport = createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin, scenePath: atlasScenePath(composed.scope),
    envelopeBytes: composed.envelopeBytes, href: composed.href, glb: input.glb, sha256: composed.sha256, manifestSha256: composed.manifestSha256, revision: SYNTHETIC_ATLAS.revision });
  const selection: ModelOverviewSelection = { owner: {}, scope: composed.scope, expiresAt: '2099-01-01T00:00:00Z',
    publicationId: composed.publicationId, manifestSha256: composed.manifestSha256 };
  const current = () => selection, subscribe = () => () => {};
  return {
    ...base,
    overview: { current, subscribe, async read(_selection, signal) {
      signal.throwIfAborted();
      return { blob: new Blob([input.glb], { type: 'model/gltf-binary' }), label: 'Synthetic unified model',
        publicationId: selection.publicationId, sourceNote: 'Generated fixture model.', components: [] };
    } },
    // The production reader, guards and admission against the in-page HTTPS fake.
    atlas: { current, subscribe, read: (requested, signal) => readUnifiedAtlas({ selection: requested, signal,
      origin: SYNTHETIC_ATLAS.origin, isCurrent: () => requested === selection, transport }) },
  };
}

const root = createRoot(document.getElementById('root')!);
void sourceModels().then(models => root.render(<LanternHost view={fixture.view as ReadyView}
  actions={{ reload: async () => true, switchHome: () => {}, busy: false, notice: '',
    session: { ...session, signOut: async () => {} } }}
  nativeContent={null} sourceModels={models} sourceDocuments={sourceDocuments} />),
error => root.render(<p role="alert">{error instanceof Error ? error.message : 'The Atlas fixture could not start.'}</p>));
// Anonymous site and model stage timings, below the host and bounded.
const timings = createRoot(document.getElementById('timings')!);
timings.render(<div className="lantern-host" style={{ height: 'auto', padding: 16 }}><StageTimings areas={['site', 'model']} /></div>);
window.addEventListener('pagehide', () => { root.unmount(); timings.unmount(); }, { once: true });
