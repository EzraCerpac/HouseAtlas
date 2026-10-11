import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { QuantityPreview } from '../components/QuantityPreview';
import { QuantityHandoffs } from '../../webmcp/quantity/QuantityHandoff';
import { createQuantityClient } from '../../../integration/quantity-client';
import { equalQuantityJson, QuantityActionError } from '../../api/quantity-client';
import type { QuantitySessionBinding } from '../../api/quantity-client';
import { healthyQuantityFixture } from './healthy.examples';
/** Separate regression lane: one bounded synthetic failure-injection case. Fake transport only; no real auth, issuer, provider or HTTP.
 * Import is inert. Run only after review of this complete body. */
const assertRegression = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const api = '/api/atlas/homebox/quantity';
const approveLabel = 'Approve this exact quantity change', submitLabel = 'Submit quantity change';
/** An external unconfirmed preview POST on the same client notifies the mounted handoff view. No click, approval, dispatch or lifecycle case. */
export async function runQuantityUncertaintyNotificationRegression(container: HTMLElement) {
  const fixture = healthyQuantityFixture;
  const reason = fixture.preview.request.reason;
  const calls: Array<{ route: string; path: string; method: string; body: unknown; status: number }> = [];
  const violations: string[] = [];
  const identity = {};
  const binding: QuantitySessionBinding = { identity, scope: fixture.source, session: {
    schemaVersion: 1, actorId: 'synthetic-actor', csrfToken: 'synthetic-csrf', expiresAt: '2099-01-01T00:00:00Z',
  } };
  // Bounded injection: only the second preview POST is answered 500. A preview 503 decodes as a definite 'unavailable' and records no hold.
  // Violations are recorded and asserted afterwards; a throw here would itself become a client hold.
  const injectedStatus = 500;
  const transport: typeof fetch = async (input, init) => {
    const path = String(input), method = init?.method ?? 'GET', route = `${method} ${path.split('?')[0]}`;
    if (!(init?.credentials === 'same-origin' && init.cache === 'no-store' && init.redirect === 'error')) violations.push(`Transport options differ: ${route}`);
    const headers = new Headers(init?.headers);
    if (method === 'GET' ? headers.has('X-Atlas-CSRF') : headers.get('X-Atlas-CSRF') !== 'synthetic-csrf') violations.push(`CSRF placement differs: ${route}`);
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
    const prior = calls.filter(call => call.route === route).length;
    const status = route === `GET ${api}/availability` && prior === 0 ? 200
      : route === `POST ${api}/preview` && prior === 0 ? 200
      : route === `POST ${api}/preview` && prior === 1 ? injectedStatus : 404;
    calls.push({ route, path, method, body, status });
    if (status === 404) violations.push(`Unexpected synthetic route: ${route}`);
    const payload = status !== 200 ? null : method === 'GET' ? fixture.availability : fixture.preview;
    return new Response(payload === null ? null : JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
  };
  const client = createQuantityClient({ getSessionBinding: () => binding, subscribeSessionBinding: () => () => {}, transport });
  // One unaborted signal throughout; no cancellation case.
  const signal = new AbortController().signal;
  const availability = await client.checkAvailability(fixture.source, signal);
  assertRegression(availability.state === 'available' && calls.length === 1 && calls[0]!.route === `GET ${api}/availability`, 'Explicit availability is the only GET');
  const prepared = await client.preview(fixture.source, 3, reason, signal);
  const wire = prepared.wire;
  assertRegression(calls.length === 2 && calls[1]!.status === 200 && equalQuantityJson(calls[1]!.body, { source: fixture.source, quantity: 3, reason }), 'One explicit preview POST with exact body');
  assertRegression(Object.isFrozen(prepared) && Object.isFrozen(wire) && equalQuantityJson(wire, fixture.preview), 'Prepared preview holds the frozen original wire');
  assertRegression(violations.length === 0, `Synthetic transport violations: ${violations.join('; ')}`);
  const store = new QuantityHandoffs(client);
  const reservation = store.agentPort().reserve();
  assertRegression(reservation, 'Handoff reservation is available');
  // Observed only; this case never settles, ends or drops the wait.
  const wait = { outcome: 'pending' as 'pending' | 'resolved' | 'rejected' };
  reservation!.offer(prepared, signal).then(() => { wait.outcome = 'resolved'; }, () => { wait.outcome = 'rejected'; });
  const snapshot = store.getSnapshot();
  assertRegression(snapshot && snapshot.prepared === prepared, 'Store snapshot offers the original prepared object');
  const handoff = snapshot!;
  const ledgerBefore = handoff.getState();
  assertRegression(ledgerBefore.open && !ledgerBefore.settled && !ledgerBefore.inFlight && !ledgerBefore.approvalAttempted && !ledgerBefore.submissionAttempted && reservation!.custody() === null, 'Ledger is open with no attempt');
  assertRegression(client.getUncertainty(fixture.source) === null, 'No hold before the injected failure');
  const mounted = createRoot(container);
  const cacheQuantity = 2;
  flushSync(() => { mounted.render(<><p data-synthetic-cache>Cached quantity: {cacheQuantity}</p><QuantityPreview client={client} source={handoff.prepared.wire.source} renderIdentity={handoff} sourceIdentity={handoff} handoff={handoff} /></>); });
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
  const until = async (condition: () => boolean, message: string) => {
    for (let i = 0; i < 200; i++) { if (condition()) return; await tick(); }
    throw new Error(message);
  };
  const button = (label: string) => [...container.querySelectorAll('button')].find(node => node.textContent === label);
  await settle();
  assertRegression(calls.length === 2, 'Mounting the handoff sends no request');
  assertRegression(!button('Check quantity availability') && !button('Preview quantity change'), 'Handoff view offers no new availability or preview action');
  const approveBefore = button(approveLabel), submitBefore = button(submitLabel);
  assertRegression(approveBefore && !approveBefore.disabled, 'Approve is enabled before the hold');
  // Human-required policy: Submit stays disabled until an issued approval, which this case never requests.
  assertRegression(submitBefore && submitBefore.disabled, 'Submit awaits an issued approval before the hold');
  assertRegression(!container.querySelector('[role="alert"]'), 'No alert before the hold');
  const savedRequest = container.querySelector('details pre')?.textContent ?? '';
  assertRegression(savedRequest && equalQuantityJson(JSON.parse(savedRequest), fixture.preview.request), 'Full original request is shown');
  const domBefore = container.innerHTML;
  // External to the mounted view: the same client and original source, no UI click.
  let failure: unknown = null;
  try { await client.preview(fixture.source, 3, reason, signal); } catch (error) { failure = error; }
  assertRegression(failure instanceof QuantityActionError && failure.state === 'unknown' && failure.action === 'preview', 'Injected preview failure rejects as unknown');
  const error = failure as QuantityActionError;
  assertRegression(calls.length === 3 && calls[2]!.status === injectedStatus && equalQuantityJson(calls[2]!.body, { source: fixture.source, quantity: 3, reason }), 'Exactly one injected preview POST');
  const held = client.getUncertainty(fixture.source);
  assertRegression(typeof held === 'string' && held === client.getUncertainty(wire.source), 'Client records the hold for the original source');
  await until(() => container.querySelector('[role="alert"]')?.textContent === held, 'Mounted view did not show the exact hold');
  await settle();
  const alert = container.querySelector('[role="alert"]')!.textContent;
  const approveAfter = button(approveLabel), submitAfter = button(submitLabel);
  assertRegression(alert === held && approveAfter?.disabled && submitAfter?.disabled, 'Exact hold shown; Approve and Submit disabled');
  assertRegression(handoff.getState() === ledgerBefore && store.getSnapshot() === handoff && handoff.prepared === prepared && prepared.wire === wire && equalQuantityJson(wire, fixture.preview), 'Ledger, prepared object and full wire are unchanged by the hold');
  assertRegression(reservation!.custody() === null && wait.outcome === 'pending', 'Custody stays unsettled and the wait pending');
  assertRegression(container.querySelector('details pre')?.textContent === savedRequest, 'Full original request is unchanged');
  assertRegression(container.querySelector('[data-synthetic-cache]')?.textContent === 'Cached quantity: 2', 'Cached quantity is unchanged');
  assertRegression(calls.length === 3 && calls.filter(call => call.method === 'GET').length === 1 && calls.filter(call => call.method === 'POST').length === 2
    && calls.every(call => !call.path.endsWith('/approval') && !call.path.endsWith('/dispatch')), 'One GET and two preview POSTs; no approval or dispatch');
  assertRegression(violations.length === 0, `Synthetic transport violations: ${violations.join('; ')}`);
  const domAfter = container.innerHTML;
  return { synthetic: true as const, requestCounts: { GET: 1, POST: 2 }, calls, held, alert, failure: { state: error.state, action: error.action, message: error.message }, domBefore, domAfter, unmount: () => mounted.unmount() };
}
