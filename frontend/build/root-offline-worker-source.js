/* No root/application response is cached. Reuse the exact public Saved closure. */
importScripts('/saved/service-worker.js');
if (BUILD !== ROOT_BUILD) throw Error('Root entry and Saved shell builds differ');
const NAVIGATION_TIMEOUT_MS = 2_000;
self.addEventListener('message', event => {
  if (event.data !== 'root-entry-status' || !event.ports[0]) return;
  event.waitUntil((async () => {
    try { event.ports[0].postMessage({ ready: await ready(), buildId: ROOT_BUILD }); }
    catch { event.ports[0].postMessage({ ready: false, buildId: ROOT_BUILD }); }
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || request.mode !== 'navigate' || url.origin !== self.location.origin
    || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '/index.html')) return;
  // Verification that throws (missing or changed public bytes, storage
  // failure) means no verified Saved shell: keep the network's answer.
  const handoff = async () => { try { return await ready(); } catch { return false; } };
  event.respondWith((async () => {
    const network = fetch(request, { cache: 'no-store' });
    let timer;
    // A server that accepts the connection but never answers (weak signal,
    // captive portal, sleeping host) counts as unavailable after this long.
    const silent = new Promise(resolve => { timer = setTimeout(resolve, NAVIGATION_TIMEOUT_MS, null); });
    try {
      // Resolved responses, including authentication and HTTP errors, belong
      // to the native host. Only a rejected or silent network read opens retained data.
      const response = await Promise.race([network, silent]);
      if (response) return response;
      if (!await handoff()) return network;
    } catch (error) {
      if (!await handoff()) throw error;
    } finally { clearTimeout(timer); }
    return Response.redirect(new URL('/saved/index.html', self.location.origin).href, 302);
  })());
});
