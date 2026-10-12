/** Public synthetic presentation only. No native server, household input or provider. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

assert.equal(process.version, 'v26.10.0');
const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.argv[2] ?? resolve(root, 'docs/demo'));
await mkdir(output, { recursive: true });
const errors = [], requests = [];
let browser, server;
const deadline = setTimeout(() => { server?.kill('SIGTERM'); void browser?.close(); }, 90_000);
try {
  // CI enables Vite's colored URLs even on pipes. Keep the readiness URL plain.
  server = spawn(process.execPath, ['frontend/node_modules/vite/bin/vite.js', 'frontend', '--host', '127.0.0.1', '--port', '0'], { cwd: root, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const origin = await new Promise((done, reject) => {
    let log = '';
    server.stdout.on('data', data => { log += data; const match = log.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) done(match[0]); });
    server.stderr.on('data', data => errors.push(String(data)));
    server.once('error', reject);
    server.once('exit', code => reject(new Error(`Fixture server exited: ${code}`)));
  });
  // Playwright's default isolated headless launch uses --no-sandbox. This capture
  // is presentation evidence, separate from the sandbox-required native checks.
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce', colorScheme: 'light', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    requests.push(route.request().url());
    if (new URL(route.request().url()).origin === origin) return route.continue();
    errors.push(`External browser request: ${route.request().url()}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/lantern-tests/core-read-visual/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.topology-chips').getByRole('button', { name: /^Alpha, Atlas identity/ }).click();
  await page.getByText('Alpha: 9 locations in reviewed membership', { exact: true }).waitFor();
  assert.match(await page.locator('body').innerText(), /Elevation recorded as unknown/);
  const names = ['building', 'room', 'network'];
  await page.screenshot({ path: resolve(output, 'synthetic-building.png'), animations: 'disabled' });
  await page.getByRole('button', { name: /^Lower room, Atlas identity/ }).click();
  await page.getByRole('heading', { name: 'Lower room', exact: true }).waitFor();
  await page.screenshot({ path: resolve(output, 'synthetic-room.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await page.getByRole('button', { name: 'Network', exact: true }).click();
  await page.getByRole('button', { name: 'Load Network relations', exact: true }).click();
  await page.getByText('synthetic-link', { exact: true }).waitFor();
  assert.match(await page.locator('body').innerText(), /9007199254740993/);
  await page.screenshot({ path: resolve(output, 'synthetic-network.png'), animations: 'disabled' });
  const images = await Promise.all(names.map(async name => (await readFile(resolve(output, `synthetic-${name}.png`))).toString('base64')));
  const collageContext = await browser.newContext({ viewport: { width: 1800, height: 520 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light' });
  const collage = await collageContext.newPage();
  await collage.setContent(`<html><head><style>body{margin:0;background:#eee9df;color:#1c2638;font:20px Arial,sans-serif}header{height:65px;padding:0 24px;display:flex;align-items:center;justify-content:space-between}main{display:flex;gap:16px;padding:0 24px}figure{margin:0;width:573px}figcaption{font-size:18px;height:32px}img{width:573px;height:398px;object-fit:contain;border:1px solid #cfc5b6}</style></head><body><header><strong>HouseAtlas · SYNTHETIC demo</strong><span>Actual React UI · generated fixtures · fake reads</span></header><main>${images.map((image, i) => `<figure><figcaption>${['Reviewed building & levels', 'Room & source facts', 'Saved Network relation'][i]}</figcaption><img src="data:image/png;base64,${image}"></figure>`).join('')}</main></body></html>`);
  await collage.screenshot({ path: resolve(output, 'synthetic-collage.png'), animations: 'disabled' });
  assert.deepEqual(errors, [], 'No renderer error or external browser request allowed');
  const house = await context.newPage();
  house.on('pageerror', error => errors.push(error.message));
  await house.addInitScript(() => {
    window.syntheticDrawCalls = 0;
    for (const name of ['drawArrays', 'drawElements']) {
      const original = WebGLRenderingContext.prototype[name];
      WebGLRenderingContext.prototype[name] = function (...args) { window.syntheticDrawCalls++; return original.apply(this, args); };
    }
  });
  await house.goto(`${origin}/lantern-tests/readme-house-visual/`, { waitUntil: 'networkidle' });
  await house.evaluate(() => document.fonts.ready);
  await house.waitForFunction(() => window.syntheticDrawCalls > 0);
  await house.getByText('L1', { exact: true }).first().waitFor();
  assert(!/rendering is unavailable|Source floors are unavailable/.test(await house.locator('body').innerText()));
  const webgl = await house.locator('canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl');
    return { version: gl.getParameter(gl.VERSION), drawCalls: window.syntheticDrawCalls, pixels: [canvas.width, canvas.height] };
  });
  await house.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
  await house.screenshot({ path: resolve(output, 'synthetic-house.png'), animations: 'disabled' });
  await house.getByRole('button', { name: 'Plan', exact: true }).click();
  await house.waitForFunction(() => document.querySelector('.stage.is-plan'));
  await house.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
  await house.screenshot({ path: resolve(output, 'synthetic-plan.png'), animations: 'disabled' });
  assert.deepEqual(errors, [], 'No renderer error or external browser request allowed');
  const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const sourceDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
  const sourcePaths = ['frontend/lantern-tests/core-read-visual/main.tsx', 'frontend/lantern-tests/core-read-visual/fixture.json', 'tools/readme-media/capture.mjs', 'frontend/lantern-tests/readme-house-visual/main.tsx', 'frontend/lantern-tests/readme-house-visual/fixture.json', 'frontend/lantern-tests/readme-house-visual/index.html', 'frontend/src/lantern/Host.tsx', 'frontend/src/api/topology-client.ts', 'frontend/src/api/network-relations-client.ts', 'frontend/src/lantern/scans/mesh-profile.ts', 'frontend/src/lantern/scans/presentation/HouseScanScene.tsx', 'frontend/src/lantern/scans/presentation/SceneMeshCanvas.tsx', 'frontend/src/lantern/scans/presentation/scan-projection.ts'];
  const hashes = {};
  for (const file of [...sourcePaths, ...names.map(name => `docs/demo/synthetic-${name}.png`), 'docs/demo/synthetic-collage.png', 'docs/demo/synthetic-house.png', 'docs/demo/synthetic-plan.png']) {
    const path = file.startsWith('docs/demo/') ? resolve(output, file.split('/').at(-1)) : resolve(root, file);
    hashes[file] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  await writeFile(resolve(output, 'capture.json'), JSON.stringify({ format: 'houseatlas-synthetic-readme-media/1', synthetic: true, sourceHead, sourceDirty, node: process.version, browser: browser.version(), webgl, viewport: [1440, 1000], collage: [1800, 520], transport: 'Checked-in synthetic Responses; browser assets from owned loopback only', sandbox: 'Playwright default headless (--no-sandbox); no native sandbox qualification', checks: ['reviewed Alpha membership', 'explicit unknown elevation', 'Lower room heading', 'saved synthetic-link with exact revision token', 'generated two-floor production mesh parser and WebGL draw calls', 'generated floor plan mode', 'zero external browser requests and renderer errors'], hashes }, null, 2) + '\n');
  console.log('PASS synthetic React media: house WebGL, plan, building, room, Network, collage; no provider/native acceptance');
} finally {
  clearTimeout(deadline);
  await browser?.close();
  if (server && server.exitCode === null) {
    const stopped = new Promise(done => server.once('exit', done));
    server.kill('SIGTERM');
    await stopped;
  }
}
