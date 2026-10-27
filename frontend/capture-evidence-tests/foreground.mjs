// Individually selected source fixtures. Actual client/selection/validators;
// in-memory transport only. No browser, listener, native state or download GET.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { transformWithOxc } from '../node_modules/vite/dist/node/index.js';

const name = process.argv[2];
assert.equal(process.argv.length, 3, 'Select exactly one named fixture');
assert(['stale-target-preparation', 'one-shot-originals', 'original-byte-mismatch', 'receipt-digest-mismatch',
  'original-offer-reused', 'original-offer-digest-mismatch', 'original-offer-record-change', 'original-offer-unavailable'].includes(name));
const root = new URL('../src/', import.meta.url);
const dataUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const raw = async path => dataUrl(`export default ${JSON.stringify(await readFile(new URL(path, import.meta.url), 'utf8'))};`);
const schemas = {
  '../../../contracts/stock-wire3/agent/agent.schema.json?raw': await raw('../../contracts/stock-wire3/agent/agent.schema.json'),
  '../../../packages/contracts/schemas/atlas.schema.json?raw': await raw('../../packages/contracts/schemas/atlas.schema.json'),
};
const allowed = new Set(['api/native-evidence-client.ts', 'capture-evidence/selection.ts', 'capture-evidence/types.ts',
  'numeric/decimal.ts', 'numeric/lossless-json.ts', 'numeric/schema-validator.ts']);
