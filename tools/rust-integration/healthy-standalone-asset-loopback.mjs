// One positive standalone text asset: actual Access, Media, stock, SQLite, TLS.
// No provider, replay, expiry, denial, fault, recovery or concurrent operation.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.version, 'v26.10.0');
const root = resolve(process.env.HOUSEATLAS_SOURCE_ROOT ?? fileURLToPath(new URL('../../', import.meta.url)));
assert(existsSync(join(root, 'AGENTS.md')) && existsSync(join(root, 'frontend/dist/index.html')));
const binary = process.env.HOUSEATLAS_BINARY;
assert(binary && existsSync(binary), 'Supply the locked compiled HOUSEATLAS_BINARY');
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-healthy-standalone-asset-'));
const data = join(scratch, 'data');
const cert = join(scratch, 'cert.pem'), key = join(scratch, 'key.pem');
const certificate = spawnSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
  '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1',
  '-addext', 'subjectAltName=IP:127.0.0.1',
], { encoding: 'utf8' });
assert.equal(certificate.status, 0, 'Disposable loopback certificate');
const ca = readFileSync(cert);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, milliseconds = 30000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(50);
  }
  throw new Error('Timed out: ' + label);
}

let service, output = '';
try {
  service = spawn(resolve(binary), [
    '--disposable-dir', data, '--frontend-dist', join(root, 'frontend/dist'),
    '--tls-cert', cert, '--tls-key', key,
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  service.stdout.on('data', bytes => { output += bytes; });
  service.stderr.on('data', () => {});
  await until(() => {
    if (service.exitCode !== null) throw new Error('Actual Rust startup failed');
    return output.includes('listening at') && existsSync(join(data, 'smoke-session.json'));
  }, 'actual Rust TLS listener');
  const fixture = JSON.parse(readFileSync(join(data, 'smoke-session.json')));
  const origin = fixture.origin;
  assert.match(origin, /^https:\/\/127\.0\.0\.1:\d+$/);
  let cookie, csrf;
  const observed = [];
  async function http(path, { method = 'GET', body, contentType, headers = {} } = {}) {
    const response = await new Promise((resolve, reject) => {
      const request = httpsRequest(new URL(path, origin), {
        method, ca, agent: false, timeout: 15000,
        headers: {
          Accept: 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin',
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body ? { 'Content-Type': contentType, 'Content-Length': body.length } : {}),
          ...(method === 'POST' && csrf ? { 'X-Atlas-Csrf': csrf } : {}),
          ...headers,
        },
      }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 1024 * 1024) response.destroy(new Error('Healthy response exceeded bound'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
      });
      request.on('error', reject);
      request.on('timeout', () => request.destroy(new Error('Healthy request timed out')));
      request.end(body);
    });
    const pathname = new URL(path, origin).pathname;
    observed.push({ method, path: pathname.includes('/media/downloads/')
      ? pathname.replace(/\/[^/]+$/, '/<issued-handle>') : pathname, status: response.status });
    assert.equal(response.status, 200, 'Positive actual HTTP request succeeded');
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    return response;
  }
  const json = async (path, options) => JSON.parse((await http(path, options)).bytes.toString('utf8'));

  const login = await http('/api/atlas/auth/login', {
    method: 'POST', body: Buffer.from(JSON.stringify(fixture.editorLogin)), contentType: 'application/json',
  });
  const issued = login.headers['set-cookie'];
  assert.equal(issued?.length, 1);
  assert(issued[0].includes('Secure') && issued[0].includes('HttpOnly') && issued[0].includes('SameSite=Strict'));
  cookie = issued[0].split(';')[0];
  const signedIn = JSON.parse(login.bytes.toString('utf8'));
  assert.equal(signedIn.schemaVersion, 1);
  assert.equal(typeof signedIn.csrfToken, 'string');
  csrf = signedIn.csrfToken;
  const view = await json('/api/atlas/view');
  const scope = view.scope;
  assert.equal(view.status, 'ready');
  const prefix = `/api/atlas/stock/v3/workspaces/${scope.workspaceId}/homes/${scope.homeId}`;
  const native = `/api/atlas/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}`;

  const original = Buffer.from('Synthetic standalone Atlas original.\n', 'utf8');
  const digest = createHash('sha256').update(original).digest('hex');
  const reason = 'Create one disposable standalone text original';
  const requestId = randomUUID();
  const metadata = {
    schemaVersion: 1, requestId, idempotencyKey: randomUUID(), context: scope,
    reason, filename: 'standalone.txt', contentType: 'text/plain',
    sourceLicense: { status: 'unknown', reference: null },
  };
  const boundary = 'houseatlas-' + randomUUID();
  const multipart = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="standalone.txt"\r\nContent-Type: text/plain\r\n\r\n`),
    original, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const receipt = await json(prefix + '/assets', {
    method: 'POST', body: multipart, contentType: `multipart/form-data; boundary=${boundary}`,
  });
  assert.equal(receipt.schemaVersion, 3);
  assert.equal(receipt.commandId, 'atlas.asset.create');
  assert.equal(receipt.requestId, requestId);
  assert.equal(receipt.status, 'committed');
  assert.equal(receipt.replayed, false);
  assert.deepEqual(receipt.resolvedScope, scope);
  assert.equal(receipt.data.records.length, 1);
  assert.equal(receipt.data.auditIds.length, 1);
  const asset = receipt.data.records[0];
  assert.equal(asset.target.authority, 'atlas');
  assert.equal(asset.target.recordType, 'asset');
  assert.equal(asset.revision, 1);
  assert.equal(asset.lifecycle, 'active');
  assert.equal(asset.payload.purpose, 'evidence-original');
  assert.equal(asset.payload.contentType, 'text/plain');
  assert.equal(asset.payload.previewPolicy, 'download-only');
  assert.equal(asset.payload.availability, 'available');
  assert.equal(asset.payload.sha256, digest);
  assert.equal(asset.payload.byteSize, original.length);
  assert.deepEqual(asset.payload.sourceLicense, metadata.sourceLicense);
  assert.deepEqual(asset.payload.evidenceIds, []);
  assert.equal(Object.hasOwn(asset.payload, 'storageKey'), false);

  const suffix = `/asset/${asset.target.recordId}`;
  const frozen = await json(native + '/records' + suffix);
  const stock = await json(prefix + '/records' + suffix);
  const history = await json(prefix + '/records' + suffix + '/history?pageSize=1');
  assert.equal(frozen.lastAuditId, receipt.data.auditIds[0]);
  assert.equal(frozen.payload.sha256, digest);
  assert.deepEqual(stock.data.records, [asset]);
  assert.equal(stock.status, 'read');
  assert.equal(stock.replayed, false);
  assert.equal(history.status, 'read');
  assert.equal(history.replayed, false);
  assert.equal(history.data.entries.length, 1);
  assert.equal(history.data.nextCursor, null);
  const event = history.data.entries[0];
  assert.equal(event.eventId, receipt.data.auditIds[0]);
  assert.equal(event.actorId, signedIn.actorId);
  assert.equal(event.commandId, 'atlas.asset.create');
  assert.equal(event.state, 'committed');
  assert.deepEqual(event.target, asset.target);

  const downloadRequest = {
    schemaVersion: 3, commandId: 'atlas.asset.download', requestId: randomUUID(),
    context: scope, target: asset.target, payload: {},
  };
  const issuedDownload = await json(prefix + '/invoke?request=' + encodeURIComponent(JSON.stringify(downloadRequest)));
  assert.equal(issuedDownload.commandId, 'atlas.asset.download');
  assert.equal(issuedDownload.status, 'read');
  assert.equal(issuedDownload.data.sha256, digest);
  assert.equal(issuedDownload.data.byteSize, original.length);
  assert.equal(issuedDownload.data.contentType, 'text/plain');
  assert.equal(issuedDownload.data.disposition, 'attachment');
  const delivered = await http(`/api/atlas/media/downloads/${scope.workspaceId}/${scope.homeId}/${issuedDownload.data.downloadToken}`);
  assert.deepEqual(delivered.bytes, original);
  assert.equal(createHash('sha256').update(delivered.bytes).digest('hex'), digest);
  assert.equal(Number(delivered.headers['content-length']), original.length);
  assert.equal(delivered.headers['content-type'], 'text/plain');
  assert.equal(delivered.headers['content-disposition'], 'attachment; filename="original.txt"');
  assert.equal(delivered.headers['content-security-policy'], "default-src 'none'; sandbox");

  const rows = spawnSync('python3', ['-c', [
    'import json,sqlite3,sys',
    "c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)",
    "tables=['records','audits','stock_operations','stock_groups','upload_consumptions']",
    "print(json.dumps({t:c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in tables}))",
    'c.close()',
  ].join('\n'), join(data, 'atlas.sqlite')], { encoding: 'utf8' });
  assert.equal(rows.status, 0, 'Read-only actual SQLite observation');
  const persisted = JSON.parse(rows.stdout);
  assert.deepEqual(persisted, { records: 7, audits: 1, stock_operations: 1, stock_groups: 1, upload_consumptions: 1 });
  const evidence = {
    flow: 'One actual editor HTTP login and standalone text asset commit',
    originalSha256: digest, committedAuditId: receipt.data.auditIds[0],
    stockRead: true, stockHistory: true, downloadBytesMatch: true,
    persisted, observations: observed,
    limitations: ['Only one fresh text/plain original and download-only disposition.', 'No replay, expiry, denial, fault, recovery, concurrency or external provider.'],
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
