// Test-only bundle of actual production modules; no mocked reducers/pickers/GLB loader.
import { build } from 'vite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const frontend = fileURLToPath(new URL('../../', import.meta.url));
export async function loadAPI() {
  const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-interactions-'));
  try {
    const modules = [
      'src/lantern/unified-atlas/scene.ts',
      'src/lantern/unified-atlas/runtime-overlays.ts',
      'src/lantern/canonical-ifc/geometry.ts',
      'src/lantern/canonical-ifc/standard-glb.ts',
      'src/lantern/canonical-ifc/stage-pointers.ts',
      'integration/unified-atlas-reader.ts',
      'lantern-tests/unified-atlas/synthetic-atlas.ts',
    ];
    const entry = join(scratch, 'entry.ts');
    writeFileSync(entry, modules.map(path => `export * from ${JSON.stringify(join(frontend, path))};`).join('\n'));
    const result = await build({ root: frontend, configFile: false, logLevel: 'error',
      build: { write: false, target: 'node26', minify: false, lib: { entry, formats: ['es'] } } });
    const output = Array.isArray(result) ? result[0] : result;
    const chunks = output.output.filter(item => item.type === 'chunk');
    if (chunks.length !== 1) throw new Error('Expected one self-contained test API bundle');
    const path = join(scratch, 'api.mjs');
    writeFileSync(path, chunks[0].code);
    return await import(pathToFileURL(path).href);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

export const scope = { workspaceId: '00000000-0000-4000-8000-000000000800', homeId: '00000000-0000-4000-8000-000000000801' };
export async function generatedModel(api, make = api.buildSyntheticAtlas) {
  const input = await make(scope);
  const composed = await api.composeAtlasEnvelope(input.companionBytes, input.glb, api.SYNTHETIC_ATLAS.revision);
  const calls = [];
  const selection = { owner: {}, scope, expiresAt: '2099-01-01T00:00:00Z',
    publicationId: composed.publicationId, manifestSha256: composed.manifestSha256 };
  const read = await api.readUnifiedAtlas({ selection, origin: api.SYNTHETIC_ATLAS.origin,
    signal: new AbortController().signal, isCurrent: () => true,
    transport: api.createAtlasTransport({ origin: api.SYNTHETIC_ATLAS.origin, scenePath: api.atlasScenePath(scope),
      envelopeBytes: composed.envelopeBytes, href: composed.href, glb: input.glb,
      sha256: composed.sha256, manifestSha256: composed.manifestSha256, revision: api.SYNTHETIC_ATLAS.revision, onRequest: url => calls.push(url) }) });
  const loaded = await api.loadStandardGlb(read.model, 'regression', new AbortController().signal);
  return { model: api.bindAtlasModel(read.scene, loaded), calls, composed, input };
}
