// Source-only successful native place PDF intake example. Root must inspect the
// whole source/imports, pin actual artifacts, register the command and release
// execution first. This file has not been executed by its author.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.version, 'v26.10.0');
assert.equal(process.argv.length, 3, 'One explicit private Root artifact packet');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/, COMMIT = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const U = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const scope = { workspaceId: U(2), homeId: U(3) }, actorId = U(5);
const maximumResponse = 1024 * 1024, wholeLimitMs = 180000;
function selected(path, maximum, privateFile = false, systemFile = false) {
  assert(typeof path === 'string' && isAbsolute(path) && resolve(path) === path);
  assert.equal(realpathSync(path), path, 'Canonical selected regular file');
  const before = lstatSync(path);
  assert(before.isFile() && before.nlink === 1 && before.size <= maximum);
  assert(before.uid === process.getuid() || systemFile && before.uid === 0);
  assert.equal(before.mode & 0o022, 0, 'Selected file is not group/world writable');
  if (privateFile) assert.equal(before.mode & 0o777, 0o600);
  const bytes = readFileSync(path), after = lstatSync(path);
  assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino);
  assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(bytes.length, before.size); return bytes;
}
const packetBytes = selected(process.argv[2], 256 * 1024, true);
const selection = JSON.parse(packetBytes);
assert.equal(selection.format, 'houseatlas-native-place-evidence-artifacts/1');
const binary = selection.binary, openssl = selection.openssl;
assert.match(binary.sha256, SHA); assert.match(binary.sourceCommit, COMMIT); assert.match(binary.sourceTree, COMMIT);
assert.match(binary.buildRecord.sha256, SHA);
assert.equal(sha(selected(binary.path, 512 * 1024 * 1024)), binary.sha256);
const buildBytes = selected(binary.buildRecord.path, 1024 * 1024, true);
assert.equal(sha(buildBytes), binary.buildRecord.sha256);
const build = JSON.parse(buildBytes);
assert.equal(build.sourceCommit, binary.sourceCommit); assert.equal(build.sourceTree, binary.sourceTree);
assert.equal(build.binarySha256, binary.sha256); assert.equal(build.binaryPath, binary.path);
assert.equal(build.bytes, binary.bytes); assert.equal(lstatSync(binary.path).size, binary.bytes);
assert.equal(build.buildCheck.exit, 0, 'Actual compiled artifact receipt');
assert.match(openssl.sha256, SHA);
assert.equal(sha(selected(openssl.path, 32 * 1024 * 1024, false, true)), openssl.sha256);
const output = selection.evidenceDirectory;
assert(isAbsolute(output) && realpathSync(output) === output);
const outputMeta = lstatSync(output);
assert(outputMeta.isDirectory() && outputMeta.uid === process.getuid() && (outputMeta.mode & 0o777) === 0o700);
assert(!existsSync(join(output, 'result.json')), 'Never overwrite prior evidence');
assert(!existsSync(join(output, 'failure.json')), 'Never overwrite prior failure evidence');

