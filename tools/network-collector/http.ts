import { createServer } from 'node:http';
import type { Config } from './config.ts';
import type { Store } from './store.ts';
import { canonical } from './inventory.ts';

export function reply(store: Store, method: string, path: string, now = Date.now()) {
  if (method !== 'GET') return { status: 405, body: '{"error":"method-not-allowed"}' };
  const inventory = store.inventory();
  if (path === '/api/health') return { status: 200, body: JSON.stringify({ version: 1, ok: true, collector: store.status() }) };
  if (!['/api/inventory', '/api/measurements'].includes(path)) return { status: 404, body: '{"error":"not-found"}' };
  if (!inventory) return { status: 503, body: '{"error":"inventory-unavailable"}' };
  const body = path === '/api/inventory' ? canonical(inventory) : JSON.stringify(store.measurements(now, inventory));
  if (Buffer.byteLength(body) > 64 * 1024 * 1024) return { status: 503, body: '{"error":"response-limit"}' };
  return { status: 200, body };
}
type Request = {
  method?: string; url?: string;
  headers: { host?: string; origin?: string };
  socket: { localAddress?: string; remoteAddress?: string };
};
export function requestReply(store: Store, listen: Config['listen'], req: Request) {
  const authority = `${listen.address === '::1' ? '[::1]' : listen.address}:${listen.port}`;
  // Validate browser-controlled authority before any store read. Socket checks
  // alone do not prevent DNS rebinding to the loopback listener.
  if (req.socket.localAddress !== listen.address || req.socket.remoteAddress !== listen.address
    || req.headers.host !== authority
    || (req.headers.origin !== undefined && req.headers.origin !== `http://${authority}`)) {
    return { status: 403, body: '{"error":"request-refused"}' };
  }
  return reply(store, req.method ?? '', req.url ?? '');
}
export function server(store: Store, listen: Config['listen']) {
  const http = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000, keepAliveTimeout: 1000 }, (req, res) => {
    try {
      const r = requestReply(store, listen, req);
      res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(r.body), ...(r.status === 405 ? { Allow: 'GET' } : {}) });
      res.end(r.body);
    } catch { res.writeHead(503); res.end('{"error":"read-unavailable"}'); }
  });
  http.maxConnections = 16;
  http.maxRequestsPerSocket = 16;
  http.on('connection', socket => socket.setTimeout(5000, () => socket.destroy()));
  return http;
}
