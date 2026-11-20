/** Real-browser offline launch of the built public shell. Serves the existing
 * production `dist/` on an owned loopback listener, opens the Saved entry once
 * online so both service workers install, then reopens `/` with the network
 * gone. Generated build output and fake read responses only: no native backend,
 * real session, household data or provider. Live cases use disposable loopback
 * TLS (requires openssl), with trust scoped to its generated certificate key.
 *
 *   --case offline-launch  listener closed (connection refused) before reopen
 *   --case hung-network    listener accepts `/` but never answers ("lie-fi")
 *   --case live-launch     live entry `/`, generated cached Atlas and a waiting
 *                          outbox entry survive closing and reopening the tab;
 *                          building records, native and electrical catalogs,
 *                          and both PDFs come from live retention passes
 *   --case desktop-library ordinary HomeBox open, dedicated PDF worker, storage
 *                          and explicit reconnect against a signed-out host
 *   --case desktop-saved-pack partial pack, keyboard navigation and worker update
 *
 * Requires `npm --prefix frontend run build` first, Node 26.10.0 and an
 * inspected HOUSEATLAS_CHROMIUM executable. Prints launch timings. */
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transformWithOxc } from 'vite';
import { homeboxRoutes, openOrdinaryHomebox, checkDesktopLibrary, checkLibraryEviction, checkReconnect, checkPartialPack,
  displayFixtureSize } from './offline-desktop-cases.mjs';
import { offlineShellPlugin } from '../build/offline-shell-plugin.mjs';
import { trackOfflineBrowser, removeOfflineScratch, finishOfflineCleanup } from './offline-launch-cleanup.mjs';

