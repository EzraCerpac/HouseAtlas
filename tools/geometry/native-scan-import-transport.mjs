/** Ordinary HTTPS through the existing selected Tailscale SOCKS route. */
import { spawn } from 'node:child_process';

const MAX_RESPONSE = 12 * 1024 * 1024, MAX_HEADERS = 64 * 1024, MAX_REQUEST = 11 * 1024 * 1024;
function need(value, message) { if (!value) throw new Error(message); }
const quote = value => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
export function parseCurlResponse(bytes) {
  let offset = 0;
  for (let interim = 0; interim < 8; interim++) {
    const end = bytes.indexOf('\r\n\r\n', offset);
    need(end >= offset && end - offset <= MAX_HEADERS, 'Invalid HTTPS response headers');
    const lines = bytes.subarray(offset, end).toString('latin1').split('\r\n');
    const match = /^HTTP\/(?:1\.[01]|2|3) ([0-9]{3})(?: |$)/.exec(lines.shift());
    need(match, 'Invalid HTTPS status');
    const status = Number(match[1]); offset = end + 4;
    if (status >= 100 && status < 200) continue;
    const headers = new Headers();
    for (const line of lines) {
      const colon = line.indexOf(':'); need(colon > 0, 'Invalid HTTPS header');
      headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
    }
    need(status >= 200 && status <= 599 && bytes.length - offset <= MAX_RESPONSE, 'HTTPS response exceeded bound');
    return new Response(status === 204 || status === 304 ? null : bytes.subarray(offset), { status, headers });
  }
  throw new Error('Too many intermediate HTTPS responses');
}

