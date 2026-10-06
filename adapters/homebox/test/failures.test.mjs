import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeBoxAdapter, cacheFreshness, HomeBoxReadError } from '../src/index.mjs';
import { reg, ids, NOW, baseline, fakeTransport, response, options, metadata, detail, assertPriorUnchanged } from './support.mjs';
const prior = () => ({ cache: structuredClone(baseline.caches[0]), homeboxEntities: structuredClone(baseline.homeboxEntities.filter(p => p.homeId === reg.homeId)) });
async function failure(transport, code, config = {}) {
  const previous = prior(), before = structuredClone(previous);
  const result = await createHomeBoxAdapter({ ...options(transport), ...config }).fetchGeneration({ previous });
  assertPriorUnchanged(assert, before, result, previous);
  assert.equal(result.cache.error.code, code);
  assert.equal(result.cache.lastAttemptAt, NOW);
  return result;
}
for (const status of [401, 403]) test(`upstream ${status} quarantines prior cache with sanitized auth error`, async () => {
  const result = await failure(async () => response({ secret: 'PRIVATE' }, reg, status), 'auth');
  assert.equal(result.quarantine, true); assert.equal(result.cache.status, 'access-revoked');
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(cacheFreshness(result.cache, { now: NOW, staleAfterMs: 1 }).requiresScopeRevalidation, true);
});
for (const field of ['workspaceId', 'homeId', 'sourceInstanceId', 'collectionId']) test(`wrong ${field} fails closed before any cache publication`, async () => {
  const wrong = { ...reg, [field]: field === 'collectionId' ? 'other-tenant' : '00000000-0000-4000-8000-000000000099' };
  const result = await failure(async () => response({ items: [], page: 1, pageSize: 100, total: 0 }, wrong), 'wrong-scope');
  assert.equal(result.quarantine, true);
});
test('missing scope receipt and redirect abort without reading response bodies', async () => {
  let read = false;
  const body = { async *[Symbol.asyncIterator]() { read = true; yield new Uint8Array(); } };
  await failure(async () => ({ status: 200, body }), 'wrong-scope'); assert.equal(read, false);
  await failure(async () => ({ status: 302, scope: reg, body }), 'upstream'); assert.equal(read, false);
  await failure(async () => ({ status: 200, redirected: true, scope: reg, body }), 'upstream'); assert.equal(read, false);
});
test('transport errors and unsuccessful status never expose keys, URLs or source body', async () => {
  const secret = 'Bearer PRIVATE_KEY https://host/private?key=PRIVATE_KEY';
  const result = await failure(async () => { throw new Error(secret); }, 'transport');
  assert.ok(!JSON.stringify(result).includes('PRIVATE_KEY'));
  const upstream = await failure(async () => response({ body: secret }, reg, 500), 'upstream');
  assert.ok(!JSON.stringify(upstream).includes('PRIVATE_KEY'));
});
const paginationCases = {
  'wrong page': v => ({ ...v, page: 2 }),
  'wrong page size': v => ({ ...v, pageSize: 99 }),
  'short page': v => ({ ...v, total: 3 }),
  'unsafe total': v => ({ ...v, total: Number.MAX_SAFE_INTEGER + 1 }),
  'unbounded total': v => ({ ...v, total: 100001 }),
  'location partition mismatch': v => ({ ...v, items: [detail(ids.item, false)], total: 1 })
};
for (const [name, mutate] of Object.entries(paginationCases)) test(`${name} rejects generation`, async () => {
  await failure(fakeTransport({ pageMutator: mutate }).transport, 'pagination');
});
test('count drift after first page and page budget abort entire generation', async () => {
  const entities = [detail(ids.item, false), detail(ids.unknown, false)];
  const drift = fakeTransport({ entities, pageMutator: (v, req) => new URLSearchParams(req.query).get('page') === '2' ? { ...v, total: v.total + 1 } : v });
  await failure(drift.transport, 'pagination', { limits: { maxPageSize: 1 } });
  await failure(fakeTransport({ entities }).transport, 'pagination', { limits: { maxPages: 1 } });
});
test('conflicting duplicate entity UUIDs fail; identical duplicate observations collapse', async () => {
  const e = detail(ids.item, false);
  await failure(fakeTransport({ entities: [e, { ...e, name: 'Changed same UUID' }] }).transport, 'pagination');
  const result = await createHomeBoxAdapter(options(fakeTransport({ entities: [e, structuredClone(e)] }).transport)).fetchGeneration();
  assert.equal(result.ok, true); assert.equal(result.homeboxEntities.length, 1);
});
test('list-to-detail observed edits fail without claiming atomic CAS', async () => {
  const f = fakeTransport({ interceptor: req => req.path === '/api/v1/entities/' + ids.location ? response(detail(ids.location, true, { name: 'Concurrent edit' })) : undefined });
  await failure(f.transport, 'pagination');
});
test('targeted detail cannot substitute another entity UUID', async () => {
  const f = fakeTransport({ interceptor: req => req.path === '/api/v1/entities/' + ids.location ? response(detail(ids.unknown, true)) : undefined });
  await failure(f.transport, 'wrong-scope');
});
for (const body of ['{broken', new Uint8Array([0xff]), JSON.stringify({ items: [{ id: 'invalid' }], page: 1, pageSize: 100, total: 1 })]) test('malformed JSON, UTF-8 or wire schema aborts generation', async () => {
  await failure(async () => ({ status: 200, scope: reg, body }), 'invalid-schema');
});
test('missing attachment/maintenance metadata is not treated as empty', async () => {
  const f = fakeTransport({ interceptor: req => {
    if (req.path === '/api/v1/entities/' + ids.location) { const e = detail(ids.location, true); delete e.attachments; return response(e); }
  } });
  await failure(f.transport, 'invalid-schema');
  await failure(fakeTransport({ interceptor: req => req.path.endsWith('/maintenance') ? response({ items: [] }) : undefined }).transport, 'invalid-schema');
});
test('parent cycles and malformed optional fields fail frozen final validation', async () => {
  await failure(fakeTransport({ entities: [detail(ids.item, false, { parent: { id: ids.item } })] }).transport, 'invalid-schema');
  await failure(fakeTransport({ entities: [detail(ids.item, false, { quantity: 'unknown' })] }).transport, 'invalid-schema');
});
test('attachment IDs conflict, active URLs and URL credentials are rejected', async () => {
  const stored = { attachmentId: ids.attachment, kind: 'stored-file', title: 'one', contentType: null, byteSize: null, proxyRef: null };
  await failure(fakeTransport({ entities: [detail(ids.item, false, { attachments: [stored, { ...stored, title: 'two' }] })] }).transport, 'invalid-schema');
  for (const url of ['javascript:alert(1)', 'https://user:password@example.invalid/manual']) {
    await failure(fakeTransport({ entities: [detail(ids.item, false, { attachments: [{ attachmentId: ids.link, kind: 'external-link', title: 'bad', url, archived: false }] })] }).transport, 'invalid-schema');
  }
});
test('response and cumulative generation bytes are independently bounded for streams', async () => {
  let consumed = 0;
  const body = { async *[Symbol.asyncIterator]() { for (let i = 0; i < 10; i++) { consumed++; yield new Uint8Array(20); } } };
  await failure(async () => ({ status: 200, scope: reg, body }), 'size-limit', { limits: { maxResponseBytes: 30 } });
  assert.equal(consumed, 2);
  await failure(fakeTransport().transport, 'size-limit', { limits: { maxGenerationBytes: 600 } });
});
test('hung transport and hung body terminate, abort transport and preserve cache', async () => {
  let signal;
  await failure(async req => { signal = req.signal; return new Promise(() => {}); }, 'timeout', { limits: { requestTimeoutMs: 20 } });
  assert.equal(signal.aborted, true);
  await failure(async () => ({ status: 200, scope: reg, body: { async *[Symbol.asyncIterator]() { await new Promise(() => {}); } } }), 'timeout', { limits: { requestTimeoutMs: 20 } });
});
test('whole generation deadline is independent of request timeout', async () => {
  let tick = 0;
  await failure(fakeTransport().transport, 'timeout', { monotonicClock: () => tick += 10, limits: { generationTimeoutMs: 40 } });
});
test('no saved cache outage remains distinct from successful empty collection', async () => {
  const result = await createHomeBoxAdapter(options(async () => { throw new Error('unavailable'); })).fetchGeneration();
  assert.equal(result.cache.status, 'error'); assert.equal(result.cache.generationId, null);
  assert.equal(result.cache.lastSuccessfulFetchAt, null); assert.equal(result.homeboxEntities, null);
});
test('existing revocation stays quarantined through a later unrelated failure', async () => {
  const p = prior(); p.cache.status = 'access-revoked'; p.cache.error = { code: 'auth', message: 'Denied', at: NOW };
  const result = await createHomeBoxAdapter(options(async () => { throw new Error('offline'); })).fetchGeneration({ previous: p });
  assert.equal(result.quarantine, true);
});

