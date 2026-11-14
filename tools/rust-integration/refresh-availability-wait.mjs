// Shared by the loopback flows that replace the browser's session with a raw
// in-page login. The app's HomeBox refresh availability GET
// (HomeboxRefreshButton, mounted lazily in the Sources section) can still be
// in flight then. The raw login replaces the session without the app being
// told, so the app cannot abort that GET, and an answer after it is a 401 for
// the ended session. Flows wait here before switching accounts; every response
// they observe must still be an ordinary success.
const REFRESH_PATH = /^\/api\/atlas\/providers\/homebox\/workspaces\/[^/]+\/homes\/[^/]+\/refresh$/;
const SOURCES_SHOWN = "Boolean(document.querySelector('dl.facts.sources'))";
// How long a shown Sources section may take to issue its first GET. If none
// has been issued by then and none is in flight, there is nothing to wait for.
const ISSUE_GRACE_MS = 3000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function refreshAvailabilityReads() {
  const pending = new Set();
  let issuedSinceLogin = 0;
  return {
    /** Feed every CDP event of the page's session. */
    observe({ method, params }) {
      if (method === 'Network.requestWillBeSent') {
        if (params.request.method === 'GET' && REFRESH_PATH.test(new URL(params.request.url).pathname)) {
          pending.add(params.requestId); issuedSinceLogin += 1;
        }
      } else if (method === 'Network.responseReceived') {
        pending.delete(params.requestId);
        if (new URL(params.response.url).pathname === '/api/atlas/auth/login' && params.response.status === 200) issuedSinceLogin = 0;
      } else if (method === 'Network.loadingFailed') pending.delete(params.requestId);
    },
    /** Resolves once no availability GET of the current session is in flight. */
    async settled(evaluate, ms = 20000) {
      const start = Date.now();
      for (;;) {
        const waited = Date.now() - start;
        if (pending.size) {
          if (waited >= ms) throw new Error('Timed out: HomeBox refresh availability read settled before session replacement');
        } else if (issuedSinceLogin || waited >= ISSUE_GRACE_MS || !(await evaluate(SOURCES_SHOWN))) return;
        await delay(25);
      }
    },
  };
}
