/** Isolated synthetic concurrency lane: two independent production cache
 * handles and factories share one synthetic disk. Only hashing is delayed;
 * all digests, transactional generation checks and stored bytes are real.
 * No listener, browser, credentials, session revocation or provider calls. */
import assert from 'node:assert/strict';
import { loadScanCacheSource } from './native-geometry-persistence-harness.mjs';
import { loadClientSource } from './native-geometry-read.mjs';
import { createSyntheticDisk, createSyntheticIndexedDB, syntheticRecords } from './synthetic-indexeddb.mjs';

const source = await loadScanCacheSource();
const { openNativeGeometryScanCache, SCAN_CACHE_DATABASE } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const disk = createSyntheticDisk(), open = () => openNativeGeometryScanCache(createSyntheticIndexedDB(disk));
const oldPage = open(), signingOut = open(), bytes = new Uint8Array([1, 2, 3]);
const rows = () => syntheticRecords(disk, SCAN_CACHE_DATABASE, 'entries');
await oldPage.read('setup', 'missing'); await signingOut.read('setup', 'missing');
oldPage.write('baseline', 'slot', 'version', bytes);
assert.deepEqual(await oldPage.read('baseline', 'version'), bytes);

const subtle = crypto.subtle, own = Object.getOwnPropertyDescriptor(subtle, 'digest'), original = subtle.digest.bind(subtle);
let release, reached, timeout;
const held = new Promise(resolve => { release = resolve; });
const hashing = new Promise(resolve => { reached = resolve; });
Object.defineProperty(subtle, 'digest', { configurable: true, value: async (algorithm, data) => {
  if (new TextDecoder().decode(data).includes('pending-old-page')) { reached(); await held; }
  return original(algorithm, data);
} });
try {
  oldPage.write('pending-old-page', 'slot', 'version', bytes);
  await Promise.race([hashing, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Queued write did not reach hashing')), 2000); })]);
  clearTimeout(timeout);
  await signingOut.clear();
  assert.equal(rows().length, 0);
  release();
  await oldPage.close();
  assert.equal(rows().length, 0, 'The other page must not repopulate after clear commits');
} finally {
  clearTimeout(timeout); release();
  if (own) Object.defineProperty(subtle, 'digest', own); else delete subtle.digest;
  await oldPage.close();
}
console.log('PASS sign-out clear fences another page’s queued write while hashing is pending');

// The clearing handle may cache a newly authorized read; old handles remain
// fenced, and a newly opened page observes the new durable generation.
signingOut.write('new-session', 'slot', 'version', bytes);
assert.deepEqual(await signingOut.read('new-session', 'version'), bytes);
const stalePage = open(); await stalePage.read('new-session', 'version');
await signingOut.clear();
stalePage.write('new-session', 'slot', 'late-version', bytes);
await stalePage.close();
assert.equal(rows().length, 0);
const newPage = open();
await newPage.ready();
newPage.write('new-session', 'slot', 'new-version', bytes);
assert.deepEqual(await newPage.read('new-session', 'new-version'), bytes);
await newPage.close();
const openingPage = open();
openingPage.write('pending-open', 'slot', 'version', bytes);
await signingOut.clear(); await openingPage.close();
assert.equal(rows().length, 0, 'An uninitialized queued write must not join a later generation');
await signingOut.close();
console.log('PASS old handles stay fenced after clear; clearing and newly opened handles can store fresh reads');

// Exercise the actual integration's production logout/cleanup sequencing.
// A page joining while the server transition is pending is still authorized;
// its generation and bytes must be cleared once that transition completes.
const { signOutWithScanCleanup } = await import(await loadClientSource());
const logoutPage = open(); await logoutPage.ready();
let completeLogout;
const logoutPending = new Promise(resolve => { completeLogout = resolve; });
const signedOut = signOutWithScanCleanup(() => logoutPending, () => logoutPage.clear());
const joiningPage = open(); await joiningPage.ready();
joiningPage.write('still-authorized', 'slot', 'version', bytes);
assert.deepEqual(await joiningPage.read('still-authorized', 'version'), bytes);
assert.equal(rows().length, 1);
completeLogout(); await signedOut;
assert.equal(rows().length, 0, 'Cleanup must run after logout, covering pages that joined while it was pending');
joiningPage.write('still-authorized', 'slot', 'late-version', bytes);
await joiningPage.close();
assert.equal(rows().length, 0, 'The page that joined during logout must now be fenced');
await logoutPage.close();
console.log('PASS logout completion clears and fences a page that joined during the pending server transition');
console.log('PASS isolated synthetic cross-page scan-cache clear; not browser or iOS proof');
