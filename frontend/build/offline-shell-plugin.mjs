import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const MIME = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', png: 'image/png', webmanifest: 'application/manifest+json' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** Seal emitted public assets only. No application/pack bytes enter this table. */
export function offlineShellPlugin() {
  const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let output, productionRoot = false;
  return { name: 'houseatlas-saved-public-shell', apply: 'build',
    config(config) {
      // Fixture-root builds keep Vite's own root/index.html default.
      if (resolve(config.root ?? process.cwd()) !== frontendRoot) return;
      return { build: { rolldownOptions: { input: {
        live: join(frontendRoot, 'index.html'), saved: join(frontendRoot, 'saved/index.html'),
      } } } };
    },
    configResolved(config) {
      productionRoot = resolve(config.root) === frontendRoot;
      output = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!productionRoot) return;
      const table = [];
      function walk(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) walk(path);
          else {
            const relative = path.slice(output.length).replaceAll('\\', '/');
            if (!(relative.startsWith('/assets/') || relative === '/saved/index.html')) continue;
            const mime = MIME[entry.name.split('.').at(-1)];
            if (!mime || statSync(path).size > 4_000_000) throw Error(`Unsupported public shell asset: ${relative}`);
            const bytes = readFileSync(path);
            table.push({ path: relative, bytes: bytes.length, sha256: hash(bytes), mime });
          }
        }
      }
      walk(output); table.sort((a, b) => a.path.localeCompare(b.path));
      if (!table.some(row => row.path === '/saved/index.html')) throw Error('Saved entry missing');
      const sourceDirectory = dirname(fileURLToPath(import.meta.url));
      const workerSource = readFileSync(join(sourceDirectory, 'offline-worker-source.js'), 'utf8');
      const rootWorkerSource = readFileSync(join(sourceDirectory, 'root-offline-worker-source.js'), 'utf8');
      // Build identity binds unmarked entry, assets and worker implementation.
      // The final marked HTML receives a separate exact SHA in the closure.
      const savedBuild = hash(JSON.stringify(table) + workerSource);
      const build = hash(savedBuild + rootWorkerSource);
      const savedPath = join(output, 'saved/index.html');
      const markedHtml = readFileSync(savedPath, 'utf8').replace('</head>', `<meta name="houseatlas-saved-shell-build" content="${build}"></head>`);
      writeFileSync(savedPath, markedHtml);
      const savedPin = table.find(row => row.path === '/saved/index.html');
      savedPin.bytes = Buffer.byteLength(markedHtml); savedPin.sha256 = hash(markedHtml);
      const worker = `const BUILD=${JSON.stringify(build)}, TABLE=${JSON.stringify(table)};\n` + workerSource;
      if (Buffer.byteLength(worker) > 4_000_000) throw Error('Public shell worker exceeds backend budget');
      writeFileSync(join(output, 'saved/service-worker.js'), worker);
      const rootWorker = `const ROOT_BUILD=${JSON.stringify(build)};\n` + rootWorkerSource;
      if (Buffer.byteLength(rootWorker) > 4_000_000) throw Error('Root entry worker exceeds backend budget');
      writeFileSync(join(output, 'offline-entry-worker.js'), rootWorker);
    },
  };
}
