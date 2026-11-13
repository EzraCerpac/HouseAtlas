import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', png: 'image/png', webmanifest: 'application/manifest+json' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const EXAMPLE_WORKER = 'service-worker.js';

/** Writes `<outDir>/service-worker.js` for the example page: the exact table
 * of every other emitted example file plus the worker source. Only this
 * directory is read; the app's own build and offline shell are not touched. */
export function writeExampleWorker(outDir, base = '/example/') {
  const table = [];
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      const relative = path.slice(outDir.length + 1).replaceAll('\\', '/');
      if (relative === EXAMPLE_WORKER) continue;
      const mime = MIME[entry.name.split('.').at(-1)];
      if (!mime) throw Error(`Unsupported example file: ${relative}`);
      const bytes = readFileSync(path);
      table.push({ path: base + relative, bytes: bytes.length, sha256: hash(bytes), mime });
    }
  };
  walk(outDir);
  table.sort((a, b) => a.path.localeCompare(b.path));
  if (!table.some(row => row.path === `${base}index.html`)) throw Error('Example entry missing');
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'example-offline-worker-source.js'), 'utf8');
  const worker = `const BUILD=${JSON.stringify(hash(JSON.stringify(table) + source))}, TABLE=${JSON.stringify(table)};\n${source}`;
  if (Buffer.byteLength(worker) > 4_000_000) throw Error('Example worker exceeds backend budget');
  writeFileSync(join(outDir, EXAMPLE_WORKER), worker);
  return table;
}

/** Example pass only: runs after the bundle is written. */
export function exampleOfflinePlugin() {
  let outDir, base;
  return { name: 'houseatlas-example-offline', apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); base = config.base; },
    closeBundle() { writeExampleWorker(outDir, base); },
  };
}
