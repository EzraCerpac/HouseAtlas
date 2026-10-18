/* Public shell only. The build plugin prepends the exact immutable closure. */
const PREFIX = 'houseatlas-saved-public-', NAME = PREFIX + BUILD;
const MARKER = new URL('/saved/.verified-shell', self.location.origin).href;
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
  try {
    for (const pin of TABLE) {
      const url = new URL(pin.path, self.location.origin);
      const response = await fetch(url, { credentials: 'omit', redirect: 'error', cache: 'reload' });
      await verified(response, pin); await cache.put(url, response);
    }
    await cache.put(MARKER, new Response(BUILD, { headers: { 'content-type': 'text/plain' } }));
    await self.skipWaiting();
  } catch (error) { await caches.delete(NAME); throw error; }
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  if (!await ready()) throw Error('Public shell is not verified');
  // Other builds may still serve an active root or Saved registration.
  // Only explicit build-qualified owner cleanup removes a retained cache.
  await self.clients.claim();
})()));
self.addEventListener('message', event => {
  if (event.data !== 'saved-shell-status' || !event.ports[0]) return;
  event.waitUntil((async () => {
    try { event.ports[0].postMessage({ ready: await ready(), buildId: BUILD }); }
    catch { event.ports[0].postMessage({ ready: false, buildId: BUILD }); }
  })());
});
self.addEventListener('fetch', event => {
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
