/** Example page entry. ./isolation is this chunk's only static import, so its
 * replacements are in place before any application module, including shared
 * chunks, is evaluated: ./app and everything it imports load afterwards. */
import './isolation';

void import('./app');
// The example's own worker holds its built files so the page opens offline
// after one online visit. It serves only /example/ files; without a worker
// (development server, blocked or unsupported) the page is online-only.
void navigator.serviceWorker?.register('/example/service-worker.js', { scope: '/example/', updateViaCache: 'none' }).catch(() => undefined);
