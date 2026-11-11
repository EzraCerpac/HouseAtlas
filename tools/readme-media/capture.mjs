/** Public synthetic presentation only. No native server, household input or provider. */
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

assert.equal(process.version, 'v26.10.0');
const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.argv[2] ?? resolve(root, 'docs/demo'));
await mkdir(output, { recursive: true });
const unifiedNames = ['unified-3d', 'unified-collapsed', 'unified-plan', 'unified-phone', 'unified-phone-crowded', 'unified-phone-hall', 'unified-stacked'];
const sourceTreeExclusions = ['docs/demo/capture.json', 'docs/publication/source-manifest.json', ...['building', 'room', 'network', 'collage', ...unifiedNames].map(name => `docs/demo/synthetic-${name}.png`)];
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
/** Page init script: counts draw submissions on whichever of WebGPU or WebGL2
 * the canonical 3D layer chose. */
function countDraws(counter) {
  window[counter] = 0;
  const wrap = (proto, names) => { if (proto) for (const name of names) {
    const original = proto[name];
    proto[name] = function (...args) { window[counter]++; return original.apply(this, args); };
  } };
  for (const context of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) wrap(context?.prototype, ['drawArrays', 'drawElements']);
  wrap(globalThis.GPURenderPassEncoder?.prototype, ['draw', 'drawIndexed']);
}
const errors = [], requests = [];
let browser, server, exampleDeadline, staticServer, exampleBrowser, buildChild, rejectBuild;
const temporary = [];
// The build runs as its own process group (npm, its shell and Vite), stopped as a whole.
const stopBuild = () => { try { if (buildChild) process.kill(-buildChild.pid, 'SIGTERM'); } catch { /* already gone */ } };
const stopAll = () => {
  server?.kill('SIGTERM'); stopBuild(); rejectBuild?.(new Error('The frontend build exceeded the example bound'));
  staticServer?.close(); void browser?.close(); void exampleBrowser?.close();
};
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
  // Unified Atlas: the generated fictional publication through the production
  // reader, LanternHost and UnifiedAtlas. The external atlas-scene/atlas-model
  // parameters are never used here. Reduced motion captures settled states only.
  const unifiedEntry = '/lantern-tests/source-host-visual/?atlas=generated';
  const atlas = await context.newPage();
  atlas.on('pageerror', error => errors.push(error.message));
  await atlas.addInitScript(countDraws, 'syntheticAtlasDrawCalls');
  await atlas.goto(`${origin}${unifiedEntry}`, { waitUntil: 'networkidle' });
  await atlas.evaluate(() => document.fonts.ready);
  assert.equal(await atlas.locator('nav.navrail .nav-btn[aria-current="page"] .nav-label').textContent(), 'Atlas');
  const shell = atlas.locator('section.ua-shell.is-stage[aria-label="Atlas"]');
  await shell.waitFor();
  // Real drawing is required; the 3D-unavailable note is reported, never captured.
  const firstDraw = await atlas.waitForFunction(() => window.syntheticAtlasDrawCalls > 0 ? 'drawn'
    : document.querySelector('.ua-viewport .cifc-stage-note')?.textContent || false);
  assert.equal(await firstDraw.jsonValue(), 'drawn', 'Unified Atlas 3D must draw before capture');
  const frames = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
  // Normal keyboard use of the visible source disclosure, without changing source.
  const sourceDisclosure = async () => {
    const compactButton = shell.getByRole('button', { name: 'View and sources', exact: true });
    if (await compactButton.isVisible()) {
      const panel = shell.locator(`[id="${await compactButton.getAttribute('aria-controls')}"]`), sources = panel.locator('.ua-menu-sources');
      await compactButton.focus(); await compactButton.press('Enter');
      assert.equal(await compactButton.getAttribute('aria-expanded'), 'true');
      await panel.waitFor({ state: 'visible' });
      assert.deepEqual((await sources.getByRole('button').allTextContents()).map(name => name.trim()), sourceNames);
      await sources.getByRole('button').last().focus(); await atlas.keyboard.press('Tab');
      assert.equal(await compactButton.getAttribute('aria-expanded'), 'false', 'The menu closes before focus enters stage controls');
      await panel.waitFor({ state: 'hidden' });
      await compactButton.focus(); await compactButton.press('Enter');
      await sources.getByRole('button').first().focus(); await atlas.keyboard.press('Escape');
      assert.equal(await compactButton.getAttribute('aria-expanded'), 'false');
      await panel.waitFor({ state: 'hidden' });
      assert.equal(await compactButton.evaluate(node => document.activeElement === node), true, 'Escape returns focus to View and sources');
      return { control: 'view-and-sources', closedAfterTab: true, closedAfterEscape: true, focusReturned: true };
    }
    const menu = atlas.locator('details.atlas-source-details'), summary = menu.locator(':scope > summary');
    await summary.focus(); await summary.press('Enter');
    assert.equal(await menu.evaluate(node => node.open), true);
    await menu.locator('nav button').last().focus(); await atlas.keyboard.press('Tab');
    assert.equal(await menu.evaluate(node => node.open), false, 'The menu closes before focus enters stage controls');
    await summary.focus(); await summary.press('Enter');
    await menu.locator('nav button').first().focus(); await atlas.keyboard.press('Escape');
    assert.equal(await menu.evaluate(node => node.open), false);
    assert.equal(await summary.evaluate(node => document.activeElement === node), true, 'Escape returns focus to the source summary');
    return { control: 'source-summary', closedAfterTab: true, closedAfterEscape: true, focusReturned: true };
  };
  const sourceNames = (await atlas.locator('details.atlas-source-details nav button').allTextContents()).map(name => name.trim());
  const desktopDisclosure = await sourceDisclosure();
  // Zoom in, then Fit view back to the baseline pose; a draw must follow the fit.
  const settledDraw = async page => {
    const menuButton = shell.getByRole('button', { name: 'View and sources', exact: true });
    const compact = await menuButton.isVisible();
    if (compact) {
      await menuButton.click();
      assert.equal(await menuButton.getAttribute('aria-expanded'), 'true');
    }
    const camera = shell.locator(compact ? '.ua-menu-camera' : '.ua-tools > .ctrl-group');
    await camera.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await frames(page);
    await page.evaluate(() => { window.syntheticAtlasDrawCalls = 0; });
    await camera.getByRole('button', { name: 'Fit view', exact: true }).click();
    await frames(page);
    await page.waitForFunction(() => window.syntheticAtlasDrawCalls > 0);
    if (compact) {
      await atlas.keyboard.press('Escape');
      assert.equal(await menuButton.getAttribute('aria-expanded'), 'false');
      assert.equal(await menuButton.evaluate(node => document.activeElement === node), true);
      await shell.locator(`[id="${await menuButton.getAttribute('aria-controls')}"]`).waitFor({ state: 'hidden' });
      await frames(page);
    }
  };
  const atlasFacts = () => atlas.evaluate(() => {
    const text = selector => document.querySelector(selector)?.textContent?.trim() ?? null;
    const names = selector => [...document.querySelectorAll(selector)].map(node => node.getAttribute('aria-label') ?? node.textContent.trim());
    const pressed = selector => [...document.querySelectorAll(selector)].filter(node => node.getAttribute('aria-pressed') === 'true')
      .map(node => node.getAttribute('aria-label') ?? node.textContent.trim());
    const inspector = document.querySelector('aside.ua-inspector'), canvas = document.querySelector('.ua-viewport canvas.cifc-canvas');
    const stageBox = document.querySelector('.ua-viewport').getBoundingClientRect();
    // The current building and floor are each visible inside their own row and the stage.
    const inView = (row, current = row?.querySelector('[aria-pressed="true"]')) => {
      if (!row || !current || !visible(row) || !visible(current)) return false;
      const a = current.getBoundingClientRect(), b = row.getBoundingClientRect();
      return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0
        && a.left >= Math.max(b.left, stageBox.left) - 1 && a.right <= Math.min(b.right, stageBox.right) + 1 && a.top >= stageBox.top - 1 && a.bottom <= stageBox.bottom + 1;
    };
    // Room and count buttons on the stage, measured against every visible floating panel.
    const visible = node => { const style = getComputedStyle(node); return style.display !== 'none' && style.visibility !== 'hidden'; };
    const panels = [...document.querySelectorAll('.ua-tools > *, .ua-scope > *, .ua-bottom > *, .ua-menu-panel:not([hidden])')].filter(visible).map(node => node.getBoundingClientRect());
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
    // The Floor Stack: a rail of rows on wide stages, a chip naming the scope on a phone.
    const compact = document.querySelector('.ua-shell').classList.contains('is-compact');
    const building = [...document.querySelectorAll('.ua-stack-buildings button[aria-pressed="true"] .ua-rung-name')].map(node => node.textContent.trim());
    const head = document.querySelector('.ua-stack-head'), buildingLabel = text('.ua-stack-head .ua-stack-building');
    const floorName = text('.ua-stack-floors button[aria-pressed="true"] .ua-rung-name');
    return {
      buildingInView: compact
        ? building.length === 1 && buildingLabel === building[0] && inView(document.querySelector('.ua-scope'), head)
        : inView(document.querySelector('.ua-stack-buildings')),
      buildingControl: { kind: compact ? 'chip' : 'rail', label: compact ? buildingLabel : building[0] ?? null },
      floorInView: compact
        ? floorName !== null && head.getAttribute('aria-label').endsWith(`, ${floorName}`) && inView(document.querySelector('.ua-scope'), head)
        : inView(document.querySelector('.ua-stack-floors')),
      covered, crowded, actionCollisions,
      menusClosed: !document.querySelector('.ua-menu-btn[aria-expanded="true"], .ua-stack-head[aria-expanded="true"]'),
      stage: document.querySelector('.ua-viewport').getAttribute('aria-label'),
      view: compact ? [document.querySelector('.ua-dock-view')?.getAttribute('aria-pressed') === 'true' ? 'Plan' : '3D'] : pressed('.ua-tools .seg button'),
      building, floor: [...document.querySelectorAll('.ua-stack-floors button[aria-pressed="true"]')]
        .map(node => node.getAttribute('aria-label') ?? node.querySelector('.ua-rung-name').textContent.trim()),
      exploded: document.querySelector('.ua-stack-spread')?.getAttribute('aria-pressed') ?? null,
      overlay: pressed('.layer-bar button'), key: text('.ua-key-head'),
      selectedRoom: text('.ua-inspector.is-room h2'), selectedFloor: text('.ua-room-floor'),
      inspector: { label: inspector.getAttribute('aria-label'), position: getComputedStyle(inspector).position, open: inspector.classList.contains('is-open') },
      labels: names('.ua-label-hit'), markers: names('.ua-marker').sort(),
      markerKeys: [...document.querySelectorAll('.ua-marker')].filter(visible).map(node => node.dataset.stageKey).sort(),
      planRooms: document.querySelectorAll('.ua-plan .cifc-plan-space').length, planSelected: document.querySelectorAll('.ua-plan .cifc-plan-space.is-selected').length,
      canvasHidden: canvas.hidden, stageNote: text('.ua-viewport .cifc-stage-note'),
    };
  });
  const atlasDrawing = () => atlas.locator('.ua-viewport canvas.cifc-canvas').evaluate(canvas =>
    ({ renderer: canvas.dataset.renderer, drawCalls: window.syntheticAtlasDrawCalls, pixels: [canvas.width, canvas.height], cssPixels: [canvas.clientWidth, canvas.clientHeight] }));
  // Generated identity: two buildings with floors; the boundary wall is context only.
  const buildings = (await shell.locator('.ua-stack-buildings .ua-rung-name').allTextContents()).map(name => name.trim());
  assert.deepEqual(buildings, ['All buildings', 'Synthetic house', 'Synthetic studio']);
  await shell.getByRole('list', { name: 'Buildings' }).getByRole('button', { name: 'Synthetic house', exact: true }).click();
  const ladder = shell.getByRole('list', { name: 'Floors of Synthetic house' });
  await ladder.waitFor();
  const floors = (await ladder.locator('.ua-rung-name').allTextContents()).map(name => name.trim());
  assert.deepEqual(floors, ['All floors', 'Upper floor', 'Split level', 'Ground floor']);
  const rooms = shell.getByRole('complementary', { name: 'Rooms' });
  const showRooms = rooms.getByRole('button', { name: 'Show rooms', exact: true });
  if (await showRooms.isVisible()) await showRooms.click();
  await rooms.getByRole('button', { name: 'Living room', exact: true }).click();
  await shell.getByRole('heading', { level: 2, name: 'Living room', exact: true }).waitFor();
  await ladder.getByRole('button', { name: 'Ground floor: 3 rooms, has the selected room', exact: true }).waitFor();
  const selected = await atlasFacts();
  assert.deepEqual([selected.floor, selected.exploded], [['Ground floor: 3 rooms, has the selected room'], 'false'],
    'Room selection retains its full floor ancestry and never turns on explosion');
  await shell.getByRole('button', { name: 'Spread floors', exact: true }).click();
  await settledDraw(atlas);
  const desktop = await atlasFacts();
  assert.deepEqual([desktop.view, desktop.building, desktop.floor, desktop.exploded], [['3D'], ['Synthetic house'], ['Ground floor: 3 rooms, has the selected room'], 'true']);
  assert.deepEqual([desktop.selectedRoom, desktop.selectedFloor, desktop.canvasHidden, desktop.stageNote], ['Living room', 'Ground floor, Synthetic house', false, null]);
  assert(desktop.labels.includes('Select room: Living room'), 'The selected room tag must be on the stage');
  const clearOfPanels = facts => {
    assert.equal(facts.menusClosed, true, 'Capture the settled stage with the compact menus closed');
    assert.deepEqual(facts.covered, [], 'No room or count button may sit under a floating panel');
    assert.deepEqual(facts.crowded, [], 'No count button may overlap another');
    assert.deepEqual(facts.actionCollisions, [], 'No mounted room action may overlap another room action or enlarged count target');
    assert.deepEqual([facts.buildingInView, facts.floorInView], [true, true], 'The current building and floor must be in view');
  };
  clearOfPanels(desktop);
  const desktopDrawing = await atlasDrawing();
  assert(desktopDrawing.pixels[0] > 1 && desktopDrawing.pixels[1] > 1);
  await atlas.mouse.move(1430, 10);
  await frames(atlas);
  await atlas.screenshot({ path: resolve(output, 'synthetic-unified-3d.png'), animations: 'disabled' });
  // Collapse only the presentation; the selected room and its already-complete
  // floor ancestry remain visible before Plan has been opened.
  await shell.getByRole('button', { name: 'Spread floors', exact: true }).click();
  await settledDraw(atlas);
  const collapsed = await atlasFacts();
  assert.deepEqual([collapsed.view, collapsed.exploded, collapsed.floor, collapsed.selectedRoom, collapsed.selectedFloor],
    [['3D'], 'false', ['Ground floor: 3 rooms, has the selected room'], 'Living room', 'Ground floor, Synthetic house']);
  assert(collapsed.labels.includes('Select room: Living room'));
  clearOfPanels(collapsed);
  const collapsedDrawing = await atlasDrawing();
  await atlas.mouse.move(1430, 10);
  await atlas.screenshot({ path: resolve(output, 'synthetic-unified-collapsed.png'), animations: 'disabled' });
  // Plan of the selected room's floor, with the published electrical counts.
  await shell.getByRole('group', { name: 'Atlas view' }).getByRole('button', { name: 'Plan', exact: true }).click();
  await atlas.waitForFunction(() => document.querySelector('.ua-shell.is-plan .ua-plan') && document.querySelector('.ua-viewport canvas.cifc-canvas').hidden);
  await shell.getByRole('group', { name: 'Layers' }).getByRole('button', { name: 'Electrical', exact: true }).click();
  await shell.getByRole('button', { name: 'Hall: 3 electrical records', exact: true }).waitFor();
  await atlas.mouse.move(1430, 10);
  await frames(atlas);
  const plan = await atlasFacts();
  assert.equal(plan.stage, 'Plan of Ground floor, Synthetic house. Arrow keys pan, plus and minus zoom, Escape goes back one level.');
  assert.deepEqual([plan.view, plan.overlay, plan.markers, plan.planRooms, plan.planSelected, plan.stageNote],
    [['Plan'], ['Electrical'], ['Hall: 3 electrical records', 'Living room: 1 electrical record'], 3, 1, null]);
  clearOfPanels(plan);
  const planSvg = atlas.locator('.ua-viewport svg.cifc-svg:has(.ua-plan)');
  assert.equal(await planSvg.count(), 1, 'Hash the authored plan SVG separately from the ground drawing');
  const planSvgSha256 = createHash('sha256').update(await planSvg.evaluate(node => node.outerHTML)).digest('hex');
  await atlas.screenshot({ path: resolve(output, 'synthetic-unified-plan.png'), animations: 'disabled' });
  // Phone width: the same selection in 3D with the room panel as a closed sheet.
  await atlas.evaluate(() => { window.syntheticAtlasDrawCalls = 0; });
  await shell.getByRole('group', { name: 'Atlas view' }).getByRole('button', { name: '3D', exact: true }).click();
  await atlas.waitForFunction(() => !document.querySelector('.ua-viewport canvas.cifc-canvas').hidden && window.syntheticAtlasDrawCalls > 0);
  await settledDraw(atlas);
  await atlas.setViewportSize({ width: 390, height: 844 });
  await frames(atlas);
  await atlas.locator('.ua-shell.is-compact').waitFor();
  const beforeChooser = await atlasFacts(), chooserScroll = await atlas.evaluate(() => [scrollX, scrollY]);
  const buildingChooser = shell.getByRole('button', { name: 'Building and floor: Synthetic house, Ground floor', exact: true });
  await buildingChooser.focus(); await buildingChooser.press('Enter');
  assert.equal(await buildingChooser.getAttribute('aria-expanded'), 'true');
  const phoneBuildings = shell.getByRole('list', { name: 'Buildings', exact: true });
  await phoneBuildings.waitFor({ state: 'visible' });
  assert.deepEqual((await phoneBuildings.locator('.ua-rung-name').allTextContents()).map(name => name.trim()), buildings);
  const currentBuilding = phoneBuildings.getByRole('button', { name: 'Synthetic house', exact: true });
  assert.equal(await currentBuilding.getAttribute('aria-pressed'), 'true');
  await currentBuilding.focus(); await atlas.keyboard.press('Escape');
  assert.equal(await buildingChooser.getAttribute('aria-expanded'), 'false');
  await phoneBuildings.waitFor({ state: 'hidden' });
  assert.equal(await buildingChooser.evaluate(node => document.activeElement === node), true, 'Escape returns focus to the Floor Stack chip');
  assert.deepEqual(await atlas.evaluate(() => [scrollX, scrollY]), chooserScroll, 'Building chooser focus does not scroll the page');
  await frames(atlas);
  const afterChooser = await atlasFacts();
  for (const field of ['view', 'overlay', 'building', 'floor', 'selectedRoom', 'selectedFloor', 'inspector', 'markers', 'markerKeys', 'stageNote'])
    assert.deepEqual(afterChooser[field], beforeChooser[field], `Closing the building chooser preserves ${field}`);
  const phoneChooser = { closedAfterEscape: true, focusReturned: true, scopePreserved: true, scrollPreserved: true };
  const phoneDisclosure = await sourceDisclosure();
  await settledDraw(atlas);
  await shell.getByRole('button', { name: 'Show details', exact: true }).waitFor();
  await atlas.mouse.move(385, 5);
  await frames(atlas);
  let phone = await atlasFacts();
  assert.deepEqual([phone.view, phone.overlay, phone.selectedRoom, phone.stageNote], [['3D'], ['Electrical'], 'Living room', null]);
  assert.deepEqual(phone.inspector, { label: 'Selected room', position: 'absolute', open: false });
  assert.deepEqual([phone.building, phone.floor], [['Synthetic house'], ['Ground floor: 3 rooms, has the selected room']]);
  assert.deepEqual(phone.buildingControl, { kind: 'chip', label: 'Synthetic house' });
  assert.deepEqual(phone.markers, ['Hall: 3 electrical records', 'Living room: 1 electrical record']);
  assert.deepEqual(phone.markerKeys, ['marker:electrical:syn-occ-hall', 'marker:electrical:syn-occ-living']);
  assert.match(phone.key, /4 records/);
  const beforeDetails = phone;
  const layerDetails = shell.getByRole('button', { name: /^Layer details/ });
  await layerDetails.click();
  assert.equal(await layerDetails.getAttribute('aria-expanded'), 'true');
  await shell.locator('.ua-keys .ua-key-head').getByText('4 records', { exact: true }).waitFor({ state: 'visible' });
  await layerDetails.click();
  assert.equal(await layerDetails.getAttribute('aria-expanded'), 'false');
  await frames(atlas);
  phone = await atlasFacts();
  for (const field of ['view', 'overlay', 'building', 'buildingControl', 'floor', 'selectedRoom', 'selectedFloor', 'inspector', 'markers', 'markerKeys', 'stageNote', 'menusClosed'])
    assert.deepEqual(phone[field], beforeDetails[field], `Layer details preserves ${field}`);
  clearOfPanels(phone);
  const phoneDrawing = await atlasDrawing();
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
  const phoneCrowdedDrawing = await atlasDrawing();
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
  const phoneHallDrawing = await atlasDrawing();
  await atlas.screenshot({ path: resolve(output, 'synthetic-unified-phone-hall.png'), animations: 'disabled' });
  await shell.getByRole('button', { name: 'Show details', exact: true }).click();
  const references = shell.getByRole('complementary', { name: 'Selected room' }).locator('.ua-record').filter({ has: atlas.getByRole('heading', { name: 'Electrical', exact: true }) });
  await references.getByText('Record references', { exact: true }).click();
  assert.deepEqual(await references.locator('.ua-refs li').allTextContents(), ['syn-circuit-1', 'syn-outlet-1', 'syn-outlet-2']);
  await shell.getByRole('button', { name: 'Hide details', exact: true }).click();
  // A stacked whole-building Network view exercises the two Stairs occurrences.
  await atlas.setViewportSize({ width: 1440, height: 1000 });
  await atlas.locator('.ua-shell:not(.is-compact)').waitFor();
  await shell.getByRole('button', { name: 'Clear room', exact: true }).click();
  await shell.getByRole('complementary', { name: 'Rooms' }).getByRole('region', { name: 'Ground floor, Synthetic house', exact: true })
    .getByRole('button', { name: 'Stairs', exact: true }).click();
  await ladder.getByRole('button', { name: 'All floors', exact: true }).click();
  await shell.getByRole('group', { name: 'Layers' }).getByRole('button', { name: 'Electrical', exact: true }).click();
  await shell.getByRole('group', { name: 'Layers' }).getByRole('button', { name: 'Network', exact: true }).click();
  await settledDraw(atlas);
  await viewport.focus();
  await atlas.evaluate(() => { window.syntheticAtlasDrawCalls = 0; });
  for (let i = 0; i < 6; i++) await viewport.press('ArrowUp');
  for (let i = 0; i < 4; i++) await viewport.press('-');
  await frames(atlas);
  await atlas.waitForFunction(() => window.syntheticAtlasDrawCalls > 0);
  const stacked = await atlasFacts();
  assert.deepEqual([stacked.exploded, stacked.floor, stacked.selectedRoom, stacked.selectedFloor],
    ['false', ['All floors'], null, null]);
  assert.deepEqual(stacked.markers, ['Stairs: 1 network record, Ground floor, Synthetic house']);
  assert.deepEqual(stacked.markerKeys, ['marker:network:syn-occ-stairs-ground']);
  assert.match(stacked.key, /1 record/);
  clearOfPanels(stacked);
  const stackedDrawing = await atlasDrawing();
  await atlas.mouse.move(1430, 10);
  await atlas.screenshot({ path: resolve(output, 'synthetic-unified-stacked.png'), animations: 'disabled' });
  assert.deepEqual(errors, [], 'No renderer error or external browser request allowed');
  const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const sourceDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
  assert.deepEqual(await sourceTreeSnapshot(), sourceTree, 'Tracked capture source must remain unchanged throughout capture');
  const sourcePaths = ['frontend/lantern-tests/core-read-visual/main.tsx', 'frontend/lantern-tests/core-read-visual/fixture.json', 'tools/readme-media/capture.mjs', 'frontend/src/lantern/atlas/AtlasView.tsx', 'frontend/src/lantern/Host.tsx', 'frontend/src/api/topology-client.ts', 'frontend/src/api/network-relations-client.ts'];
  const hashes = {};
  for (const file of [...sourcePaths, ...names.map(name => `docs/demo/synthetic-${name}.png`), 'docs/demo/synthetic-collage.png']) {
    const path = file.startsWith('docs/demo/') ? resolve(output, file.split('/').at(-1)) : resolve(root, file);
    hashes[file] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  const unifiedSourcePaths = ['tools/readme-media/capture.mjs', 'frontend/lantern-tests/source-host-visual/index.html', 'frontend/lantern-tests/source-host-visual/main.tsx', 'frontend/lantern-tests/source-host-visual/synthetic-site.ts', 'frontend/lantern-tests/source-host-visual/synthetic-documents.ts', 'frontend/lantern-tests/unified-atlas/synthetic-atlas.ts', 'frontend/integration/unified-atlas-reader.ts', 'frontend/src/lantern/Host.tsx', 'frontend/src/lantern/atlas/AtlasView.tsx', 'frontend/src/lantern/atlas/useCamera.ts', 'frontend/src/lantern/unified-atlas/UnifiedAtlas.tsx', 'frontend/src/lantern/unified-atlas/atlas-text.ts', 'frontend/src/lantern/unified-atlas/FloorStack.tsx', 'frontend/src/lantern/unified-atlas/AtlasInspector.tsx', 'frontend/src/lantern/unified-atlas/AtlasKeys.tsx', 'frontend/src/lantern/unified-atlas/scene.ts', 'frontend/src/lantern/unified-atlas/runtime-overlays.ts', 'frontend/src/lantern/unified-atlas/unified-atlas.css', 'frontend/src/lantern/unified-atlas/PublishedOverlayDetails.tsx', 'frontend/src/lantern/unified-atlas/labels.ts', 'frontend/src/lantern/unified-atlas/types.ts', 'frontend/src/lantern/canonical-ifc/MeshLayer.tsx', 'frontend/src/lantern/canonical-ifc/mesh-scene.ts', 'frontend/src/lantern/canonical-ifc/mesh-appearance.ts', 'frontend/src/lantern/canonical-ifc/gpu-budget.ts', 'frontend/src/lantern/canonical-ifc/geometry.ts', 'frontend/src/lantern/canonical-ifc/useStageCamera.ts', 'frontend/src/lantern/canonical-ifc/stage-pointers.ts', 'frontend/src/lantern/canonical-ifc/standard-glb.ts', 'frontend/src/lantern/canonical-ifc/glb-preflight.ts', 'frontend/src/lantern/canonical-ifc/canonical-ifc.css'];
  const unifiedSourceHashes = {}, unifiedArtifactHashes = {};
  for (const file of unifiedSourcePaths) unifiedSourceHashes[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
  for (const name of unifiedNames) unifiedArtifactHashes[`docs/demo/synthetic-${name}.png`] = createHash('sha256').update(await readFile(resolve(output, `synthetic-${name}.png`))).digest('hex');
  const unifiedAtlas = {
    entry: unifiedEntry, renderer: 'production UnifiedAtlas in LanternHost AtlasView',
    fixture: 'generated fictional publication from synthetic-atlas.ts; production readUnifiedAtlas over an in-page fake HTTPS transport; external atlas-scene/atlas-model parameters unused',
    buildings, floors, planSvgSHA256: planSvgSha256,
    sourceDisclosure: { desktop: desktopDisclosure, phone: phoneDisclosure },
    buildingChooser: { phone: phoneChooser },
    states: [
      { image: 'synthetic-unified-3d.png', viewport: [1440, 1000], ...desktop, drawing: desktopDrawing },
      { image: 'synthetic-unified-collapsed.png', viewport: [1440, 1000], ...collapsed, drawing: collapsedDrawing },
      { image: 'synthetic-unified-plan.png', viewport: [1440, 1000], ...plan },
      { image: 'synthetic-unified-phone.png', viewport: [390, 844], ...phone, drawing: phoneDrawing },
      { image: 'synthetic-unified-phone-crowded.png', viewport: [390, 844], ...phoneCrowded, drawing: phoneCrowdedDrawing, focusRecoveredWithoutScroll: true },
      { image: 'synthetic-unified-phone-hall.png', viewport: [390, 844], ...phoneHall, drawing: phoneHallDrawing, recordReferences: ['syn-circuit-1', 'syn-outlet-1', 'syn-outlet-2'] },
      { image: 'synthetic-unified-stacked.png', viewport: [1440, 1000], ...stacked, drawing: stackedDrawing },
    ],
    checks: ['Atlas section current', 'two navigable generated buildings and three house floors in height order', 'Living room selected on Ground floor through the room list', 'fresh 3D draws after Fit view before 3D capture', 'explicit explosion and collapse preserve the selected room and its complete floor ancestry', 'Ground floor plan with three rooms, one selected and the canvas hidden', 'published electrical counts for Hall and Living room', 'both counts remain at fitted phone width with the room panel as a closed sheet', 'selected count wins a zoomed-out phone touch-target collision without reducing the four-record total', 'Hall remains selectable with its three original record references', 'culled focused count returns focus to the viewport without scrolling', 'whole-building Network deterministically retains one context-qualified count and one distinct source record', 'no room or enlarged count target under a floating panel', 'no enlarged count target over another', 'current building and floor in view in every state'],
    scope: ['Generated fictional data only; no household, native, backend admission or private reference', 'Reduced motion: settled states only; no animation, transition or mid-sweep evidence', 'Playwright headless Chromium; no iPhone, PWA, native document, PDF or device acceptance'],
    sourceHashes: unifiedSourceHashes, artifactHashes: unifiedArtifactHashes,
  };
  // Example house: the real `npm --prefix frontend run build` output (the app
  // build, then the example's own pass into dist/example), served by an owned
  // loopback server with the Rust host's path, file-type, size and
  // cache-header rules. One bounded phase after the receipt above is complete,
  // so the existing capture keeps its unchanged 90 seconds.
  clearTimeout(deadline);
  exampleDeadline = setTimeout(stopAll, 60_000);
  const exampleStarted = Date.now(), frontend = resolve(root, 'frontend');
  // The dev server is not used from here on and must not watch the build.
  if (server.exitCode === null) {
    const devStopped = new Promise(done => server.once('exit', done));
    server.kill('SIGTERM');
    await devStopped;
  }
  // Type check of the example sources with the frontend's pinned compiler.
  const typescript = JSON.parse(await readFile(resolve(frontend, 'node_modules/typescript/package.json'), 'utf8'));
  const typecheck = spawnSync(process.execPath, [resolve(frontend, 'node_modules/typescript', typescript.bin.tsc), '-p', 'example/tsconfig.json', '--noEmit', '--pretty', 'false'],
    { cwd: frontend, encoding: 'utf8', timeout: 30_000 });
  assert.equal(typecheck.error, undefined, 'The pinned TypeScript compiler must run');
  const diagnostics = `${typecheck.stdout}\n${typecheck.stderr}`.split('\n').filter(line => /error TS\d+/.test(line));
  assert.deepEqual(diagnostics.filter(line => !/^[^\s(]+\(\d+,\d+\): error TS\d+/.test(line)), [], 'Every compiler diagnostic names a file');
  assert(typecheck.status === 0 || diagnostics.length > 0, `The compiler failed without diagnostics: ${typecheck.stderr}`);
  // Only the imported lantern-tests fixtures are outside the claim; they stay
  // visible here and in the receipt. Anything else, including the app modules
  // the example imports, fails.
  const fixtureDiagnostics = diagnostics.filter(line => line.startsWith('lantern-tests/'));
  if (fixtureDiagnostics.length) console.log(`Type diagnostics in imported lantern-tests fixtures (recorded, not failed):\n${fixtureDiagnostics.join('\n')}`);
  assert.deepEqual(diagnostics.filter(line => !line.startsWith('lantern-tests/')), [], 'The example sources and the app modules they import must type-check');
  await new Promise((done, reject) => {
    rejectBuild = reject;
    buildChild = spawn('npm', ['--prefix', 'frontend', 'run', 'build'], { cwd: root, detached: true, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
    let log = '';
    buildChild.stderr.on('data', data => { log += data; });
    buildChild.once('error', reject);
    buildChild.once('exit', code => code === 0 ? done() : reject(new Error(`npm run build failed (${code}): ${log}`)));
  }).finally(() => { buildChild = null; rejectBuild = null; });
  const built = resolve(frontend, 'dist');
  const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', woff2: 'font/woff2', webmanifest: 'application/manifest+json', png: 'image/png' };
  const files = new Map();
  const collect = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), key = '/' + relative(built, path).split(sep).join('/');
      assert(!entry.isSymbolicLink(), `Built output contains a symlink: ${key}`);
      if (entry.isDirectory()) { await collect(path); continue; }
      assert(types[entry.name.split('.').at(-1)], `The Rust host refuses this built file type: ${key}`);
      assert((await stat(path)).size <= 4_000_000, `The Rust host refuses this built file size: ${key}`);
      files.set(key, path);
    }
  };
  await collect(built);
  // The app's startup files and offline shell stay outside dist/example, and
  // the signed-out link ships in the app's startup JavaScript.
  const appIndex = await readFile(files.get('/index.html'), 'utf8');
  const startup = [...appIndex.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+\.js)"/g)].map(match => match[1]);
  assert(startup.length > 0 && startup.every(path => !path.startsWith('/example/')), 'The app startup loads nothing from the example');
  // Per-file startup bytes and default node gzip, the startup budget's method;
  // the startup file carrying the link is kept for size review.
  const startupFiles = await Promise.all(startup.map(async path => ({ path, bytes: await readFile(files.get(path)) })));
  const startupSizes = startupFiles.map(({ path, bytes }) => ({ path, bytes: bytes.length, gzip: gzipSync(bytes).length }));
  const linkFiles = startupFiles.filter(({ bytes }) => bytes.includes('/example/index.html'));
  assert.equal(linkFiles.length, 1, 'The signed-out link to the example ships in one app startup file');
  await writeFile(resolve(output, 'example-link-startup-chunk.js'), linkFiles[0].bytes);
  assert(!(await readFile(files.get('/saved/service-worker.js'), 'utf8')).includes('/example/'), 'The offline shell precaches nothing from the example');
  const exampleFiles = [...files.keys()].filter(key => key.startsWith('/example/'));
  assert(exampleFiles.includes('/example/index.html') && exampleFiles.some(key => key.startsWith('/example/assets/')), 'The build emits the example page and its assets');
  // One synthetic same-origin page to seed storage and to navigate away to.
  const away = '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Away</title></head><body><p>Synthetic navigation target</p></body></html>';
  staticServer = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname, key = path === '/' ? '/index.html' : path;
    const headers = key.startsWith('/assets/') && !key.slice(8).includes('/')
      ? { 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' }
      : { 'cache-control': 'private, no-store', pragma: 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };
    if (request.method !== 'GET' || key.includes('%') || (key !== '/away.html' && !files.has(key))) { response.writeHead(404, headers).end(); return; }
    const body = key === '/away.html' ? Promise.resolve(away) : readFile(files.get(key));
    body.then(bytes => response.writeHead(200, { ...headers, 'content-type': types[key.split('.').at(-1)] }).end(bytes),
      () => response.writeHead(500, headers).end());
  });
  await new Promise(done => staticServer.listen(0, '127.0.0.1', done));
  const exampleOrigin = `http://127.0.0.1:${staticServer.address().port}`;
  const buildMs = Date.now() - exampleStarted;
  // A separate browser without Playwright's default back/forward-cache switch,
  // so the capture records which Back path Chromium actually takes.
  exampleBrowser = await chromium.launch({ ignoreDefaultArgs: ['--disable-back-forward-cache'] });
  const guard = context => context.route('**/*', route => {
    requests.push(route.request().url());
    if (new URL(route.request().url()).origin === exampleOrigin) return route.continue();
    errors.push(`External browser request: ${route.request().url()}`);
    return route.abort();
  });
  const exampleTitle = 'Synthetic example house · HouseAtlas';
  // The example readiness used by every example check: label, Atlas section,
  // fresh 3D draw and the house opened through ?building=.
  const exampleReady = async (page, counter) => {
    assert.equal(await page.title(), exampleTitle);
    await page.getByRole('button', { name: 'Home: Synthetic example house. Choose home.', exact: true }).waitFor();
    assert.equal(await page.locator('nav.navrail .nav-btn[aria-current="page"] .nav-label').textContent(), 'Atlas');
    const stage = page.locator('section.ua-shell.is-stage[aria-label="Atlas"]');
    await stage.waitFor();
    const drawn = await page.waitForFunction(name => window[name] > 0 ? 'drawn'
      : document.querySelector('.ua-viewport .cifc-stage-note')?.textContent || false, counter);
    assert.equal(await drawn.jsonValue(), 'drawn', 'The example house must draw in 3D');
    await stage.getByRole('list', { name: 'Floors of Synthetic house' }).waitFor();
    assert.equal(await stage.getByRole('list', { name: 'Buildings' }).getByRole('button', { name: 'Synthetic house', exact: true }).getAttribute('aria-pressed'), 'true');
    return stage;
  };
  const exampleEntry = '/example/index.html?building=syn-building-house';
  // One screenshot and one short scripted video tour of the built page.
  const videoDirectory = await mkdtemp(join(tmpdir(), 'houseatlas-example-video-'));
  temporary.push(videoDirectory);
  const tourContext = await exampleBrowser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC',
    colorScheme: 'light', serviceWorkers: 'block', recordVideo: { dir: videoDirectory, size: { width: 1280, height: 800 } } });
  await guard(tourContext);
  const tour = await tourContext.newPage();
  tour.on('pageerror', error => errors.push(error.message));
  await tour.addInitScript(countDraws, 'syntheticAtlasDrawCalls');
  await tour.goto(`${exampleOrigin}${exampleEntry}`, { waitUntil: 'load' });
  await tour.evaluate(() => document.fonts.ready);
  const tourShell = await exampleReady(tour, 'syntheticAtlasDrawCalls');
  await frames(tour);
  await tour.screenshot({ path: resolve(output, 'example-house.png'), animations: 'disabled' });
  const pause = () => tour.waitForTimeout(800);
  await pause();
  const tourRooms = tourShell.getByRole('complementary', { name: 'Rooms' });
  const tourShowRooms = tourRooms.getByRole('button', { name: 'Show rooms', exact: true });
  if (await tourShowRooms.isVisible()) await tourShowRooms.click();
  await tourRooms.getByRole('button', { name: 'Living room', exact: true }).click();
  await tourShell.getByRole('heading', { level: 2, name: 'Living room', exact: true }).waitFor();
  await pause();
  await tourShell.getByRole('button', { name: 'Spread floors', exact: true }).click();
  await pause();
  await tourShell.getByRole('group', { name: 'Atlas view' }).getByRole('button', { name: 'Plan', exact: true }).click();
  await tour.waitForFunction(() => document.querySelector('.ua-shell.is-plan .ua-plan'));
  await tourShell.getByRole('group', { name: 'Layers' }).getByRole('button', { name: 'Electrical', exact: true }).click();
  await tourShell.getByRole('button', { name: 'Hall: 3 electrical records', exact: true }).waitFor();
  await pause();
  await tourShell.getByRole('group', { name: 'Atlas view' }).getByRole('button', { name: '3D', exact: true }).click();
  await tour.waitForFunction(() => !document.querySelector('.ua-viewport canvas.cifc-canvas').hidden);
  await pause();
  assert.deepEqual(errors, [], 'No renderer error or external browser request allowed');
  const tourVideo = tour.video();
  await tourContext.close();
  await tourVideo.saveAs(resolve(output, 'example-house-tour.webm'));
  const tourMs = Date.now() - exampleStarted - buildMs;
  // Isolation order, storage sentinels and Back navigation on the built page.
  const navigationStarted = Date.now();
  const productionContext = await exampleBrowser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC',
    colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' });
  await guard(productionContext);
  const production = await productionContext.newPage();
  production.on('pageerror', error => errors.push(error.message));
  await production.addInitScript(countDraws, 'exampleProductionDrawCalls');
  // Records any page use of the replaced globals before the example's
  // isolation replaces them; isolation's own definitions remove these traps.
  await production.addInitScript(() => {
    window.examplePreIsolationUse = [];
    const trap = (owner, name) => {
      let original, holder = owner;
      while (holder && !(original = Object.getOwnPropertyDescriptor(holder, name))) holder = Object.getPrototypeOf(holder);
      if (!original) throw new Error(`Missing global: ${name}`);
      Object.defineProperty(owner, name, { configurable: true, get() {
        window.examplePreIsolationUse.push(name);
        return original.get ? original.get.call(owner) : original.value;
      }, set(value) {
        window.examplePreIsolationUse.push(name);
        if (original.set) original.set.call(owner, value);
      } });
    };
    for (const name of ['fetch', 'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'BroadcastChannel']) trap(window, name);
    trap(navigator, 'locks'); trap(document, 'cookie');
  });
  // Draws are counted afresh after the page is hidden or restored.
  await production.addInitScript(() => {
    window.examplePageshows = [];
    addEventListener('pagehide', () => { window.exampleProductionDrawCalls = 0; });
    addEventListener('pageshow', event => { window.examplePageshows.push(event.persisted); if (event.persisted) window.exampleProductionDrawCalls = 0; });
  });
  // Synthetic same-origin sentinels the example must neither read nor change,
  // including one row in the real outbox database.
  const sentinel = { key: 'houseatlas-synthetic-sentinel', value: 'synthetic-sentinel-value' };
  const outboxRows = (key, write) => new Promise((done, reject) => {
    const request = indexedDB.open('houseatlas-outbox-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('entries', write ? 'readwrite' : 'readonly'), store = tx.objectStore('entries');
      if (write) store.put({ id: key, seq: 1, kind: 'synthetic-sentinel', value: write });
      const all = store.getAll();
      tx.oncomplete = () => { db.close(); done(all.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
  const readSentinels = () => production.evaluate(async ({ key, rows }) => ({ local: localStorage.getItem(key), session: sessionStorage.getItem(key),
    cookie: document.cookie, outbox: await new Function('return ' + rows)()(key, null) }), { key: sentinel.key, rows: outboxRows.toString() });
  await production.goto(`${exampleOrigin}/away.html`, { waitUntil: 'load' });
  await production.evaluate(async ({ key, value, rows }) => {
    localStorage.setItem(key, value); sessionStorage.setItem(key, value);
    document.cookie = `${key}=${value}; path=/; SameSite=Strict`;
    await new Function('return ' + rows)()(key, value);
  }, { ...sentinel, rows: outboxRows.toString() });
  const seeded = await readSentinels();
  assert.deepEqual([seeded.local, seeded.session, seeded.cookie, seeded.outbox.length], [sentinel.value, sentinel.value, `${sentinel.key}=${sentinel.value}`, 1]);
  await production.goto(`${exampleOrigin}${exampleEntry}`, { waitUntil: 'load' });
  await exampleReady(production, 'exampleProductionDrawCalls');
  assert.deepEqual(await production.evaluate(() => window.examplePreIsolationUse), [], 'No page script used a replaced global before isolation ran');
  const exampleRealm = await production.evaluate(key => ({ local: localStorage.getItem(key), session: sessionStorage.getItem(key), cookie: document.cookie,
    indexedDB: typeof indexedDB, caches: typeof caches, broadcastChannel: typeof BroadcastChannel, locks: typeof navigator.locks }), sentinel.key);
  assert.deepEqual(exampleRealm, { local: null, session: null, cookie: '', indexedDB: 'undefined', caches: 'undefined', broadcastChannel: 'undefined', locks: 'undefined' },
    'Script on the example page sees none of the origin storage');
  // Back/Forward: leave for another owned page, check the sentinels, go back.
  await production.goto(`${exampleOrigin}/away.html`, { waitUntil: 'load' });
  assert.deepEqual(await readSentinels(), seeded, 'The example left origin storage unchanged');
  await production.goBack({ waitUntil: 'commit' });
  await production.waitForFunction(() => document.readyState === 'complete' && window.examplePageshows?.length > 0);
  await exampleReady(production, 'exampleProductionDrawCalls');
  const back = await production.evaluate(() => ({ pageshows: window.examplePageshows, navigationType: performance.getEntriesByType('navigation')[0]?.type ?? null }));
  const backPath = back.pageshows.at(-1) === true ? 'back-forward-cache restore' : 'back navigation reload';
  if (backPath === 'back navigation reload') assert.deepEqual([back.pageshows, back.navigationType], [[false], 'back_forward']);
  await production.goto(`${exampleOrigin}/away.html`, { waitUntil: 'load' });
  assert.deepEqual(await readSentinels(), seeded, 'Origin storage is still unchanged after Back');
  assert.deepEqual(errors, [], 'No renderer error or external browser request allowed');
  await productionContext.close();
  await exampleBrowser.close();
  await new Promise(done => staticServer.close(done));
  const navigationMs = Date.now() - navigationStarted;
  const exampleHouse = {
    entry: exampleEntry, renderer: 'frontend/example page: production LanternHost and UnifiedAtlas over the generated publication',
    viewport: [1280, 800], screenshot: 'example-house.png', video: 'example-house-tour.webm',
    tour: ['open on Synthetic house through ?building=', 'select Living room', 'spread floors', 'Plan with Electrical layer', 'back to 3D'],
    production: {
      build: 'npm --prefix frontend run build: the app build, then vite build --config example/vite.config.ts into frontend/dist/example',
      preIsolationUse: [],
      served: 'all of frontend/dist from an owned loopback static server applying the Rust host exact-path, file-type, 4,000,000-byte and cache-header rules; no Rust host',
      files: files.size, exampleFiles: exampleFiles.length, startup: startupSizes, linkChunk: linkFiles[0].path, exampleInOfflineShell: false,
      typecheck: { config: 'frontend/example/tsconfig.json', failedOutsideLanternTests: 0, lanternTestsDiagnostics: fixtureDiagnostics },
      storage: { seeded: ['localStorage', 'sessionStorage', 'script-visible cookie', 'houseatlas-outbox-v1 row'], exampleRealm, unchangedAfterLeaving: true, unchangedAfterBack: true },
      back: { path: backPath, ...back },
    },
    durationsMs: { typecheckAndBuild: buildMs, tour: tourMs, navigation: navigationMs },
    scope: ['Generated fictional data only', 'Clean browser profile with service workers blocked; synthetic sentinels only, no existing user profile',
      'Video is a review aid: browser timing varies; no pixel or timing evidence', 'Durations are informational'],
    artifactHashes: Object.fromEntries(await Promise.all(['example-house.png', 'example-house-tour.webm'].map(async name =>
      [name, createHash('sha256').update(await readFile(resolve(output, name))).digest('hex')]))),
  };
  await writeFile(resolve(output, 'capture.json'), JSON.stringify({ format: 'houseatlas-synthetic-readme-media/1', synthetic: true, sourceHead, sourceDirty, sourceTree, node: process.version, browser: browser.version(), viewport: [1440, 1000], collage: [1800, 520], transport: 'Checked-in synthetic Responses; browser assets from owned loopback only', sandbox: 'Playwright default headless (--no-sandbox); no native sandbox qualification', checks: ['reviewed Alpha membership', 'explicit unknown elevation', 'Lower room heading', 'saved synthetic-link with exact revision token', 'zero external browser requests and renderer errors'], hashes, unifiedAtlas, exampleHouse }, null, 2) + '\n');
  console.log('PASS synthetic React media: building, room, Network, collage, generated unified Atlas 3D/plan/phone, example house type check, npm run build, screenshot, tour video, Back navigation and storage sentinels; no provider/native acceptance');
} finally {
  clearTimeout(deadline);
  clearTimeout(exampleDeadline);
  stopBuild();
  await browser?.close();
  await exampleBrowser?.close();
  staticServer?.close();
  await Promise.all(temporary.map(path => rm(path, { recursive: true, force: true })));
  if (server && server.exitCode === null) {
    const stopped = new Promise(done => server.once('exit', done));
    server.kill('SIGTERM');
    await stopped;
  }
}
