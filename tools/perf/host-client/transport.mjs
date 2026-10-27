import assert from 'node:assert/strict';
import { Agent, request } from 'node:https';
import { createPacer } from './options.mjs';

// A narrow Node HTTPS -> Fetch port for the unchanged production adapters.
// Only the newly generated listener is admissible; redirects are never followed.
export function localTransport({ origin, ca, cookie, rate = 10, maxBytes = 8 << 20 }) {
  assert.match(origin, /^https:\/\/127\.0\.0\.1:[0-9]+$/);
  assert(Number.isInteger(rate) && rate >= 1 && rate <= 10);
  const agents = new Set();
  let agent = false, storedCookie = cookie, active = 0, closed = false;
  const pacer = createPacer(rate);
  const rows = [];
  function connection(reuse) {
    assert.equal(active, 0, 'Set connection mode between cohorts');
    if (agent) { agent.destroy(); agents.delete(agent); }
    agent = reuse ? new Agent({ keepAlive: true, maxSockets: 4, maxFreeSockets: 4, maxCachedSessions: 0 }) : false;
    if (agent) agents.add(agent);
  }
  async function ready(signal) {
    assert.equal(active, 0, 'Align only after the preceding cohort settles');
    await pacer.ready(signal);
    assert.equal(active, 0, 'No request may overlap cohort alignment');
  }
  async function fetch(path, init = {}, fault = null, observe = () => {}) {
    assert(!closed, 'Transport closed');
    assert(typeof path === 'string' && path.startsWith('/') && !path.startsWith('//'), 'Relative local path required');
    const url = new URL(path, origin);
    assert.equal(url.origin, origin);
    assert(!url.hash && !url.username && !url.password);
    const signal = init.signal;
    const body = init.body;
    assert(body === undefined || body === null || typeof body === 'string', 'Only bounded JSON text bodies');
    if (body) assert(Buffer.byteLength(body) <= 65536);
    await pacer.wait(signal);
    signal?.throwIfAborted();
    assert(active < 4, 'At most four in-flight requests');
    active++;
    const row = { method: init.method ?? 'GET', startedMs: performance.now(), bytes: 0, reusedSocket: false, status: null, outcome: 'pending' };
    rows.push(row);
    observe(row);
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    let requestObject, responseObject, controller, timer, faultTimer, failure, done = false;
    const end = (outcome, error) => {
      if (done) return;
      done = true; active--;
      clearTimeout(timer); clearTimeout(faultTimer);
      signal?.removeEventListener('abort', abort);
      row.elapsedMs = performance.now() - row.startedMs;
      row.outcome = outcome;
      if (error) row.errorName = error.name;
      finish();
    };
    const abort = () => {
      const error = signal.reason ?? new DOMException('Cancelled', 'AbortError');
      failure?.(error); requestObject?.destroy(error);
    };
    return await new Promise((resolve, reject) => {
      const fail = error => {
        if (done) return;
        end(signal?.aborted ? 'cancelled' : error.name === 'TimeoutError' ? 'timeout' : 'error', error);
        try { controller?.error(error); } catch {}
        reject(error);
      };
      failure = fail;
      const headers = new Headers(init.headers);
      headers.set('Origin', origin); headers.set('Sec-Fetch-Site', 'same-origin');
      if (storedCookie) headers.set('Cookie', storedCookie);
      if (body) headers.set('Content-Length', String(Buffer.byteLength(body)));
      try {
        requestObject = request(url, {
          method: row.method, ca, agent,
          headers: Object.fromEntries(headers),
        }, response => {
          responseObject = response;
          row.reusedSocket = requestObject.reusedSocket;
          row.status = response.statusCode;
          const incoming = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) incoming.set(name, Array.isArray(value) ? value.join(', ') : value);
          }
          if (response.headers['set-cookie']) storedCookie = response.headers['set-cookie'][0].split(';')[0];
          const stream = new ReadableStream({
            start(value) { controller = value; },
            cancel() { requestObject.destroy(new DOMException('Body cancelled', 'AbortError')); end('cancelled'); },
          });
          response.on('error', fail);
          response.on('aborted', () => fail(new Error('TruncatedResponse')));
          const chunks = [];
          response.on('data', chunk => {
            if (done) return;
            row.bytes += chunk.length;
            if (row.bytes > maxBytes) { requestObject.destroy(new RangeError('Response byte limit')); return; }
            // Faults operate only on this adapter's response delivery, after
            // verified local HTTPS. They do not alter the host or its network.
            if (fault) chunks.push(chunk);
            else controller.enqueue(new Uint8Array(chunk));
          });
          response.on('end', () => {
            if (done) return;
            const deliver = () => {
              if (done) return;
              if (signal?.aborted) { abort(); return; }
              if (fault?.kind === 'truncate') {
                const all = Buffer.concat(chunks);
                const prefix = all.subarray(0, Math.floor(all.length / 2));
                if (prefix.length) controller.enqueue(new Uint8Array(prefix));
                fail(new Error('TruncatedResponse')); return;
              }
              if (fault?.kind === 'lost-ack') { fail(new Error('AcknowledgementWithheld')); return; }
              if (fault) for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
              controller.close(); end('ok');
            };
            if (fault?.kind === 'delay') faultTimer = setTimeout(deliver, fault.ms);
            else deliver();
          });
          const noBody = row.method === 'HEAD' || [204, 205, 304].includes(response.statusCode);
          resolve(new Response(noBody ? null : stream, { status: response.statusCode, headers: incoming }));
        });
        requestObject.on('error', fail);
        timer = setTimeout(() => {
          const error = new DOMException('Request deadline', 'TimeoutError');
          fail(error); requestObject.destroy(error);
        }, 5000);
        if (signal) {
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        }
        requestObject.end(body);
      } catch (error) { requestObject?.destroy(); responseObject?.destroy(); fail(error); }
    }).then(response => {
      // Retain settlement only internally; public samples never include headers,
      // cookie, URL, payload, server output or generated credentials.
      Object.defineProperty(response, 'localFinished', { value: finished });
      return response;
    });
  }
  return {
    fetch, rows, connection, ready,
    get active() { return active; },
    close() { closed = true; for (const owned of agents) owned.destroy(); agents.clear(); },
  };
}
