import { createServer } from 'node:http';
import type { Config } from './config.ts';
import type { Store } from './store.ts';
import { parseAction } from './actions.ts';
import type { Actions } from './actions.ts';
import { parseJson } from './config.ts';
import { canonical } from './inventory.ts';

export function reply(store: Store, method: string, path: string, now = Date.now()) {
  if (method !== 'GET') return { status: 405, body: '{"error":"method-not-allowed"}' };
  const inventory = store.inventory();
  if (path === '/api/health') return { status: 200, body: JSON.stringify({ version: 1, ok: true, collector: store.status() }) };
  if (path === '/api/results') return { status: 200, body: JSON.stringify(store.extras()) };
  if (!['/api/inventory', '/api/measurements'].includes(path)) return { status: 404, body: '{"error":"not-found"}' };
  if (!inventory) return { status: 503, body: '{"error":"inventory-unavailable"}' };
  const body = path === '/api/inventory' ? canonical(inventory) : JSON.stringify(store.measurements(now, inventory));
  if (Buffer.byteLength(body) > 64 * 1024 * 1024) return { status: 503, body: '{"error":"response-limit"}' };
  return { status: 200, body };
}
type Request = {
  method?: string; url?: string;
  headers: { host?: string; origin?: string };
  socket: { localAddress?: string; remoteAddress?: string; setTimeout?: (ms: number) => unknown };
};
function permitted(listen: Config['listen'], req: Request) {
  const authority = `${listen.address === '::1' ? '[::1]' : listen.address}:${listen.port}`;
  // Validate browser-controlled authority before any store read. Socket checks
  // alone do not prevent DNS rebinding to the loopback listener.
  if (req.socket.localAddress !== listen.address || req.socket.remoteAddress !== listen.address
    || req.headers.host !== authority
    || (req.headers.origin !== undefined && req.headers.origin !== `http://${authority}`)) {
    return false;
  }
  return true;
}
export function requestReply(store: Store, listen: Config['listen'], req: Request) {
  if (!permitted(listen, req)) return { status: 403, body: '{"error":"request-refused"}' };
  return reply(store, req.method ?? '', req.url ?? '');
}
export async function actionReply(config: Config, actions: Actions, req: Request & { headers: { 'content-type'?: string }; [Symbol.asyncIterator](): AsyncIterator<Uint8Array> }) {
  // Reuse the GET authority fence before reading a byte or accessing owners.
  if (!permitted(config.listen, req) || req.headers.origin !== undefined) return { status: 403, body: '{"error":"request-refused"}' };
  if (req.headers['content-type'] !== 'application/json') return { status: 415, body: '{"error":"content-type"}' };
  let size = 0;
  const chunks: Buffer[] = [];
  let action;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) return { status: 413, body: '{"error":"body-limit"}' };
      chunks.push(Buffer.from(chunk));
    }
    action = parseAction(parseJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))), config);
  } catch { return { status: 400, body: '{"error":"invalid-action"}' }; }
  // The 5-second upload/idle bound must not cut off a bounded speed run.
  req.socket.setTimeout?.(75_000);
  return actions.execute(action);
}
export function server(store: Store, listen: Config['listen'], config?: Config, actions?: Actions) {
  const http = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000, keepAliveTimeout: 1000 }, async (req, res) => {
    try {
      const r = req.method === 'POST' && req.url === '/api/actions' && config && actions
        ? await actionReply(config, actions, req) : requestReply(store, listen, req);
      res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(r.body), ...(r.status === 405 ? { Allow: 'GET' } : {}) });
      res.end(r.body);
      req.socket.setTimeout(5000);
    } catch { res.writeHead(503); res.end('{"error":"read-unavailable"}'); }
  });
  http.maxConnections = 16;
  http.maxRequestsPerSocket = 16;
  http.on('connection', socket => socket.setTimeout(5000, () => socket.destroy()));
  return http;
}
