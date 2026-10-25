/** Runs the installed viewer's own admission on a baked GLB: the frontend's
 * closed glTF preflight plus the Unified embedded-PNG material admission, loaded
 * from frontend/src through Vite's TypeScript transform (the same way the
 * lantern tests load them). With a companion it also runs the viewer's scene
 * admission and selector binding on the loaded primitives. A bake that this
 * refuses would not load in the app. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const FRONTEND = new URL('../../../frontend/', import.meta.url);
const dataURL = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;

async function load() {
  let transformWithOxc;
  try { ({ transformWithOxc } = await import(createRequire(new URL('package.json', FRONTEND)).resolve('vite'))); }
  catch { throw new Error('The admission check needs the frontend dependencies: run `npm ci` in frontend/'); }
  const source = async (relative, replacements = {}) => {
    const file = new URL(relative, FRONTEND);
    let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname, { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
    for (const [specifier, url] of Object.entries(replacements)) code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
    return dataURL(code);
  };
  const preflightURL = await source('src/lantern/canonical-ifc/glb-preflight.ts');
  const preflight = await import(preflightURL);
  const materialURL = await source('src/lantern/canonical-ifc/embedded-png-material.ts', { './glb-preflight': preflightURL });
  const material = await import(materialURL);
  const geometryURL = await source('src/lantern/canonical-ifc/geometry.ts');
  const standard = await import(await source('src/lantern/canonical-ifc/standard-glb.ts', {
    three: new URL('node_modules/three/build/three.module.js', FRONTEND).href,
    'three/examples/jsm/loaders/GLTFLoader.js': new URL('node_modules/three/examples/jsm/loaders/GLTFLoader.js', FRONTEND).href,
    './geometry': geometryURL, './glb-preflight': preflightURL, './embedded-png-material': materialURL,
  }));
  const scene = await import(await source('src/lantern/unified-atlas/scene.ts', {
    '../canonical-ifc/geometry': geometryURL, './types': await source('src/lantern/unified-atlas/types.ts'),
  }));
  return { preflight, material, standard, scene };
}

let modules;
/** Returns the admitted work, or throws the viewer's own refusal. */
export async function admitInViewer(glb) {
  modules ??= await load();
  const { readGlbContainer, preflightGltf, STANDARD_GLB_LIMITS } = modules.preflight;
  if (glb.byteLength > STANDARD_GLB_LIMITS.bytes) throw new Error(`Overview is ${glb.byteLength} bytes; the viewer admits ${STANDARD_GLB_LIMITS.bytes}`);
  const container = readGlbContainer(glb), admission = preflightGltf(container);
  const plan = modules.material.admitEmbeddedPngMaterials(container, admission);
  return { ...admission.work, preparedBytes: plan.preparedBytes, gpuBytes: plan.gpuBytes, limits: STANDARD_GLB_LIMITS };
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** The host's read envelope for a companion and its overview, as the server
 * composes it (backend/src/http/atlas_scene.rs); pins and href are local. */
export function hostEnvelope(companion, glb) {
  const companionBytes = Buffer.from(JSON.stringify(companion)), { scope, publicationId } = companion;
  return {
    profile: 'houseatlas.unified-atlas-scene.v1', scope, selection: { revision: 0, publicationId },
    publication: { publicationId, sourceRevisionId: companion.sourceRevisionId, sourceSha256: companion.sourceSha256, semanticsSha256: sha256(companionBytes) },
    artifacts: [{ artifactId: 'model', role: 'model', contentType: 'model/gltf-binary', bytes: glb.byteLength, sha256: sha256(glb),
      href: `/api/atlas/models/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/atlas/${publicationId}/artifacts/model` }],
    ...Object.fromEntries(['frame', 'buildings', 'levels', 'rooms', 'occurrences', 'meshBindings', 'plans', 'overlayBindings', 'coverage']
      .map(key => [key, companion[key]])),
  };
}

/** Admits the companion as the app reads it, loads the GLB through the
 * viewer's standard loader exactly as UnifiedAtlas does and binds every selector to exactly one drawn
 * primitive. Returns the bound model, or throws the viewer's own refusal. */
export async function bindInViewer(glb, companion) {
  modules ??= await load();
  const envelope = hostEnvelope(companion, glb);
  const scene = modules.scene.admitAtlasScene(envelope, { scope: companion.scope, publicationId: companion.publicationId },
    Buffer.byteLength(JSON.stringify(envelope)));
  // The app's own loader path, embedded PNG decoding and source shading included.
  const loaded = await modules.standard.loadStandardGlb(glb, 'atlas', new AbortController().signal, undefined, { embeddedPngMaterials: true });
  return modules.scene.bindAtlasModel(scene, loaded);
}
