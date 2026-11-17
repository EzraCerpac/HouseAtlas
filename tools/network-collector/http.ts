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
export function server(store: Store, listen: Config['listen']) {
  const http = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000, keepAliveTimeout: 1000 }, (req, res) => {
    // Exact local peer and local binding checks. No forwarded headers or DNS.
    if (req.socket.localAddress !== listen.address || req.socket.remoteAddress !== listen.address) { res.writeHead(403); res.end(); return; }
    try {
      const r = reply(store, req.method ?? '', req.url ?? '');
      res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(r.body), ...(r.status === 405 ? { Allow: 'GET' } : {}) });
      res.end(r.body);
    } catch { res.writeHead(503); res.end('{"error":"read-unavailable"}'); }
  });
  http.maxConnections = 16;
  http.maxRequestsPerSocket = 16;
  http.on('connection', socket => socket.setTimeout(5000, () => socket.destroy()));
  return http;
}
