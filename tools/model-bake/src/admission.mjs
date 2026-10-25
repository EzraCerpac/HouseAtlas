/** Runs the installed viewer's own admission on a baked GLB: the frontend's
 * closed glTF preflight plus the Unified embedded-PNG material admission, loaded
 * from frontend/src through Vite's TypeScript transform (the same way the
 * lantern tests load them). A bake that this refuses would not load in the app. */
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
  const material = await import(await source('src/lantern/canonical-ifc/embedded-png-material.ts', { './glb-preflight': preflightURL }));
  return { preflight, material };
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