const cache = new Map();
async function load(relative) {
  assert(allowed.has(relative), `Unexpected runtime module: ${relative}`);
  if (cache.has(relative)) return cache.get(relative);
  const file = new URL(relative, root);
  let { code } = await transformWithOxc(await readFile(file, 'utf8'), file.pathname,
    { lang: 'ts', target: 'esnext', tsconfig: false, sourcemap: false });
  const imports = [...code.matchAll(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'];?\s*$/gm)].map(match => match[1]);
  for (const specifier of imports) {
    let destination = schemas[specifier];
    if (specifier === 'ajv-formats/dist/formats.js') destination = new URL('../node_modules/ajv-formats/dist/formats.js', import.meta.url).href;
    if (!destination) {
      assert(specifier.startsWith('.'), `Unexpected bare import: ${specifier}`);
      const resolved = new URL(`${specifier}.ts`, file).pathname.replace(root.pathname, '');
      destination = await load(resolved);
    }
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(destination));
  }
  const url = dataUrl(code); cache.set(relative, url); return url;
}
const { createNativeEvidenceClient } = await import(await load('api/native-evidence-client.ts'));
const { selectEvidenceFile, CAPTURE_TYPES, CAPTURE_MAX_BYTES } = await import(await load('capture-evidence/selection.ts'));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { workspaceId: uuid(1000), homeId: uuid(1001) };
const placeId = uuid(1002), identityId = uuid(1003), priorEvidence = uuid(1004), evidenceId = uuid(1005), assetId = uuid(1006);
const timestamp = '2026-10-25T12:00:00Z';
const policy = { contentTypes: [...CAPTURE_TYPES], maximumBytes: CAPTURE_MAX_BYTES,
  licenses: [{ label: 'Synthetic unknown license', value: { status: 'unknown', reference: null } }] };
const record = (recordType, recordId, payload) => ({ schemaVersion: 1, recordType, recordId, ...scope, revision: 1,
  lifecycle: 'active', createdAt: timestamp, updatedAt: timestamp, lastAuditId: uuid(1007), payload });
const admission = { schemaVersion: 1, admissionKind: 'native-location', scope,
  record: record('location-semantics', placeId, { atlasId: identityId, semanticKind: 'room', reviewStatus: 'accepted', evidenceIds: [priorEvidence] }),
  identity: record('identity', identityId, { kind: 'location', evidenceIds: [priorEvidence] }),
  guards: [{ record: { recordType: 'evidence', recordId: priorEvidence }, expectedRevision: 1 },
    { record: { recordType: 'identity', recordId: identityId }, expectedRevision: 1 }],
  canAttachEvidence: true, maximumReasonCodePoints: 1024, attachmentPolicy: policy };
const sha = value => createHash('sha256').update(value).digest('hex');
const signal = () => new AbortController().signal;
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
async function inputFor(filename = 'synthetic-note.txt', type = 'text/plain', method = 'file-picker') {
  const bytes = await readFile(new URL(`fixtures/${filename}`, import.meta.url));
  const original = new File([bytes], filename, { type, lastModified: 42 });
  return { bytes, input: { selection: await selectEvidenceFile(original, method, policy, signal(), timestamp),
    statement: 'Generated source fixture only', reason: 'Correlate synthetic original', sourceLicense: policy.licenses[0].value } };
}
function receipt(metadata, digest, size) {
  const item = (recordType, recordId, revision, payload) => ({ target: { authority: 'atlas', recordType, recordId }, revision, lifecycle: 'active', payload });
  return { schemaVersion: 3, commandId: 'atlas.batch.execute', requestId: metadata.requestId, resolvedScope: scope,
    status: 'committed', replayed: false, operationId: uuid(1008), data: { requestDigest: 'a'.repeat(64),
      auditIds: [uuid(1009), uuid(1010), uuid(1011)], records: [
        item('evidence', evidenceId, 1, { statement: metadata.statement, supersedesEvidenceIds: [], references: [{ kind: 'atlas-asset', assetId }],
          provenance: { source: null, sourceRevision: null, sourceConfidence: null, evidenceBasis: 'unknown', factAt: null,
            retrievedAt: timestamp, vantage: `Browser selection claim v1: ${JSON.stringify(metadata.capture)}`,
            uncertainty: { status: 'unknown', explanation: null } } }),
        item('identity', identityId, 2, { kind: 'location', evidenceIds: [priorEvidence, evidenceId] }),
        item('asset', assetId, 1, { owner: 'atlas', purpose: 'evidence-original',
          sha256: digest, byteSize: size, contentType: metadata.contentType, sourceLicense: metadata.sourceLicense,
          availability: 'available', previewPolicy: 'download-only', evidenceIds: [evidenceId] }),
      ] } };
}
function harness() {
  const binding = Object.freeze({ scope: Object.freeze({ ...scope }) }), listeners = new Set(), calls = [];
  let current = binding, owner = {};
  const state = { onGet: () => response(admission), onPost: () => { throw new Error('Unexpected synthetic POST'); },
    onAsset: () => { throw new Error('Unexpected synthetic asset read'); }, onHead: () => { throw new Error('Unexpected synthetic HEAD'); } };
  const base = `/api/atlas/editing/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/native-places/${placeId}`;
  const client = createNativeEvidenceClient({ getBinding: () => current, owner: () => owner,
    subscribe(changed) { listeners.add(changed); return () => listeners.delete(changed); },
    exchange: async (actual, route, method, active, body, requestId) => {
      assert.equal(actual, binding); assert(active instanceof AbortSignal);
      calls.push({ method, requestId, route });
      const assetPath = `/api/atlas/stock/v3/workspaces/${scope.workspaceId}/homes/${scope.homeId}/records/asset/${assetId}`;
      if (route === assetPath) { assert.equal(method, 'GET'); return state.onAsset(); }
      if (method === 'HEAD') {
        assert.equal(route, `/api/atlas/media/${scope.workspaceId}/${scope.homeId}/${sha(JSON.stringify({ assetId, kind: 'atlas-asset' }))}/download`);
        return state.onHead();
      }
      assert.equal(route, method === 'POST' ? `${base}/evidence` : base);
      if (method === 'GET') return state.onGet();
      assert.equal(method, 'POST'); assert(body instanceof FormData);
      return state.onPost(body, requestId);
    } });
  return { client, binding, calls, listeners, state,
    invalidate(kind) {
      if (kind === 'session') owner = {};
      else current = Object.freeze({ scope: binding.scope }); // Same IDs, different generation.
      for (const listener of [...listeners]) listener();
    } };
}

if (name.startsWith('original-offer-')) {
  // Exercise the production resolver, not the UI or a real original download.
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://houseatlas.invalid' } } });
  try {
    const fixtures = name === 'original-offer-reused' ? [
      ['synthetic-photo.jpg', 'image/jpeg'], ['synthetic-photo-progressive.jpg', 'image/jpeg'],
      ['synthetic-image.png', 'image/png'], ['synthetic-document.pdf', 'application/pdf'], ['synthetic-note.txt', 'text/plain'],
    ] : [['synthetic-note.txt', 'text/plain']];
    for (const [filename, type] of fixtures) {
      const h = harness(), { bytes, input } = await inputFor(filename, type);
      const fresh = await h.client.load(h.binding, placeId, signal());
      const prepared = await h.client.prepare(fresh, input, signal());
      let asset;
      h.state.onPost = (body, requestId) => {
        const metadata = JSON.parse(body.get('metadata'));
        assert.equal(requestId, prepared.requestId); assert.equal(metadata.requestId, requestId);
        const value = receipt(metadata, sha(bytes), bytes.length);
        asset = value.data.records.find(row => row.target.recordType === 'asset');
        // Reuse commits evidence+identity only; the original asset isn't created again.
        value.data.records = value.data.records.filter(row => row.target.recordType !== 'asset');
        value.data.auditIds = value.data.auditIds.slice(0, 2);
        return response(value);
      };
      const committed = await h.client.commit(prepared, signal());
      assert.equal(committed.outcome, 'committed'); assert.equal(committed.receipt.data.records.length, 2);
      let assetReads = 0, headReads = 0;
      h.state.onAsset = () => {
        assetReads++;
        if (name === 'original-offer-unavailable') return new Response(null, { status: 404 });
        const current = structuredClone(asset);
        if (name === 'original-offer-digest-mismatch') current.payload.sha256 = '0'.repeat(64);
        if (name === 'original-offer-record-change' && assetReads === 2) current.revision = 2;
        return response({ schemaVersion: 3, commandId: 'atlas.asset.get', requestId: uuid(1020), resolvedScope: scope,
          status: 'read', replayed: false, data: { records: [current], nextCursor: null, sourceStatus: 'current' } });
      };
      h.state.onHead = () => {
        headReads++;
        return new Response(null, { headers: { 'content-type': type, 'content-length': String(bytes.length),
          'content-disposition': 'attachment; filename="original"' } });
      };
      if (name === 'original-offer-digest-mismatch') {
        await assert.rejects(h.client.resolveOriginal(h.binding, prepared, signal()), /differs from selected file/);
        assert.equal(assetReads, 1); assert.equal(headReads, 0, 'equal MIME/size cannot bypass the selected-byte digest');
      } else {
        const offer = await h.client.resolveOriginal(h.binding, prepared, signal());
        if (name === 'original-offer-reused') {
          assert.equal(offer.href, `/api/atlas/media/${scope.workspaceId}/${scope.homeId}/${sha(JSON.stringify({ assetId, kind: 'atlas-asset' }))}/download`);
          assert.equal(assetReads, 2); assert.equal(headReads, 1);
          assert.deepEqual(h.calls.slice(3).map(call => call.method), ['GET', 'HEAD', 'GET']);
        } else {
          assert.equal(offer, null);
          assert.equal(assetReads, name === 'original-offer-unavailable' ? 1 : 2);
          assert.equal(headReads, name === 'original-offer-unavailable' ? 0 : 1);
        }
      }
      const [pending] = h.client.pending(h.binding);
      assert.equal(pending.outcome, 'committed', 'an unavailable original never erases a validated commit');
      assert.equal(pending.evidenceId, evidenceId); assert.equal(pending.assetId, assetId);
      assert.equal(h.calls.filter(call => call.method === 'POST').length, 1, 'resolution never resends');
      assert.equal(h.listeners.size, 0);
    }
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
} else if (name === 'stale-target-preparation') {
  // Hold the final fresh admission read after byte validation, then retire its
  // binding or session. A transport ignoring abort cannot revive preparation.
  for (const kind of ['binding', 'session', 'cancel']) {
    const h = harness(), { input } = await inputFor();
    const fresh = await h.client.load(h.binding, placeId, signal());
    const entered = deferred(), reply = deferred(), controller = new AbortController();
    h.state.onGet = () => { entered.resolve(); return reply.promise; };
    const preparing = h.client.prepare(fresh, input, controller.signal);
    const rejected = assert.rejects(preparing);
    await entered.promise;
    if (kind === 'cancel') controller.abort(); else h.invalidate(kind);
    await rejected;
    reply.resolve(response(admission));
    await Promise.resolve();
    assert.deepEqual(h.calls.map(call => call.method), ['GET', 'GET']);
    assert.equal(h.listeners.size, 0, 'retired preparation subscriptions removed');
    if (kind !== 'session') assert.deepEqual(h.client.pending(h.client.getBinding()), []);
    // Re-admit a new generation and select the same bytes explicitly. No send.
    const next = harness(), replacement = await inputFor();
    const nextAdmission = await next.client.load(next.binding, placeId, signal());
    assert(await next.client.prepare(nextAdmission, replacement.input, signal()));
    assert(!next.calls.some(call => call.method === 'POST'));
  }
} else if (name === 'one-shot-originals' || name === 'receipt-digest-mismatch') {
  const fixtures = name === 'one-shot-originals' ? [
    ['synthetic-photo.jpg', 'image/jpeg', 'camera-request'], ['synthetic-photo-progressive.jpg', 'image/jpeg', 'photo-picker'],
    ['synthetic-image.png', 'image/png', 'photo-picker'], ['synthetic-document.pdf', 'application/pdf', 'file-picker'],
    ['synthetic-note.txt', 'text/plain', 'file-picker'],
  ] : [['synthetic-note.txt', 'text/plain', 'file-picker']];
  for (const [filename, type, method] of fixtures) {
    const h = harness(), { bytes, input } = await inputFor(filename, type, method);
    const fresh = await h.client.load(h.binding, placeId, signal());
    const prepared = await h.client.prepare(fresh, input, signal());
    const entered = deferred(), reply = deferred();
    h.state.onPost = async (body, requestId) => {
      const file = body.get('file'), metadata = JSON.parse(body.get('metadata'));
      assert.equal(file.name, filename); assert.equal(file.type, type);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes, 'exact multipart bytes equal generated original');
      assert.equal(metadata.requestId, requestId); assert.equal(requestId, prepared.requestId);
      assert.equal(metadata.recordId, placeId); assert.deepEqual(metadata.context, scope);
      assert.deepEqual(metadata.capture, input.selection.capture);
      assert.equal(metadata.capture.byteOrigin, 'browser-returned-unmodified');
      entered.resolve({ metadata, file }); return reply.promise;
    };
    const committing = h.client.commit(prepared, signal());
    const settled = name === 'receipt-digest-mismatch' ? assert.rejects(committing, /Native original asset differs/) : committing;
    const { metadata, file } = await entered.promise;
    await assert.rejects(h.client.commit(prepared, signal()), /already dispatched/);
    assert.equal(h.client.pending(h.binding)[0].outcome, 'unknown');
    reply.resolve(response(receipt(metadata, name === 'receipt-digest-mismatch' ? '0'.repeat(64) : sha(bytes), file.size)));
    const result = await settled;
    await assert.rejects(h.client.commit(prepared, signal()), /already dispatched/);
    const [pending] = h.client.pending(h.binding);
    assert.equal(h.calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(h.listeners.size, 0);
    if (name === 'receipt-digest-mismatch') {
      assert.equal(pending.outcome, 'unknown'); assert.equal(pending.receipt, undefined);
      assert.equal(pending.evidenceId, undefined); assert.equal(pending.assetId, undefined);
      await assert.rejects(h.client.prepare(fresh, input, signal()), /completion is unknown/);
    } else {
      assert.equal(result.outcome, 'committed'); assert.equal(pending.evidenceId, evidenceId); assert.equal(pending.assetId, assetId);
      assert.equal(pending.receipt.requestId, prepared.requestId);
      const evidence = pending.receipt.data.records.find(row => row.target.recordType === 'evidence');
      assert.equal(evidence.payload.references[0].assetId, pending.assetId);
      assert.equal(evidence.payload.provenance.factAt, null); assert.equal(evidence.payload.provenance.evidenceBasis, 'unknown');
      assert.equal(evidence.payload.provenance.retrievedAt, timestamp);
    }
  }
} else {
  const h = harness(), { input } = await inputFor();
  const fresh = await h.client.load(h.binding, placeId, signal());
  const originalBytes = new Uint8Array(await input.selection.original.arrayBuffer());
  originalBytes[0] ^= 1;
  const different = new File([originalBytes], input.selection.file.name, { type: 'text/plain' });
  assert.equal(different.size, input.selection.original.size, 'size/name/type alone cannot establish original identity');
  const altered = { ...input, selection: { ...input.selection, file: different } };
  await assert.rejects(h.client.prepare(fresh, altered, signal()), /browser-original bytes differ/);
  assert.deepEqual(h.calls.map(call => call.method), ['GET']);
  assert.deepEqual(h.client.pending(h.binding), []); assert.equal(h.listeners.size, 0);
}
console.log(`PASS synthetic source fixture ${name}; no browser/native acceptance`);
