// Individually selected, generated cancellation/concurrency lifecycle cases.
// Separate from ordinary positives: no network, browser, native/session owner,
// credential, persistence, security/recovery control or default broad run.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
assert.equal(process.version, 'v26.10.0');
assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--case');
const selected = process.argv[3]; assert(['decode-cancellation', 'selection-replacement'].includes(selected));
globalThis.fetch = () => { throw new Error('Generated lifecycle cases forbid external fetch'); };
const frontend = fileURLToPath(new URL('../', import.meta.url)), scratch = mkdtempSync(join(tmpdir(), 'houseatlas-material-lifecycle-'));
let h;
try {
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(join(frontend, 'lantern-tests/embedded-png-material-fixture.ts'))};\nexport { loadStandardGlb } from ${JSON.stringify(join(frontend, 'src/lantern/canonical-ifc/standard-glb.ts'))};\nexport { admitRgbPng,decodeRgbPng } from ${JSON.stringify(join(frontend, 'src/lantern/canonical-ifc/embedded-png-material.ts'))};\n`);
  const built = await build({ root: frontend, configFile: false, logLevel: 'silent', resolve: { alias: [{ find: /^react$/, replacement: join(frontend, 'lantern-tests/embedded-material-react.mjs') }] },
    build: { write: false, target: 'node26', lib: { entry, formats: ['es'] }, rolldownOptions: { external: ['react/jsx-runtime'], output: { codeSplitting: false } }, minify: false } });
  const output = Array.isArray(built) ? built[0] : built, path = join(scratch, 'case.mjs');
  writeFileSync(path, output.output.find(row => row.type === 'chunk' && row.isEntry).code.replaceAll(JSON.stringify('react/jsx-runtime'), JSON.stringify(pathToFileURL(join(frontend, 'node_modules/react/jsx-runtime.js')).href)));
  h = await import(pathToFileURL(path).href);
} finally { rmSync(scratch, { recursive: true, force: true }); }
if (selected === 'decode-cancellation') {
  const image = await h.generatedRgbPng(33, 35, true, 4), pin = h.admitRgbPng(image.png), controller = new AbortController();
  const reason = new Error('Generated PNG owner retired');
  const pending = h.decodeRgbPng(pin, controller.signal), rejected = assert.rejects(pending, error => error === reason);
  controller.abort(reason); await rejected;
  const next = await h.decodeRgbPng(pin, new AbortController().signal); assert.deepEqual(next.rgba, image.rgba);
} else {
  const fixture = await h.generatedMaterialGlb(), old = new AbortController(), current = new AbortController(), published = [];
  const read = async (controller, key) => { const result = await h.loadStandardGlb(fixture.bytes, key, controller.signal, undefined, { embeddedPngMaterials: true }); controller.signal.throwIfAborted(); published.push(key); return result; };
  const pending = read(old, 'retired'), rejected = assert.rejects(pending);
  old.abort(new Error('Generated selection replaced'));
  const next = await read(current, 'current'); await rejected;
  assert.deepEqual(published, ['current']); assert.equal(next.meshes[0].sourceMaterial.baseColorTexture.colorRole, 'srgb');
}
console.log(`PASS ${selected}: generated bounded lifecycle only; no browser or native qualification`);
