import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { CONTRACT_VERSION, boundaries, canonicalJson, validateShape } from '../../../packages/contracts/src/index.mjs';

export const ADAPTER_VERSION = '0.1.0';
export const HOMEBOX_REFERENCE_VERSION = boundaries.homebox.testedVersion;
export const CONSISTENCY = boundaries.homebox.consistency;
export const DEFAULT_LIMITS = Object.freeze({ ...boundaries.defaults });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGES = Object.freeze({
  timeout: 'HomeBox read exceeded its time limit.',
  auth: 'HomeBox access was denied; cached access requires scope revalidation.',
  'wrong-scope': 'HomeBox response does not match the registered source partition.',
  'invalid-schema': 'HomeBox metadata failed the pinned synthetic contract.',
  pagination: 'HomeBox pagination did not complete consistently within its limits.',
  'size-limit': 'HomeBox read exceeded its byte limit.',
  transport: 'HomeBox read transport failed.',
  upstream: 'HomeBox returned an unsuccessful response.'
});
export class HomeBoxReadError extends Error {
  constructor(code) { super(MESSAGES[code] ?? MESSAGES.transport); this.name = 'HomeBoxReadError'; this.code = Object.hasOwn(MESSAGES, code) ? code : 'transport'; }
}
const fail = code => { throw new HomeBoxReadError(code); };
const clone = value => structuredClone(value);
const uuid = value => { if (typeof value !== 'string' || !UUID.test(value)) fail('invalid-schema'); return value.toLowerCase(); };
const scope = r => ({ workspaceId: r.workspaceId, homeId: r.homeId, sourceInstanceId: r.sourceInstanceId, collectionId: r.collectionId });
const sameScope = (a, b) => Object.entries(scope(a)).every(([k, v]) => b[k] === v);
const shaped = (name, value) => { try { return validateShape(name, value); } catch { fail('invalid-schema'); } };
const object = value => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-schema'); return value; };
const date = value => { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('invalid-schema'); return value; };

// Reject duplicate (including escaped-equivalent) object keys before JSON.parse.
// A fixed nesting ceiling bounds parser recursion for hostile metadata.
function parseMetadata(text) {
  let i = 0;
  const whitespace = () => { while (i < text.length && /[ \t\r\n]/.test(text[i])) i++; };
  const string = () => {
    if (text[i] !== '"') fail('invalid-schema');
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === '"') { try { const decoded = JSON.parse(text.slice(start, i)); if (!decoded.isWellFormed()) fail('invalid-schema'); return decoded; } catch { fail('invalid-schema'); } }
      if (c === '\\') i++;
    }
    fail('invalid-schema');
  };
  const value = depth => {
    if (depth > 64) fail('invalid-schema');
    whitespace();
    const c = text[i];
    if (c === '"') { string(); return; }
    if (c === '{') {
      i++; whitespace(); const keys = new Set();
      if (text[i] === '}') { i++; return; }
      while (true) {
        whitespace(); const key = string();
        if (keys.has(key)) fail('invalid-schema'); keys.add(key);
        whitespace(); if (text[i++] !== ':') fail('invalid-schema');
        value(depth + 1); whitespace();
        const separator = text[i++];
        if (separator === '}') return;
        if (separator !== ',') fail('invalid-schema');
      }
    }
    if (c === '[') {
      i++; whitespace(); if (text[i] === ']') { i++; return; }
      while (true) {
        value(depth + 1); whitespace(); const separator = text[i++];
        if (separator === ']') return;
        if (separator !== ',') fail('invalid-schema');
      }
    }
    const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!literal) fail('invalid-schema');
    if (!['true', 'false', 'null'].includes(literal[0]) && !Number.isFinite(Number(literal[0]))) fail('invalid-schema');
    i += literal[0].length;
  };
  value(0); whitespace(); if (i !== text.length) fail('invalid-schema');
  try { return JSON.parse(text); } catch { fail('invalid-schema'); }
}

