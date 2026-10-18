/* No root/application response is cached. Reuse the exact public Saved closure. */
importScripts('/saved/service-worker.js');
if (BUILD !== ROOT_BUILD) throw Error('Root entry and Saved shell builds differ');
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
  event.respondWith((async () => {
    try {
      // Resolved responses, including authentication and HTTP errors, belong
      // to the native host. Only a rejected network read opens retained data.
      return await fetch(request, { cache: 'no-store' });
    } catch (error) {
      if (!await ready()) throw error;
      return Response.redirect(new URL('/saved/index.html', self.location.origin).href, 302);
    }
  })());
});
