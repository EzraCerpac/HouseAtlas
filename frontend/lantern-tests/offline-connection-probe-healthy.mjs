// Healthy generated checks for the Saved viewer's live-host probe and the
// room map download preference. Generated transports and an in-memory
// localStorage only; no browser, network or service worker.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';

assert.deepEqual(process.argv.slice(2), [], 'This runner takes no arguments');
const frontend = new URL('../', import.meta.url);
async function sourceURL(relative) {
  const file = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname, { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  code = code.replaceAll('"react"', JSON.stringify(new URL('./node_modules/react/index.js', frontend).href));
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const { probeLiveHost, PROBE_TIMEOUT_MS } = await import(await sourceURL('../src/offline/connection-probe.ts'));
const origin = 'https://houseatlas.invalid';

const seen = [];
assert.equal(await probeLiveHost(async (url, init) => { seen.push({ url, init }); return new Response('sign in', { status: 401 }); }, origin), true,
  'any HTTP answer, including a sign-in refusal, means the host is reachable');
assert.equal(seen[0].url, `${origin}/`);
assert.equal(seen[0].init.cache, 'no-store'); assert.equal(seen[0].init.redirect, 'manual');
assert.equal(await probeLiveHost(async () => new Response('down', { status: 503 }), origin), true);
assert.equal(await probeLiveHost(async () => { throw new TypeError('Generated network unavailable'); }, origin), false);
// Node does not keep the process alive for AbortSignal.timeout alone.
const hold = setTimeout(() => {}, PROBE_TIMEOUT_MS * 2);
const started = Date.now();
assert.equal(await probeLiveHost((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))), origin), false,
  'a host that never answers counts as offline');
assert.ok(Date.now() - started < PROBE_TIMEOUT_MS + 1_000);
clearTimeout(hold);

// Preference: stored per device, default automatic, holds downloads when asked or on reported mobile data.
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) };
const connection = {};
Object.defineProperty(globalThis, 'navigator', { value: { connection }, configurable: true });
const updates = await import(await sourceURL('../src/lantern/unified-atlas/model-updates.ts'));
assert.equal(updates.readModelUpdates(), 'automatic');
assert.equal(updates.modelUpdatesAllowed(), true);
connection.type = 'cellular';
assert.equal(updates.modelUpdatesAllowed(), false, 'automatic holds off on reported mobile data');
delete connection.type; connection.saveData = true;
assert.equal(updates.modelUpdatesAllowed(), false, 'and with Data Saver');
delete connection.saveData;
updates.setModelUpdates('ask');
assert.equal(updates.readModelUpdates(), 'ask');
assert.equal(updates.modelUpdatesAllowed(), false);
globalThis.localStorage = { getItem() { throw new Error('Generated storage denied'); }, setItem() { throw new Error('Generated storage denied'); } };
assert.equal(updates.readModelUpdates(), 'automatic', 'unavailable storage leaves the default');
// An explicit download or retry authorizes only the selection it was asked for.
const atlas = readFileSync(new URL('../src/lantern/unified-atlas/UnifiedAtlas.tsx', import.meta.url), 'utf8');
assert.ok(atlas.includes("asked === selection || modelUpdatesAllowed()"), 'held downloads are released per selection');
assert.ok(!/attempt > 0 \|\|/.test(atlas), 'a past retry does not release later selections');
console.log('PASS live-host probe and room map download preference');