function normalizeWireEntity(value) {
  const e = clone(object(value));
  e.id = uuid(e.id);
  if (e.entityType != null) e.entityType.id = uuid(object(e.entityType).id);
  if (e.parent != null) e.parent.id = uuid(object(e.parent).id);
  // Known optional fields become explicit unknowns; never classify unavailable types.
  e.entityType ??= null;
  e.parent ??= null;
  shaped('homeboxPageWire', { items: [e], page: 1, pageSize: 1, total: 1 });
  return e;
}
function normalizeAttachments(value) {
  if (!Array.isArray(value)) fail('invalid-schema');
  const seen = new Map();
  for (const raw of value) {
    const a = clone(object(raw));
    a.attachmentId = uuid(a.attachmentId);
    // Content authorization/proxy capability is supplied later by AT-11/12.
    if (a.kind === 'stored-file') a.proxyRef = null;
    shaped('attachment', a);
    if (a.kind === 'external-link') {
      const u = new URL(a.url);
      if (u.username || u.password) fail('invalid-schema');
    }
    if (seen.has(a.attachmentId) && !isDeepStrictEqual(seen.get(a.attachmentId), a)) fail('invalid-schema');
    seen.set(a.attachmentId, a);
  }
  return [...seen.values()];
}
function normalizeMaintenance(value) {
  if (!Array.isArray(value)) fail('invalid-schema');
  const seen = new Map();
  for (const raw of value) {
    const m = clone(object(raw));
    m.entryId = uuid(m.entryId);
    shaped('maintenance', m);
    if (seen.has(m.entryId) && !isDeepStrictEqual(seen.get(m.entryId), m)) fail('invalid-schema');
    seen.set(m.entryId, m);
  }
  return [...seen.values()];
}
function navigationConfig(value, registration) {
  if (value == null) return null;
  const n = clone(object(value));
  if (!sameScope(registration, n)) fail('wrong-scope');
  const u = new URL(n.origin);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/') fail('invalid-schema');
  for (const [intent, route] of Object.entries(object(n.routes))) {
    if (!['view', 'edit', 'maintenance'].includes(intent) || route.verified !== true || typeof route.path !== 'string' || !/^\/[A-Za-z0-9_/-]*\{entityId\}[A-Za-z0-9_/-]*$/.test(route.path) || route.path.includes('//') || route.path.includes('..')) fail('invalid-schema');
  }
  return { ...n, origin: u.origin };
}
function links(navigation, registration, source) {
  if (!navigation) return [];
  return Object.entries(navigation.routes).map(([intent, route]) => ({
    kind: 'homebox-native', intent,
    entity: { workspaceId: registration.workspaceId, homeId: registration.homeId, key: clone(source) },
    href: navigation.origin + route.path.replace('{entityId}', source.externalId), verifiedRoute: true
  }));
}
function projection(raw, maintenance, registration, retrievedAt, navigation) {
  const source = { sourceInstanceId: registration.sourceInstanceId, collectionId: registration.collectionId, sourceKind: 'homebox-entity', externalId: raw.id };
  return shaped('homeboxProjection', {
    schemaVersion: 1, workspaceId: registration.workspaceId, homeId: registration.homeId, source,
    sourceUpdatedAt: raw.updatedAt, retrievedAt,
    entity: {
      id: raw.id, name: raw.name, description: raw.description ?? '',
      entityType: raw.entityType === null ? null : { id: raw.entityType.id, name: raw.entityType.name, isLocation: raw.entityType.isLocation },
      parent: raw.parent === null ? null : { id: raw.parent.id }, archived: raw.archived,
      quantity: raw.quantity ?? null, manufacturer: raw.manufacturer ?? null,
      modelNumber: raw.modelNumber ?? null, serialNumber: raw.serialNumber ?? null, notes: raw.notes ?? null
    },
    attachments: normalizeAttachments(raw.attachments), maintenance: normalizeMaintenance(maintenance),
    nativeLinks: links(navigation, registration, source)
  });
}
function emptyCache(registration) {
  return { schemaVersion: 1, ...scope(registration), status: 'empty', lastSuccessfulFetchAt: null, lastAttemptAt: null, generationId: null, consistency: CONSISTENCY, error: null };
}
// Frozen snapshot shape plus its read/cache semantic subset. Parent-cycle checking
// is linear; the general contract validator walks each complete ancestor chain.
function validateReadState(registration, cache, homeboxEntities, checkTime = () => {}) {
  shaped('snapshot', { contractVersion: CONTRACT_VERSION, synthetic: true, sources: [registration], records: [], caches: [cache], homeboxEntities, networkRelations: [] });
  if (!sameScope(registration, cache)) fail('wrong-scope');
  if ((cache.lastSuccessfulFetchAt === null) !== (cache.generationId === null) ||
      (cache.status === 'fresh' && (!cache.lastSuccessfulFetchAt || cache.error)) ||
      (cache.status === 'empty' && cache.lastSuccessfulFetchAt !== null) ||
      (cache.status === 'error' && !cache.error)) fail('invalid-schema');
  const allowed = new Set(registration.allowedExternalIds), records = new Map();
  for (const p of homeboxEntities) {
    checkTime();
    if (!sameScope(registration, { ...p, ...p.source }) || p.source.sourceKind !== 'homebox-entity') fail('wrong-scope');
    if (p.source.externalId !== p.entity.id || records.has(p.entity.id)) fail('invalid-schema');
    if (registration.partitionMode === 'reviewed-entity-allowlist' && (!allowed.has(p.entity.id) || (p.entity.parent && !allowed.has(p.entity.parent.id)))) fail('wrong-scope');
    if (!cache.generationId || !cache.lastSuccessfulFetchAt || Date.parse(p.retrievedAt) > Date.parse(cache.lastSuccessfulFetchAt)) fail('invalid-schema');
    for (const link of p.nativeLinks) {
      if (link.entity.workspaceId !== p.workspaceId || link.entity.homeId !== p.homeId || !isDeepStrictEqual(link.entity.key, p.source)) fail('wrong-scope');
      const u = new URL(link.href);
      if (u.username || u.password || u.search || u.hash) fail('invalid-schema');
    }
    records.set(p.entity.id, p);
  }
  const state = new Map();
  for (const start of homeboxEntities) {
    checkTime(); const trail = []; let next = start;
    while (next && state.get(next.entity.id) !== 2) {
      checkTime();
      if (state.get(next.entity.id) === 1) fail('invalid-schema');
      state.set(next.entity.id, 1); trail.push(next.entity.id);
      next = next.entity.parent ? records.get(next.entity.parent.id) : null;
    }
    for (const id of trail) state.set(id, 2);
  }
}
function previousGeneration(previous, registration) {
  const p = previous == null ? { cache: emptyCache(registration), homeboxEntities: [] } : clone(previous);
  if (!sameScope(registration, p.cache)) fail('wrong-scope');
  validateReadState(registration, p.cache, p.homeboxEntities);
  return p;
}
/** Read-time age only. Does not change fetch/retrieval timestamps or authorize cache. */
export function cacheFreshness(cache, { now, staleAfterMs }) {
  shaped('cacheStatus', cache);
  const at = Date.parse(date(now));
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0) fail('invalid-schema');
  const ageMs = cache.lastSuccessfulFetchAt === null ? null : Math.max(0, at - Date.parse(cache.lastSuccessfulFetchAt));
  return { cache: { ...clone(cache), status: cache.status === 'fresh' && ageMs > staleAfterMs ? 'stale' : cache.status }, ageMs, requiresScopeRevalidation: cache.status === 'access-revoked' || cache.error?.code === 'wrong-scope' };
}