export function createNativeCurlTransport({ origin, proxy, scope }) {
  const selected = new URL(origin);
  need(selected.protocol === 'https:' && selected.origin === origin && !selected.username && !selected.password,
    'Select a canonical HTTPS origin');
  need(proxy === 'socks5h://127.0.0.1:11080', 'Use the existing approved Tailscale SOCKS route');
  need(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(scope?.workspaceId)
    && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(scope?.homeId), 'Select an exact native scope');
  const u = '[0-9a-f-]{36}', prefix = `/api/atlas/(?:stock/v3|geometry/v1|scene/v1|editing/v1)/workspaces/${scope.workspaceId}/homes/${scope.homeId}`;
  const auth = /^\/api\/atlas\/auth\/(?:mode|proxy|session|logout)$/;
  const scoped = new RegExp(`^${prefix}/(?:admission|invoke|commands|assets(?:/${u}/review-proof)?|records/[a-z-]+(?:/${u}(?:/history)?)?|originals(?:/${u}/derivative)?|buildings/${u}(?:/associations|/current|/frames/[0-9a-f]{64}/meshes/[0-9a-f]{64})?|native-places/${u}(?:/evidence(?:/requests/${u})?)?)$`);
  const media = new RegExp(`^/api/atlas/media/${scope.workspaceId}/${scope.homeId}/[0-9a-f]{64}/(?:download|preview)$`);
  const sceneHeadList = `/api/atlas/stock/v3/workspaces/${scope.workspaceId}/homes/${scope.homeId}/records/scene-association`;
  let cookie = null;
  const exchange = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, origin);
    need(url.origin === origin && !url.hash && !url.username && !url.password,
      'Native request escaped the selected origin');
    need(auth.test(url.pathname) || scoped.test(url.pathname) || media.test(url.pathname) || url.pathname === '/api/atlas/retained-intent',
      'Native route is not in the import closure');
    const method = init.method ?? 'GET'; need(method === 'GET' || method === 'POST', 'Unsupported native method');
    need(!url.search || method === 'GET' && (url.pathname.endsWith('/invoke')
      || url.pathname === sceneHeadList && url.search === '?pageSize=100&includeArchived=true'),
    'Unexpected native URL selector');
    const signal = init.signal; signal?.throwIfAborted();
    const headers = new Headers(init.headers);
    for (const key of headers.keys()) need(!/^(cookie|host|authorization|x-forwarded|x-atlas-proxy|proxy-)/i.test(key), 'Caller supplied identity header');
    headers.set('Origin', origin); headers.set('Sec-Fetch-Site', 'same-origin');
    headers.set('Referer', origin + '/'); if (cookie) headers.set('Cookie', cookie);
    let body = null;
    if (init.body !== undefined && init.body !== null) {
      if (typeof init.body === 'string') need(Buffer.byteLength(init.body) <= MAX_REQUEST, 'Native request exceeded byte bound');
      else if (init.body instanceof FormData) {
        let inputBytes = 0;
        for (const [name, value] of init.body) inputBytes += Buffer.byteLength(name) +
          (typeof value === 'string' ? Buffer.byteLength(value) : value.size) + 1024;
        need(inputBytes <= MAX_REQUEST, 'Native multipart exceeded byte bound');
      } else throw new Error('Unsupported native body');
      const request = new Request(url, { method, headers, body: init.body });
      body = Buffer.from(await request.arrayBuffer());
      need(body.length <= MAX_REQUEST, 'Native upload exceeded bounded input');
      headers.set('Content-Type', request.headers.get('Content-Type'));
    }
    const config = [`url = ${quote(url.href)}`, `request = ${quote(method)}`,
      ...[...headers].map(([key, value]) => { need(!/[\r\n\0]/.test(key + value), 'Invalid native header'); return `header = ${quote(key + ': ' + value)}`; }),
      ...(body ? ['data-binary = "@/dev/fd/3"'] : [])].join('\n') + '\n';
    return await new Promise((resolve, reject) => {
      // Credential bytes travel only through anonymous pipes, never argv/files/logs.
      const child = spawn('/usr/bin/curl', ['-q', '--silent', '--show-error', '--include', '--http1.1', '--noproxy', '',
        '--proxy', proxy, '--proto', '=https', '--max-time', '60', '--connect-timeout', '10', '--config', '-'],
      { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
      let length = 0, stderrLength = 0, stopped = false, settled = false, retirementTimer; const chunks = [];
      const finish = (error, response) => {
        if (settled) return; settled = true; clearTimeout(timer); clearTimeout(retirementTimer);
        signal?.removeEventListener('abort', stop);
        if (error) reject(error); else resolve(response);
      };
      const stop = () => {
        if (stopped) return; stopped = true;
        child.kill('SIGKILL');
        for (const pipe of [child.stdin, child.stdout, child.stderr, child.stdio[3]]) pipe.destroy();
        retirementTimer = setTimeout(() => finish(new Error('HTTPS child retirement is unconfirmed; mutation outcome may be unknown')), 5000);
      };
      const timer = setTimeout(stop, 65_000); signal?.addEventListener('abort', stop, { once: true });
      child.stdout.on('data', part => { length += part.length; if (length > MAX_RESPONSE + MAX_HEADERS * 8) stop(); else chunks.push(part); });
      child.stderr.on('data', part => { stderrLength += part.length; if (stderrLength > 16384) stop(); });
      for (const pipe of [child.stdin, child.stdout, child.stderr, child.stdio[3]]) pipe.on('error', stop);
      child.on('error', stop);
      child.on('close', code => {
        if (stopped || signal?.aborted || code !== 0) return finish(new Error('HTTPS exchange incomplete; mutation outcome may be unknown'));
        try {
          const response = parseCurlResponse(Buffer.concat(chunks));
          if (url.pathname === '/api/atlas/auth/proxy' && response.ok) {
            const values = response.headers.getSetCookie(); need(values.length === 1, 'Session cookie is unavailable');
            need(/;\s*Secure(?:;|$)/i.test(values[0]) && /;\s*HttpOnly(?:;|$)/i.test(values[0]) && /;\s*SameSite=Strict(?:;|$)/i.test(values[0]), 'Native session flags differ');
            cookie = values[0].split(';', 1)[0];
          }
          if (url.pathname === '/api/atlas/auth/logout' && response.ok) cookie = null;
          finish(null, response);
        } catch (error) { finish(error); }
      });
      child.stdin.end(config); child.stdio[3].end(body ?? Buffer.alloc(0));
      if (signal?.aborted) stop();
    });
  };
  return Object.freeze({ exchange, forget: () => { cookie = null; } });
}
