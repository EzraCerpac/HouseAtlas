/* Example page only (scope /example/). The build plugin prepends BUILD and
 * TABLE: every public file of dist/example with its size, SHA-256 and type.
 * It caches and serves only those files, under its own cache name; no API,
 * auth, media, root, Saved or household route is intercepted, and it never
 * opens or removes another cache. The example's data is generated in the page. */
const PREFIX = 'houseatlas-example-', NAME = PREFIX + BUILD, ENTRY = '/example/index.html';
const NAVIGATION_TIMEOUT_MS = 2_000;
const byPath = new Map(TABLE.map(row => [row.path, row]));
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
async function verified(response, pin) {
  if (!response || response.status !== 200 || response.type === 'opaque' || response.redirected
    || response.headers.get('content-type')?.split(';')[0].trim() !== pin.mime) throw Error('Example file unavailable');
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== pin.bytes || await digest(bytes) !== pin.sha256) throw Error('Example file changed');
  return response;
}
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(NAME);
  try {
    for (const pin of TABLE) {
      const url = new URL(pin.path, self.location.origin);
      try { await verified(await cache.match(url), pin); continue; } catch { /* not held yet */ }
      await cache.put(url, await verified(await fetch(url, { credentials: 'omit', redirect: 'error', cache: 'reload' }), pin));
    }
  } catch (error) { await caches.delete(NAME); throw error; }
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== NAME) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !byPath.has(url.pathname)) return;
  // The entry keeps its starting-state query; built files are requested without one.
  if (request.mode === 'navigate' ? url.pathname !== ENTRY : url.search !== '') return;
  const held = () => caches.open(NAME).then(cache => cache.match(new URL(url.pathname, self.location.origin)));
  if (request.mode !== 'navigate') {
    event.respondWith(held().then(response => response ?? fetch(request)));
    return;
  }
  // The entry prefers the network, so a new build is picked up online; a
  // rejected or silent read (offline, captive portal) opens the held entry.
  event.respondWith((async () => {
    const network = fetch(request, { cache: 'no-store' });
    let timer;
    const silent = new Promise(resolve => { timer = setTimeout(resolve, NAVIGATION_TIMEOUT_MS, null); });
    try {
      const response = await Promise.race([network, silent]);
      if (response) return response;
    } catch { /* offline: use the held entry */ } finally { clearTimeout(timer); }
    return await held() ?? network;
  })());
});
