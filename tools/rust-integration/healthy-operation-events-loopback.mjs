// Positive aggregate stock events over a fresh local Rust/Access/SQLite/TLS host.
// No replay, denial, expiry, revocation, fault, recovery or external provider.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.version, 'v26.10.0');
const root = resolve(process.env.HOUSEATLAS_SOURCE_ROOT ?? fileURLToPath(new URL('../../', import.meta.url)));
assert(existsSync(join(root, 'AGENTS.md')) && existsSync(join(root, 'frontend/dist/index.html')));
const binary = process.env.HOUSEATLAS_BINARY;
assert(binary && existsSync(binary), 'Supply the locked compiled HOUSEATLAS_BINARY');
const chromium = process.env.HOUSEATLAS_CHROMIUM ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync);
assert(chromium, 'A real Chromium executable is required for the read-only Changes view');
const scratch = mkdtempSync('/tmp/houseatlas-operation-events-healthy-');
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
    const result = await check();
    if (result) return result;
    await delay(50);
  }
  throw new Error('Timed out: ' + label);
}

let service, browser, output = '', serviceError = '';
try {
  service = spawn(resolve(binary), [
    '--disposable-dir', data, '--frontend-dist', join(root, 'frontend/dist'),
    '--tls-cert', cert, '--tls-key', key,
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  service.stdout.on('data', bytes => { output += bytes; });
  service.stderr.on('data', bytes => { serviceError += bytes; });
  await until(() => {
    if (service.exitCode !== null) throw new Error('Actual Rust startup failed: ' + serviceError.slice(-1200));
    return output.includes('listening at') && existsSync(join(data, 'smoke-session.json'));
  }, 'actual Rust TLS listener');
  const fixture = JSON.parse(readFileSync(join(data, 'smoke-session.json')));
  const origin = fixture.origin;
  assert.match(origin, /^https:\/\/127\.0\.0\.1:\d+$/);
  let cookie, csrf;
  const observed = [];
  async function http(path, { method = 'GET', body } = {}) {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const response = await new Promise((resolve, reject) => {
      const request = httpsRequest(new URL(path, origin), {
        method, ca, agent: false, timeout: 15000,
        headers: {
          Accept: 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin',
          ...(cookie ? { Cookie: cookie } : {}),
          ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}),
          ...(method === 'POST' && csrf ? { 'X-Atlas-Csrf': csrf } : {}),
        },
      }, incoming => {
        const chunks = []; let size = 0;
        incoming.on('data', chunk => {
          size += chunk.length;
          if (size > 1024 * 1024) incoming.destroy(new Error('Healthy response exceeded bound'));
          else chunks.push(chunk);
        });
        incoming.on('error', reject);
        incoming.on('end', () => resolve({ status: incoming.statusCode, headers: incoming.headers, bytes: Buffer.concat(chunks) }));
      });
      request.on('error', reject);
      request.on('timeout', () => request.destroy(new Error('Healthy request timed out')));
      request.end(bytes);
    });
    observed.push({ method, path: new URL(path, origin).pathname, status: response.status });
    assert.equal(response.status, 200, 'Positive actual HTTP request succeeded: ' + path);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    return response;
  }
  const json = async (path, options) => JSON.parse((await http(path, options)).bytes.toString('utf8'));
  const login = await http('/api/atlas/auth/login', { method: 'POST', body: fixture.editorLogin });
  const issued = login.headers['set-cookie'];
  assert.equal(issued?.length, 1);
  assert(issued[0].includes('Secure') && issued[0].includes('HttpOnly') && issued[0].includes('SameSite=Strict'));
  cookie = issued[0].split(';')[0];
  const signedIn = JSON.parse(login.bytes.toString('utf8'));
  assert.equal(signedIn.schemaVersion, 1);
  assert.equal(typeof signedIn.csrfToken, 'string');
  csrf = signedIn.csrfToken;
  const view = await json('/api/atlas/view');
  assert.equal(view.status, 'ready');
  const scope = view.scope;
  const stock = `/api/atlas/stock/v3/workspaces/${scope.workspaceId}/homes/${scope.homeId}`;
  const eventsPath = `/api/atlas/operation-events?homeId=${encodeURIComponent(scope.homeId)}&pageSize=1`;
  const graphSql = [
    'import json,sqlite3,sys',
    "c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)",
    "tables=['sources','projections','caches','network_relations','cache_epochs','cache_generations']",
    "print(json.dumps({t:c.execute('SELECT * FROM '+t+' ORDER BY rowid').fetchall() for t in tables}))",
    'c.close()',
  ].join('\n');
  function sourceGraph() {
    const query = spawnSync('python3', ['-c', graphSql, join(data, 'atlas.sqlite')], { encoding: 'utf8' });
    assert.equal(query.status, 0, 'Read-only actual source graph observation');
    return JSON.parse(query.stdout);
  }
  const originalGraph = sourceGraph();
  const U = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const guard = { target: { authority: 'atlas', recordType: 'evidence', recordId: U(100) }, revision: { kind: 'atlas', value: 1 } };
  const command = (kind, id, request, key, payload) => ({
    schemaVersion: 3, commandId: `atlas.${kind}.create`, requestId: U(request), context: scope,
    target: { authority: 'atlas', recordType: kind, recordId: U(id) }, payload,
    idempotencyKey: U(key), reason: 'Healthy disposable aggregate operation event',
    preconditions: { target: null, guards: [guard] }, approvalReceiptId: null,
  });
  async function commit(intent) {
    const current = await json('/api/atlas/auth/session');
    assert.equal(current.actorId, signedIn.actorId);
    csrf = current.csrfToken;
    const receipt = await json(stock + '/commands', { method: 'POST', body: intent });
    assert.equal(receipt.schemaVersion, 3);
    assert.equal(receipt.commandId, intent.commandId);
    assert.equal(receipt.requestId, intent.requestId);
    assert.equal(receipt.status, 'committed');
    assert.equal(receipt.replayed, false);
    assert.deepEqual(receipt.resolvedScope, scope);
    assert.match(receipt.operationId, /^[0-9a-f-]{36}$/);
    assert.match(receipt.data.requestDigest, /^[0-9a-f]{64}$/);
    return receipt;
  }
  const firstIntent = command('circuit', 920, 1200, 1300, { label: null, panel: null, evidenceIds: [U(100)] });
  const children = [
    command('identity', 921, 1201, 1301, { kind: 'item', evidenceIds: [U(100)] }),
    command('identity', 922, 1202, 1302, { kind: 'item', evidenceIds: [U(100)] }),
  ];
  const batchIntent = {
    schemaVersion: 3, commandId: 'atlas.batch.execute', requestId: U(1203), context: scope,
    target: { authority: 'atlas', kind: 'batch', batchId: U(1400) }, payload: { commands: children },
    idempotencyKey: U(1303), reason: 'Healthy disposable ordered aggregate batch',
    preconditions: { target: null, guards: [guard] }, approvalReceiptId: null,
  };
  const firstReceipt = await commit(firstIntent);
  const batchReceipt = await commit(batchIntent);
  assert.equal(firstReceipt.data.auditIds.length, 1);
  assert.equal(batchReceipt.data.auditIds.length, 2);
  const originalIds = [...firstReceipt.data.auditIds, ...batchReceipt.data.auditIds];

  const sql = [
    'import json,sqlite3,sys',
    "c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)",
    'rows=c.execute("SELECT a.seq,a.audit_id,a.body,l.root_operation_id,l.command_id,l.request_digest,g.operation_id FROM audits AS a JOIN stock_audit_links AS l ON l.audit_id=a.audit_id JOIN stock_groups AS g ON g.root_operation_id=l.root_operation_id AND g.ordinal=l.group_ordinal WHERE a.workspace_id=? AND a.home_id=? ORDER BY a.seq",(sys.argv[2],sys.argv[3])).fetchall()',
    'print(json.dumps([dict(seq=r[0],auditId=r[1],audit=json.loads(r[2]),rootOperationId=r[3],commandId=r[4],requestDigest=r[5],operationId=r[6]) for r in rows]))',
    'c.close()',
  ].join('\n');
  function retainedRows() {
    const query = spawnSync('python3', ['-c', sql, join(data, 'atlas.sqlite'), scope.workspaceId, scope.homeId], { encoding: 'utf8' });
    assert.equal(query.status, 0, 'Read-only actual SQLite retained audit observation');
    return JSON.parse(query.stdout);
  }
  const originals = retainedRows();
  assert.equal(originals.length, 3);
  assert.deepEqual(originals.map(row => row.auditId), originalIds);
  assert.deepEqual(originals.map(row => row.rootOperationId), [firstReceipt.operationId, batchReceipt.operationId, batchReceipt.operationId]);
  assert.deepEqual(originals.map(row => row.commandId), [firstIntent.commandId, ...children.map(child => child.commandId)]);
  function expected(row) {
    return {
      eventId: row.auditId, rootOperationId: row.rootOperationId, operationId: row.operationId,
      commandId: row.commandId, actorId: row.audit.actorId, at: row.audit.at,
      target: { authority: 'atlas', recordType: row.audit.record.recordType, recordId: row.audit.record.recordId },
      requestDigest: row.requestDigest, state: 'committed',
    };
  }
  function assertPage(page, rows) {
    assert.equal(page.format, 'atlas-operation-events/1');
    assert.deepEqual(page.resolvedScope, scope);
    assert.equal(page.coverage, 'retained-atlas-stock-only');
    assert.equal(page.completeness, 'partial');
    assert.equal(page.order, 'audit-sequence-ascending');
    assert.deepEqual(page.entries, rows.map(expected));
  }
  const firstPage = await json(eventsPath);
  assertPage(firstPage, [originals[0]]);
  assert.equal(typeof firstPage.nextCursor, 'string');
  assert(firstPage.nextCursor.length > 0);

  // This fresh native commit occurs after the first page. The held cursor must
  // finish only the original fixed audit watermark, while a new read sees it.
  const laterIntent = command('circuit', 923, 1204, 1304, { label: null, panel: null, evidenceIds: [U(100)] });
  const laterReceipt = await commit(laterIntent);
  assert.equal(laterReceipt.data.auditIds.length, 1);
  const laterRecord = await json(`/api/atlas/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/records/circuit/${laterIntent.target.recordId}`);
  assert.equal(laterRecord.recordId, laterIntent.target.recordId);
  assert.equal(laterRecord.lastAuditId, laterReceipt.data.auditIds[0]);
  assert.deepEqual(sourceGraph(), originalGraph, 'Native stock writes leave the source graph unchanged');
  const after = retainedRows();
  assert.equal(after.length, 4);
  assert.deepEqual(after.slice(0, 3), originals);
  assert.equal(after[3].auditId, laterReceipt.data.auditIds[0]);
  assert(after[3].seq > originals[2].seq);
  const secondPage = await json(eventsPath + '&cursor=' + encodeURIComponent(firstPage.nextCursor));
  assertPage(secondPage, [originals[1]]);
  assert.equal(typeof secondPage.nextCursor, 'string');
  assert(secondPage.nextCursor.length > 0);
  const thirdPage = await json(eventsPath + '&cursor=' + encodeURIComponent(secondPage.nextCursor));
  assertPage(thirdPage, [originals[2]]);
  assert.equal(thirdPage.nextCursor, null);
  const fresh = await json(`/api/atlas/operation-events?homeId=${encodeURIComponent(scope.homeId)}&pageSize=100`);
  assertPage(fresh, after);
  assert.equal(fresh.nextCursor, null);

  // The real built React Changes view reads this aggregate through Chrome.
  // Browser interaction is navigation only; operation history transport is GET.
  const browserRequests = [];
  class Pipe {
    next = 0; pending = new Map(); buffer = Buffer.alloc(0);
    constructor(process) {
      this.process = process;
      process.stdio[4].on('data', bytes => {
        this.buffer = Buffer.concat([this.buffer, bytes]);
        let end;
        while ((end = this.buffer.indexOf(0)) !== -1) {
          const raw = this.buffer.subarray(0, end).toString();
          this.buffer = this.buffer.subarray(end + 1);
          if (!raw) continue;
          const message = JSON.parse(raw);
          if (message.id) {
            const pending = this.pending.get(message.id); if (!pending) continue;
            this.pending.delete(message.id); clearTimeout(pending.timer);
            message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
          } else if (message.method === 'Network.requestWillBeSent') {
            browserRequests.push({ url: message.params.request.url, method: message.params.request.method });
          }
        }
      });
    }
    send(method, params = {}, sessionId) {
      const id = ++this.next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
        this.pending.set(id, { resolve, reject, timer });
        this.process.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
      });
    }
  }
  browser = spawn(chromium, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync',
    '--disable-features=MediaRouter,OptimizationHints', '--ignore-certificate-errors',
    '--user-data-dir=' + join(scratch, 'browser'), 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const cdp = new Pipe(browser);
  const version = await cdp.send('Browser.getVersion');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
  const split = cookie.indexOf('=');
  const installed = await send('Network.setCookie', {
    name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin,
    path: '/', secure: true, httpOnly: true, sameSite: 'Strict',
  });
  assert.equal(installed.success, true);
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!result.exceptionDetails, 'Read-only Changes view evaluation');
    return result.result.value;
  };
  await send('Page.navigate', { url: origin });
  await until(async () => (await evaluate('document.body?.innerText ?? ""')).includes('Synthetic home'), 'actual authorized React home');
  await until(async () => await evaluate(`(() => {
    const button = [...document.querySelectorAll('nav[aria-label="Sections"] button')]
      .find(button => button.textContent?.trim() === 'Changes' && button.getClientRects().length);
    if (!button) return false;
    button.click(); return true;
  })()`), 'visible Changes navigation');
  await until(async () => (await evaluate('document.querySelector("main#main h1")?.textContent')) === 'Changes', 'Changes view');
  const renderedIds = await until(async () => {
    const ids = await evaluate(`[...document.querySelectorAll('ol[aria-label="Retained operation events"] li')]
      .map(row => row.querySelector('details dd')?.textContent ?? null)`);
    return ids?.length === 4 ? ids : null;
  }, 'four actual rendered operation events');
  assert.deepEqual(renderedIds, after.map(row => row.auditId));
  const operationGets = browserRequests.filter(request => request.url.startsWith(origin + '/api/atlas/operation-events?'));
  assert(operationGets.length >= 1);
  assert(operationGets.every(request => request.method === 'GET'));

  const evidence = {
    flow: 'Actual editor HTTP login, fresh native stock writes, retained SQLite audits, fixed-watermark aggregate event pages',
    originalAuditIds: originalIds, laterAuditId: laterReceipt.data.auditIds[0],
    pinnedPageAuditIds: [firstPage, secondPage, thirdPage].flatMap(page => page.entries.map(entry => entry.eventId)),
    freshReadAuditIds: fresh.entries.map(entry => entry.eventId),
    sourceGraphUnchanged: true, laterRecordAuditId: laterRecord.lastAuditId,
    browser: version.product, renderedAuditIds: renderedIds,
    browserOperationHistoryGets: operationGets.length,
    observed,
    limitations: ['Only local synthetic positive writes and reads.', 'No replay, expiry, denial, fault, recovery, concurrency or external provider.'],
  };
  if (process.env.HOUSEATLAS_EVIDENCE) writeFileSync(process.env.HOUSEATLAS_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  try {
    if (browser?.exitCode === null) browser.kill('SIGTERM');
    if (service?.exitCode === null) {
      service.kill('SIGINT');
      await until(() => service.exitCode !== null, 'graceful Rust shutdown', 10000);
      assert.equal(service.exitCode, 0);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
