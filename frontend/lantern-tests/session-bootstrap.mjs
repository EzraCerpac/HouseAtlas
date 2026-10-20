/** Isolated actual-React fixture. No listener/browser/native/live transport.
 * --healthy is positive-only; --regression selects one reviewed named case. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, isAbsolute } from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const healthy = ['local-initial', 'proxy-initial', 'existing-session', 'host-opt-out', 'password-mode'];
const regression = ['strict-effect-setup', 'pending-remount', 'uncertain-open', 'port-replacement', 'subscription-during-open'];
const args = process.argv.slice(2);
assert(args.length === 1 && args[0] === '--healthy' || args.length === 2 && args[0] === '--regression' && regression.includes(args[1]), 'Choose only the reviewed positive group or one explicit synthetic regression');
const selected = args[0] === '--healthy' ? healthy : [args[1]];
const jsdomPath = process.env.HOUSEATLAS_TEST_JSDOM;
assert(jsdomPath && isAbsolute(jsdomPath), 'An explicitly reviewed external jsdom/lib/api.js path is required');
const { JSDOM } = await import(pathToFileURL(jsdomPath).href);
const frontend = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(frontend, '.session-bootstrap-'));
const oldFetch = globalThis.fetch;
const oldNodeEnv = process.env.NODE_ENV;
// React act is a development-only fixture API; this process builds no release.
process.env.NODE_ENV = 'development';
globalThis.fetch = async () => { throw new Error('External transport forbidden in synthetic fixture'); };
let dom;
try {
  assert.equal(typeof (await import('react')).act, 'function', 'Actual React development act is required');
  // These two generated-data modules use import.meta.url to read checked-in
  // fixtures/schema. Keep their original file identity in Node; production
  // React modules and decoder remain the actual Vite-compiled sources.
  const generatedImports = new Map([
    ['../../web/demo/fixtures.mjs', fileURLToPath(new URL('../../web/demo/fixtures.mjs', import.meta.url))],
    ['../../web/src/prepare.mjs', fileURLToPath(new URL('../../web/src/prepare.mjs', import.meta.url))],
  ]);
  const generatedData = { name: 'original-generated-data-identity', enforce: 'pre',
    resolveId(id) { const path = generatedImports.get(id); return path ? { id: path, external: true } : null; } };
  await build({ configFile: false, root: frontend, plugins: [generatedData, react()], logLevel: 'warn',
    build: { ssr: fileURLToPath(new URL('./session-bootstrap-fixture.jsx', import.meta.url)),
      outDir: scratch, emptyOutDir: true, rolldownOptions: { output: { entryFileNames: 'fixture.mjs' } } } });
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://synthetic.house.invalid/#home', pretendToBeVisual: true,
  });
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'FormData'])
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name], writable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.fetch = globalThis.fetch;
  const fixture = await import(pathToFileURL(join(scratch, 'fixture.mjs')).href);
  assert.deepEqual(fixture.healthyCases, healthy); assert.deepEqual(fixture.regressionCases, regression);
  for (const name of selected) {
    await fixture.run(name);
    assert.equal(document.body.childElementCount, 0, 'Owned React root/container cleaned');
    console.log(`PASS actual SessionApp ${name}`);
  }
} finally {
  dom?.window.close(); globalThis.fetch = oldFetch;
  if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
  rmSync(scratch, { recursive: true, force: true });
}