/** Server-side, injected GET-only transport. This module never calls fetch or stores keys. */
export function createHomeBoxAdapter({ registration, transport, clock = () => new Date().toISOString(), monotonicClock = () => performance.now(), idFactory = randomUUID, limits = {}, nativeNavigation = null }) {
  registration = clone(registration);
  shaped('sourceRegistration', registration);
  if (registration.owner !== 'homebox' || (registration.partitionMode === 'exclusive-home' && registration.allowedExternalIds.length)) fail('wrong-scope');
  const allowed = new Set(registration.allowedExternalIds.map(uuid));
  if (allowed.size !== registration.allowedExternalIds.length || [...allowed].some(id => !registration.allowedExternalIds.includes(id))) fail('invalid-schema');
  if (typeof transport !== 'function' || typeof clock !== 'function' || typeof monotonicClock !== 'function' || typeof idFactory !== 'function') fail('invalid-schema');
  const config = { ...DEFAULT_LIMITS, ...limits };
  for (const [key, value] of Object.entries(limits)) if (!(key in DEFAULT_LIMITS) || typeof DEFAULT_LIMITS[key] !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) fail('invalid-schema');
  const navigation = navigationConfig(nativeNavigation, registration);
  const authorized = id => registration.partitionMode === 'exclusive-home' || allowed.has(id);
  const checkParent = e => { if (e.parent && !authorized(e.parent.id)) fail('wrong-scope'); };
  let busy = false;

  async function executeRead({ previous = null, parentIds = [], signal: externalSignal } = {}, filtered = false) {
    if (busy) fail('transport');
    if (!Array.isArray(parentIds) || (externalSignal != null && !(externalSignal instanceof AbortSignal))) fail('invalid-schema');
    const prior = previousGeneration(filtered ? null : previous, registration);
    const parents = [...new Set(parentIds.map(uuid))];
    if (parents.some(id => !authorized(id))) fail('wrong-scope');
    // Parent-filtered reads are views, not replacement generations.
    if ((!filtered && parents.length) || (filtered && !parents.length) || parents.length > config.maxPageSize) fail('pagination');
    const attemptAt = date(clock());
    busy = true;
    const began = monotonicClock();
    const controller = new AbortController();
    let timer, externalAbort;
    let bytes = 0, requests = 0, pages = 0;
    const checkTime = () => { if (controller.signal.aborted || monotonicClock() - began >= config.generationTimeoutMs) fail('timeout'); };
    const request = async (path, query = []) => {
      checkTime(); requests++;
      const requestDeadline = Math.min(monotonicClock() + config.requestTimeoutMs, began + config.generationTimeoutMs);
      const checkRequestTime = () => {
        if (controller.signal.aborted || monotonicClock() >= requestDeadline) fail('timeout');
      };
      checkRequestTime();
      // No route, method, tenant or arbitrary headers supplied by callers.
      if (!/^\/api\/v1\/entities(?:\/[0-9a-f-]{36}(?:\/maintenance)?)?$/.test(path)) fail('transport');
      const req = Object.freeze({ method: 'GET', path, query: Object.freeze(query.map(pair => Object.freeze(pair))), headers: Object.freeze({ 'X-Tenant': registration.collectionId }), redirect: 'error', scope: Object.freeze(scope(registration)), signal: controller.signal });
      const remaining = requestDeadline - monotonicClock();
      let requestTimer;
      const timeout = new Promise((_, reject) => {
        requestTimer = setTimeout(() => { controller.abort(); reject(new HomeBoxReadError('timeout')); }, Math.max(0, remaining));
      });
      const operation = (async () => {
        let response;
        try { response = await transport(req); } catch (e) { checkRequestTime(); if (e instanceof HomeBoxReadError) throw e; fail('transport'); }
        checkRequestTime();
        object(response);
        if (response.redirected || (response.status >= 300 && response.status < 400)) fail('upstream');
        if (response.status === 401 || response.status === 403) fail('auth');
        if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) fail('upstream');
        // Scope receipt is produced by the trusted bound transport, not assumed HTTP headers.
        if (!response.scope || !sameScope(registration, response.scope)) fail('wrong-scope');
        const body = response.body;
        let iterable;
        if (typeof body === 'string') iterable = [new TextEncoder().encode(body)];
        else if (body instanceof Uint8Array) iterable = [body];
        else if (body?.[Symbol.asyncIterator] || body?.[Symbol.iterator]) iterable = body;
        else fail('invalid-schema');
        let size = 0; const chunks = [];
        for await (const chunk of iterable) {
          checkRequestTime();
          if (!(chunk instanceof Uint8Array)) fail('invalid-schema');
          size += chunk.byteLength; bytes += chunk.byteLength;
          if (size > config.maxResponseBytes || bytes > config.maxGenerationBytes) fail('size-limit');
          chunks.push(new Uint8Array(chunk)); // Own bytes before a producer reuses its scratch buffer.
        }
        checkRequestTime();
        const joined = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { checkRequestTime(); joined.set(chunk, offset); offset += chunk.byteLength; }
        checkRequestTime();
        try {
          const result = { value: parseMetadata(new TextDecoder('utf-8', { fatal: true }).decode(joined)), retrievedAt: date(clock()) };
          checkRequestTime(); // Synchronous decoding/parsing can defer the timer callback.
          return result;
        } catch (e) { if (e instanceof HomeBoxReadError) throw e; fail('invalid-schema'); }
      })();
      try { const result = await Promise.race([operation, timeout, cancelled]); checkRequestTime(); return result; } finally { clearTimeout(requestTimer); }
    };
    let cancel;
    const cancelled = new Promise((_, reject) => { cancel = () => { controller.abort(); reject(new HomeBoxReadError('timeout')); }; });
    cancelled.catch(() => {}); // Pre-aborted inputs may fail before the first race attaches.
    timer = setTimeout(cancel, config.generationTimeoutMs);
    externalAbort = cancel;
    externalSignal?.addEventListener('abort', externalAbort, { once: true });
    if (externalSignal?.aborted) cancel();
    try {
      const entities = new Map();
      for (const isLocation of [true, false]) {
        let total = null, page = 1, fetched = 0;
        while (true) {
          if (++pages > config.maxPages) fail('pagination');
          const { value } = await request('/api/v1/entities', [['isLocation', String(isLocation)], ['includeArchived', 'true'], ['page', String(page)], ['pageSize', String(config.maxPageSize)], ...parents.map(id => ['parentIds', id])]);
          object(value);
          if (!Array.isArray(value.items)) fail('invalid-schema');
          const normalized = value.items.map(normalizeWireEntity);
          shaped('homeboxPageWire', { ...value, items: normalized });
          if (!Number.isSafeInteger(value.total) || value.page !== page || value.pageSize !== config.maxPageSize || value.items.length > config.maxPageSize || (total !== null && total !== value.total)) fail('pagination');
          total = value.total;
          if (total > config.maxPages * config.maxPageSize) fail('pagination');
          const expected = Math.min(config.maxPageSize, Math.max(0, total - fetched));
          if (value.items.length !== expected) fail('pagination');
          for (const e of normalized) {
            if (e.entityType && e.entityType.isLocation !== isLocation) fail('pagination');
            if (filtered && !parents.includes(e.parent?.id)) fail('pagination');
            const existing = entities.get(e.id);
            if (existing && canonicalJson(existing) !== canonicalJson(e)) fail('pagination');
            entities.set(e.id, e);
          }
          fetched += normalized.length;
          if (fetched === total) break;
          page++;
        }
      }
      const projections = [];
      for (const e of entities.values()) {
        if (!authorized(e.id)) continue;
        checkParent(e);
        const detail = await request(`/api/v1/entities/${e.id}`);
        const raw = normalizeWireEntity(detail.value);
        if (raw.id !== e.id) fail('wrong-scope');
        checkParent(raw);
        if (filtered && !parents.includes(raw.parent?.id)) fail('pagination');
        // Detect edits observed between list and detail; offset data is still not CAS.
        if (['name', 'archived', 'updatedAt', 'entityType', 'parent'].some(k => !isDeepStrictEqual(e[k], raw[k]))) fail('pagination');
        const maintenance = await request(`/api/v1/entities/${e.id}/maintenance`);
        projections.push(projection(raw, maintenance.value, registration, maintenance.retrievedAt, navigation));
      }
      checkTime();
      const successAt = date(clock());
      if (Date.parse(successAt) < Date.parse(attemptAt) || (prior.cache.lastSuccessfulFetchAt !== null && Date.parse(successAt) < Date.parse(prior.cache.lastSuccessfulFetchAt)) || projections.some(p => Date.parse(p.retrievedAt) > Date.parse(successAt))) fail('invalid-schema');
      const cache = shaped('cacheStatus', { ...emptyCache(registration), status: 'fresh', lastSuccessfulFetchAt: successAt, lastAttemptAt: attemptAt, generationId: uuid(idFactory()) });
      validateReadState(registration, cache, projections, checkTime);
      checkTime();
      const present = new Set(projections.map(p => p.source.externalId));
      return { ok: true, cache: filtered ? null : cache, completeness: filtered ? 'filtered-view' : 'complete-generation', replaceCache: !filtered, homeboxEntities: projections, missingExternalIds: prior.homeboxEntities.map(p => p.source.externalId).filter(id => !present.has(id)), retainPrevious: false, quarantine: filtered ? null : prior.cache.status === 'access-revoked' || prior.cache.error?.code === 'wrong-scope', quarantineTransition: filtered ? 'preserve' : 'revalidation-candidate', stats: { bytes, requests, pages }, consistency: CONSISTENCY, deletionConfirmed: false };
    } catch (e) {
      controller.abort();
      const code = e instanceof HomeBoxReadError ? e.code : 'transport';
      const errorAt = date(clock());
      const cache = shaped('cacheStatus', { ...clone(prior.cache), status: code === 'auth' || code === 'wrong-scope' || prior.cache.status === 'access-revoked' || prior.cache.error?.code === 'wrong-scope' ? 'access-revoked' : 'error', lastAttemptAt: attemptAt, error: { code, at: errorAt, message: MESSAGES[code] } });
      return { ok: false, cache: filtered ? null : cache, completeness: filtered ? 'filtered-view' : 'complete-generation', replaceCache: false, error: clone(cache.error), homeboxEntities: null, missingExternalIds: [], retainPrevious: true, quarantine: filtered ? (code === 'auth' || code === 'wrong-scope' ? true : null) : code === 'auth' || code === 'wrong-scope' || prior.cache.status === 'access-revoked' || prior.cache.error?.code === 'wrong-scope', quarantineTransition: code === 'auth' || code === 'wrong-scope' ? 'quarantine' : 'preserve', stats: { bytes, requests, pages }, consistency: CONSISTENCY, deletionConfirmed: false };
    } finally {
      clearTimeout(timer); externalSignal?.removeEventListener('abort', externalAbort); busy = false;
    }
  }
  return Object.freeze({ fetchGeneration: options => executeRead(options), fetchView: options => executeRead(options, true) });
}
