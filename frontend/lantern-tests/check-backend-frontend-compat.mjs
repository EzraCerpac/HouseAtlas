import assert from 'node:assert/strict';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(frontend, '..');
const dist = resolve(process.argv[2] ?? join(frontend, 'dist'));
const backendSource = readFileSync(join(root, 'backend/src/main.rs'), 'utf8');
const frontendLoader = backendSource.match(/fn frontend\([\s\S]*?\n}\nfn main\(/)?.[0];
assert(frontendLoader, 'Could not locate the backend frontend loader');
const limit = Number(frontendLoader.match(/metadata\.len\(\)\s*>\s*([\d_]+)/)?.[1]?.replaceAll('_', ''));
assert(Number.isSafeInteger(limit) && limit > 0, 'Could not read backend frontend asset size limit');
const extensionBlock = frontendLoader.match(/let kind = match path\.extension\(\)[\s\S]*?\n\s*};/)?.[0];
assert(extensionBlock, 'Could not read backend frontend MIME extension allowlist');
const backendExtensions = [...extensionBlock.matchAll(/Some\("([a-z0-9]+)"\)\s*=>\s*"([^"]+)"/g)]
  .map(([, extension, mime]) => [extension, mime]);
assert.deepEqual(backendExtensions, [
  ['html', 'text/html; charset=utf-8'],
  ['js', 'text/javascript; charset=utf-8'],
  ['css', 'text/css; charset=utf-8'],
  ['woff2', 'font/woff2'],
  ['webmanifest', 'application/manifest+json'],
  ['png', 'image/png'],
], 'Backend frontend MIME policy changed; review this compatibility check');

const files = [];
function walk(directory) {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name), metadata = lstatSync(path);
    assert(!metadata.isSymbolicLink(), `Frontend output must not contain symlinks: ${relative(dist, path)}`);
    if (metadata.isDirectory()) walk(path);
    else {
      assert(metadata.isFile(), `Unsupported frontend output entry: ${relative(dist, path)}`);
      const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
      assert(backendExtensions.some(([allowed]) => allowed === extension), `Backend rejects frontend extension: ${relative(dist, path)}`);
      assert(metadata.size <= limit, `Backend rejects oversized frontend asset: ${relative(dist, path)} (${metadata.size} > ${limit})`);
      files.push(relative(dist, path));
    }
  }
}
walk(dist);
assert(files.includes('index.html'), 'Missing compiled application index');
const worker = files.find(path => /^assets\/pdf\.worker\.min-[A-Za-z0-9_-]+\.js$/.test(path));
assert(worker, 'PDF.js worker must be emitted as a backend-supported .js module');
assert(readFileSync(join(frontend, 'licenses/pdfjs-dist-LICENSE.txt'), 'utf8').includes('Apache License'), 'Keep the PDF.js license in the public source');
assert(readFileSync(join(frontend, 'licenses/pdfjs-dist-NOTICE.txt'), 'utf8').length > 0, 'Keep the PDF.js notice in the public source');
assert(!files.some(path => path.startsWith('licenses/')), 'License and notice source files must stay out of unsupported frontend output');
console.log(`Backend frontend compatibility passed: ${files.length} regular files, accepted extensions and MIME types, each <= ${limit} bytes; PDF.js worker ${worker}; license and notice remain in source.`);
