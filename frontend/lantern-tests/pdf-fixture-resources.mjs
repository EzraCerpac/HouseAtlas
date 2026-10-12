import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Check the actual fixture server, including worker module MIME and exact
 * upstream fallback bytes. This performs no browser or PDF rendering. */
export async function verifyPdfFixtureResources(files, origin, frontend) {
  const worker = [...files.keys()].find(path => /\/pdf\.worker\.min-[^/]+\.(?:mjs|js)$/.test(path));
  assert(worker, 'Fixture build must emit the PDF.js worker');
  const resources = [worker, ...['openjpeg_nowasm_fallback.js', 'jbig2_nowasm_fallback.js']
    .map(name => '/assets/pdfjs/' + name)];
  const checked = [];
  for (const path of resources) {
    assert(files.has(path), `Missing fixture PDF resource: ${path}`);
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /^text\/javascript(?:;|$)/, path);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, files.get(path), 'Fixture server preserves built resource bytes');
    const upstream = path === worker ? 'build/pdf.worker.min.mjs' : 'wasm/' + path.split('/').at(-1);
    assert.deepEqual(bytes, readFileSync(join(frontend, 'node_modules/pdfjs-dist', upstream)),
      'Fixture resource preserves upstream bytes');
    checked.push({ path, bytes: bytes.length, mime: response.headers.get('content-type') });
  }
  return checked;
}
