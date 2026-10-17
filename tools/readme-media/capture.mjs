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
const unifiedNames = ['unified-3d', 'unified-collapsed', 'unified-plan', 'unified-phone', 'unified-phone-crowded', 'unified-phone-hall', 'unified-stacked'];
const sourceTreeExclusions = ['docs/demo/capture.json', 'docs/publication/source-manifest.json', ...['house', 'mesh', 'plan', 'building', 'room', 'network', 'collage', ...unifiedNames].map(name => `docs/demo/synthetic-${name}.png`)];
async function sourceTreeSnapshot() {
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(path => path && !sourceTreeExclusions.includes(path)).sort();
  const rows = [];
  for (const path of paths) {
    const bytes = await readFile(resolve(root, path));
    rows.push(`${path}\t${bytes.length}\t${createHash('sha256').update(bytes).digest('hex')}\n`);
  }
  return { algorithm: 'SHA256 of sorted tracked path TAB bytes TAB file-SHA256 LF', fileCount: paths.length, exclusions: sourceTreeExclusions, sha256: createHash('sha256').update(rows.join('')).digest('hex') };
}
const sourceTree = await sourceTreeSnapshot();
const errors = [], requests = [];
let browser, server;
const deadline = setTimeout(() => { server?.kill('SIGTERM'); void browser?.close(); }, 90_000);
try {
  // CI enables Vite's colored URLs even on pipes. Keep the readiness URL plain.
  server = spawn(process.execPath, [resolve(root, 'frontend/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '0'], { cwd: resolve(root, 'frontend'), env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  await house.goto(`${origin}/lantern-tests/readme-house-visual/?renderer=mesh`, { waitUntil: 'networkidle' });
  await house.evaluate(() => document.fonts.ready);
  await house.waitForFunction(() => window.syntheticDrawCalls > 0);
  // Floor tags are emitted from prepared floors, unlike the always-present controls.
  await house.waitForFunction(() => {
    const labels = [...document.querySelectorAll('.floor-tag-name')].map(node => node.textContent).sort();
    return JSON.stringify(labels) === JSON.stringify(['Synthetic lower floor', 'Synthetic upper floor']);
  });
  assert(!/rendering is unavailable|Source floors are unavailable/.test(await house.locator('body').innerText()));
  // Exercise the actual controls, return to the baseline pose, and require a
  // fresh draw after both prepared floors have committed to the renderer.
  await house.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await house.evaluate(() => { window.syntheticDrawCalls = 0; });
  await house.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await house.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
  await house.waitForFunction(() => window.syntheticDrawCalls > 0 && document.querySelector('canvas').width > 1 && document.querySelector('canvas').height > 1);
  const webgl = await house.locator('canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl');
    return { version: gl.getParameter(gl.VERSION), drawCalls: window.syntheticDrawCalls, pixels: [canvas.width, canvas.height], preparedFloors: [...document.querySelectorAll('.floor-tag-name')].map(node => node.textContent).sort() };
  });
  await house.screenshot({ path: resolve(output, 'synthetic-mesh.png'), animations: 'disabled' });
  const illustrated = await context.newPage();
  illustrated.on('pageerror', error => errors.push(error.message));
  await illustrated.goto(`${origin}/lantern-tests/readme-house-visual/`, { waitUntil: 'networkidle' });
  await illustrated.evaluate(() => document.fonts.ready);
  await illustrated.waitForFunction(() => document.querySelectorAll('svg.model > g.floor').length === 3 && document.querySelectorAll('svg.model .furniture').length > 0);
  await illustrated.getByRole('button', { name: 'Kitchen', exact: true }).click();
  await illustrated.getByRole('heading', { name: 'Kitchen', exact: true }).waitFor();
  assert.match(await illustrated.locator('body').innerText(), /Fictional belongings/);
  await illustrated.mouse.move(1430, 10);
  await illustrated.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done))));
  });
  const illustrationSvgSha256 = createHash('sha256').update(await illustrated.locator('svg.model').evaluate(node => node.outerHTML)).digest('hex');
  await illustrated.screenshot({ path: resolve(output, 'synthetic-house.png'), animations: 'disabled' });
  await illustrated.getByRole('button', { name: 'Plan', exact: true }).click();
  await illustrated.waitForFunction(() => document.querySelector('.stage.is-plan'));
  await illustrated.locator('.legend > button').click();
  await illustrated.mouse.move(1430, 10);
  await illustrated.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
  await illustrated.screenshot({ path: resolve(output, 'synthetic-plan.png'), animations: 'disabled' });
  assert.deepEqual(errors, [], 'No renderer error or external browser request allowed');

  // Unified Atlas: the generated fictional publication through the production
  // reader, LanternHost and UnifiedAtlas. The external atlas-scene/atlas-model
  // parameters are never used here. Reduced motion captures settled states only.
  const unifiedEntry = '/lantern-tests/source-host-visual/?atlas=generated';
  const atlas = await context.newPage();
  atlas.on('pageerror', error => errors.push(error.message));
  await atlas.addInitScript(() => {
    window.syntheticAtlasDrawCalls = 0;
    for (const name of ['drawArrays', 'drawElements']) {
      const original = WebGLRenderingContext.prototype[name];
      WebGLRenderingContext.prototype[name] = function (...args) { window.syntheticAtlasDrawCalls++; return original.apply(this, args); };
    }
  });
  await atlas.goto(`${origin}${unifiedEntry}`, { waitUntil: 'networkidle' });
  await atlas.evaluate(() => document.fonts.ready);
  assert.equal(await atlas.locator('nav.navrail .nav-btn[aria-current="page"] .nav-label').textContent(), 'Atlas');
  const shell = atlas.locator('section.ua-shell.is-stage[aria-label="Atlas"]');
  await shell.waitFor();
  // Real drawing is required; the 3D-unavailable note is reported, never captured.
  const firstDraw = await atlas.waitForFunction(() => window.syntheticAtlasDrawCalls > 0 ? 'drawn'
    : document.querySelector('.ua-viewport .cifc-stage-note')?.textContent || false);
  assert.equal(await firstDraw.jsonValue(), 'drawn', 'Unified Atlas WebGL must draw before capture');
  const frames = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
  // Normal keyboard use of the compact disclosure, without changing source.
  const sourceDisclosure = async () => {
    const menu = atlas.locator('details.atlas-source-details'), summary = menu.locator(':scope > summary');
    await summary.focus(); await summary.press('Enter');
    assert.equal(await menu.evaluate(node => node.open), true);
    await menu.locator('nav button').last().focus(); await atlas.keyboard.press('Tab');
    assert.equal(await menu.evaluate(node => node.open), false, 'The menu closes before focus enters stage controls');
    await summary.focus(); await summary.press('Enter');
    await menu.locator('nav button').first().focus(); await atlas.keyboard.press('Escape');
    assert.equal(await menu.evaluate(node => node.open), false);
    assert.equal(await summary.evaluate(node => document.activeElement === node), true, 'Escape returns focus to the source summary');
    return { closedAfterTab: true, closedAfterEscape: true, focusReturned: true };
  };
  const desktopDisclosure = await sourceDisclosure();
  // Zoom in, then Fit view back to the baseline pose; a draw must follow the fit.
  const settledDraw = async page => {
    await shell.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await frames(page);
    await page.evaluate(() => { window.syntheticAtlasDrawCalls = 0; });
    await shell.getByRole('button', { name: 'Fit view', exact: true }).click();
    await frames(page);
    await page.waitForFunction(() => window.syntheticAtlasDrawCalls > 0);
  };
  const atlasFacts = () => atlas.evaluate(() => {
    const text = selector => document.querySelector(selector)?.textContent?.trim() ?? null;
    const names = selector => [...document.querySelectorAll(selector)].map(node => node.getAttribute('aria-label') ?? node.textContent.trim());
    const pressed = selector => [...document.querySelectorAll(selector)].filter(node => node.getAttribute('aria-pressed') === 'true')
      .map(node => node.getAttribute('aria-label') ?? node.textContent.trim());
    const inspector = document.querySelector('aside.ua-inspector'), canvas = document.querySelector('.ua-viewport canvas.cifc-canvas');
    const stageBox = document.querySelector('.ua-viewport').getBoundingClientRect();
    // The current building and floor are each visible inside their own row and the stage.
    const inView = selector => {
      const row = document.querySelector(selector), current = row?.querySelector('[aria-pressed="true"]');
      if (!current) return false;
      const a = current.getBoundingClientRect(), b = row.getBoundingClientRect();
      return a.left >= Math.max(b.left, stageBox.left) - 1 && a.right <= Math.min(b.right, stageBox.right) + 1 && a.top >= stageBox.top - 1 && a.bottom <= stageBox.bottom + 1;
    };
    // Room and count buttons on the stage, measured against every visible floating panel.
    const visible = node => { const style = getComputedStyle(node); return style.display !== 'none' && style.visibility !== 'hidden'; };
    const panels = [...document.querySelectorAll('.ua-tools > *, .ua-scope > *, .ua-bottom > *')].filter(visible).map(node => node.getBoundingClientRect());
    if (getComputedStyle(inspector).position === 'absolute' && !inspector.classList.contains('is-open')) panels.push(inspector.getBoundingClientRect());
    // Conservatively include the nine-pixel pseudo-element extensions around
    // each count's border box, rather than measuring only the visible badge.
    const hitBox = node => {
      const box = node.getBoundingClientRect(), pad = node.matches('.ua-marker') ? 9 : 0;
      return { left: box.left - pad, right: box.right + pad, top: box.top - pad, bottom: box.bottom + pad };
    };
    const covered = [...document.querySelectorAll('.ua-label-hit, .ua-marker')].filter(visible).filter(node => {
      const a = hitBox(node);
      return panels.some(b => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1);
    }).map(node => node.getAttribute('aria-label'));
    // Count buttons that overlap one another, so one count never hides another.
    const counts = [...document.querySelectorAll('.ua-marker')].filter(visible).map(node => [node.getAttribute('aria-label'), hitBox(node)]);
    const crowded = counts.flatMap(([name, a], at) => counts.slice(at + 1)
      .filter(([, b]) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1).map(([other]) => `${name} / ${other}`));
    const actions = [...document.querySelectorAll('.ua-label-hit, .ua-marker')].filter(visible)
      .map(node => [node.getAttribute('aria-label'), hitBox(node)]);
    const actionCollisions = actions.flatMap(([name, a], at) => actions.slice(at + 1)
      .filter(([, b]) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1).map(([other]) => `${name} / ${other}`));
    return {
      buildingInView: inView('.ua-buildings'), floorInView: inView('.ua-ladder'), covered, crowded, actionCollisions,
      stage: document.querySelector('.ua-viewport').getAttribute('aria-label'),
      view: pressed('.ua-tools .seg button'), building: pressed('.ua-buildings button'), floor: pressed('.ua-ladder button'),
      exploded: document.querySelector('.ua-tools .ctrl-wide')?.getAttribute('aria-pressed') ?? null,
      overlay: pressed('.layer-bar button'), key: text('.ua-key-head'),
      selectedRoom: text('.ua-inspector.is-room h2'), selectedFloor: text('.ua-room-floor'),
      inspector: { label: inspector.getAttribute('aria-label'), position: getComputedStyle(inspector).position, open: inspector.classList.contains('is-open') },
      labels: names('.ua-label-hit'), markers: names('.ua-marker').sort(),
      markerKeys: [...document.querySelectorAll('.ua-marker')].filter(visible).map(node => node.dataset.stageKey).sort(),
      planRooms: document.querySelectorAll('.ua-plan .cifc-plan-space').length, planSelected: document.querySelectorAll('.ua-plan .cifc-plan-space.is-selected').length,
      canvasHidden: canvas.hidden, stageNote: text('.ua-viewport .cifc-stage-note'),
    };
  });
  const atlasWebgl = () => atlas.locator('.ua-viewport canvas.cifc-canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl');
    return { version: gl.getParameter(gl.VERSION), drawCalls: window.syntheticAtlasDrawCalls, pixels: [canvas.width, canvas.height], cssPixels: [canvas.clientWidth, canvas.clientHeight] };
  });
  // Generated identity: two buildings with floors; the boundary wall is context only.
  const buildings = (await shell.locator('nav.ua-buildings button').allTextContents()).map(name => name.trim());
  assert.deepEqual(buildings, ['All buildings', 'Synthetic house', 'Synthetic studio']);
  await shell.getByRole('navigation', { name: 'Buildings' }).getByRole('button', { name: 'Synthetic house', exact: true }).click();
  const ladder = shell.getByRole('navigation', { name: 'Floors of Synthetic house' });
  await ladder.waitFor();
  const floors = (await ladder.locator('.ua-rung-name').allTextContents()).map(name => name.trim());
  assert.deepEqual(floors, ['All floors', 'Upper floor', 'Split level', 'Ground floor']);
  const rooms = shell.getByRole('complementary', { name: 'Rooms' });
  const showRooms = rooms.getByRole('button', { name: 'Show rooms', exact: true });
  if (await showRooms.isVisible()) await showRooms.click();
  await rooms.getByRole('button', { name: 'Living room', exact: true }).click();
  await shell.getByRole('heading', { level: 2, name: 'Living room', exact: true }).waitFor();
  await ladder.getByRole('button', { name: 'Ground floor: 3 rooms, has the selected room', exact: true }).waitFor();
  await settledDraw(atlas);
  const desktop = await atlasFacts();
  assert.deepEqual([desktop.view, desktop.building, desktop.floor, desktop.exploded], [['3D'], ['Synthetic house'], ['All floors'], 'true']);
  assert.deepEqual([desktop.selectedRoom, desktop.selectedFloor, desktop.canvasHidden, desktop.stageNote], ['Living room', 'Ground floor, Synthetic house', false, null]);
  assert(desktop.labels.includes('Select room: Living room'), 'The selected room tag must be on the stage');
  const clearOfPanels = facts => {
    assert.deepEqual(facts.covered, [], 'No room or count button may sit under a floating panel');
    assert.deepEqual(facts.crowded, [], 'No count button may overlap another');
    assert.deepEqual(facts.actionCollisions, [], 'No mounted room action may overlap another room action or enlarged count target');
    assert.deepEqual([facts.buildingInView, facts.floorInView], [true, true], 'The current building and floor must be in view');
  };
  clearOfPanels(desktop);
  const desktopWebgl = await atlasWebgl();
  assert(desktopWebgl.pixels[0] > 1 && desktopWebgl.pixels[1] > 1);
  await atlas.mouse.move(1430, 10);
  await frames(atlas);
  await atlas.screenshot({ path: resolve(output, 'synthetic-unified-3d.png'), animations: 'disabled' });
  // Collapse directly from an exploded whole-building selection, before Plan
  // has supplied a floor. The selected occurrence must remain visible.
  await shell.getByRole('button', { name: 'Exploded', exact: true }).click();
  await settledDraw(atlas);
  const collapsed = await atlasFacts();
  assert.deepEqual([collapsed.view, collapsed.exploded, collapsed.floor, collapsed.selectedRoom, collapsed.selectedFloor],
    [['3D'], 'false', ['Ground floor: 3 rooms, has the selected room'], 'Living room', 'Ground floor, Synthetic house']);
  assert(collapsed.labels.includes('Select room: Living room'));
  clearOfPanels(collapsed);
  const collapsedWebgl = await atlasWebgl();
  await atlas.mouse.move(1430, 10);
  await atlas.screenshot({ path: resolve(output, 'synthetic-unified-collapsed.png'), animations: 'disabled' });
  // Plan of the selected room's floor, with the published electrical counts.
  await shell.getByRole('group', { name: 'Atlas view' }).getByRole('button', { name: 'Plan', exact: true }).click();
  await atlas.waitForFunction(() => document.querySelector('.ua-shell.is-plan .ua-plan') && document.querySelector('.ua-viewport canvas.cifc-canvas').hidden);
  await shell.getByRole('group', { name: 'Overlay' }).getByRole('button', { name: 'Electrical', exact: true }).click();
  await shell.getByRole('button', { name: 'Hall: 3 electrical records', exact: true }).waitFor();
  await atlas.mouse.move(1430, 10);
  await frames(atlas);
  const plan = await atlasFacts();
  assert.equal(plan.stage, 'Plan of Ground floor, Synthetic house. Arrow keys pan, plus and minus zoom, Escape clears the room.');
  assert.deepEqual([plan.view, plan.overlay, plan.markers, plan.planRooms, plan.planSelected, plan.stageNote],
    [['Plan'], ['Electrical'], ['Hall: 3 electrical records', 'Living room: 1 electrical record'], 3, 1, null]);
  clearOfPanels(plan);
  const planSvgSha256 = createHash('sha256').update(await atlas.locator('.ua-viewport svg.cifc-svg').evaluate(node => node.outerHTML)).digest('hex');
  await atlas.screenshot({ path: resolve(output, 'synthetic-unified-plan.png'), animations: 'disabled' });
  // Phone width: the same selection in 3D with the room panel as a closed sheet.
  await atlas.evaluate(() => { window.syntheticAtlasDrawCalls = 0; });
  await shell.getByRole('group', { name: 'Atlas view' }).getByRole('button', { name: '3D', exact: true }).click();
  await atlas.waitForFunction(() => !document.querySelector('.ua-viewport canvas.cifc-canvas').hidden && window.syntheticAtlasDrawCalls > 0);
  await settledDraw(atlas);
  await atlas.setViewportSize({ width: 390, height: 844 });
  await frames(atlas);
  const phoneDisclosure = await sourceDisclosure();
  await settledDraw(atlas);
  await shell.getByRole('button', { name: 'Show details', exact: true }).waitFor();
  await atlas.mouse.move(385, 5);
  await frames(atlas);
  const phone = await atlasFacts();
  assert.deepEqual([phone.view, phone.overlay, phone.selectedRoom, phone.stageNote], [['3D'], ['Electrical'], 'Living room', null]);
  assert.deepEqual(phone.inspector, { label: 'Selected room', position: 'absolute', open: false });
  assert.deepEqual([phone.building, phone.floor], [['Synthetic house'], ['Ground floor: 3 rooms, has the selected room']]);
  assert.deepEqual(phone.markers, ['Hall: 3 electrical records', 'Living room: 1 electrical record']);
  assert.deepEqual(phone.markerKeys, ['marker:electrical:syn-occ-hall', 'marker:electrical:syn-occ-living']);
  assert.match(phone.key, /4 records/);
  clearOfPanels(phone);
  const phoneWebgl = await atlasWebgl();
  await atlas.screenshot({ path: resolve(output, 'synthetic-unified-phone.png'), animations: 'disabled' });
  // Normal modified-wheel zoom preserves keyboard focus on Hall while its full
  // target collides with selected Living. Culling must recover focus honestly.
  await shell.getByRole('button', { name: 'Hall: 3 electrical records', exact: true }).focus();
  const scrollBefore = await atlas.evaluate(() => [scrollX, scrollY]);
  const viewport = atlas.locator('.ua-viewport'), viewportBox = await viewport.boundingBox();
  await atlas.mouse.move(viewportBox.x + viewportBox.width / 2, viewportBox.y + viewportBox.height / 2);
  await atlas.evaluate(() => { window.syntheticAtlasDrawCalls = 0; });
  await atlas.keyboard.down('Control');
  await atlas.mouse.wheel(0, 200);
  await atlas.keyboard.up('Control');
  await frames(atlas);
  await atlas.waitForFunction(() => window.syntheticAtlasDrawCalls > 0);
  await atlas.waitForFunction(() => !document.querySelector('.ua-marker[aria-label="Hall: 3 electrical records"]')
    && document.activeElement === document.querySelector('.ua-viewport'));
  const phoneCrowded = await atlasFacts();
  assert.deepEqual(phoneCrowded.markers, ['Living room: 1 electrical record']);
  assert.deepEqual(phoneCrowded.markerKeys, ['marker:electrical:syn-occ-living']);
  assert.match(phoneCrowded.key, /4 records/);
  clearOfPanels(phoneCrowded);
  assert.equal(await viewport.evaluate(node => document.activeElement === node), true, 'A culled focused badge returns focus to the viewport');
  assert.deepEqual(await atlas.evaluate(() => [scrollX, scrollY]), scrollBefore, 'Focus recovery does not scroll the page');
  const phoneCrowdedWebgl = await atlasWebgl();
  await atlas.mouse.move(385, 5);
  await atlas.screenshot({ path: resolve(output, 'synthetic-unified-phone-crowded.png'), animations: 'disabled' });
  await shell.getByRole('button', { name: 'Clear room', exact: true }).click();
  await shell.getByRole('button', { name: 'Show rooms', exact: true }).click();
  await atlas.evaluate(() => { window.syntheticAtlasDrawCalls = 0; });
  await shell.getByRole('complementary', { name: 'Rooms' }).getByRole('button', { name: 'Hall', exact: true }).click();
  await frames(atlas);
  await atlas.waitForFunction(() => window.syntheticAtlasDrawCalls > 0);
  const phoneHall = await atlasFacts();
  assert.deepEqual([phoneHall.selectedRoom, phoneHall.markers], ['Hall', ['Hall: 3 electrical records']]);
  assert.deepEqual(phoneHall.markerKeys, ['marker:electrical:syn-occ-hall']);
  assert.match(phoneHall.key, /4 records/);
  clearOfPanels(phoneHall);
  const phoneHallWebgl = await atlasWebgl();
  await atlas.screenshot({ path: resolve(output, 'synthetic-unified-phone-hall.png'), animations: 'disabled' });
  await shell.getByRole('button', { name: 'Show details', exact: true }).click();
  const references = shell.getByRole('complementary', { name: 'Selected room' }).locator('.ua-record').filter({ has: atlas.getByRole('heading', { name: 'Electrical', exact: true }) });
  await references.getByText('Record references', { exact: true }).click();
  assert.deepEqual(await references.locator('.ua-refs li').allTextContents(), ['syn-circuit-1', 'syn-outlet-1', 'syn-outlet-2']);
  await shell.getByRole('button', { name: 'Hide details', exact: true }).click();
  // A stacked whole-building Network view exercises the two Stairs occurrences.
  await atlas.setViewportSize({ width: 1440, height: 1000 });
  await shell.getByRole('button', { name: 'Clear room', exact: true }).click();
  await shell.getByRole('complementary', { name: 'Rooms' }).getByRole('region', { name: 'Ground floor, Synthetic house', exact: true })
    .getByRole('button', { name: 'Stairs', exact: true }).click();
  await ladder.getByRole('button', { name: 'All floors', exact: true }).click();
  await shell.getByRole('group', { name: 'Overlay' }).getByRole('button', { name: 'Network', exact: true }).click();
  await settledDraw(atlas);
  await viewport.focus();
  await atlas.evaluate(() => { window.syntheticAtlasDrawCalls = 0; });
  for (let i = 0; i < 6; i++) await viewport.press('ArrowUp');
  for (let i = 0; i < 4; i++) await viewport.press('-');
  await frames(atlas);
  await atlas.waitForFunction(() => window.syntheticAtlasDrawCalls > 0);
  const stacked = await atlasFacts();
  assert.deepEqual([stacked.exploded, stacked.floor, stacked.selectedRoom, stacked.selectedFloor],
    ['false', ['All floors'], 'Stairs', 'Ground floor, Synthetic house']);
  assert.deepEqual(stacked.markers, ['Stairs: 1 network record']);
  assert.deepEqual(stacked.markerKeys, ['marker:network:syn-occ-stairs-ground']);
  assert.match(stacked.key, /1 record/);
  clearOfPanels(stacked);
  const stackedWebgl = await atlasWebgl();
  await atlas.mouse.move(1430, 10);
  await atlas.screenshot({ path: resolve(output, 'synthetic-unified-stacked.png'), animations: 'disabled' });
  assert.deepEqual(errors, [], 'No renderer error or external browser request allowed');
  const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const sourceDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
  assert.deepEqual(await sourceTreeSnapshot(), sourceTree, 'Tracked capture source must remain unchanged throughout capture');
  const sourcePaths = ['frontend/lantern-tests/core-read-visual/main.tsx', 'frontend/lantern-tests/core-read-visual/fixture.json', 'tools/readme-media/capture.mjs', 'frontend/lantern-tests/readme-house-visual/main.tsx', 'frontend/lantern-tests/readme-house-visual/house.ts', 'frontend/lantern-tests/readme-house-visual/demo.css', 'frontend/src/lantern/atlas/Model.tsx', 'frontend/src/lantern/atlas/AtlasView.tsx', 'frontend/lantern-reference/HouseAtlas-Lantern-B-Source.zip', 'frontend/lantern-tests/readme-house-visual/fixture.json', 'frontend/lantern-tests/readme-house-visual/index.html', 'frontend/src/lantern/Host.tsx', 'frontend/src/api/topology-client.ts', 'frontend/src/api/network-relations-client.ts', 'frontend/src/lantern/scans/mesh-profile.ts', 'frontend/src/lantern/scans/presentation/HouseScanScene.tsx', 'frontend/src/lantern/scans/presentation/SceneMeshCanvas.tsx', 'frontend/src/lantern/scans/presentation/scan-projection.ts'];
  const hashes = {};
  for (const file of [...sourcePaths, ...names.map(name => `docs/demo/synthetic-${name}.png`), 'docs/demo/synthetic-collage.png', 'docs/demo/synthetic-house.png', 'docs/demo/synthetic-mesh.png', 'docs/demo/synthetic-plan.png']) {
    const path = file.startsWith('docs/demo/') ? resolve(output, file.split('/').at(-1)) : resolve(root, file);
    hashes[file] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  const unifiedSourcePaths = ['tools/readme-media/capture.mjs', 'frontend/lantern-tests/source-host-visual/index.html', 'frontend/lantern-tests/source-host-visual/main.tsx', 'frontend/lantern-tests/source-host-visual/synthetic-site.ts', 'frontend/lantern-tests/source-host-visual/synthetic-documents.ts', 'frontend/lantern-tests/unified-atlas/synthetic-atlas.ts', 'frontend/integration/unified-atlas-reader.ts', 'frontend/src/lantern/Host.tsx', 'frontend/src/lantern/atlas/AtlasView.tsx', 'frontend/src/lantern/atlas/useCamera.ts', 'frontend/src/lantern/unified-atlas/UnifiedAtlas.tsx', 'frontend/src/lantern/unified-atlas/scene.ts', 'frontend/src/lantern/unified-atlas/runtime-overlays.ts', 'frontend/src/lantern/unified-atlas/unified-atlas.css', 'frontend/src/lantern/unified-atlas/PublishedOverlayDetails.tsx', 'frontend/src/lantern/unified-atlas/labels.ts', 'frontend/src/lantern/unified-atlas/types.ts', 'frontend/src/lantern/canonical-ifc/MeshLayer.tsx', 'frontend/src/lantern/canonical-ifc/geometry.ts', 'frontend/src/lantern/canonical-ifc/useStageCamera.ts', 'frontend/src/lantern/canonical-ifc/stage-pointers.ts', 'frontend/src/lantern/canonical-ifc/standard-glb.ts', 'frontend/src/lantern/canonical-ifc/glb-preflight.ts', 'frontend/src/lantern/canonical-ifc/canonical-ifc.css'];
  const unifiedSourceHashes = {}, unifiedArtifactHashes = {};
  for (const file of unifiedSourcePaths) unifiedSourceHashes[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
  for (const name of unifiedNames) unifiedArtifactHashes[`docs/demo/synthetic-${name}.png`] = createHash('sha256').update(await readFile(resolve(output, `synthetic-${name}.png`))).digest('hex');
  const unifiedAtlas = {
    entry: unifiedEntry, renderer: 'production UnifiedAtlas in LanternHost AtlasView',
    fixture: 'generated fictional publication from synthetic-atlas.ts; production readUnifiedAtlas over an in-page fake HTTPS transport; external atlas-scene/atlas-model parameters unused',
    buildings, floors, planSvgSHA256: planSvgSha256,
    sourceDisclosure: { desktop: desktopDisclosure, phone: phoneDisclosure },
    states: [
      { image: 'synthetic-unified-3d.png', viewport: [1440, 1000], ...desktop, webgl: desktopWebgl },
      { image: 'synthetic-unified-collapsed.png', viewport: [1440, 1000], ...collapsed, webgl: collapsedWebgl },
      { image: 'synthetic-unified-plan.png', viewport: [1440, 1000], ...plan },
      { image: 'synthetic-unified-phone.png', viewport: [390, 844], ...phone, webgl: phoneWebgl },
      { image: 'synthetic-unified-phone-crowded.png', viewport: [390, 844], ...phoneCrowded, webgl: phoneCrowdedWebgl, focusRecoveredWithoutScroll: true },
      { image: 'synthetic-unified-phone-hall.png', viewport: [390, 844], ...phoneHall, webgl: phoneHallWebgl, recordReferences: ['syn-circuit-1', 'syn-outlet-1', 'syn-outlet-2'] },
      { image: 'synthetic-unified-stacked.png', viewport: [1440, 1000], ...stacked, webgl: stackedWebgl },
    ],
    checks: ['Atlas section current', 'two navigable generated buildings and three house floors in height order', 'Living room selected on Ground floor through the room list', 'fresh WebGL draws after Fit view before 3D capture', 'collapse before Plan focuses the selected floor and retains its stage tag', 'Ground floor plan with three rooms, one selected and the canvas hidden', 'published electrical counts for Hall and Living room', 'both counts remain at fitted phone width with the room panel as a closed sheet', 'selected count wins a zoomed-out phone touch-target collision without reducing the four-record total', 'Hall remains selectable with its three original record references', 'culled focused count returns focus to the viewport without scrolling', 'stacked Network keeps one selected count and one distinct source record', 'no room or enlarged count target under a floating panel', 'no enlarged count target over another', 'current building and floor in view in every state'],
    scope: ['Generated fictional data only; no household, native, backend admission or private reference', 'Reduced motion: settled states only; no animation, transition or mid-sweep evidence', 'Playwright headless Chromium; no iPhone, PWA, native document, PDF or device acceptance'],
    sourceHashes: unifiedSourceHashes, artifactHashes: unifiedArtifactHashes,
  };
  await writeFile(resolve(output, 'capture.json'), JSON.stringify({ format: 'houseatlas-synthetic-readme-media/1', synthetic: true, sourceHead, sourceDirty, sourceTree, node: process.version, browser: browser.version(), webgl, illustration: { renderer: 'production AtlasView/Model', fictional: true, floors: 3, selectedRoom: 'Kitchen', svgSHA256: illustrationSvgSha256, referenceArchiveSHA256: '96a884bf935e6aedfa3e5b4f415cce8be295630fe052dc66c5497f8b87b1da63' }, viewport: [1440, 1000], collage: [1800, 520], transport: 'Checked-in synthetic Responses; browser assets from owned loopback only', sandbox: 'Playwright default headless (--no-sandbox); no native sandbox qualification', checks: ['reviewed Alpha membership', 'explicit unknown elevation', 'Lower room heading', 'saved synthetic-link with exact revision token', 'both source floors prepared before production WebGL capture', 'original fictional three-floor illustrated house with furniture and selected Kitchen', 'illustrated ground-floor plan mode', 'zero external browser requests and renderer errors'], hashes, unifiedAtlas }, null, 2) + '\n');
  console.log('PASS synthetic React media: original illustrated house, plan, two-floor WebGL meshes, building, room, Network, collage, generated unified Atlas 3D/plan/phone; no provider/native acceptance');
} finally {
  clearTimeout(deadline);
  await browser?.close();
  if (server && server.exitCode === null) {
    const stopped = new Promise(done => server.once('exit', done));
    server.kill('SIGTERM');
    await stopped;
  }
}
