/* Public shell only. The build plugin prepends the exact immutable closure. */
const PREFIX = 'houseatlas-saved-public-', NAME = PREFIX + BUILD;
const MARKER = new URL('/saved/.verified-shell', self.location.origin).href;
// Each owned scope records the build it serves, so pruning never removes the
// cache the other registration still runs from (the root lags until its update).
const PINS = 'houseatlas-saved-shell-pins', SCOPE = typeof ROOT_BUILD === 'undefined' ? 'saved' : 'root';
const pinURL = scope => new URL(`/saved/.pin-${scope}`, self.location.origin).href;
const byPath = new Map(TABLE.map(row => [row.path, row]));
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
async function verified(response, pin) {
  if (!response || response.status !== 200 || response.type === 'opaque' || response.redirected
    || response.headers.get('content-type')?.split(';')[0].trim() !== pin.mime) throw Error('Public shell asset unavailable');
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== pin.bytes || await digest(bytes) !== pin.sha256) throw Error('Public shell asset changed');
  return response;
}
async function ready() {
  const cache = await caches.open(NAME), marker = await cache.match(MARKER);
  if (!marker || await marker.text() !== BUILD) return false;
  for (const pin of TABLE) await verified(await cache.match(new URL(pin.path, self.location.origin)), pin);
  return true;
}
self.addEventListener('install', event => event.waitUntil((async () => {
  // A matching already verified cache may still serve an active worker.
  // Changed worker code has a distinct BUILD/name; never delete active bytes.
  if (await ready()) { await self.skipWaiting(); return; }
  const cache = await caches.open(NAME);
  // Hashed assets an earlier build already verified are copied, not downloaded
  // again; each copy passes this build's own pin like a network response.
  const earlier = await Promise.all((await caches.keys()).filter(name => name.startsWith(PREFIX) && name !== NAME).map(name => caches.open(name)));
  const reuse = async (url, pin) => {
    for (const old of earlier) { try { return await verified(await old.match(url), pin); } catch { /* not held or changed */ } }
    return null;
  };
  try {
    for (const pin of TABLE) {
      const url = new URL(pin.path, self.location.origin);
      const response = await reuse(url, pin) ?? await verified(await fetch(url, { credentials: 'omit', redirect: 'error', cache: 'reload' }), pin);
      await cache.put(url, response);
    }
    // Completion time orders builds for pruning; earlier markers lack it (0).
    await cache.put(MARKER, new Response(BUILD, { headers: { 'content-type': 'text/plain', 'x-installed-at': String(Date.now()) } }));
    await self.skipWaiting();
  } catch (error) { await caches.delete(NAME); throw error; }
})()));
const installedAt = marker => Number(marker?.headers.get('x-installed-at')) || 0;
/** Keeps this build, every build a scope pin names, unfinished installs, any
 * build completed after this one, and the most recent earlier one; drops the
 * rest. Nothing is pruned until both scopes have pinned a build, so a root
 * still on an earlier build (or on a worker without pins) keeps its bytes. */
async function pruneEarlierBuilds() {
  const pins = await caches.open(PINS);
  const pinned = await Promise.all(['root', 'saved'].map(async scope => (await pins.match(pinURL(scope)))?.text()));
  if (pinned.some(build => !build)) return;
  const own = installedAt(await (await caches.open(NAME)).match(MARKER));
  const earlier = [];
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX) || name === NAME || pinned.includes(name.slice(PREFIX.length))) continue;
    const marker = await (await caches.open(name)).match(MARKER);
    if (!marker || await marker.text() !== name.slice(PREFIX.length)) continue;
    const at = installedAt(marker);
    if (at <= own) earlier.push({ name, at });
  }
  earlier.sort((a, b) => b.at - a.at);
  for (const { name } of earlier.slice(1)) await caches.delete(name);
}
self.addEventListener('activate', event => event.waitUntil((async () => {
  if (!await ready()) throw Error('Public shell is not verified');
  await (await caches.open(PINS)).put(pinURL(SCOPE), new Response(BUILD, { headers: { 'content-type': 'text/plain' } }));
  await self.clients.claim();
  try { await pruneEarlierBuilds(); } catch { /* Storage stays as it was; the next activation retries. */ }
})()));
self.addEventListener('message', event => {
  if (event.data !== 'saved-shell-status' || !event.ports[0]) return;
  event.waitUntil((async () => {
    try { event.ports[0].postMessage({ ready: await ready(), buildId: BUILD }); }
    catch { event.ports[0].postMessage({ ready: false, buildId: BUILD }); }
  })());
});
self.addEventListener('fetch', event => {
  // The root wrapper imports verification/lifecycle code, never Saved fetch
  // ownership. Only the narrower /saved/ registration serves public bytes.
  if (typeof ROOT_BUILD !== 'undefined') return;
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || url.hash) return;
  // No API, auth, native media, arbitrary route or query interception.
  const pin = byPath.get(url.pathname);
  if (!pin || request.mode === 'navigate' && url.pathname !== '/saved/index.html') return;
  event.respondWith((async () => {
    const cache = await caches.open(NAME);
    const marker = await cache.match(MARKER);
    if (!marker || await marker.text() !== BUILD) throw Error('Public shell unavailable');
    return verified(await cache.match(url), pin);
  })());
});
