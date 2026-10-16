import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { transformWithOxc } from 'vite';
import { readSource } from './source.mjs';

const require = createRequire(import.meta.url);
const dataUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
export const dependencyUrl = name => pathToFileURL(require.resolve(name)).href;
// require.resolve('three') chooses CJS; all measured modules use the same ESM instance.
export const threeUrl = new URL('./node_modules/three/build/three.module.js', import.meta.url).href;

/** Compile only selected source modules; every runtime import must have an explicit mapping. */
export async function loadSource(root, path, observed, replacements = {}) {
  const text = readSource(root, path, observed).toString('utf8');
  let { code } = await transformWithOxc(text, path, { lang: path.endsWith('.tsx') ? 'tsx' : 'ts', target: 'esnext',
    tsconfig: false, sourcemap: false, jsx: { runtime: 'automatic' } });
  for (const [name, url] of Object.entries(replacements)) code = code.replaceAll(JSON.stringify(name), JSON.stringify(url));
  // No package/relative/network fallbacks. New imports require a reviewed harness revision.
  for (const match of code.matchAll(/(?:from\s+|import\s*\(?\s*)["']([^"']+)["']/g))
    if (!/^(data:|file:)/.test(match[1])) throw new Error('Unmapped measurement import');
  return dataUrl(code);
}