test('duplicate escaped JSON keys, nonfinite numbers and excessive depth are rejected', async () => {
  for (const body of ['{"items":[],"page":1,"pageSize":100,"total":0,"total":1}', '{"items":[],"page":1,"pageSize":100,"total":0,"\\u0074otal":1}', '{"items":[],"page":1,"pageSize":100,"total":0,"unknown":1e999}', '['.repeat(66) + '0' + ']'.repeat(66)]) {
    await failure(async () => ({ status: 200, scope: reg, body }), 'invalid-schema');
  }
});
test('pre-aborted and mid-flight cancelled reads retain private generation', async () => {
  for (const pre of [true, false]) {
    const controller = new AbortController(); if (pre) controller.abort();
    let started = false;
    const transport = async () => { started = true; controller.abort(); return new Promise(() => {}); };
    const previous = prior(), before = structuredClone(previous);
    const r = await createHomeBoxAdapter(options(transport)).fetchGeneration({ previous, signal: controller.signal });
    assertPriorUnchanged(assert, before, r, previous); assert.equal(r.cache.error.code, 'timeout');
    if (pre) assert.equal(started, false);
  }
});
test('wrong-scope quarantine persists in cache metadata through successive failures', async () => {
  const wrong = await failure(async () => response({}, { ...reg, collectionId: 'wrong' }), 'wrong-scope');
  let p = { cache: wrong.cache, homeboxEntities: prior().homeboxEntities };
  for (let i = 0; i < 2; i++) {
    const r = await createHomeBoxAdapter(options(async () => { throw new Error('offline'); })).fetchGeneration({ previous: p });
    assert.equal(r.quarantine, true); assert.equal(r.cache.status, 'access-revoked');
    p = { cache: r.cache, homeboxEntities: p.homeboxEntities };
  }
});
test('simultaneous generation rejected without allowing overlapping publications', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fakeTransport({ interceptor: async (_req, calls) => { if (calls.length === 1) await gate; } });
  const adapter = createHomeBoxAdapter(options(f.transport));
  const first = adapter.fetchGeneration();
  await assert.rejects(adapter.fetchGeneration(), e => e.code === 'transport');
  release(); assert.equal((await first).ok, true);
  assert.equal((await adapter.fetchGeneration()).ok, true);
});
test('wall clock moving backwards cannot publish a falsely fresh generation', async () => {
  let tick = 0;
  const clock = () => tick++ === 0 ? NOW : '2026-10-06T09:00:00.000Z';
  await failure(fakeTransport().transport, 'invalid-schema', { clock });
});

