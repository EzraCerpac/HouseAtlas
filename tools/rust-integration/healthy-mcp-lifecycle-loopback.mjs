// Two healthy mounted MCP sessions separated by one genuine Access rotation.
// No old-credential probe, cancellation, replay, failure or concurrent request.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.version, 'v26.10.0');
const root = fileURLToPath(new URL('../../', import.meta.url));
const binary = process.env.HOUSEATLAS_BINARY;
assert(binary && existsSync(binary), 'Supply the locked actual HOUSEATLAS_BINARY');
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-healthy-mcp-http-'));
const data = join(scratch, 'data');
const cert = join(scratch, 'cert.pem'), key = join(scratch, 'key.pem');
const certificate = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { encoding: 'utf8' });
assert.equal(certificate.status, 0, 'Disposable loopback certificate');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, milliseconds = 30000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(50);
  }
  throw new Error('Timed out: ' + label);
}
let service, output = '', errors = '';
try {
  service = spawn(resolve(binary), ['--disposable-dir', data, '--frontend-dist', join(root, 'frontend/dist'), '--tls-cert', cert, '--tls-key', key], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  service.stdout.on('data', bytes => { output += bytes; });
  service.stderr.on('data', bytes => { errors += bytes; });
  await until(() => {
    if (service.exitCode !== null) throw new Error('Actual Rust startup failed: ' + errors);
    return output.includes('listening at') && existsSync(join(data, 'smoke-session.json'));
  }, 'actual loopback service');
  const fixture = JSON.parse(readFileSync(join(data, 'smoke-session.json')));
  const origin = fixture.origin;
  assert.match(origin, /^https:\/\/127\.0\.0\.1:\d+$/);
  let cookie, csrf;
  const observations = [];
  const ca = readFileSync(cert);
  async function http(path, body, extra = {}) {
    const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const response = await new Promise((resolve, reject) => {
      const request = httpsRequest(new URL(path, origin), {
        method: bytes ? 'POST' : 'GET', ca, agent: false, timeout: 15000,
        headers: {
          Accept: 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin',
          ...(cookie ? { Cookie: cookie } : {}),
          ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length, ...(csrf ? { 'X-Atlas-Csrf': csrf } : {}) } : {}),
          ...extra,
        },
      }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 1024 * 1024) response.destroy(new Error('Healthy response exceeded its inspected bound'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
      });
      request.on('error', reject);
      request.on('timeout', () => request.destroy(new Error('Healthy request timed out')));
      request.end(bytes);
    });
    observations.push({ path, status: response.status });
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    return { ...response, body: response.text ? JSON.parse(response.text) : null };
  }
  function acceptReceipt(response) {
    assert.equal(response.status, 200);
    assert.equal(response.body.schemaVersion, 1);
    assert.equal(typeof response.body.csrfToken, 'string');
    const issued = response.headers['set-cookie'];
    assert.equal(issued.length, 1);
    assert(issued[0].includes('Secure') && issued[0].includes('HttpOnly') && issued[0].includes('SameSite=Strict'));
    cookie = issued[0].split(';')[0]; csrf = response.body.csrfToken;
  }
  acceptReceipt(await http('/api/atlas/auth/login', fixture.editorLogin));
  const U = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
  const scope = { workspaceId: U(1), homeId: U(2) };
  const path = `/api/atlas/mcp/workspaces/${scope.workspaceId}/homes/${scope.homeId}`;
  async function healthySession(label, canonicalId) {
    let sessionId;
    async function post(message) {
      const response = await http(path, message, {
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
        ...(sessionId ? { 'MCP-Session-Id': sessionId } : {}),
      });
      if (response.headers['mcp-session-id']) sessionId = response.headers['mcp-session-id'];
      return response;
    }
    const initialized = await post({ jsonrpc: '2.0', id: label + '-initialize', method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'HouseAtlas healthy lifecycle', version: '0.1.0' } } });
    assert.equal(initialized.status, 200); assert.equal(initialized.body.id, label + '-initialize');
    assert.equal(initialized.body.result.protocolVersion, '2025-11-25'); assert(sessionId);
    const ready = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(ready.status, 202); assert.equal(ready.text, '');
    const listed = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(listed.status, 200); assert.equal(listed.body.id, 1);
    assert.deepEqual(listed.body.result.tools.map(tool => tool.name).sort(), ['atlas_bindings', 'atlas_media_geometry', 'atlas_records', 'homebox_entities_locations']);
    assert(listed.body.result.tools.every(tool => tool.annotations.readOnlyHint === true));
    const request = { schemaVersion: 3, commandId: 'atlas.identity.get', requestId: canonicalId, context: scope, target: { authority: 'atlas', recordType: 'identity', recordId: U(200) }, payload: {} };
    const read = await post({ jsonrpc: '2.0', id: label + '-read', method: 'tools/call', params: { name: 'atlas_records', arguments: request } });
    assert.equal(read.status, 200); assert.equal(read.body.id, label + '-read');
    const result = read.body.result; assert.equal(result.isError, false);
    const wire = result.structuredContent;
    assert.deepEqual(JSON.parse(result.content[0].text), wire);
    assert.equal(wire.requestId, request.requestId); assert.equal(wire.commandId, request.commandId);
    assert.deepEqual(wire.resolvedScope, scope); assert.equal(wire.status, 'read');
    assert.equal(wire.data.records.length, 1);
    return { sessionId, wire };
  }
  const first = await healthySession('before', U(1951));
  acceptReceipt(await http('/api/atlas/auth/rotate', {}));
  // No request is made with the prior cookie or prior MCP session after rotation.
  const second = await healthySession('after', U(1952));
  assert.notEqual(first.sessionId, second.sessionId);
  assert.deepEqual(first.wire.data, second.wire.data);
  const rows = spawnSync('python3', ['-c', "import sqlite3,json,sys;c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);print(json.dumps({t:c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['records','audits','stock_operations']}));c.close()", join(data, 'atlas.sqlite')], { encoding: 'utf8' });
  assert.equal(rows.status, 0); const persisted = JSON.parse(rows.stdout);
  assert.deepEqual(persisted, { records: 6, audits: 0, stock_operations: 0 });
  const evidence = {
    flow: 'Two actual mounted MCP read sessions with a genuine healthy Access rotation',
    binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
    protocolVersion: '2025-11-25', originalNativePeers: true, freshSessionAfterRotation: true,
    before: first.wire, after: second.wire, observations, persisted,
    limitations: ['No old credential/session probe or cancellation.', 'No rejected, replayed, expired, revoked, fault, crash, concurrent or provider operation.'],
  };
  if (process.env.HOUSEATLAS_EVIDENCE) writeFileSync(process.env.HOUSEATLAS_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  try {
    if (service?.exitCode === null) {
      service.kill('SIGINT');
      await until(() => service.exitCode !== null, 'graceful Rust shutdown', 10000);
      assert.equal(service.exitCode, 0);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
