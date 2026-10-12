/** Compile the real native clients, not a mirrored wire implementation. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const require = createRequire(resolve(root, 'frontend/package.json'));
const digest = value => createHash('sha256').update(value).digest('hex');
const entries = Object.freeze({
  write: 'frontend/integration/native-geometry-write-client.ts',
  association: 'frontend/integration/native-geometry-association-client.ts',
  read: 'frontend/integration/native-geometry-read-client.ts',
  mesh: 'frontend/src/lantern/scans/mesh-profile.ts',
  session: 'frontend/src/app/session.ts',
  retained: 'frontend/src/api/retained-intent-client.ts',
  numeric: 'frontend/src/numeric/lossless-json.ts',
  places: 'frontend/src/api/native-place-client.ts',
  topology: 'frontend/src/api/topology-client.ts',
  schemas: 'frontend/integration/stock-schemas.ts',
  reviewed: 'frontend/integration/native-scene-reviewed-places.ts',
});
export async function loadNativeImportRuntime(extraEntries = {}) {
  if (process.version !== 'v26.10.0') throw new Error('Use the reviewed Node 26.10.0 runtime');
  for (const path of Object.values(extraEntries)) {
    if (!/^frontend\/integration\/native-scan-import-(scene|text)\.ts$/.test(path))
      throw new Error('Unlisted native import module');
  }
  const { transformWithOxc } = await import(pathToFileURL(require.resolve('vite')).href);
  const directory = await mkdtemp(resolve(tmpdir(), 'houseatlas-agent-import-runtime-'));
  await chmod(directory, 0o700);
  const selected = new Map(), pins = [];
  const compile = async (absolute, raw = false) => {
    const key = `${absolute}${raw ? '?raw' : ''}`;
    if (selected.has(key)) return selected.get(key);
    const path = absolute.slice(root.length + 1);
    if (!absolute.startsWith(root + '/') || !/^(frontend\/(src|integration)\/.*\.ts|contracts\/.*\.json|packages\/contracts\/.*\.json)$/.test(path))
      throw new Error('Native import dependency escaped its source closure');
    const bytes = await readFile(absolute);
    const file = resolve(directory, `${digest(key)}.mjs`);
    const url = pathToFileURL(file).href;
    selected.set(key, url);
    let code;
    if (path.endsWith('.json')) {
      code = `export default ${raw ? JSON.stringify(bytes.toString('utf8')) : bytes.toString('utf8')};`;
    } else {
      ({ code } = await transformWithOxc(bytes.toString('utf8'), absolute,
        { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false }));
      const imports = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*)["']([^"']+)["']/g)];
      for (const match of imports) {
        const specifier = match[1]; let destination;
        if (specifier.startsWith('.')) {
          const isRaw = specifier.endsWith('?raw');
          let dependency = resolve(dirname(absolute), isRaw ? specifier.slice(0, -4) : specifier);
          if (!/\.(ts|json)$/.test(dependency)) dependency = dependency.replace(/\.js$/, '') + '.ts';
          destination = await compile(dependency, isRaw);
        } else {
          if (!/^(ajv|ajv-formats)(\/|$)/.test(specifier)) throw new Error('Unexpected native client dependency');
          destination = pathToFileURL(require.resolve(specifier)).href;
        }
        code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(destination));
      }
      // JSON attributes belong only to JSON modules; these schemas were compiled to JS.
      code = code.replace(/(from\s*"file:[^"]+\.mjs")\s*with\s*\{\s*type:\s*"json"\s*\}/g, '$1');
      if (/\bimport\s*\(/.test(code)) throw new Error('Dynamic client import is outside the reviewed closure');
    }
    await writeFile(file, code, { flag: 'wx', mode: 0o600 });
    pins.push({ path: path + (raw ? '?raw' : ''), bytes: bytes.length,
      sha256: digest(bytes), compiledSha256: digest(code) });
    return url;
  };
  try {
    const modules = {};
    for (const [name, path] of Object.entries({ ...entries, ...extraEntries }))
      modules[name] = await import(await compile(resolve(root, path)));
    const lock = await readFile(resolve(root, 'frontend/package-lock.json'));
    return { ...modules, provenance: Object.freeze({ node: process.version, frontendLockSha256: digest(lock),
      modules: pins.sort((a, b) => a.path.localeCompare(b.path)) }),
    dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