test('unpaired Unicode metadata and malformed injected error codes stay bounded', async () => {
  await failure(async () => ({ status: 200, scope: reg, body: '{"items":[],"page":1,"pageSize":100,"total":0,"unknown":"\\ud800"}' }), 'invalid-schema');
  await failure(async () => { throw new HomeBoxReadError('arbitrary-private-value'); }, 'transport');
});
test('final linear graph validation matches frozen parent cycles and nested containers', async () => {
  const entities = Array.from({ length: 200 }, (_, i) => detail(`00000000-0000-4000-8000-${String(2000 + i).padStart(12, '0')}`, true, { parent: i === 0 ? null : { id: `00000000-0000-4000-8000-${String(1999 + i).padStart(12, '0')}` } }));
  const result = await createHomeBoxAdapter(options(fakeTransport({ entities }).transport)).fetchGeneration();
  assert.equal(result.ok, true); assert.equal(result.homeboxEntities.length, 200);
  const { validateSnapshot } = await import('../../../packages/contracts/src/index.mjs');
  validateSnapshot({ contractVersion: '1.0.0', synthetic: true, sources: [reg], records: [], caches: [result.cache], homeboxEntities: result.homeboxEntities, networkRelations: [] });
  entities[0].parent = { id: entities.at(-1).id };
  await failure(fakeTransport({ entities }).transport, 'invalid-schema');
});
test('a late transport resolution after timeout cannot publish or overlap current generation', async () => {
  let lateResolve;
  const late = new Promise(resolve => { lateResolve = resolve; });
  let attempt = 0;
  const normal = fakeTransport().transport;
  const adapter = createHomeBoxAdapter({ ...options(req => attempt++ === 0 ? late : normal(req)), limits: { requestTimeoutMs: 20 } });
  const failed = await adapter.fetchGeneration(); assert.equal(failed.ok, false);
  lateResolve(response({ items: [], page: 1, pageSize: 100, total: 0 }));
  const fresh = await adapter.fetchGeneration(); assert.equal(fresh.ok, true);
  assert.equal(failed.homeboxEntities, null); assert.equal(fresh.homeboxEntities.length, 3);
});

test('complete read-back is only a candidate and preserves prior source quarantine', async () => {
  const p = prior(); p.cache.status = 'access-revoked'; p.cache.error = { code: 'auth', message: 'Denied', at: NOW };
  const r = await createHomeBoxAdapter(options(fakeTransport().transport)).fetchGeneration({ previous: p });
  assert.equal(r.ok, true); assert.equal(r.cache.status, 'fresh');
  assert.equal(r.quarantine, true); assert.equal(r.quarantineTransition, 'revalidation-candidate');
  assert.equal(p.cache.status, 'access-revoked');
});