const CASES = { 'offline-launch': 2_000, 'hung-network': 3_000, 'live-launch': 2_000, 'desktop-library': 2_000, 'desktop-saved-pack': 2_000 };
const selectionHint = 'Select --case ' + Object.keys(CASES).join(', ');
assert.equal(process.argv.length, 4, selectionHint);
assert.equal(process.argv[2], '--case');
const selected = process.argv[3], budgetMs = CASES[selected];
assert(budgetMs, selectionHint);
const desktopLibrary = selected === 'desktop-library';
const desktopPack = selected === 'desktop-saved-pack';
const liveEntry = selected === 'live-launch' || desktopLibrary;
const standardProfile = selected === 'live-launch' && process.env.HOUSEATLAS_TEST_STANDARD_DOCUMENTS === '1';
if (selected === 'live-launch' && !standardProfile) {
  // A second disposable profile proves the standard host with a genuinely cold device.
  const child = spawn(process.execPath, process.argv.slice(1), {
    stdio: 'inherit', env: { ...process.env, HOUSEATLAS_TEST_STANDARD_DOCUMENTS: '1' },
  });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 0, 'Standard-profile offline launch');
}
const chromium = process.env.HOUSEATLAS_CHROMIUM;
assert(chromium && existsSync(chromium), 'Set HOUSEATLAS_CHROMIUM to the inspected local Chromium executable');
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
for (const path of ['index.html', 'offline-entry-worker.js', 'saved/index.html', 'saved/service-worker.js'])
  assert(existsSync(join(dist, path)), `Build the frontend first: missing dist/${path}`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
let mode = 'online', served = 0, stalled = 0, servedPaths = [];
const successorFiles = new Map();
const sockets = new Set(), held = new Set();
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-offline-launch-'));
let tls = null, certificatePin = null;
if (liveEntry) {
  const key = join(scratch, 'key.pem'), cert = join(scratch, 'cert.pem');
  const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=127.0.0.1'], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  tls = { key: readFileSync(key), cert: readFileSync(cert) };
  certificatePin = createHash('sha256').update(new X509Certificate(tls.cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
}
let onlineSeed = null, denySession = false;
const apiRequests = [];
const topologyReads = [];
const libraryReads = [];
const unexpectedRequests = [];
const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const atlasSchema = JSON.parse(readFileSync(new URL('../../packages/contracts/schemas/atlas.schema.json', import.meta.url)));
const agentSchema = JSON.parse(readFileSync(new URL('../../contracts/client-schemas/agent-ajv.schema.json', import.meta.url)));
ajv.addSchema(atlasSchema); ajv.addSchema(agentSchema);
const stockBase = ({ workspaceId, homeId }) => `/api/atlas/stock/v3/workspaces/${workspaceId}/homes/${homeId}`;
const stockRead = (scope, commandId, records, requestId = randomUUID()) => {
  const result = { schemaVersion: 3, commandId, requestId, resolvedScope: scope,
    status: 'read', replayed: false, data: { records, sourceStatus: 'current', nextCursor: null } };
  const check = ajv.getSchema(agentSchema.$id + '#/$defs/result_' + commandId.replace(/[.-]/g, '_'));
  assert(check(result), JSON.stringify(check.errors));
  return result;
};
const jsonRead = value => new Response(JSON.stringify(value, (key, item) => key === 'metres' ? JSON.rawJSON('2.750') : item),
  { headers: { 'content-type': 'application/json', 'x-atlas-snapshot-sha256': 'f'.repeat(64), 'cache-control': 'private, no-store' } });
const serve = async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const path = url.pathname;
  if (onlineSeed && path.startsWith('/api/')) {
    const route = `${request.method} ${path}${url.search}`;
    apiRequests.push(route);
    try {
      let reply;
      const { scope } = onlineSeed.view;
      const library = onlineSeed.library.routes.get(route);
      const homebox = onlineSeed.homebox?.respond(request, url);
      if (homebox) {
        reply = homebox;
      } else if (library) {
        reply = await library();
        libraryReads.push({ route, status: reply.status });
      } else if (route === 'GET /api/atlas/auth/session') {
        reply = denySession ? new Response(null, { status: 401 }) : jsonRead({ schemaVersion: 1, actorId: onlineSeed.owner.actorId,
          csrfToken: 'generated-unused', expiresAt: '2099-01-01T00:00:00Z' });
      } else if (route === 'GET /api/atlas/view') {
        reply = jsonRead({ ...onlineSeed.view, entries: desktopLibrary ? onlineSeed.view.entries : [],
          sourceDocumentsService: { profile: 'houseatlas.geodata-document-read.v2', available: !standardProfile } });
      } else if (request.method === 'GET' && path === `${stockBase(scope)}/invoke`) {
        assert.equal(url.searchParams.size, 1);
        const query = JSON.parse(url.searchParams.get('request'));
        const kind = query.target.recordType, commandId = `atlas.${kind}.list`;
        const held = onlineSeed.topology;
        const records = query.payload.buildingId === undefined ? held.lists[kind]?.records
          : kind === 'identity' ? held.buildings.find(b => b.buildingId === query.payload.buildingId)?.members.records : undefined;
        assert(records, 'Only generated topology lists are served');
        assert.equal(query.commandId, commandId);
        const check = ajv.getSchema(agentSchema.$id + '#/$defs/request_' + commandId.replace(/[.-]/g, '_'));
        assert(check(query), JSON.stringify(check.errors));
        assert.deepEqual(query.context, scope);
        assert.equal(query.payload.cursor, null);
        assert.equal(query.payload.includeArchived, false);
        reply = jsonRead(stockRead(scope, commandId, records, query.requestId));
        topologyReads.push(kind);
      } else if (!onlineSeed.optionalReads.has(route)) {
        unexpectedRequests.push(route);
      }
      if (!reply) { response.writeHead(404).end(); return; }
      const body = Buffer.from(await reply.arrayBuffer());
      response.writeHead(reply.status, Object.fromEntries(reply.headers)).end(body);
    } catch (error) {
      unexpectedRequests.push(`${route}: ${error.message}`);
      response.writeHead(500).end();
    }
    return;
  }
  if (mode === 'hung' && (path === '/' || path === '/index.html')) { stalled++; held.add(response); return; }
  served++; servedPaths.push(path);
  const relative = path === '/' ? 'index.html' : path === '/saved/' ? 'saved/index.html' : path.slice(1);
  const file = normalize(join(dist, relative));
  if (!file.startsWith(dist + '/') || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return;
  }
  response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  response.end(successorFiles.get(path) ?? readFileSync(file));
};
const server = tls ? createSecureServer(tls, serve) : createServer(serve);
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const origin = `${tls ? 'https' : 'http'}://127.0.0.1:${port}`;

// Reuse the public generated publication and the production storage APIs. Only
// the live-launch case supplies generated online reads and seeds unrelated
// device data. These data modules are test setup, not additional served assets.
async function sourceURL(relative, replacements = {}) {
  const file = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(file, 'utf8'), file.pathname, {
    lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false,
  });
  for (const [specifier, url] of Object.entries(replacements)) {
    assert.ok(code.includes(JSON.stringify(specifier)), `Missing import ${specifier}`);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  for (const match of code.matchAll(/^\s*import\s+(?:[\w$\s{},*]+?\s+from\s+)?["']([^"']+)["']/gm))
    assert.ok(match[1].startsWith('data:'), `Unexpected setup import ${match[1]}`);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const stockRecord = (recordType, recordId, payload, revision = 1) => ({
  target: { authority: 'atlas', recordType, recordId }, revision, lifecycle: 'active', payload,
});
async function liveLibrary(scope, buildingId, homeLabel) {
  const { createSyntheticDocumentServer } = await import('./source-host-visual/synthetic-documents.ts');
  const built = await build({ configFile: false, logLevel: 'silent',
    build: { write: false, target: 'node26', minify: false, lib: {
      entry: fileURLToPath(new URL('./electrical-library-visual/synthetic-electrical.ts', import.meta.url)), formats: ['es'],
    } } });
  const fixture = Array.isArray(built) ? built[0] : built;
  const { code } = fixture.output.find(file => file.type === 'chunk' && file.isEntry);
  const { createSyntheticElectricalLibrary } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const routes = new Map();
  const json = (path, value) => routes.set(`GET ${path}`, () => jsonRead(value));

  // Expose one available PDF from the generated Documents fixture. Fill measures
  // the complete page, so unrelated preview, outline and stale tile stay out.
  const native = await createSyntheticDocumentServer(scope);
  const docBase = `/api/atlas/documents/v2/workspaces/${scope.workspaceId}/homes/${scope.homeId}/documents`;
  const docPath = `${docBase}/${native.documentIds[0]}`;
  const nativeGet = path => native.transport(native.origin + path, {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', mode: 'same-origin',
  });
  const metadata = await (await nativeGet(docPath)).json();
  const { document } = metadata;
  const { assetId, revision, sha256, bytes } = document.payload.original;
  const nativePin = { documentId: document.recordId, documentRevision: document.revision, assetId,
    assetRevision: revision, sha256, bytes, contentType: 'application/pdf' };
  const nativeOriginal = `${docPath}/original?expectedRevision=${document.revision}`;
  const nativeDownload = `GET ${nativeOriginal}`;
  if (!standardProfile) {
    json(`${docBase}?limit=50`, { profile: 'houseatlas.geodata-document-list.v2', scope, documents: [metadata], nextCursor: null });
    json(docPath, metadata);
    routes.set(nativeDownload, () => nativeGet(nativeOriginal));
  }

  // The mounted electrical reader qualifies the association, both supporting
  // originals and building evidence before it can fetch the correlated PDF.
  const electrical = await createSyntheticElectricalLibrary('pdf', 'available', { scope, buildingId, buildingLabel: 'Generated barn', homeLabel });
  const sceneBase = `/api/atlas/scene/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/buildings/${buildingId}`;
  json(`${sceneBase}/current`, { status: 'available', association: electrical.association });
  json(`${sceneBase}/head`, electrical.head);
  const record = (kind, id, payload, rev) => routes.set(`GET ${stockBase(scope)}/records/${kind}/${id}`,
    () => jsonRead(stockRead(scope, `atlas.${kind}.get`, [stockRecord(kind, id, payload, rev)])));
  const building = stockRecord('identity', buildingId, { kind: 'location', evidenceIds: [electrical.pdfEvidenceId] });
  record('identity', buildingId, building.payload, building.revision);
  let electricalPin, electricalDownload;
  for (const original of electrical.originals) {
    const { evidenceId, evidenceRevision, assetId, revision, sha256, bytes, contentType } = original;
    const provenance = { source: null, sourceRevision: null, sourceConfidence: null, evidenceBasis: 'document',
      factAt: null, retrievedAt: '2026-01-02T12:00:00Z', vantage: null,
      uncertainty: { status: 'unknown', explanation: 'Generated documentary original' } };
    record('evidence', evidenceId, { statement: 'Generated electrical original', provenance,
      supersedesEvidenceIds: [], references: [{ kind: 'atlas-asset', assetId }] }, evidenceRevision);
    record('asset', assetId, { owner: 'atlas', purpose: 'evidence-original', availability: 'available',
      sha256, byteSize: bytes.length, contentType, previewPolicy: 'download-only',
      sourceLicense: { status: 'unknown', reference: null }, evidenceIds: [] }, revision);
    const descriptor = createHash('sha256').update(JSON.stringify({ assetId, kind: 'atlas-asset' })).digest('hex');
    const download = `GET /api/atlas/media/${scope.workspaceId}/${scope.homeId}/${descriptor}/download`;
    routes.set(download, () => new Response(bytes, { headers: { 'content-type': contentType,
      'content-length': String(bytes.length), 'content-disposition': 'attachment; filename="generated-original"',
      'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } }));
    if (evidenceId === electrical.pdfEvidenceId) {
      electricalDownload = download;
      electricalPin = { source: 'electrical-evidence', buildingId, evidenceId, evidenceRevision,
        assetId, assetRevision: String(revision), sha256, byteSize: String(bytes.length), contentType };
    }
  }
  assert(electricalPin, 'Generated electrical PDF is pinned by the documentary fixture');
  const requiredReads = [...routes.keys()].filter(route => route !== `GET ${sceneBase}/head`);
  return { routes, requiredReads, building, nativePin, electricalPin, nativeSurveyBytes: native.bytes.get(assetId),
    pdfDownloads: standardProfile ? [electricalDownload] : [nativeDownload, electricalDownload] };
}

async function liveLaunchSeed() {
  const { buildSyntheticAtlas, composeAtlasEnvelope, SYNTHETIC_ATLAS, sha256Hex } = await import('./unified-atlas/synthetic-atlas.ts');
  const scope = { workspaceId: '00000000-0000-4000-8000-000000000800', homeId: '00000000-0000-4000-8000-000000000801' };
  const { glb, companionBytes } = await buildSyntheticAtlas(scope);
  const composed = await composeAtlasEnvelope(companionBytes, glb, SYNTHETIC_ATLAS.revision);
  const byteStoreURL = await sourceURL('../integration/native-geometry-scan-cache.ts');
  const cacheURL = await sourceURL('../integration/unified-atlas-cache.ts', { './native-geometry-scan-cache': byteStoreURL });
  const outboxURL = await sourceURL('../src/outbox/store.ts');
  const copyOwnerURL = await sourceURL('../src/offline/live-copy-owner.ts');
  const copyBackendURL = await sourceURL('../src/offline/live-copy-indexeddb.ts');
  const { syntheticPdf } = await import('./source-host-visual/synthetic-documents.ts');
  const place = n => `00000000-0000-4000-8000-0000000009${n}`;
  const homeLabel = 'Synthetic offline home';
  const library = await liveLibrary(scope, place('10'), homeLabel);
  const pdf = desktopLibrary ? library.nativeSurveyBytes : syntheticPdf();
  // Exact source-native association from the generated HomeBox storage contracts;
  // registration/observation facts describe this held copy, not a provider revision.
  const homeboxPin = { source: 'homebox-attachment', sourceInstanceId: '00000000-0000-4000-8000-000000000040',
    collectionId: 'generated-opaque-collection', entityId: '00000000-0000-4000-8000-000000000041',
    attachmentId: '00000000-0000-4000-8000-000000000042', observationId: '00000000-0000-4000-8000-000000000070',
    sourceRegistrationVersion: 3, sourceRegistrationSha256: 'e'.repeat(64), sha256: await sha256Hex(pdf), bytes: pdf.length,
    contentType: 'application/pdf', sourceContentType: 'application/pdf', beforeRetrievedAt: '2026-01-03T10:00:01Z',
    bodyRetrievedAt: '2026-01-03T10:00:02Z', afterRetrievedAt: '2026-01-03T10:00:03Z' };
  const source = { sourceInstanceId: homeboxPin.sourceInstanceId, collectionId: homeboxPin.collectionId,
    sourceKind: 'homebox-entity', externalId: homeboxPin.entityId };
  const view = { status: 'ready', scope, homeLabel, now: '2026-01-03T10:00:00Z', canEdit: true,
    homes: [{ ...scope, label: homeLabel }], caches: [], entries: [{
      ...scope, key: JSON.stringify([source.sourceInstanceId, source.collectionId, source.sourceKind, source.externalId]), source,
      entity: { id: homeboxPin.entityId, name: 'Generated pump', description: '', entityType: null, parent: null, archived: false,
        quantity: '1', manufacturer: null, modelNumber: null, serialNumber: null, notes: null },
      kind: 'item', semanticKind: 'unclassified', sourceState: 'present', cacheStatus: 'stale', sourceUpdatedAt: null,
      retrievedAt: '2026-01-03T10:00:00Z', aliases: [], mobility: 'unknown', attachments: [{
        attachmentId: homeboxPin.attachmentId, title: 'Generated HomeBox PDF', kind: 'stored-file',
        contentType: 'application/pdf', byteSize: String(pdf.length), downloadHref: null, previewHref: null,
      }], nativeLinks: [],
      maintenance: [{ entryId: 'generated-upkeep', name: 'Inspect generated pump', description: 'Generated maintenance only',
        scheduledDate: '2026-01-10', completedDate: null, cost: null }], networkBound: false, networkStates: [], networkRelations: [],
    }] };
  // Generated building records as the Rooms & places lens reads them (#560), encoded by the actual codec:
  // a building, a level at an exact recorded elevation, a level with an unknown elevation and a room.
  const { loadNumericSource } = await import('./load-numeric-source.mjs');
  const { encodeHeldTopology } = await import(await loadNumericSource('offline/held-topology.ts'));
  const { ExactDecimal } = await import(await loadNumericSource('numeric/decimal.ts'));
  const location = n => stockRecord('identity', place(n), { kind: 'location', evidenceIds: [] });
  const named = (n, atlasId, semanticKind, label, extra = {}) => stockRecord('location-semantics', place(n),
    { atlasId, semanticKind, reviewStatus: 'accepted', label, evidenceIds: [place('40')], ...extra });
  const contains = (n, from, to, membershipKind) => stockRecord('relation', place(n), { kind: 'location-membership', membershipKind,
    from: { kind: 'atlas-record', ref: { recordType: 'identity', recordId: place(from) } },
    to: { kind: 'atlas-record', ref: { recordType: 'identity', recordId: place(to) } },
    reviewStatus: 'accepted', uncertainty: { status: 'unknown', explanation: null }, evidenceIds: [place('40')] });
  const locations = [library.building, ...['11', '12', '13'].map(location)];
  const topology = encodeHeldTopology({ version: 1, scope, capturedAt: '2026-01-03T10:20:00.000Z', snapshotSha256: 'f'.repeat(64),
    lists: { identity: { records: locations, sourceStatus: 'current' }, binding: { records: [], sourceStatus: 'current' },
      'location-semantics': { records: [named('20', place('10'), 'building', 'Generated barn'),
        named('21', place('11'), 'floor', 'Generated ground level', { elevation: { status: 'known', metres: ExactDecimal.parse('2.750'), datumAtlasId: place('10') } }),
        named('22', place('12'), 'floor', 'Generated loft', { elevation: { status: 'unknown' } }),
        named('23', place('13'), 'room', 'Generated tack room', { evidenceIds: [place('40')] })], sourceStatus: 'current' },
      relation: { records: [contains('30', '10', '11', 'building'), contains('31', '10', '12', 'building'), contains('32', '11', '13', 'level')], sourceStatus: 'current' } },
    buildings: [{ buildingId: place('10'), members: { records: locations, sourceStatus: 'current' } }] });
  console.log(`INFO held building records, generated live-launch home: ${topology.byteLength} bytes`);
  // These independent services are not configured for this fixture.
  const optionalReads = new Set([
    'GET /api/atlas/backup/v1/settings',
    `GET ${stockBase(scope)}/admission`,
    `GET ${stockBase(scope)}/quantity-tool-admission`,
    `GET ${stockBase(scope)}/records/geometry?pageSize=100&includeArchived=false`,
    `GET /api/atlas/operation-events?workspaceId=${scope.workspaceId}&homeId=${scope.homeId}&pageSize=25`,
  ]);
  const owner = { actorId: 'synthetic-offline-launch-actor', ...scope };
  const requestId = 'synthetic-offline-launch-request';
  // Same persisted entry shape as the existing generated outbox examples. It
  // is deliberately never sent: this static fixture has no canonical session
  // or stock command server and cannot establish reconnect authorization.
  const entry = { id: 'synthetic-offline-launch-edit', seq: 1, owner, kind: 'place-name',
    label: 'Rename generated room after offline launch',
    target: { recordType: 'location-semantics', recordId: 'synthetic-room' },
    intent: { label: 'Generated renamed room' }, commandId: 'atlas.batch.execute', requestId,
    body: JSON.stringify({ commandId: 'atlas.batch.execute', requestId,
      idempotencyKey: 'synthetic-offline-launch-key', target: 'synthetic-room', base: 1 }),
    createdAt: '2026-01-03T10:15:00.000Z', state: 'waiting', sent: false, problem: null, settledAt: null };
  return { topology: JSON.parse(Buffer.from(topology).toString()), optionalReads, library, cacheURL, outboxURL,
    copyOwnerURL, copyBackendURL, view, homeboxPin, pdf: [...pdf], owner, entry, publicationId: SYNTHETIC_ATLAS.publicationId,
    manifestSha256: composed.manifestSha256, modelSha256: composed.sha256,
    envelopeSha256: await sha256Hex(composed.envelopeBytes), envelope: [...composed.envelopeBytes], model: [...glb] };
}

// Reseal the same public bundle with one harmless HTML revision in task-owned
// output. This exercises both actual workers without rebuilding the app twice.
function installSuccessorFiles() {
  const output = join(scratch, 'successor');
  mkdirSync(join(output, 'saved'), { recursive: true });
  cpSync(join(dist, 'assets'), join(output, 'assets'), { recursive: true });
  const html = readFileSync(join(dist, 'saved/index.html'), 'utf8');
  writeFileSync(join(output, 'saved/index.html'), html.replace(/<meta name="houseatlas-saved-shell-build" content="[a-f0-9]{64}">/,
    '<meta name="generated-shell-revision" content="second">'));
  for (const entry of readdirSync(join(dist, 'saved')).filter(name => name.startsWith('pdf.worker.min-')))
    cpSync(join(dist, 'saved', entry), join(output, 'saved', entry));
  const plugin = offlineShellPlugin();
  plugin.configResolved({ root: dirname(dist), build: { outDir: output } });
  plugin.closeBundle();
  for (const path of ['/saved/index.html', '/saved/service-worker.js', '/offline-entry-worker.js'])
    successorFiles.set(path, readFileSync(join(output, path.slice(1))));
  return shellBuildId(successorFiles.get('/saved/index.html').toString());
}
const shellBuildId = html => html.match(/name="houseatlas-saved-shell-build" content="([a-f0-9]{64})"/)?.[1];
const shownBuild = `document.querySelector('meta[name="houseatlas-saved-shell-build"]')?.content`;

class Pipe {
  next = 0; pending = new Map(); buffer = Buffer.alloc(0); listeners = new Set();
  constructor(child) {
    const stop = error => { for (const entry of this.pending.values()) entry.reject(error); this.pending.clear(); };
    child.on('exit', code => stop(new Error('Chromium exited: ' + code)));
    child.stdio[4].on('data', bytes => {
      this.buffer = Buffer.concat([this.buffer, bytes]);
      let end;
      while ((end = this.buffer.indexOf(0)) !== -1) {
        const raw = this.buffer.subarray(0, end).toString(); this.buffer = this.buffer.subarray(end + 1);
        if (!raw) continue;
        const message = JSON.parse(raw);
        if (message.id) {
          const entry = this.pending.get(message.id); if (!entry) continue;
          this.pending.delete(message.id);
          message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
        } else for (const listener of this.listeners) listener(message);
      }
    });
    this.child = child;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
  }
}

const browser = spawn(chromium, ['--headless=new', ...(tls ? ['--ignore-certificate-errors-spki-list=' + certificatePin] : []), '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
  '--disable-sync', '--user-data-dir=' + join(scratch, 'profile'), 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
const stopBrowser = trackOfflineBrowser(browser);
const cdp = new Pipe(browser);
const timeout = (ms, label) => new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms).unref());
// Keep bounded observations across target replacement and reload. Do not turn
// diagnostics into extra network/storage work or change the case's deadlines.
const observations = [];
const record = (kind, detail) => {
  const bounded = JSON.parse(JSON.stringify(detail, (_key, value) => typeof value === 'string' ? value.slice(0, 2000) : value));
  observations.push({ ms: Date.now(), kind, detail: bounded });
  if (observations.length > 160) observations.shift();
};
let primarySession, coldReload = null, diagnose = async () => ({ observations });
cdp.listeners.add(message => {
  const { method, params, sessionId } = message;
  if (sessionId !== primarySession) return;
  if (['Page.frameNavigated', 'Page.lifecycleEvent', 'Page.frameStartedLoading', 'Page.frameStoppedLoading',
    'Runtime.executionContextCreated', 'Runtime.executionContextDestroyed', 'Runtime.executionContextsCleared'].includes(method)) {
    record(method, params);
    if (method === 'Page.frameNavigated' && !params.frame.parentId && coldReload)
      coldReload.committedLoader = params.frame.loaderId;
  } else if (method === 'Runtime.exceptionThrown') {
    record(method, { text: params.exceptionDetails.text, description: params.exceptionDetails.exception?.description?.slice(0, 2000),
      url: params.exceptionDetails.url, lineNumber: params.exceptionDetails.lineNumber });
  } else if (method === 'Runtime.consoleAPICalled') {
    record(method, { type: params.type, context: params.executionContextId,
      args: params.args.map(arg => String(arg.value ?? arg.description ?? arg.type).slice(0, 1000)) });
  } else if (method === 'Network.loadingFailed') record(method, params);
});
// Observe original IndexedDB requests without replacing application handlers,
// awaiting requests, reading stored values or creating a connection ourselves.
const storageProbe = `(() => {
  const pending = new Map(), recent = []; let next = 0;
  const finish = (id, kind) => {
    const entry = pending.get(id); pending.delete(id);
    recent.push({ ...entry, kind, at: performance.now() }); if (recent.length > 40) recent.shift();
  };
  globalThis.__offlineStorageDiagnostics = () => ({ pending: [...pending.values()], recent });
  const open = indexedDB.open;
  indexedDB.open = function (...args) {
    const request = open.apply(this, args), id = ++next;
    pending.set(id, { id, operation: 'open', database: String(args[0]), at: performance.now() });
    for (const event of ['success', 'error']) request.addEventListener(event, () => finish(id, event), { once: true });
    for (const event of ['blocked', 'upgradeneeded']) request.addEventListener(event, () => {
      recent.push({ id, kind: event, at: performance.now() }); if (recent.length > 40) recent.shift();
    });
    request.addEventListener('success', () => request.result.addEventListener('versionchange', () => {
      recent.push({ id, kind: 'versionchange', at: performance.now() }); if (recent.length > 40) recent.shift();
    }), { once: true });
    return request;
  };
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = transaction.apply(this, args), id = ++next;
    pending.set(id, { id, operation: 'transaction', database: this.name, mode: tx.mode, at: performance.now() });
    for (const event of ['complete', 'abort']) tx.addEventListener(event, () => finish(id, event), { once: true });
    return tx;
  };
})()`;
let primaryFailure = null;
try {
  let { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  let { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  const observePage = async () => {
    primarySession = sessionId;
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.setLifecycleEventsEnabled', { enabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: storageProbe });
  };
  await observePage();
  const evaluate = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) record('evaluate exception', { text: exceptionDetails.text, description: exceptionDetails.exception?.description?.slice(0, 1000) });
    assert(!exceptionDetails, exceptionDetails?.exception?.description ?? exceptionDetails?.text);
    return result.value;
  };
  const bounded = async task => {
    let timer;
    try { return await Promise.race([task(), new Promise(resolve => { timer = setTimeout(() => resolve('diagnostic timeout'), 1500); })]); }
    catch (error) { return String(error); } finally { clearTimeout(timer); }
  };
  diagnose = async () => {
    const [page, workers, frameTree, documentTree, targets] = await Promise.all([
      bounded(() => evaluate(`(() => ({
        url: location.href, readyState: document.readyState, visibility: document.visibilityState,
        htmlLength: document.documentElement?.outerHTML.length, text: document.body?.innerText.slice(0, 2000),
        rootChildren: document.getElementById('root')?.childElementCount,
        appHidden: document.querySelector('.offline-app-root')?.hidden,
        storage: globalThis.__offlineStorageDiagnostics?.(),
        navigation: performance.getEntriesByType('navigation').map(({ type, startTime, responseStart, domContentLoadedEventEnd, loadEventEnd }) =>
          ({ type, startTime, responseStart, domContentLoadedEventEnd, loadEventEnd })),
        controller: navigator.serviceWorker.controller?.scriptURL,
      }))()`)),
      bounded(() => evaluate(`navigator.serviceWorker.getRegistrations().then(rows => rows.map(row => ({ scope: row.scope,
        active: row.active?.state, waiting: row.waiting?.state, installing: row.installing?.state })))`)),
      bounded(() => send('Page.getFrameTree')),
      bounded(async () => {
        // DOM-domain readback is independent of Runtime's default context.
        const { root } = await send('DOM.getDocument', { depth: 0 });
        const { outerHTML } = await send('DOM.getOuterHTML', { nodeId: root.nodeId });
        return { url: root.documentURL, htmlLength: outerHTML.length,
          containsWithdrawnMessage: outerHTML.includes('Held app information is unavailable or was removed.') };
      }),
      bounded(() => cdp.send('Target.getTargets')),
    ]);
    return { coldReload, page, workers, frameTree, documentTree, targets, observations };
  };
  const screenshot = async name => {
    const directory = process.env.HOUSEATLAS_OFFLINE_SCREENSHOTS;
    if (!directory) return;
    await evaluate(`Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined)))`);
    mkdirSync(directory, { recursive: true });
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(directory, name + '.png'), Buffer.from(data, 'base64'));
  };
  const poll = async (expression, ms, label) => {
    const until = Date.now() + ms;
    for (;;) {
      if (await evaluate(expression).catch(error => { record('poll evaluation error', String(error)); return false; })) return Date.now();
      if (Date.now() > until) throw new Error(label + ': ' + await evaluate('document.body.innerText').catch(() => 'page unavailable'));
      await new Promise(done => setTimeout(done, 25));
    }
  };

  const installPersistence = () => send('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.origin === ${JSON.stringify(origin)}) {
      globalThis.persistenceCalls = 0;
      let granted = false;
      Object.defineProperties(navigator.storage, {
        persisted: { value: async () => granted },
        persist: { value: async () => { globalThis.persistenceCalls++; return granted = globalThis.allowPersistence === true; } },
      });
    }` });
  // 1. Online: the Saved or live entry installs the public offline closure.
  // The live entry also runs ordinary retention against the generated routes.
  if (liveEntry) onlineSeed = await liveLaunchSeed();
  if (desktopLibrary) onlineSeed.homebox = homeboxRoutes(onlineSeed, stockBase, jsonRead);
  if (standardProfile || desktopLibrary) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.origin === ${JSON.stringify(origin)})
      localStorage.setItem('houseatlas.keep-native-library.v1', 'off');` });
  }
  await send('Page.navigate', { url: origin + (liveEntry ? '/' : '/saved/index.html') });
  await poll(`(async () => {
    const root = await navigator.serviceWorker.getRegistration('/'), saved = await navigator.serviceWorker.getRegistration('/saved/');
    return root?.active?.state === 'activated' && saved?.active?.state === 'activated'
      && (await caches.keys()).some(name => name.startsWith('houseatlas-saved-public-'));
  })()`, 60_000, 'Root and Saved workers did not activate online');
  if (selected === 'live-launch') {
    await poll(`[...document.querySelectorAll('button')].some(b => b.textContent === 'Place records' && b.getClientRects().length > 0)`, 15_000, 'Online Place records missing');
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Place records' && b.getClientRects().length > 0).click()`);
    await poll(`document.body.textContent.includes('Building records: current')`, 15_000, 'Online building records not visible');
    if (standardProfile) {
      const fill = `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === 'Keep library now')`;
      await evaluate(`document.querySelector('button[aria-label="Settings"]').click()`);
      await poll(`Boolean(${fill})`, 10_000, 'Keep library now did not appear');
      assert.equal(onlineSeed.library.pdfDownloads.some(route => libraryReads.some(read => read.route === route)), false,
        'The standard-profile original must be acquired by the explicit fill');
      await evaluate(`${fill}.click()`);
    }
    await new Promise(done => setTimeout(done, 20_000));
    assert(topologyReads.length >= 4, 'The live host reads generated building records');
    assert.equal(await evaluate(`(async () => {
      const request = indexedDB.open('houseatlas-live-readonly-copy-v1');
      const db = await new Promise((yes, no) => { request.onsuccess = () => yes(request.result); request.onerror = () => no(request.error); });
      try { return await new Promise((yes, no) => {
        const tx = db.transaction('metadata'), rows = tx.objectStore('metadata').getAllKeys();
        tx.oncomplete = () => yes(rows.result.some(key => key.includes('"topology"'))); tx.onabort = () => no(tx.error);
      }); } finally { db.close(); }
    })()`), true, 'Online-visible building records must be held after the warm');
    const { nativePin, electricalPin, requiredReads, pdfDownloads } = onlineSeed.library;
    assert.deepEqual(unexpectedRequests, [], 'Only the generated read contracts may be used online');
    const servedReads = libraryReads.filter(read => read.status === 200).map(read => read.route);
    assert.deepEqual(requiredReads.filter(route => !servedReads.includes(route)), [], 'Live fill must read both catalogs and their qualified originals');
    for (const route of pdfDownloads) assert.equal(servedReads.filter(read => read === route).length, 1, route);
    const held = await evaluate(`(async () => {
      const { createLiveCopyOwner } = await import(${JSON.stringify(onlineSeed.copyOwnerURL)});
      const { openLiveCopyBackend } = await import(${JSON.stringify(onlineSeed.copyBackendURL)});
      const copies = createLiveCopyOwner(openLiveCopyBackend(indexedDB));
      const signal = new AbortController().signal;
      function check(result) {
        if (result.status !== 'ok') throw new Error('Live hold readback: ' + result.status);
        return result.value;
      }
      async function measure(blob) {
        const bytes = await blob.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return { bytes: bytes.byteLength, contentType: blob.type,
          sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
      }
      try {
        const { handle } = check(await copies.readLast(signal));
        const { actorId, scope } = check(await copies.copyIdentity(handle, signal));
        const native = await copies.readDocument(handle, ${JSON.stringify(nativePin)}, signal);
        const electrical = check(await copies.readElectricalDocument(handle, ${JSON.stringify(electricalPin)}, signal));
        return { actorId, scope, native: native.status === 'ok' ? await measure(native.value) : native.status, electrical: await measure(electrical) };
      } finally { copies.close(); }
    })()`);
    assert.deepEqual(held, {
      actorId: onlineSeed.owner.actorId, scope: onlineSeed.view.scope,
      native: standardProfile ? 'missing' : { bytes: nativePin.bytes, contentType: nativePin.contentType, sha256: nativePin.sha256 },
      electrical: { bytes: Number(electricalPin.byteSize), contentType: electricalPin.contentType, sha256: electricalPin.sha256 },
    }, 'Live fill retained exact, catalog-bound originals for this profile before any device seeding');
    console.log(`INFO ${standardProfile ? 'standard' : 'full-document'} live fill held electrical ${held.electrical.bytes} bytes with matching SHA-256`);
  }
  if (desktopLibrary) {
    // Persistence outcomes are deterministic; Chrome still owns actual IndexedDB and Cache Storage.
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await openOrdinaryHomebox({ evaluate, poll }, onlineSeed);
  }
  let pack = null, firstBuild = null, packModule = null;
  if (desktopPack) {
    await poll(`document.querySelector('.saved-manager [role="status"]')?.textContent === 'No manually saved house copy on this browser.'`,
      5_000, 'An empty profile was not described as missing a saved copy');
    firstBuild = shellBuildId(readFileSync(join(dist, 'saved/index.html'), 'utf8'));
    assert.match(firstBuild, /^[a-f0-9]{64}$/);
    const built = await build({ configFile: false, logLevel: 'silent', build: { write: false, target: 'esnext',
      lib: { entry: fileURLToPath(new URL('./offline-atlas-browser/generated-pack.ts', import.meta.url)), formats: ['es'] } } });
    const { code } = (Array.isArray(built) ? built[0] : built).output.find(file => file.type === 'chunk' && file.isEntry);
    packModule = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
    pack = await evaluate(`import(${JSON.stringify(packModule)}).then(fixture => fixture.keepPartialPack(${JSON.stringify(firstBuild)}))`);
  }
  const installed = served;

  // 2. Network gone. Reopen the installed start URL.
  if (selected !== 'hung-network') {
    await new Promise(done => { server.close(done); for (const socket of sockets) socket.destroy(); });
  } else mode = 'hung';
  served = 0; servedPaths = [];
  let seeded = null;
  const reopenApiRequests = [], externalRequests = [], offlineResponses = [], pdfTargets = new Map();
  if (liveEntry) {
    seeded = onlineSeed;
    const { cacheURL, outboxURL, copyOwnerURL, copyBackendURL, view, homeboxPin, pdf, owner, entry, publicationId, manifestSha256, modelSha256,
      envelopeSha256, envelope, model } = seeded;
    assert.deepEqual(await evaluate(`(async () => {
      const { openUnifiedAtlasStore, observeUnifiedAtlasActor, createUnifiedAtlasCache } = await import(${JSON.stringify(cacheURL)});
      const { openOutboxStore } = await import(${JSON.stringify(outboxURL)});
      const store = openUnifiedAtlasStore(indexedDB); await store.ready();
      try {
        // A synthetic display-only actor observation publishes the pointer;
        // this is not a canonical live session or authority to send the edit.
        const owner = ${JSON.stringify(owner)};
        const actor = await observeUnifiedAtlasActor(store, owner.actorId);
        if (!actor) throw new Error('Synthetic Atlas actor observation was not retained');
        const cache = createUnifiedAtlasCache(store, owner, actor);
        cache.keepModel(${JSON.stringify(modelSha256)}, new Uint8Array(${JSON.stringify(model)}));
        cache.keepScene(${JSON.stringify(publicationId)}, ${JSON.stringify(manifestSha256)},
          new Uint8Array(${JSON.stringify(envelope)}), ${JSON.stringify(envelopeSha256)}, null);
      } finally { await store.close(); }
      ${desktopLibrary ? '' : `      const { createLiveCopyOwner } = await import(${JSON.stringify(copyOwnerURL)});
      const { openLiveCopyBackend } = await import(${JSON.stringify(copyBackendURL)});
      const copies = createLiveCopyOwner(openLiveCopyBackend(indexedDB));
      const check = result => { if (result.status !== 'ok') throw new Error('Generated retention failed: ' + result.status); return result.value; };
      try {
        const actor = check(await copies.observeActor(${JSON.stringify(owner.actorId)}, () => true));
        const home = check(copies.bindHome(actor, ${JSON.stringify(view.scope)}, () => true));
        const signal = new AbortController().signal;
        check(await copies.keepView(home, ${JSON.stringify(view)}, signal));
        check(await copies.keepHomeboxDocument(home, ${JSON.stringify(homeboxPin)}, new Uint8Array(${JSON.stringify(pdf)}).buffer, signal));
      } finally { copies.close(); }
`}
      const outbox = openOutboxStore(indexedDB);
      try { await outbox.put(${JSON.stringify(entry)}); return await outbox.list(); }
      finally { outbox.close(); }
    })()`), [entry], 'the complete generated queue record is durable before close');
  }
  if (liveEntry || desktopPack) {
    // Close the application target, rather than merely reloading its React
    // tree. The new target shares only the device profile and retained stores.
    assert.equal((await cdp.send('Target.closeTarget', { targetId })).success, true);
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
    await observePage();
    if (desktopLibrary) await installPersistence();
    cdp.listeners.add(message => {
      if (desktopLibrary && message.method === 'Target.attachedToTarget' && message.sessionId === sessionId) {
        const child = message.params.sessionId;
        if (message.params.targetInfo.type === 'worker') pdfTargets.set(child, message.params.targetInfo);
        void cdp.send('Network.enable', {}, child)
          .then(() => cdp.send('Runtime.runIfWaitingForDebugger', {}, child))
          .catch(error => record('Worker attach error', String(error)));
      }
      if (message.sessionId !== sessionId && !pdfTargets.has(message.sessionId)) return;
      if (desktopLibrary && message.method === 'Network.responseReceived') {
        const { url, status, fromServiceWorker, serviceWorkerResponseSource } = message.params.response;
        if (url.startsWith('http')) offlineResponses.push({ url, status, fromServiceWorker, serviceWorkerResponseSource });
      }
      if (message.method === 'Network.requestWillBeSent') {
        const { method, url } = message.params.request;
        if (url.startsWith(origin + '/api/')) reopenApiRequests.push({ method, url });
        if (/^https?:/.test(url) && new URL(url).origin !== origin) externalRequests.push({ method, url });
      }
    });
    await send('Network.enable');
    if (desktopLibrary) await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  } else await send('Page.navigate', { url: 'about:blank' });
  const started = Date.now();
  send('Page.navigate', { url: origin + '/' }).catch(() => {});
  const shown = await Promise.race([
    poll(`location.pathname === '/saved/index.html' && document.readyState !== 'loading'
      && document.getElementById('root')?.childElementCount > 0`, budgetMs + 5_000, 'no shell'),
    timeout(budgetMs + 5_000, 'no shell'),
  ]).catch(() => null);
  const launchMs = shown === null ? null : shown - started;
  console.log(JSON.stringify({ case: selected, installRequests: installed, launchMs, budgetMs,
    reopenRequestsServed: served, reopenPaths: servedPaths, stalledRootRequests: stalled }));
  assert.notEqual(launchMs, null, `Offline reopen never showed the Saved shell within ${budgetMs + 5_000} ms`);
  assert(launchMs <= budgetMs, `Offline reopen took ${launchMs} ms; budget ${budgetMs} ms`);
  // A page in a worker's scope may ask for that worker's script (registration.update(),
  // updateViaCache 'none'); in hung-network the listener answers it. That is an update
  // check, not shell bytes: the shell itself must still come from the cache.
  const updateChecks = new Set(['/offline-entry-worker.js', '/saved/service-worker.js']);
  assert.deepEqual(servedPaths.filter(path => !updateChecks.has(path)), [], 'Offline reopen fetched public shell bytes from the network');
  if (desktopLibrary) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await checkDesktopLibrary({ evaluate, poll, send }, seeded);
    await checkLibraryEviction({ evaluate, poll }, seeded);
    assert.deepEqual(reopenApiRequests, [], 'The offline PDF journey performs no API requests');
    assert.deepEqual(externalRequests, [], 'The offline PDF journey requests no non-loopback resources');
    assert.deepEqual(servedPaths, [], 'No request reaches the loopback listener while it is stopped');
    const workers = offlineResponses.filter(response => new URL(response.url).pathname.includes('/pdf.worker.min-'));
    assert(workers.some(response => response.status === 200 && response.fromServiceWorker
      && response.serviceWorkerResponseSource === 'cache-storage'
      && [...pdfTargets.values()].some(target => target.url === response.url)), JSON.stringify(workers));
    assert(offlineResponses.every(response => response.fromServiceWorker), JSON.stringify(offlineResponses));
    assert(!observations.some(event => event.kind === 'Runtime.consoleAPICalled'
      && event.detail.args.includes('Warning: Setting up fake worker.')), 'PDF.js fell back to the main thread');
    console.log('INFO PDF worker responses: ' + JSON.stringify(workers.map(({ status, serviceWorkerResponseSource }) => ({ status, serviceWorkerResponseSource }))));
    assert.deepEqual(unexpectedRequests, [], 'Online HomeBox open used only generated, scoped read routes');
    const beforeReconnect = apiRequests.length;
    await checkReconnect({ evaluate, poll }, seeded, async () => {
      denySession = true;
      await new Promise(done => server.listen(port, '127.0.0.1', done));
    });
    assert.deepEqual(apiRequests.slice(beforeReconnect), ['GET /api/atlas/auth/session']);
    console.log('INFO desktop library: one ordinary HomeBox read, two rendered pages, exact held original, cached PDF worker, storage totals and explicit persistence outcomes, eviction and signed-out live handoff');
  } else if (desktopPack) {
    const workerIdentities = `(async () => {
        const root = (await navigator.serviceWorker.getRegistration('/'))?.active;
        const saved = navigator.serviceWorker.controller;
        if (new URL(root.scriptURL).pathname !== '/offline-entry-worker.js' ||
            new URL(saved.scriptURL).pathname !== '/saved/service-worker.js') return null;
        return await Promise.all([[root, 'root-entry-status'], [saved, 'saved-shell-status']].map(([worker, message]) =>
          new Promise(resolve => {
            const channel = new MessageChannel();
            const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 3000);
            channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
            worker.postMessage(message, [channel.port2]);
          })));
      })()`;
    const compareShells = async expected => {
      assert.equal(await evaluate(shownBuild), expected);
      assert.deepEqual(await evaluate(workerIdentities), [{ ready: true, buildId: expected }, { ready: true, buildId: expected }]);
    };
    await compareShells(firstBuild);
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await checkPartialPack({ evaluate, poll, send }, pack);
    assert.deepEqual(reopenApiRequests, [], 'A partial pack makes no API requests offline');
    assert.deepEqual(servedPaths, []);
    const successor = installSuccessorFiles();
    assert.match(successor, /^[a-f0-9]{64}$/);
    assert.notEqual(successor, firstBuild);
    await new Promise(done => server.listen(port, '127.0.0.1', done));
    // A cache-bypassing Saved URL receives the newer public HTML. Its normal
    // startup verifies and updates Saved first, then the root registration.
    assert.equal(await evaluate(shownBuild), firstBuild, 'A newly served build must not relabel the open old document');
    await send('Page.navigate', { url: origin + '/saved/index.html?generated-build=2' });
    await poll(`document.querySelector('.saved-header [role="status"]')?.textContent === 'Public shell verified' &&
      ${shownBuild} === ${JSON.stringify(successor)}`, 25_000, 'The successor Saved shell did not install');
    await compareShells(successor);
    await new Promise(done => { server.close(done); for (const socket of sockets) socket.destroy(); });
    await send('Page.navigate', { url: 'about:blank' });
    await send('Page.navigate', { url: origin + '/' });
    await poll(`location.pathname === '/saved/index.html' && ${shownBuild} === ${JSON.stringify(successor)} &&
      document.querySelector('.saved-manager') !== null`, 10_000, 'Cold reopen did not select the successor shell');
    await compareShells(successor);
    await evaluate(`[...document.querySelectorAll('.saved-manager button')].find(b => b.textContent === 'Open saved Atlas').click()`);
    await poll(`document.querySelector('.saved-coverage')?.textContent.includes(${JSON.stringify(pack.localRevision)}) &&
      document.querySelector('.saved-coverage summary')?.textContent.startsWith('Saved coverage: partial pack;')`, 10_000,
      'A public shell update changed the retained partial pack');
    assert.deepEqual(await evaluate(`import(${JSON.stringify(packModule)}).then(fixture => fixture.verifyRetainedPack(${JSON.stringify(pack.localRevision)}))`),
      { shellBuildId: firstBuild, snapshotId: pack.snapshotId }, 'The generated pack must retain its original shell pin and verified resources');
    assert.deepEqual(reopenApiRequests, []);
    assert.deepEqual(externalRequests, []);
    console.log('INFO desktop Saved pack: exact partial capture, keyboard building/floor/room navigation and accessible names, Plan/3D round trip, and matching root/Saved identities across a public worker update');
  } else if (seeded) {
    // Assert actual application output from the retained generated publication,
    // not just a shell, a cache record, or an injected waiting-count element.
    await poll(`(() => {
      const atlas = document.querySelector('.offline-atlas .ua-shell.is-stage');
      const buildings = atlas?.querySelector('[aria-label="Buildings"]')?.textContent ?? '';
      const status = atlas?.querySelector('.ua-stored-note')?.textContent ?? '';
      const offline = document.querySelector('.offline-pill')?.textContent ?? '';
      return buildings.includes('Synthetic house') && buildings.includes('Synthetic studio')
        && status.includes('Stored copy') && status.includes('not updated')
        && offline.includes('Offline') && offline.includes('1 change waiting');
    })()`, 15_000, 'Reopened app did not show the generated cached Atlas and its waiting outbox count');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.navrail button')].map(button => button.textContent)`), ['Atlas', 'Upkeep', 'Library', 'Changes']);
    assert.equal(await evaluate(`document.querySelectorAll('.offline-pill').length`), 1);
    // The Atlas states its held copy's date like the other three views, on its own line above the stage.
    assert.equal(await evaluate(`(() => { const stamp = document.querySelector('.offline-app .offline-stamp'), stage = document.querySelector('.offline-atlas');
      return /^Read-only held copy from .+\\.$/.test(stamp?.textContent ?? '') && stamp.querySelector('time[datetime]') !== null
        && stamp.getBoundingClientRect().bottom <= stage.getBoundingClientRect().top + 1; })()`), true);
    assert.equal(await evaluate(`document.querySelectorAll('.saved-header, .saved-manager').length`), 0);
    // Phone-width navigation and actual lazy PDF canvas use only the held public closure.
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await screenshot('phone-offline-atlas');
    const tab = async label => {
      await evaluate(`[...document.querySelectorAll('.navrail button')].find(button => button.textContent === ${JSON.stringify(label)}).click()`);
      await poll(`document.querySelector('main h1')?.textContent === ${JSON.stringify(label)}`, 5_000, label + ' did not open');
    };
    await tab('Upkeep');
    assert.equal(await evaluate(`document.querySelector('main').textContent.includes('Inspect generated pump')`), true);
    await tab('Changes');
    assert.equal(await evaluate(`document.querySelector('main').textContent.includes('Operation history is not held')`), true);
    // Rooms & places from the held building records: the Atlas lens, the held-copy stamp, exact
    // elevation tokens and explicit unknowns, 44 px phone targets, nothing fetched.
    await evaluate(`[...document.querySelectorAll('.navrail button')].find(button => button.textContent === 'Atlas').click()`);
    await poll(`[...document.querySelectorAll('.offline-lens button')].some(button => button.textContent === 'Rooms & places')`, 5_000, 'Atlas lens switch not shown');
    // A keyboard user's pressed switch button keeps focus across the change.
    await evaluate(`(() => { const button = [...document.querySelectorAll('.offline-lens button')].find(button => button.textContent === 'Rooms & places');
      button.focus(); button.click(); })()`);
    await poll(`document.querySelector('main h1')?.textContent === 'Rooms & places'
      && [...document.querySelectorAll('main button')].some(button => button.getAttribute('aria-label')?.startsWith('Generated barn, Atlas identity'))`, 15_000, 'Held Rooms & places did not open');
    assert.equal(await evaluate(`(() => { const head = document.querySelector('main .view-head p'), text = document.querySelector('main').textContent;
      return /^Read-only held copy from .+\.$/.test(head?.textContent ?? '') && head.querySelector('time[datetime]') !== null
        && text.includes('Building records retrieved') && text.includes('Building records: current')
        && document.querySelector('.navrail button[aria-current="page"]')?.textContent === 'Atlas'
        && document.querySelector('.offline-lens button[aria-pressed="true"]')?.textContent === 'Rooms & places'; })()`), true,
      'Held Rooms & places must carry the held-copy stamp and its own retrieval time');
    assert.equal(await evaluate(`document.activeElement === document.querySelector('.offline-lens button[aria-pressed="true"]')`), true,
      'The pressed Rooms & places switch button must keep focus after the change');
    await evaluate(`[...document.querySelectorAll('main button')].find(button => button.getAttribute('aria-label')?.startsWith('Generated barn, Atlas identity')).click()`);
    await poll(`document.querySelector('main').textContent.includes('Generated barn: 3 locations in reviewed membership')`, 5_000, 'Held building membership not shown');
    assert.equal(await evaluate(`(() => { const text = document.querySelector('main').textContent;
      return text.includes('+2.750 m') && text.includes('elevation unknown') && text.includes('Generated tack room'); })()`), true,
      'Held levels keep the exact recorded elevation and the explicit unknown');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.offline-lens button, main .chip-btn')].filter(node => node.getClientRects().length)
      .map(node => node.getBoundingClientRect().height).filter(height => height < 44)`), [], 'Phone lens and building controls are 44 px');
    // Held records are shown, not opened: no details view or evidence record exists offline.
    assert.equal(await evaluate(`(() => { const main = document.querySelector('main'), evidence = main.querySelector('[data-evidence-id="00000000-0000-4000-8000-000000000940"]');
      return main.querySelectorAll('button.ledger-main, button.entity-link, .linked-evidence button').length === 0
        && main.querySelectorAll('.entity-link.is-held').length > 0
        && evidence?.textContent === 'Evidence not held in this saved copy.'
        && !main.textContent.includes('The session for this evidence read has expired.'); })()`), true,
      'Held lens must not offer record selection or evidence reads it cannot complete');
    await screenshot('phone-offline-rooms-places');
    assert.deepEqual(servedPaths.filter(path => !updateChecks.has(path)), [], 'Held Rooms & places must not fetch public bytes or data from network');
    // A copy saved without building records (as before #560) keeps the not-held sentence.
    const withoutRecords = await evaluate(`(async () => {
      const { createLiveCopyOwner } = await import(${JSON.stringify(seeded.copyOwnerURL)});
      const { openLiveCopyBackend } = await import(${JSON.stringify(seeded.copyBackendURL)});
      const channel = new BroadcastChannel('houseatlas-live-readonly-copy-v1');
      const copies = createLiveCopyOwner(openLiveCopyBackend(indexedDB), { changed: () => channel.postMessage('changed') });
      try {
        const actor = await copies.observeActor(${JSON.stringify(seeded.owner.actorId)}, () => true);
        const home = copies.bindHome(actor.value, ${JSON.stringify(seeded.view.scope)}, () => true);
        return (await copies.removeTopology(home.value, new AbortController().signal)).status;
      } finally { copies.close(); channel.close(); }
    })()`);
    assert.equal(withoutRecords, 'ok');
    await poll(`document.querySelector('main h1')?.textContent === 'Rooms & places'
      && document.querySelector('main').textContent.includes('Offline: building records are not held in this saved copy. Connect and open live to read them.')
      && !document.querySelector('main').textContent.includes('Generated barn')`, 10_000, 'A copy without building records lost the not-held sentence');
    await tab('Library');
    if (standardProfile) {
      assert.equal(await evaluate(`document.querySelector('main').textContent.includes('Synthetic parcel survey')`), false);
    } else {
      // Wait for the native row's own action: electrical rows can report "On this device" first.
      await poll(`[...document.querySelectorAll('main button')].some(button => button.textContent === 'Open Synthetic parcel survey')`, 5_000, 'PDF availability not shown');
      await screenshot('phone-offline-library');
      await evaluate(`[...document.querySelectorAll('main button')].find(button => button.textContent === 'Open Synthetic parcel survey').click()`);
      await poll(`(() => { const canvas = document.querySelector('canvas[aria-label="Synthetic parcel survey, PDF page 1"]');
        return canvas && canvas.width > 0 && getComputedStyle(canvas).visibility !== 'hidden'; })()`, 15_000, 'Held PDF did not render offline');
      // Every page and zoom button, the disabled Previous page included, is displayed at 44 px or more.
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('.source-pdf-controls button')].map(node => {
        const rect = node.getBoundingClientRect();
        return [node.getAttribute('aria-label') ?? node.textContent, node.disabled,
          node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible' && rect.width >= 44 && rect.height >= 44];
      })`), [['Previous page', true, true], ['Next page', false, true], ['Zoom out PDF', false, true], ['Zoom in PDF', false, true]],
      'Phone PDF page and zoom buttons are 44 px');
      // Touch on a wide screen (phone layout off): the viewer's Close and download keep 44 px too.
      const wideTouch = `['Previous page', 'Next page', 'Zoom out PDF', 'Zoom in PDF', 'Close', 'Save held original'].map(name => {
        const node = [...document.querySelectorAll('[role="dialog"] :is(button, a)')].find(node => (node.getAttribute('aria-label') ?? node.textContent) === name);
        const rect = node?.getBoundingClientRect();
        return [name, Boolean(node && node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible' && rect.width >= 44 && rect.height >= 44)];
      })`;
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await poll(`matchMedia('(pointer: coarse)').matches && !matchMedia('(max-width: 759px)').matches && ${wideTouch}.every(([, ok]) => ok)`, 5_000, 'Wide touch PDF viewer targets');
      assert.deepEqual(await evaluate(wideTouch), [['Previous page', true], ['Next page', true], ['Zoom out PDF', true], ['Zoom in PDF', true], ['Close', true], ['Save held original', true]],
        'Wide touch PDF viewer controls are 44 px');
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      // Ordinary focus retires all borrowed data, then restores neutral reading
      // intent only after fresh owner reads and a replacement React commit.
      await evaluate(`[...document.querySelectorAll('.source-pdf button')].find(button => button.textContent === 'Next page').click()`);
      await poll(`(() => { const canvas = document.querySelector('canvas[aria-label="Synthetic parcel survey, PDF page 2"]');
        return canvas && canvas.width > 0 && getComputedStyle(canvas).visibility !== 'hidden'; })()`, 15_000, 'Held PDF second page did not draw');
      await evaluate(`document.querySelector('button[aria-label="Zoom in PDF"]').click()`);
      await poll(`(() => { const canvas = document.querySelector('canvas[aria-label="Synthetic parcel survey, PDF page 2"]');
        return document.querySelector('.source-pdf-controls').textContent.includes('200%') && canvas && canvas.width > 0
          && getComputedStyle(canvas).visibility !== 'hidden'; })()`, 15_000, 'Held PDF zoom did not draw');
      const reading = await evaluate(`(() => { const frame = document.querySelector('.source-pdf-page');
        frame.scrollTop = 100; frame.scrollLeft = 40; frame.dispatchEvent(new Event('scroll'));
        return { top: frame.scrollTop, left: frame.scrollLeft }; })()`);
      assert(reading.top > 0, 'Generated zoomed PDF must exercise a real vertical reading offset');
      assert.equal(await evaluate(`(() => { window.dispatchEvent(new Event('focus'));
        return document.querySelector('.offline-app-root').hidden; })()`), true, 'Focus must hide borrowed content synchronously');
      await poll(`(() => { const root = document.querySelector('.offline-app-root');
        const canvas = document.querySelector('canvas[aria-label="Synthetic parcel survey, PDF page 2"]');
        const frame = document.querySelector('.source-pdf-page');
        return root && !root.hidden && document.querySelector('main h1')?.textContent === 'Library'
          && document.querySelector('.source-pdf-controls')?.textContent.includes('200%')
          && canvas && canvas.width > 0 && getComputedStyle(canvas).visibility !== 'hidden' && frame
          && Math.abs(frame.scrollTop - ${reading.top}) <= 1 && Math.abs(frame.scrollLeft - ${reading.left}) <= 1;
      })()`, 15_000, 'Foreground revalidation lost Library or exact PDF page/zoom/reading offset');
      assert.deepEqual(servedPaths.filter(path => !updateChecks.has(path)), [], 'Tabs and held PDF must not fetch public bytes or data from network');
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    }
    await poll(`(() => {
      const button = [...document.querySelectorAll('main button')].find(button => button.textContent === 'Open Generated HomeBox PDF');
      return button && !button.disabled && button.closest('li')?.textContent.includes('On this device · Copied from HomeBox');
    })()`, 5_000, 'Exact held HomeBox attachment availability not shown');
    await evaluate(`[...document.querySelectorAll('main button')].find(button => button.textContent === 'Open Generated HomeBox PDF').click()`);
    await poll(`(() => { const canvas = document.querySelector('canvas[aria-label="Generated HomeBox PDF, PDF page 1"]');
      return canvas && canvas.width > 0 && getComputedStyle(canvas).visibility !== 'hidden'; })()`, 15_000, 'Held HomeBox PDF did not render offline');
    assert.deepEqual(servedPaths.filter(path => !updateChecks.has(path)), [], 'Held HomeBox PDF must not fetch public bytes or data from network');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    // Closing the held file returns focus to its Library opener: after Escape when the click
    // did not focus the opener (as on iOS), and after Close when revalidation replaced it.
    const homeboxOpener = `[...document.querySelectorAll('main button')].find(button => button.textContent === 'Open Generated HomeBox PDF')`;
    await poll(`document.querySelector('[role="dialog"]') === null && document.activeElement === ${homeboxOpener}`, 5_000, 'Escape left focus off the HomeBox opener');
    const pressEnter = async () => { for (const type of ['rawKeyDown', 'char', 'keyUp'])
      await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'char' ? { text: '\r' } : {}) }); };
    await pressEnter();
    await poll(`document.querySelector('canvas[aria-label="Generated HomeBox PDF, PDF page 1"]')?.width > 0`, 15_000, 'Enter did not open the held HomeBox PDF');
    const replaced = await evaluate(`(() => { window.__heldOpener = ${homeboxOpener}; window.dispatchEvent(new Event('focus')); return document.querySelector('.offline-app-root').hidden; })()`);
    assert.equal(replaced, true, 'Foreground revalidation must start while the held file is open');
    await poll(`!document.querySelector('.offline-app-root').hidden && !window.__heldOpener.isConnected
      && document.querySelector('canvas[aria-label="Generated HomeBox PDF, PDF page 1"]')?.width > 0`, 15_000, 'Revalidation did not reopen the held HomeBox PDF');
    await evaluate(`document.querySelector('[role="dialog"] button[aria-label="Close"]').focus()`);
    await pressEnter();
    await poll(`document.querySelector('[role="dialog"]') === null && document.activeElement === ${homeboxOpener}`, 5_000, 'Close left focus off the current HomeBox opener');
    await poll(`[...document.querySelectorAll('main button')].some(button => button.textContent === 'Fictional kitchen · Page 2' && !button.disabled)`, 5_000, 'Electrical file availability not shown');
    await evaluate(`[...document.querySelectorAll('main button')].find(button => button.textContent === 'Fictional kitchen · Page 2').click()`);
    await poll(`(() => { const canvas = document.querySelector('canvas[aria-label="Electrical reference PDF, PDF page 2"]');
      return canvas && canvas.width > 0 && getComputedStyle(canvas).visibility !== 'hidden'; })()`, 15_000, 'Held electrical PDF did not render its referenced page offline');
    await screenshot('phone-offline-electrical-page');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    // A second generated building may reuse the same evidence and sheet IDs; its own row gets focus back
    // after keyboard Close, and after Escape when a non-focusing click followed focus on the Library tab.
    // Focus moved out of the dialog on purpose stays where it was put.
    assert.deepEqual(await evaluate(`(async () => {
      const { createLiveCopyOwner } = await import(${JSON.stringify(seeded.copyOwnerURL)});
      const { openLiveCopyBackend } = await import(${JSON.stringify(seeded.copyBackendURL)});
      const channel = new BroadcastChannel('houseatlas-live-readonly-copy-v1');
      const copies = createLiveCopyOwner(openLiveCopyBackend(indexedDB), { changed: () => channel.postMessage('changed') });
      const signal = new AbortController().signal;
      try {
        const home = copies.bindHome((await copies.observeActor(${JSON.stringify(seeded.owner.actorId)}, () => true)).value, ${JSON.stringify(seeded.view.scope)}, () => true).value;
        const handle = (await copies.readLast(signal)).value.handle;
        const [building] = (await copies.readElectricalCatalog(handle, signal)).value.buildings, [document] = building.documents;
        const pin = { ...document.pin, buildingId: '00000000-0000-4000-8000-0000000009e2' };
        const bytes = await (await copies.readElectricalDocument(handle, document.pin, signal)).value.arrayBuffer();
        return [(await copies.keepElectricalCatalog(home, { ...building, buildingId: pin.buildingId, documents: [{ ...document, pin }] }, signal)).status,
          (await copies.keepElectricalDocument(home, pin, bytes, signal)).status];
      } finally { copies.close(); channel.close(); }
    })()`), ['ok', 'ok'], 'Second generated building with the same electrical evidence and sheet IDs');
    const sheets = `[...document.querySelectorAll('main button')].filter(button => button.textContent === 'Fictional kitchen · Page 2' && !button.disabled)`;
    const libraryTab = `[...document.querySelectorAll('.navrail button')].find(button => button.textContent === 'Library')`;
    const sheetOpen = `document.querySelector('canvas[aria-label="Electrical reference PDF, PDF page 2"]')?.width > 0`;
    const pressEscape = async () => { for (const type of ['rawKeyDown', 'keyUp'])
      await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); };
    await poll(`${sheets}.length === 2`, 10_000, 'Second building sheet not shown');
    await evaluate(`${sheets}[1].focus()`); await pressEnter();
    await poll(sheetOpen, 15_000, 'Second building sheet did not open');
    await evaluate(`document.querySelector('[role="dialog"] button[aria-label="Close"]').focus()`); await pressEnter();
    await poll(`document.querySelector('[role="dialog"]') === null && document.activeElement === ${sheets}[1]`, 5_000, 'Close left focus off the second building sheet');
    assert.equal(await evaluate(`(() => { ${libraryTab}.focus(); const focused = document.activeElement === ${libraryTab}; ${sheets}[1].click(); return focused; })()`), true);
    await poll(sheetOpen, 15_000, 'Second building sheet did not open by click');
    await pressEscape();
    await poll(`document.querySelector('[role="dialog"]') === null && document.activeElement === ${sheets}[1]`, 5_000, 'Escape left focus on the Library tab, not the second building sheet');
    await evaluate(`${sheets}[1].focus()`); await pressEnter();
    await poll(sheetOpen, 15_000, 'Second building sheet did not reopen');
    await evaluate(`${libraryTab}.focus()`); await pressEscape();
    await poll(`document.querySelector('[role="dialog"]') === null`, 5_000, 'Escape did not close the second building sheet');
    await new Promise(done => setTimeout(done, 300));
    assert.equal(await evaluate(`document.activeElement === ${libraryTab}`), true, 'Focus moved out of the dialog on purpose must stay there');
    await evaluate(`document.querySelector('button[aria-label="Settings"]').click()`);
    const electricalSize = 'Electrical PDFs read so far: ' + displayFixtureSize(2 * Number(seeded.library.electricalPin.byteSize)) + '.';
    const nativeSize = standardProfile ? 'Document sizes are unavailable.' : 'Documents: ' + displayFixtureSize(seeded.library.nativePin.bytes) + '.';
    await poll(`(() => {
      const text = document.querySelector('[role="dialog"] fieldset')?.textContent ?? '';
      return text.includes(${JSON.stringify(electricalSize)}) && text.includes(${JSON.stringify(nativeSize)});
    })()`, 5_000, 'Offline storage settings did not show the catalog byte totals');
    assert.equal(await evaluate(`(() => {
      const paragraph = [...document.querySelectorAll('[role="dialog"] .setting-static')].find(node =>
        node.textContent.includes('HomeBox PDFs marked “On this device” in Library can open offline. Downloading missing files requires a connection.'));
      return !!paragraph && paragraph.getClientRects().length > 0 && getComputedStyle(paragraph).visibility !== 'hidden'
        && !document.querySelector('[role="dialog"]').textContent.includes('HomeBox attachments require a connection.');
    })()`), true, 'Visible Settings copy must distinguish held HomeBox PDFs from missing-file downloads');
    assert.equal(await evaluate(`(() => {
      const paragraph = [...document.querySelectorAll('[role="dialog"] .setting-static')].find(node =>
        node.textContent.includes('HomeBox files listed in this held view: 1.'));
      return !!paragraph && paragraph.getClientRects().length > 0 && getComputedStyle(paragraph).visibility !== 'hidden'
        && paragraph.textContent.includes('Size hints: ${seeded.pdf.length} bytes across 1 file; 0 sizes unknown. 0 above the 10 MiB automatic-download limit.')
        && paragraph.textContent.includes('These are reported sizes, not bytes stored here. Full HomeBox library size is unknown.');
    })()`), true, 'Visible Settings must show exact captured HomeBox size hints without a storage or completeness claim');
    // Opened on purpose from the live app (its link marks the tab session), the
    // same page keeps the full Saved view with Saved scope and shell removal.
    await evaluate(`sessionStorage.setItem('houseatlas.saved-entry.v1', '1')`);
    await send('Page.reload', {});
    await poll(`(() => document.querySelector('.saved-header h1')?.textContent === 'Saved Atlas'
      && document.querySelector('.saved-header details summary')?.textContent === 'Saved scope'
      && document.querySelector('.saved-message[role="note"]') !== null
      && document.querySelector('.saved-stage .ua-shell.is-stage') !== null
      && document.querySelector('.navrail, .offline-app-root') === null)()`, 15_000,
      'the explicit Saved entry lost its full view');
    assert.deepEqual(await evaluate(`(async () => {
      const { openOutboxStore } = await import(${JSON.stringify(seeded.outboxURL)});
      const store = openOutboxStore(indexedDB);
      try { return await store.list(); } finally { store.close(); }
    })()`), [seeded.entry], 'closing and reopening offline retains the exact owner, intent, command bytes and waiting state');
    assert.deepEqual(reopenApiRequests, [], 'The offline shell renders all views and PDFs without reading or writing to the API');
    // Retiring only the app copy must not expose its still-held legacy Atlas.
    await evaluate(`sessionStorage.removeItem('houseatlas.saved-entry.v1')`);
    await send('Page.reload', {});
    await poll(`document.querySelector('.navrail') !== null`, 10_000, 'App shell did not reopen for withdrawal');
    await tab('Library');
    await poll(`[...document.querySelectorAll('main button')].some(button => button.textContent === 'Fictional kitchen · Page 2' && !button.disabled)`, 5_000, 'Electrical original unavailable before withdrawal');
    await evaluate(`[...document.querySelectorAll('main button')].find(button => button.textContent === 'Fictional kitchen · Page 2').click()`);
    await poll(`(() => { const canvas = document.querySelector('canvas[aria-label="Electrical reference PDF, PDF page 2"]');
      return canvas && canvas.width > 0 && getComputedStyle(canvas).visibility !== 'hidden'; })()`, 15_000, 'Electrical PDF unavailable before withdrawal');
    const second = await cdp.send('Target.createTarget', { url: origin + '/saved/index.html' });
    const attached = await cdp.send('Target.attachToTarget', { targetId: second.targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, attached.sessionId);
    const cleared = await cdp.send('Runtime.evaluate', { expression: `(async () => {
      const { createLiveCopyOwner } = await import(${JSON.stringify(seeded.copyOwnerURL)});
      const { openLiveCopyBackend } = await import(${JSON.stringify(seeded.copyBackendURL)});
      const channel = new BroadcastChannel('houseatlas-live-readonly-copy-v1');
      const owner = createLiveCopyOwner(openLiveCopyBackend(indexedDB), { changed: () => channel.postMessage('changed') });
      try { return await owner.clear(); } finally { owner.close(); channel.close(); }
    })()`, awaitPromise: true, returnByValue: true }, attached.sessionId);
    assert.equal(cleared.exceptionDetails, undefined);
    assert.equal(cleared.result.value.status, 'ok');
    await poll(`document.body.textContent.includes('Held app information is unavailable or was removed.')
      && document.querySelector('.source-pdf-page canvas, .offline-atlas, .saved-stage') === null`, 10_000, 'Peer tombstone did not withdraw held drawing and Atlas');
    assert.equal((await cdp.send('Target.closeTarget', { targetId: second.targetId })).success, true);
    const { frameTree } = await send('Page.getFrameTree');
    coldReload = { previousLoader: frameTree.frame.loaderId, frameId: frameTree.frame.id, requestedAt: Date.now() };
    await send('Page.reload', {});
    coldReload.acknowledgedAt = Date.now();
    await poll(`document.body.textContent.includes('Held app information is unavailable or was removed.')
      && document.querySelector('.saved-stage, .offline-atlas') === null`, 10_000, 'Cold tombstone reopened a legacy Atlas');

    console.log(`PASS live-launch (${standardProfile ? 'standard' : 'full-document'}): online building records and qualified library originals retained, cached Atlas, held Rooms & places and its not-held sentence, all four phone-width tabs, held PDF canvases and storage settings after tab close/reopen; exact queue retained and zero writes`);
  }
  console.log(`PASS ${selected}: Saved shell shown ${launchMs} ms after reopening /; generated build only, not iOS or installed-PWA proof`);
} catch (error) {
  primaryFailure = { error };
  try { console.error('Offline launch failure diagnostics: ' + JSON.stringify(await diagnose())); }
  catch (diagnosticError) { console.error('Offline diagnostics unavailable:', diagnosticError); }
  throw error;
} finally {
  await finishOfflineCleanup({
    primaryFailure,
    beforeShutdown: [...held].map(response => () => response.destroy()),
    stopBrowser: () => stopBrowser(() => cdp.send('Browser.close')),
    // Enumerate after shutdown, with acceptance stopped before reading the live set.
    releaseTransport: (function* () {
      yield () => { if (server.listening) server.close(); };
      for (const socket of sockets) yield () => socket.destroy();
    })(),
    removeScratch: () => removeOfflineScratch(scratch),
  });
}
