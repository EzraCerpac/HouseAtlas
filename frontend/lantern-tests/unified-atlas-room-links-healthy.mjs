// Named ordinary positive: generated authenticated room-map delivery through
// the production reader. No actual network, native authority, browser or held
// malformed/denial/withdrawal/replay/expiry controls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
assert.equal(process.version, 'v26.10.0');
assert.deepEqual(process.argv.slice(2), []);
const asURL = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function sourceURL(relative, replacements = {}) {
  const path = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(path, 'utf8'), path.pathname,
    { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  for (const [name, target] of Object.entries(replacements)) {
    assert.ok(code.includes(JSON.stringify(name)));
    code = code.replaceAll(JSON.stringify(name), JSON.stringify(target));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert.ok(match[1].startsWith('data:') || match[1].startsWith('file:'));
  return asURL(code);
}
const typesURL = await sourceURL('../src/lantern/unified-atlas/types.ts');
const readerURL = await sourceURL('../integration/unified-atlas-room-links-reader.ts', {
  '../src/lantern/unified-atlas/types': typesURL,
});
const { readUnifiedAtlasRoomLinks } = await import(readerURL);
const U = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const scope = Object.freeze({ workspaceId: U(1), homeId: U(2) });
const selection = Object.freeze({ owner: Object.freeze({}), scope, publicationId: U(3), manifestSha256: 'a'.repeat(64),
  expiresAt: new Date(Date.now() + 600_000).toISOString() });
const sceneSelection = Object.freeze({ ...scope, publicationId: U(3), revision: 'b'.repeat(64), semanticsSha256: 'c'.repeat(64) });
const publicationRooms = Object.freeze([
  Object.freeze({ roomId: 'generated:house-room', buildingId: 'generated:house', nativePlaceId: U(10), occurrenceIds: Object.freeze(['generated:occ-house']) }),
  Object.freeze({ roomId: 'generated:studio-room', buildingId: 'generated:studio', nativePlaceId: U(11), occurrenceIds: Object.freeze(['generated:occ-studio']) }),
  Object.freeze({ roomId: 'generated:unmapped', buildingId: 'generated:house', nativePlaceId: null, occurrenceIds: Object.freeze(['generated:occ-unmapped']) }),
]);
const links = [
  { roomId: publicationRooms[0].roomId, nativePlaceId: U(10), packagePlaceKey: 'generated:room', packagePlaceUuid: U(20) },
  { roomId: publicationRooms[1].roomId, nativePlaceId: U(11), packagePlaceKey: 'generated:room', packagePlaceUuid: U(21) },
];
const origin = 'https://atlas.generated.invalid';
const expectedURL = `${origin}/api/atlas/models/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/atlas/${selection.publicationId}/room-links`
  + `?expectedSemanticsSha256=${sceneSelection.semanticsSha256}&expectedSelectionRevision=${sceneSelection.revision}`;
let reads = 0;
async function deliver(declaredLinks, rooms = publicationRooms) {
  const map = { profile: 'houseatlas.unified-atlas-room-links.v1', ...scope, publicationId: selection.publicationId,
    semanticsSha256: sceneSelection.semanticsSha256, links: declaredLinks };
  const bytes = new TextEncoder().encode(JSON.stringify(map));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let currentChecks = 0;
  const result = await readUnifiedAtlasRoomLinks({ selection, sceneSelection, publicationRooms: rooms, origin,
    signal: new AbortController().signal, isCurrent: () => { currentChecks++; return true; },
    transport: async (url, options) => {
      reads++; assert.equal(url, expectedURL); assert.equal(options.method, 'GET');
      assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
      assert.deepEqual(options.headers, { Accept: 'application/json' });
      return new Response(bytes, { status: 200, headers: {
        'content-type': 'application/json', 'content-length': String(bytes.byteLength), 'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff', 'x-atlas-selection-revision': sceneSelection.revision,
        'content-digest': `sha-256=:${Buffer.from(sha256, 'hex').toString('base64')}:`,
      } });
    } });
  assert.ok(currentChecks > 0); assert.equal(result.sha256, sha256);
  assert.deepEqual(result.reviewedRoomLinks, map);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.reviewedRoomLinks) && Object.isFrozen(result.reviewedRoomLinks.links));
  assert.ok(result.reviewedRoomLinks.links.every(Object.isFrozen));
  return result;
}
const original = JSON.stringify(publicationRooms);
const whole = await deliver(links);
assert.equal(whole.reviewedRoomLinks.links.length, 2, 'one publication map retains links from both buildings');
assert.equal(JSON.stringify(publicationRooms), original, 'independent review does not mutate producer room facts');
assert.equal(whole.reviewedRoomLinks.links.some(link => link.roomId === 'generated:unmapped'), false, 'no link is invented for another room');
const empty = await deliver([]);
assert.equal(empty.reviewedRoomLinks.links.length, 0, 'a valid empty selected map remains empty');
const longRoom = 'r'.repeat(128), longKey = 'p'.repeat(128);
await deliver([{ roomId: longRoom, nativePlaceId: U(30), packagePlaceKey: longKey, packagePlaceUuid: U(31) }], [
  { roomId: longRoom, buildingId: 'generated:annex', nativePlaceId: U(30), occurrenceIds: ['generated:occ-annex'] },
]);
assert.equal(reads, 3);
// Normal map refreshes while a slower native open remains pending. Time and
// the base lease are in-process fakes; no timeout/expiry/withdrawal branch runs.
const ownerURL = await sourceURL('../integration/unified-atlas-room-links-owner.ts');
const { createReviewedRoomLinksOverlayOwner } = await import(ownerURL);
const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
const timers = new Map(), contextListeners = new Set(), nativeListeners = new Set();
let clock = 0, timerId = 0, refreshes = 0, disposals = 0, nativeReady = false, nativeDisposed = false, owner;
let resolveNative, nativeSignal;
const pendingNative = new Promise(resolve => { resolveNative = resolve; });
const frame = Object.freeze({ status: 'available', lease: Object.freeze({}) });
const request = Object.freeze({ sceneSelection, publicationRooms, nativeBuildingId: U(40) });
const flush = async () => { for (let at = 0; at < 12; at++) await Promise.resolve(); };
async function advance(to) {
  for (;;) {
    const next = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    if (!next || next[1].at > to) break;
    clock = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
  }
  clock = to; await flush();
}
try {
  globalThis.setTimeout = (callback, delay) => {
    const id = ++timerId; timers.set(id, { at: clock + Number(delay), callback }); return id;
  };
  globalThis.clearTimeout = id => { timers.delete(id); };
  owner = createReviewedRoomLinksOverlayOwner({ initialReview: Object.freeze({ ...whole, checkedAt: 0 }),
    now: () => clock, signal: new AbortController().signal, isContextCurrent: () => true,
    subscribeContext: changed => { contextListeners.add(changed); return () => { contextListeners.delete(changed); }; },
    readReview: async signal => {
      assert.equal(signal.aborted, false); refreshes++;
      const equivalent = Object.freeze({ ...whole.reviewedRoomLinks,
        links: Object.freeze(whole.reviewedRoomLinks.links.map(link => Object.freeze({ ...link }))) });
      assert.notEqual(equivalent, whole.reviewedRoomLinks);
      return Object.freeze({ ...whole, reviewedRoomLinks: equivalent, checkedAt: clock });
    },
    createSource: reviewCurrent => ({
      open(input, signal) {
        assert.equal(input, request); assert.equal(reviewCurrent(), true);
        nativeSignal = signal; return pendingNative;
      },
      isCurrent(value) { return value === frame && nativeReady && !nativeDisposed && reviewCurrent(); },
      subscribeInvalidation(value, changed) {
        assert.equal(value, frame); nativeListeners.add(changed); return () => { nativeListeners.delete(changed); };
      },
      release() { assert.fail('The normal path disposes the base owner with its original lease'); },
      dispose() { if (nativeDisposed) return; nativeDisposed = true; disposals++; for (const changed of [...nativeListeners]) changed(); },
    }),
  });
  const opening = owner.open(request, new AbortController().signal);
  await advance(10_000); assert.equal(refreshes, 1);
  await advance(20_000); assert.equal(refreshes, 2);
  await advance(25_000);
  nativeReady = true; resolveNative(frame); await flush();
  const returned = await opening;
  assert.equal(returned, frame, 'The same base lease is published after normal map refresh during native opening');
  assert.equal(owner.isCurrent(frame), true); assert.equal(contextListeners.size, 1); assert.equal(nativeListeners.size, 1);
  let invalidations = 0;
  const off = owner.subscribeInvalidation(frame, () => { invalidations++; });
  owner.release(frame);
  assert.equal(owner.isCurrent(frame), false); assert.equal(invalidations, 1);
  assert.equal(disposals, 1); assert.equal(nativeSignal.aborted, true);
  assert.equal(timers.size, 0); assert.equal(contextListeners.size, 0); assert.equal(nativeListeners.size, 0);
  off(); owner.dispose(); assert.equal(disposals, 1);
} finally {
  owner?.dispose(); globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout;
}
console.log('PASS generated authenticated room-map reads: exact query/revision/digest, whole-publication links across two buildings, immutable output, empty map and valid bounded source IDs. No network/native grant, backend admission, cancellation controls, mounted host or browser qualification.');
console.log('PASS normal same-map refresh while native open is pending for 25 simulated seconds; original frame identity, successful ownership and ordinary release/disposal. Fake base lease and timers only; no expiry or withdrawal controls.');