const began = Date.now(), scratch = realpathSync(mkdtempSync(join(tmpdir(), 'houseatlas-native-evidence-')));
chmodSync(scratch, 0o700);
const configPath = join(scratch, 'server.json'), cert = join(scratch, 'cert.pem'), key = join(scratch, 'key.pem');
const frontend = join(scratch, 'frontend'); mkdirSync(frontend, { mode: 0o700 });
writeFileSync(join(frontend, 'index.html'), '<!doctype html><title>Synthetic native evidence example</title><div id="root"></div>', { mode: 0o600, flag: 'wx' });
const owned = [], exchanges = [], proofs = [];
let origin, ca, cookie, csrf, service, timedOut = false, completed = false;
let phase = 'preparation', failedPhase = null, failedCode = null, spawnCode = null;
let primaryFailure = null, cleanupFailed = false, cleanupErrorCode = null;
const startupLimit = 8192, startupOutput = { stdout: { chunks: [], observed: 0, captured: 0 }, stderr: { chunks: [], observed: 0, captured: 0 } };
let startupCaptured = 0;
const publicStartupLines = new Set([
  'HouseAtlas persistent server listening on 127.0.0.1:48743 for https://127.0.0.1:48743',
  'HomeBox, Network and AI providers unconfigured; historical Media admission unavailable',
  ...['Expected one React root', 'Persistent frontend directory must be canonical',
    'Frontend output cannot contain symlinks', 'Unsupported frontend asset',
    'Unsupported frontend asset type', 'Invalid frontend path', 'Missing compiled React application']
    .map(message => `Error: "${message}"`),
]);
function publicErrorCode(error) {
  return ['ERR_ASSERTION', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOENT', 'EACCES', 'EADDRINUSE'].includes(error?.code) ? error.code : null;
}
function captureStartup(stream, chunk) {
  // Only pre-auth startup bytes from this owned synthetic server are retained.
  // Both pipes keep draining after this phase; no later bytes enter evidence.
  if (phase !== 'serve-readiness') return;
  const entry = startupOutput[stream]; entry.observed += chunk.length;
  const count = Math.min(chunk.length, startupLimit - startupCaptured);
  if (count > 0) { entry.chunks.push(Buffer.from(chunk.subarray(0, count))); entry.captured += count; startupCaptured += count; }
}
function startupEvidence() {
  const streams = {};
  for (const [name, entry] of Object.entries(startupOutput)) {
    const prefix = Buffer.concat(entry.chunks), lines = prefix.toString('utf8').split(/\r?\n/).filter(line => line.length > 0);
    // Persist only exact public owner strings. Unknown error/path/header/key
    // content is withheld, not blindly sanitized and released as raw logs.
    streams[name] = { observedBytes: entry.observed, capturedPrefixBytes: prefix.length,
      capturedPrefixSha256: sha(prefix), publicText: lines.filter(line => publicStartupLines.has(line)).join('\n'),
      withheldLines: lines.filter(line => !publicStartupLines.has(line)).length,
      readError: entry.readError === true, readErrorCode: entry.readErrorCode ?? null };
  }
  return { scope: 'owned synthetic serve startup before authentication only', maximumCombinedBytes: startupLimit,
    capturedCombinedBytes: startupCaptured, truncated: Object.values(startupOutput).reduce((n, item) => n + item.observed, 0) > startupCaptured, streams };
}
const deadline = setTimeout(() => { timedOut = true; for (const child of owned) if (child.exitCode === null) child.kill('SIGTERM'); }, wholeLimitMs);
const delay = ms => new Promise(yes => setTimeout(yes, ms));
function liveBudget() { assert(!timedOut && Date.now() - began < wholeLimitMs, 'Bounded whole example'); }
function synchronous(binary, args, timeout) {
  liveBudget(); const result = spawnSync(binary, args, { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'], timeout, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, 'Owned preparation succeeds'); return result;
}
async function selectedPort() {
  // The actual owner restricts loopback-local configuration to this one port.
  // If occupied, stop; never select another origin or touch an existing service.
  const port = 48743, probe = createServer();
  await new Promise((yes, no) => { probe.once('error', no); probe.listen({ host: '127.0.0.1', port, exclusive: true }, yes); });
  assert.equal(probe.address().port, port);
  await new Promise((yes, no) => probe.close(error => error ? no(error) : yes())); return port;
}
function stopped(child) { return child.exitCode !== null || child.signalCode !== null || child.failedToStart; }
async function stopOwned(child) {
  const released = () => stopped(child) && child.stdioClosed !== false;
  if (released()) return;
  if (!stopped(child)) child.kill('SIGTERM'); const until = Date.now() + 12000;
  while (!released() && Date.now() < until) await delay(25);
  if (!released()) {
    if (!stopped(child)) child.kill('SIGKILL'); const forcedUntil = Date.now() + 3000;
    while (!released() && Date.now() < forcedUntil) await delay(25);
  }
  assert(stopped(child), 'Only the owned process stopped');
  assert(child.stdioClosed !== false, 'Owned stdout/stderr reached child close');
}
async function exchange(method, path, body = null, contentType = 'application/json', includeSession = true) {
  liveBudget(); assert(typeof path === 'string' && path.startsWith('/api/atlas/') && !path.startsWith('//'));
  const url = new URL(path, origin); assert.equal(url.origin, origin, 'Literal disposable TLS loopback only');
  assert.equal(url.hostname, '127.0.0.1');
  const bytes = body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  assert(bytes === null || bytes.length <= 128 * 1024);
  const headers = { Origin: origin, 'Sec-Fetch-Site': 'same-origin', Accept: 'application/json' };
  if (includeSession) { assert(cookie && csrf); headers.Cookie = cookie; }
  if (bytes !== null) { headers['Content-Type'] = contentType; headers['Content-Length'] = String(bytes.length); if (includeSession) headers['X-Atlas-CSRF'] = csrf; }
  return new Promise((yes, no) => {
    const req = httpsRequest(url, { method, headers, ca, rejectUnauthorized: true, agent: false }, response => {
      const chunks = []; let count = 0;
      response.on('data', chunk => { count += chunk.length; if (count > maximumResponse) req.destroy(new Error('Bounded response exceeded')); else chunks.push(chunk); });
      response.on('error', no);
      response.on('end', () => {
        clearTimeout(timer);
        const route = url.pathname.startsWith(`/api/atlas/media/downloads/${scope.workspaceId}/${scope.homeId}/`)
          ? { routeTemplate: '/api/atlas/media/downloads/{workspace_id}/{home_id}/{token}', withheldPathFields: ['token'] }
          : { path: url.pathname };
        exchanges.push({ method, ...route, status: response.statusCode }); assert(exchanges.length <= 100);
        yes({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) });
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('Whole headers/body deadline')), 15000);
    req.on('error', error => { clearTimeout(timer); no(error); }); if (bytes) req.write(bytes); req.end();
  });
}
function json(response) { assert.equal(response.status, 200, 'Successful actual native exchange'); return JSON.parse(response.bytes.toString('utf8')); }
function correlated(request, wire, status) {
  assert.equal(wire.schemaVersion, 3); assert.equal(wire.commandId, request.commandId); assert.equal(wire.requestId, request.requestId);
  assert.deepEqual(wire.resolvedScope, scope); assert.equal(wire.status, status); assert.equal(wire.replayed, false);
  if (status === 'committed') assert.match(wire.operationId, UUID);
  else assert.equal(Object.hasOwn(wire, 'operationId'), false, 'Read owner declares no mutation operation ID');
}
function downloadEvidence(wire) {
  // Retain source/receipt/hash correlation, never serialize the live capability.
  const { downloadToken, ...data } = wire.data;
  assert(typeof downloadToken === 'string' && UUID.test(downloadToken), 'Native download handle shape');
  return { redactedWire: { ...wire, data }, withheldFields: ['data.downloadToken'] };
}
const stock = () => `/api/atlas/stock/v3/workspaces/${scope.workspaceId}/homes/${scope.homeId}`;
function command(kind, recordId, payload) {
  return { schemaVersion: 3, commandId: `atlas.${kind}.create`, requestId: randomUUID(), context: scope,
    target: { authority: 'atlas', recordType: kind, recordId }, payload, idempotencyKey: randomUUID(),
    reason: 'Synthetic source-free native place evidence', preconditions: { target: null, guards: [] }, approvalReceiptId: null };
}
async function read(kind, verb, recordId = null, payload = {}) {
  const request = { schemaVersion: 3, commandId: `atlas.${kind}.${verb}`, requestId: randomUUID(), context: scope,
    target: { authority: 'atlas', recordType: kind, ...(recordId ? { recordId } : {}) }, payload };
  const wire = json(await exchange('GET', stock() + '/invoke?request=' + encodeURIComponent(JSON.stringify(request))));
  correlated(request, wire, 'read');
  proofs.push({ request, ...(request.commandId === 'atlas.asset.download' ? downloadEvidence(wire) : { wire }) });
  return wire;
}
function pdfBytes() {
  // Valid generated one-page synthetic PDF with real object/xref offsets. No
  // household document or PDF safety/preview claim is embedded in this example.
  const stream = 'BT /F1 12 Tf 20 60 Td (Synthetic electricity document) Tj ET\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`];
  let text = '%PDF-1.7\n'; const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const start = Buffer.byteLength(text); text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`; return Buffer.from(text);
}
let result;
try {
  const port = await selectedPort(); origin = `https://127.0.0.1:${port}`;
  const opensslConfig = join(scratch, 'openssl.cnf');
  writeFileSync(opensslConfig, '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3\n[dn]\nCN=127.0.0.1\n[v3]\nsubjectAltName=IP:127.0.0.1\n', { mode: 0o600, flag: 'wx' });
  synchronous(openssl.path, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-config', opensslConfig], 15000);
  chmodSync(cert, 0o600); chmodSync(key, 0o600); ca = readFileSync(cert);
  const config = { schemaVersion: 1, deploymentId: U(1), dataDirectory: join(scratch, 'data'), logDirectory: join(scratch, 'data/logs'), frontendDirectory: frontend,
    tlsCertificate: cert, tlsPrivateKey: key, listen: `127.0.0.1:${port}`, origin, homes: [{ ...scope, label: 'Synthetic Home' }], mcpCommands: 'read-only',
    authentication: { mode: 'loopback-local', identity: { userId: U(4), actorId, username: 'synthetic-local', scope } } };
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
  synchronous(binary.path, ['initialize', '--server-config', configPath], 30000);
  phase = 'serve-readiness';
  service = spawn(binary.path, ['serve', '--server-config', configPath], { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] }); owned.push(service);
  service.stdioClosed = false;
  service.stdout.on('data', chunk => captureStartup('stdout', chunk));
  service.stderr.on('data', chunk => captureStartup('stderr', chunk));
  service.stdout.on('error', error => { startupOutput.stdout.readError = true; startupOutput.stdout.readErrorCode = publicErrorCode(error); });
  service.stderr.on('error', error => { startupOutput.stderr.readError = true; startupOutput.stderr.readErrorCode = publicErrorCode(error); });
  service.once('close', () => { service.stdioClosed = true; });
  service.on('error', error => { service.failedToStart = true; spawnCode = publicErrorCode(error); });
  const readyUntil = Date.now() + 30000; let ready = false;
  while (!ready && Date.now() < readyUntil) {
    liveBudget(); assert(!stopped(service), 'Owned service is running');
    try { const mode = json(await exchange('GET', '/api/atlas/auth/mode', null, 'application/json', false)); assert.equal(mode.mode, 'loopback-local'); ready = true; }
    catch (error) { if (!['ECONNREFUSED', 'ECONNRESET'].includes(error.code)) throw error; await delay(50); }
  }
  assert(ready, 'Bounded readiness');
  assert(Object.values(startupOutput).every(entry => !entry.readError), 'Owned startup pipes captured without read errors');
  phase = 'authentication-started'; // Stop retaining output before native cookie/CSRF issuance.
  const sessionResponse = await exchange('POST', '/api/atlas/auth/local', {}, 'application/json', false), session = json(sessionResponse);
  assert.equal(session.schemaVersion, 1); assert.equal(session.actorId, actorId);
  assert(typeof session.expiresAt === 'string' && session.expiresAt.length > 0);
  cookie = sessionResponse.headers['set-cookie'][0].split(';')[0]; csrf = session.csrfToken; assert(typeof cookie === 'string' && typeof csrf === 'string');
  phase = 'authenticated-positive';
  const emptyPayload = { cursor: null, pageSize: 100, includeArchived: false };
  for (const kind of ['identity', 'binding']) assert.deepEqual((await read(kind, 'list', null, emptyPayload)).data.records, []);
  const initialEvidenceId = U(100), identityId = U(101), semanticsId = U(201);
  const evidence = { statement: 'I report the synthetic Main house native location.', provenance: { source: null, sourceRevision: null, sourceConfidence: null,
    evidenceBasis: 'owner-report', factAt: null, retrievedAt: new Date().toISOString(), vantage: null, uncertainty: { status: 'unknown', explanation: null } }, supersedesEvidenceIds: [], references: [] };
  const identityPayload = { kind: 'location', evidenceIds: [initialEvidenceId] };
  const semanticsPayload = { atlasId: identityId, semanticKind: 'building', label: 'Main house', reviewStatus: 'accepted', evidenceIds: [initialEvidenceId] };
  const create = { schemaVersion: 3, commandId: 'atlas.batch.execute', requestId: randomUUID(), context: scope, target: { authority: 'atlas', kind: 'batch', batchId: randomUUID() },
    payload: { commands: [command('evidence', initialEvidenceId, evidence), command('identity', identityId, identityPayload), command('location-semantics', semanticsId, semanticsPayload)] },
    idempotencyKey: randomUUID(), reason: 'Synthetic source-free native place evidence', preconditions: { target: null, guards: [] }, approvalReceiptId: null };
  const created = json(await exchange('POST', stock() + '/commands', create)); correlated(create, created, 'committed');
  assert.equal(created.data.records.length, 3); assert.match(created.data.requestDigest, SHA);
  const nativePath = `/api/atlas/editing/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/native-places/${semanticsId}`;
  const admission = json(await exchange('GET', nativePath));
  assert.equal(admission.schemaVersion, 1); assert.equal(admission.admissionKind, 'native-location'); assert.deepEqual(admission.scope, scope);
  assert.equal(admission.record.recordId, semanticsId); assert.equal(admission.record.revision, 1); assert.deepEqual(admission.record.payload, semanticsPayload);
  assert.equal(admission.identity.recordId, identityId); assert.deepEqual(admission.identity.payload, identityPayload); assert.equal(admission.canAttachEvidence, true);
  assert(admission.attachmentPolicy.contentTypes.includes('application/pdf'));
  assert.deepEqual(admission.guards, [{ record: { recordType: 'evidence', recordId: initialEvidenceId }, expectedRevision: 1 }, { record: { recordType: 'identity', recordId: identityId }, expectedRevision: 1 }]);
  const pdf = pdfBytes(), pdfSha256 = sha(pdf), filename = 'synthetic-electricity.pdf';
  const metadata = { schemaVersion: 1, requestId: randomUUID(), idempotencyKey: randomUUID(), context: scope, recordId: semanticsId, expectedRevision: admission.record.revision,
    guards: admission.guards, statement: 'Synthetic uploaded electricity evidence; document truth and capture time are unknown.', sourceLicense: { status: 'unknown', reference: null },
    reason: 'Synthetic source-free native place PDF attachment', filename, contentType: 'application/pdf' };
  const boundary = 'houseatlas-' + randomUUID();
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`), pdf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const upload = json(await exchange('POST', nativePath + '/evidence', body, 'multipart/form-data; boundary=' + boundary));
  correlated({ commandId: 'atlas.batch.execute', requestId: metadata.requestId }, upload, 'committed'); assert.match(upload.data.requestDigest, SHA);
  assert.equal(upload.data.records.length, 3); assert.equal(upload.data.auditIds.length, 3);
  const changedIdentity = upload.data.records.find(row => row.target.recordType === 'identity'), savedAsset = upload.data.records.find(row => row.target.recordType === 'asset'), savedEvidence = upload.data.records.find(row => row.target.recordType === 'evidence');
  assert(changedIdentity && savedAsset && savedEvidence); assert.equal(changedIdentity.target.recordId, identityId); assert.equal(changedIdentity.revision, 2);
  assert.match(savedAsset.target.recordId, UUID); assert.match(savedEvidence.target.recordId, UUID);
  const expectedIdentity = { ...identityPayload, evidenceIds: [initialEvidenceId, savedEvidence.target.recordId] }; assert.deepEqual(changedIdentity.payload, expectedIdentity);
  assert.equal(savedAsset.payload.sha256, pdfSha256); assert.equal(savedAsset.payload.byteSize, pdf.length); assert.equal(savedAsset.payload.contentType, 'application/pdf'); assert.equal(savedAsset.payload.previewPolicy, 'download-only');
  assert.equal(savedEvidence.payload.statement, metadata.statement); assert.equal(savedEvidence.payload.provenance.source, null); assert.equal(savedEvidence.payload.provenance.factAt, null);
  assert.deepEqual(savedEvidence.payload.references, [{ kind: 'atlas-asset', assetId: savedAsset.target.recordId }]);
  for (const [kind, id, payload] of [['identity', identityId, expectedIdentity], ['location-semantics', semanticsId, semanticsPayload], ['evidence', savedEvidence.target.recordId, savedEvidence.payload]]) {
    const actual = await read(kind, 'get', id); assert.deepEqual(actual.data.records[0].payload, payload);
    const history = await read(kind, 'history', id, emptyPayload);
    assert.equal(history.data.entries.length, kind === 'identity' ? 2 : 1);
    assert.equal(history.data.nextCursor, null); assert.equal(history.data.completeness, 'atlas-owned-audit');
    for (const entry of history.data.entries) {
      assert.equal(entry.actorId, actorId); assert.equal(entry.state, 'committed');
      assert.match(entry.eventId, UUID); assert([...created.data.auditIds, ...upload.data.auditIds].includes(entry.eventId));
      assert.deepEqual(entry.target, { authority: 'atlas', recordType: kind, recordId: id });
    }
  }
  assert.deepEqual((await read('binding', 'list', null, emptyPayload)).data.records, [], 'No source Binding fabricated');
  const afterAdmission = json(await exchange('GET', nativePath)); assert.equal(afterAdmission.record.revision, 1); assert.equal(afterAdmission.identity.revision, 2); assert.deepEqual(afterAdmission.identity.payload, expectedIdentity);
  const download = await read('asset', 'download', savedAsset.target.recordId); assert.equal(download.data.sha256, pdfSha256); assert.equal(download.data.byteSize, pdf.length);
  assert.equal(download.data.contentType, 'application/pdf'); assert.equal(download.data.disposition, 'attachment');
  assert(typeof download.data.downloadToken === 'string' && UUID.test(download.data.downloadToken), 'Native download handle shape');
  const delivery = await exchange('GET', `/api/atlas/media/downloads/${scope.workspaceId}/${scope.homeId}/${download.data.downloadToken}`);
  assert.equal(delivery.status, 200); assert.deepEqual(delivery.bytes, pdf); assert.equal(sha(delivery.bytes), pdfSha256);
  assert.equal(delivery.headers['content-type'], 'application/pdf'); assert.equal(delivery.headers['cache-control'], 'private, no-store'); assert.match(delivery.headers['content-disposition'], /^attachment;/);
  phase = 'graceful-stop';
  await stopOwned(service); assert.equal(service.exitCode, 0, 'Graceful native lease release');
  assert(Object.values(startupOutput).every(entry => !entry.readError), 'Owned startup pipes captured without read errors');
  phase = 'result';
  result = { format: 'houseatlas-native-place-evidence-positive/1', status: 'passed', runnerSha256: sha(selected(fileURLToPath(import.meta.url), 128 * 1024)), selectionSha256: sha(packetBytes),
    binary, openssl, scope, actorId, sourceFreeCreation: { request: create, wire: created }, nativeAdmission: admission, upload: { metadata, wire: upload, pdfSha256, bytes: pdf.length },
    nativeAfter: afterAdmission, proofs, download: { ...downloadEvidence(download), sha256: pdfSha256, bytes: delivery.bytes.length }, exchanges,
    qualification: 'Successful fresh disposable native loopback TLS/local Editor creation and PDF asset/evidence/identity batch plus actual read/history/download. No frontend DOM, actual household, PDF safety, provider, retry/replay, failure/denial/control or deployment acceptance.',
    cleanup: { ownedServiceStopped: true, gracefulExit: 0, scratchRemoved: false, elapsedMs: Date.now() - began } };
  liveBudget(); // A late graceful stop cannot convert a timed-out example to success.
  completed = true;
} catch (error) {
  primaryFailure = { error }; failedPhase = phase; failedCode = publicErrorCode(error);
} finally {
  clearTimeout(deadline);
  try {
    for (const child of owned) await stopOwned(child);
    assert(owned.every(stopped), 'No owned listener remains'); rmSync(scratch, { recursive: true }); assert(!existsSync(scratch));
    if (completed) { result.cleanup.scratchRemoved = true; result.cleanup.elapsedMs = Date.now() - began; writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); }
  } catch (error) {
    cleanupFailed = true; cleanupErrorCode = publicErrorCode(error);
    if (primaryFailure === null) { primaryFailure = { error }; failedPhase = 'cleanup'; failedCode = cleanupErrorCode; }
  } finally {
    cookie = undefined; csrf = undefined;
    if (primaryFailure !== null) {
      try {
        const failed = { format: 'houseatlas-native-place-evidence-failure/1', status: 'failed',
          runnerSha256: sha(selected(fileURLToPath(import.meta.url), 128 * 1024)), selectionSha256: sha(packetBytes),
          binarySha256: binary.sha256, binarySourceCommit: binary.sourceCommit, binarySourceTree: binary.sourceTree,
          failurePhase: failedPhase, failureCode: failedCode, startupOutput: startupEvidence(),
          service: { pid: service?.pid ?? null, exitCode: service?.exitCode ?? null, signalCode: service?.signalCode ?? null,
            failedToStart: service?.failedToStart === true, spawnCode, stdioClosed: service?.stdioClosed === true },
          cleanup: { failed: cleanupFailed, errorCode: cleanupErrorCode, ownedProcessesStopped: owned.every(stopped),
            ownedStdioClosed: owned.every(child => child.stdioClosed !== false), scratchRemoved: !existsSync(scratch), elapsedMs: Date.now() - began },
          qualification: 'Observed ordinary positive failure only; no pass, injected scenario, retry or diagnosis inferred. Only exact public pre-auth owner output is persisted; non-allowlisted lines and all post-auth output are withheld.' };
        writeFileSync(join(output, 'failure.json'), JSON.stringify(failed, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      } catch (error) {
        // Evidence failure never replaces the original error or releases success.
        console.error('Private failure evidence could not be written; original failure retained.', publicErrorCode(error));
      }
    }
  }
}
if (primaryFailure !== null) throw primaryFailure.error;
console.log('PASS successful synthetic native place PDF evidence, exact receipt and original download; owned state removed');
