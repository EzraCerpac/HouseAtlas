import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { boundaries, validateShape } from '../../../packages/contracts/src/index.mjs';

export const ADAPTER_VERSION = '0.1.0';
export const NETWORK_READ_ROUTES = Object.freeze(['/api/inventory']);
const scopeFields = ['workspaceId', 'homeId', 'sourceInstanceId', 'collectionId'];
const copy = value => structuredClone(value);
const scope = value => Object.fromEntries(scopeFields.map(key => [key, value[key]]));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const bad = (code, message) => { throw new NetworkReadError(code, message); };
export class NetworkReadError extends Error {
  constructor(code, message) { super(message); this.name = 'NetworkReadError'; this.code = code; }
}
const text = (value, max = 16384) => typeof value === 'string' && value.length <= max;
const sourceText = value => text(value, 2000);
const id = value => text(value, 4096) && value.length > 0;
const stamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const timestamp = value => { if (!stamp(value)) bad('invalid-schema', 'Invalid timestamp'); return value; };
const nullableStamp = value => value === null ? null : timestamp(value);
const guard = (condition, message) => { if (!condition) bad('invalid-schema', message); };
const keys = (row, allowed) => guard(Object.keys(row).every(key => allowed.includes(key)), 'Unknown source fields require compatibility review');

export function assertNetworkReadRequest(request) {
  if (!object(request) || Object.keys(request).some(key => !['method', 'path'].includes(key)) ||
      request.method !== 'GET' || !NETWORK_READ_ROUTES.includes(request.path)) {
    bad('forbidden', 'Only the pinned inventory GET request is permitted');
  }
  return request;
}

function registrationOf(registration) {
  try { validateShape('sourceRegistration', registration); } catch { bad('wrong-scope', 'Invalid Network source registration'); }
  if (registration.owner !== 'network' || (registration.partitionMode === 'exclusive-home' && registration.allowedExternalIds.length)) {
    bad('wrong-scope', 'Expected a reviewed Network source partition');
  }
  return copy(registration);
}
function assertScope(expected, actual) {
  if (!object(actual) || scopeFields.some(key => expected[key] !== actual[key])) bad('wrong-scope', 'Network source scope does not match');
}
function assertAllowed(registration, externalId) {
  if (registration.partitionMode === 'reviewed-entity-allowlist' && !registration.allowedExternalIds.includes(externalId)) {
    bad('wrong-scope', 'Network record is outside the reviewed source partition');
  }
}
function unique(rows, label, maxRecords) {
  guard(Array.isArray(rows), `Invalid ${label} list`);
  if (rows.length > maxRecords) bad('size-limit', 'Network record count exceeds limit');
  const seen = new Set();
  for (const row of rows) {
    guard(object(row) && id(row.id), `Invalid ${label} identity`);
    guard(!seen.has(row.id), `Duplicate ${label} identity`); seen.add(row.id);
  }
  return rows;
}
function validateInventory(document, registration, maxRecords) {
  guard(object(document) && Number.isSafeInteger(document.revision) && document.revision >= 0 && object(document.inventory), 'Invalid inventory document');
  const inv = document.inventory;
  const all = new Set();
  for (const key of ['rooms', 'devices', 'interfaces', 'segments', 'links']) {
    for (const row of unique(inv[key], key, maxRecords)) {
      guard(!all.has(row.id), 'Network IDs must remain globally unique'); all.add(row.id);
      assertAllowed(registration, row.id);
    }
  }
  if (all.size > maxRecords) bad('size-limit', 'Network generation record count exceeds limit');
  const rooms = new Set(inv.rooms.map(row => row.id));
  const devices = new Set(inv.devices.map(row => row.id));
  const endpoints = new Map([
    ...inv.devices.map(row => [row.id, 'device']), ...inv.interfaces.map(row => [row.id, 'interface']),
    ...inv.segments.map(row => [row.id, 'segment'])
  ]);
  for (const row of inv.rooms) { keys(row, ['id', 'name']); guard(sourceText(row.name), 'Invalid Network group name'); }
  for (const row of [...inv.devices, ...inv.segments]) {
    guard(sourceText(row.name) && sourceText(row.kind), 'Invalid Network entity');
    guard(!own(row, 'roomId') || rooms.has(row.roomId), 'Unknown Network group');
  }
  for (const row of inv.devices) {
    keys(row, ['id', 'name', 'kind', 'role', 'mobility', 'roomId', 'notes']);
    guard(!own(row, 'notes') || sourceText(row.notes), 'Invalid device notes');
    guard(!own(row, 'role') || ['infrastructure', 'client'].includes(row.role), 'Invalid device role');
    guard(!own(row, 'mobility') || ['fixed', 'mobile'].includes(row.mobility), 'Invalid mobility');
    guard(row.mobility !== 'mobile' || !own(row, 'roomId'), 'Mobile device cannot acquire a fixed group');
  }
  for (const row of inv.segments) { keys(row, ['id', 'name', 'kind', 'roomId']); guard(['powerline', 'lan', 'unknown'].includes(row.kind), 'Invalid abstract segment kind'); }
  for (const row of inv.interfaces) {
    keys(row, ['id', 'deviceId', 'name', 'mac', 'addresses']);
    guard(devices.has(row.deviceId) && sourceText(row.name) && Array.isArray(row.addresses) && row.addresses.every(a => text(a, 200)), 'Invalid interface');
    guard(!own(row, 'mac') || /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(row.mac), 'Invalid interface MAC');
  }
  for (const row of inv.links) {
    keys(row, ['id', 'from', 'to', 'medium', 'confidence', 'observedAt', 'notes', 'reportedRate']);
    guard(endpoints.has(row.from) && endpoints.has(row.to), 'Unknown link endpoint');
    guard(['ethernet', 'wifi', 'powerline', 'unknown'].includes(row.medium), 'Invalid link medium');
    guard(['confirmed', 'reported', 'inferred', 'unknown'].includes(row.confidence), 'Invalid source confidence');
    guard(!own(row, 'notes') || sourceText(row.notes), 'Invalid link notes');
    if (own(row, 'observedAt')) timestamp(row.observedAt);
    if (own(row, 'reportedRate')) {
      const rate = row.reportedRate;
      guard(object(rate) && rate.kind === 'negotiated-port' && Number.isFinite(rate.mbps) && rate.mbps > 0 && rate.mbps <= 1000000 && id(rate.source), 'Invalid reported port rate');
      keys(rate, ['mbps', 'kind', 'source', 'observedAt']);
      timestamp(rate.observedAt);
    }
  }
  guard(object(inv.positions) && Object.values(inv.positions).every(p => object(p) && Number.isFinite(p.x) && Number.isFinite(p.y)), 'Invalid Network graph positions');
  return endpoints;
}
function limitsOf(options = {}) {
  const result = {
    maxResponseBytes: boundaries.defaults.maxResponseBytes,
    requestTimeoutMs: boundaries.defaults.requestTimeoutMs,
    maxRecords: 10000,
    ...options
  };
  guard(Object.keys(result).every(key => ['maxResponseBytes', 'requestTimeoutMs', 'maxRecords'].includes(key)), 'Unknown limit');
  guard(Object.values(result).every(n => Number.isSafeInteger(n) && n > 0), 'Invalid adapter limit');
  return result;
}
function boundedJson(body, maxBytes) {
  let raw;
  try { raw = typeof body === 'string' ? body : JSON.stringify(body); } catch { bad('invalid-schema', 'Expected JSON response'); }
  guard(typeof raw === 'string', 'Expected JSON response');
  if (Buffer.byteLength(raw) > maxBytes) bad('size-limit', 'Network response exceeds limit');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { bad('invalid-schema', 'Malformed Network JSON'); }
  // JSON.parse alone silently accepts conflicting duplicate keys. Walk already-valid
  // JSON tokens before publication and bound nesting for captured observation values.
  const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) ?? [];
  let index = 0;
  function walk(depth) {
    guard(depth <= 100, 'Network JSON nesting exceeds limit');
    const token = tokens[index++];
    if (token === '{') {
      const seen = new Set();
      while (tokens[index] !== '}') {
        const key = JSON.parse(tokens[index++]);
        guard(!seen.has(key), 'Duplicate Network JSON key'); seen.add(key); index++; walk(depth + 1);
        if (tokens[index] === ',') index++;
      }
      index++;
    } else if (token === '[') {
      while (tokens[index] !== ']') { walk(depth + 1); if (tokens[index] === ',') index++; } index++;
    } else if (/^-?\d/.test(token)) guard(Number.isFinite(Number(token)), 'Nonfinite Network JSON number');
  }
  walk(0);
  return parsed;
}

function validateLinkReview(review, revision, links) {
  guard(object(review) && review.revision === revision && object(review.links), 'Link review must match the source revision');
  keys(review, ['revision', 'links']);
  guard(Object.keys(review.links).length === links.length && links.every(link => own(review.links, link.id)), 'Every source link requires explicit reviewed provenance');
  for (const evidence of Object.values(review.links)) {
    guard(object(evidence), 'Invalid reviewed link evidence');
    keys(evidence, ['kind', 'evidenceBasis', 'temporalStatus', 'factAt', 'vantage', 'unresolvedTo']);
    nullableStamp(evidence.factAt);
    guard(evidence.vantage === null || id(evidence.vantage), 'Invalid reviewed link vantage');
  }
}

function projectLinkRelation({ source, link, evidence, endpoints, sourceRevision, sourceSnapshotAt, retrievedAt }) {
  let from = { kind: endpoints.get(link.from), id: link.from, description: null };
  let to = { kind: endpoints.get(link.to), id: link.to, description: null };
  guard(evidence.kind === 'network-segment-membership' || (from.kind !== 'segment' && to.kind !== 'segment'), 'Abstract segment cannot become a physical connection');
  if (evidence.kind === 'network-segment-membership' && from.kind === 'segment') [from, to] = [to, from];
  if (evidence.unresolvedTo !== undefined) {
    guard(id(evidence.unresolvedTo), 'Unresolved endpoint needs a description');
    to = { kind: 'unresolved', id: null, description: evidence.unresolvedTo };
  }
  const relation = {
    schemaVersion: 1, ...scope(source), externalId: link.id, kind: evidence.kind,
    from, to, medium: link.medium, sourceRevision, sourceSnapshotAt, retrievedAt,
    vantage: evidence.vantage, sourceConfidence: link.confidence, evidenceBasis: evidence.evidenceBasis,
    temporalStatus: evidence.temporalStatus, factAt: own(link, 'observedAt') ? link.observedAt : evidence.factAt,
    notes: link.notes ?? ''
  };
  try { validateShape('networkRelation', relation); } catch { bad('invalid-schema', 'Invalid reviewed Network relation'); }
  guard(relation.kind !== 'network-association' || relation.temporalStatus !== 'current-claim', 'Historical association cannot become a current connection');
  guard(relation.kind !== 'network-segment-membership' || (to.kind === 'segment' && ['device', 'interface'].includes(from.kind)), 'Membership must remain member-to-segment');
  return relation;
}

/** Pure, offline projection. Review is pinned to the captured inventory revision.
 * It supplies explicit evidence/temporal classification; notes are never parsed as authority.
 */
export function projectNetworkCapture({ registration, capture, review, limits = {} }) {
  const source = registrationOf(registration), bounds = limitsOf(limits);
  assertScope(source, capture?.source);
  const retrievedAt = timestamp(capture.retrievedAt);
  const sourceSnapshotAt = nullableStamp(capture.sourceSnapshotAt);
  const wire = boundedJson(capture.document, bounds.maxResponseBytes);
  const endpoints = validateInventory(wire, source, bounds.maxRecords);
  validateLinkReview(review, wire.revision, wire.inventory.links);
  const networkRelations = wire.inventory.links.map(link => projectLinkRelation({ source, link, evidence: review.links[link.id], endpoints,
    sourceRevision: wire.revision, sourceSnapshotAt, retrievedAt }));
  const project = (kind, row) => ({
    schemaVersion: 1, ...scope(source), sourceKind: `network-${kind}`, externalId: row.id,
    sourceRevision: wire.revision, sourceSnapshotAt, retrievedAt, value: copy(row)
  });
  // Graph positions and addresses are source data; neither is a physical mapping.
  const inventory = {
    groups: wire.inventory.rooms.map(row => project('group', row)),
    devices: wire.inventory.devices.map(row => project('device', row)),
    interfaces: wire.inventory.interfaces.map(row => project('interface', row)),
    segments: wire.inventory.segments.map(row => project('segment', row)),
    links: wire.inventory.links.map(row => project('link', row))
  };
  const observations = unique(wire.observations ?? [], 'observations', bounds.maxRecords).map(row => {
    guard(id(row.collectorId) && id(row.kind) && id(row.vantagePoint) && object(row.value), 'Invalid captured observation');
    timestamp(row.timestamp);
    if (row.invalidatedAt !== undefined) timestamp(row.invalidatedAt);
    if (row.deviceId !== undefined) { guard(endpoints.get(row.deviceId) === 'device', 'Unknown observation device'); assertAllowed(source, row.deviceId); }
    if (row.interfaceId !== undefined) { guard(endpoints.get(row.interfaceId) === 'interface', 'Unknown observation interface'); assertAllowed(source, row.interfaceId); }
    assertAllowed(source, row.id);
    // Unqualified aggregate observations cannot be assigned to a reviewed shared-home partition.
    guard(source.partitionMode !== 'reviewed-entity-allowlist' || row.deviceId !== undefined || row.interfaceId !== undefined, 'Unqualified shared-source observation');
    return { ...scope(source), externalId: row.id, sourceRevision: wire.revision, sourceSnapshotAt,
      retrievedAt, factAt: row.timestamp, vantage: row.vantagePoint, value: copy(row) };
  });
  return { schemaVersion: 1, ...scope(source), sourceRevision: wire.revision, sourceSnapshotAt,
    retrievedAt, inventory, networkRelations, observations, linkReview: copy(review),
    provenance: { input: 'network-inventory-document', linkReviewRevision: review.revision, graphPositionsEstablishGeometry: false,
      groupsEstablishPlacement: false, segmentsEstablishCircuits: false, sourceHistoryIsComplete: false } };
}

function emptyState(source) {
  return { cache: { schemaVersion: 1, ...scope(source), status: 'empty', lastSuccessfulFetchAt: null,
    lastAttemptAt: null, generationId: null, consistency: 'non-transactional-offset-pages', error: null }, generation: null };
}
function validateState(source, state, configuredReview = null) {
  assertScope(source, state?.cache);
  try { validateShape('cacheStatus', state.cache); } catch { bad('invalid-schema', 'Invalid Network cache metadata'); }
  guard((state.cache.status === 'access-revoked' && state.generation === null || (state.generation === null) === (state.cache.lastSuccessfulFetchAt === null)) &&
    (state.cache.generationId === null) === (state.cache.lastSuccessfulFetchAt === null), 'Cache generation must retain success metadata');
  guard(state.cache.status !== 'fresh' || (state.generation !== null && state.cache.error === null), 'Fresh cache needs a valid generation');
  if (state.generation !== null) {
    assertScope(source, state.generation);
    timestamp(state.generation.retrievedAt); nullableStamp(state.generation.sourceSnapshotAt);
    guard(Number.isSafeInteger(state.generation.sourceRevision) && state.generation.sourceRevision >= 0, 'Invalid cached source revision');
    guard(object(state.generation.inventory) && Array.isArray(state.generation.networkRelations) && Array.isArray(state.generation.observations), 'Invalid cached generation');
    guard(Date.parse(state.generation.retrievedAt) <= Date.parse(state.cache.lastSuccessfulFetchAt), 'Cache retrieval follows success metadata');
    for (const [key, kind] of Object.entries({ groups: 'group', devices: 'device', interfaces: 'interface', segments: 'segment', links: 'link' })) {
      guard(Array.isArray(state.generation.inventory[key]), 'Invalid cached inventory');
      for (const row of state.generation.inventory[key]) {
        assertScope(source, row); assertAllowed(source, row.externalId);
        guard(row.sourceKind === `network-${kind}` && row.externalId === row.value?.id && row.sourceRevision === state.generation.sourceRevision && row.retrievedAt === state.generation.retrievedAt && row.sourceSnapshotAt === state.generation.sourceSnapshotAt, 'Invalid cached inventory provenance');
      }
    }
    const endpoints = validateInventory({ revision: state.generation.sourceRevision, inventory: {
      rooms: state.generation.inventory.groups.map(row => row.value), devices: state.generation.inventory.devices.map(row => row.value),
      interfaces: state.generation.inventory.interfaces.map(row => row.value), segments: state.generation.inventory.segments.map(row => row.value),
      links: state.generation.inventory.links.map(row => row.value), positions: {}
    } }, source, 10000);
    const links = new Map(state.generation.inventory.links.map(row => [row.externalId, row.value]));
    validateLinkReview(state.generation.linkReview, state.generation.sourceRevision, [...links.values()]);
    if (configuredReview?.revision === state.generation.sourceRevision) {
      guard(isDeepStrictEqual(state.generation.linkReview, configuredReview), 'Cached review does not match configured source review');
    }
    unique(state.generation.networkRelations.map(row => ({ id: row.externalId })), 'cached relations', 10000);
    guard(state.generation.networkRelations.length === links.size, 'Cached generation lost a source link');
    for (const relation of state.generation.networkRelations) {
      assertScope(source, relation); validateShape('networkRelation', relation); assertAllowed(source, relation.externalId);
      const link = links.get(relation.externalId);
      guard(link, 'Cached relation has no retained source link');
      const expected = projectLinkRelation({ source, link, evidence: state.generation.linkReview.links[link.id], endpoints,
        sourceRevision: state.generation.sourceRevision, sourceSnapshotAt: state.generation.sourceSnapshotAt, retrievedAt: state.generation.retrievedAt });
      guard(isDeepStrictEqual(relation, expected), 'Cached relation differs from its retained source link and reviewed projection');
    }
    unique(state.generation.observations.map(row => ({ id: row.externalId })), 'cached observations', 10000);
    for (const observation of state.generation.observations) {
      assertScope(source, observation); assertAllowed(source, observation.externalId);
      const original = observation.value;
      guard(observation.externalId === original?.id && observation.factAt === original.timestamp && observation.vantage === original.vantagePoint &&
        observation.sourceRevision === state.generation.sourceRevision && observation.retrievedAt === state.generation.retrievedAt &&
        observation.sourceSnapshotAt === state.generation.sourceSnapshotAt && id(original.collectorId) && id(original.kind) && id(original.vantagePoint) && object(original.value), 'Invalid cached observation provenance');
      timestamp(observation.factAt);
      if (original.invalidatedAt !== undefined) timestamp(original.invalidatedAt);
      if (original.deviceId !== undefined) { guard(endpoints.get(original.deviceId) === 'device', 'Unknown cached observation device'); assertAllowed(source, original.deviceId); }
      if (original.interfaceId !== undefined) { guard(endpoints.get(original.interfaceId) === 'interface', 'Unknown cached observation interface'); assertAllowed(source, original.interfaceId); }
      guard(source.partitionMode !== 'reviewed-entity-allowlist' || original.deviceId !== undefined || original.interfaceId !== undefined, 'Unqualified shared-source observation');
    }
  }
  return copy(state);
}

const errorMessages = Object.freeze({ timeout: 'Network read timed out', auth: 'Network access is unavailable',
  'wrong-scope': 'Network source scope was rejected', 'invalid-schema': 'Network response was rejected',
  'size-limit': 'Network response exceeded limits', transport: 'Network is unavailable', upstream: 'Network source returned an error' });

/** No live HTTP implementation, login, timers, demand, diagnostics, or write capability.
 * The integrator injects an authorized server transport returning an attested source tuple.
 */
export function createNetworkReadAdapter({ registration, transport, review, clock = () => new Date().toISOString(),
  newGenerationId = randomUUID, limits = {}, initialState = null }) {
  const source = registrationOf(registration), bounds = limitsOf(limits), pinnedReview = copy(review);
  guard(typeof transport === 'function', 'A bounded read transport is required');
  let state = initialState === null ? emptyState(source) : validateState(source, initialState, pinnedReview);
  let inflight = null;
  const read = () => copy(state.cache.status === 'access-revoked' ? { cache: state.cache, generation: null } : state);
  const refresh = () => {
    if (inflight) return inflight;
    inflight = (async () => {
      const at = timestamp(clock());
      const controller = new AbortController();
      let timer;
      try {
        const request = Object.freeze(assertNetworkReadRequest({ method: 'GET', path: '/api/inventory' }));
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new NetworkReadError('timeout', 'Network read timed out')); }, bounds.requestTimeoutMs);
        });
        const response = await Promise.race([Promise.resolve().then(() => transport(request, { signal: controller.signal })), timeout]);
        if (response?.status === 401 || response?.status === 403) bad('auth', errorMessages.auth);
        if (response?.status !== 200) bad('upstream', errorMessages.upstream);
        if (response.redirected || response.location || response.url) bad('upstream', 'Redirect response rejected');
        assertScope(source, response.source);
        const fetchedAt = timestamp(clock());
        guard(Date.parse(fetchedAt) >= Date.parse(at), 'Clock moved backwards during read');
        const generation = projectNetworkCapture({ registration: source, review: pinnedReview, limits: bounds,
          capture: { source: response.source, document: response.body, retrievedAt: fetchedAt, sourceSnapshotAt: response.sourceSnapshotAt ?? null } });
        if (state.generation && generation.sourceRevision < state.generation.sourceRevision) bad('invalid-schema', 'Source revision moved backwards');
        const inventoryValues = value => Object.fromEntries(Object.entries(value.inventory).map(([key, rows]) => [key, rows.map(row => row.value)]));
        if (state.generation && generation.sourceRevision === state.generation.sourceRevision && !isDeepStrictEqual(inventoryValues(generation), inventoryValues(state.generation))) {
          bad('invalid-schema', 'Inventory changed without a source revision');
        }
        const cache = { schemaVersion: 1, ...scope(source), status: 'fresh', lastSuccessfulFetchAt: fetchedAt,
          lastAttemptAt: at, generationId: newGenerationId(), consistency: 'non-transactional-offset-pages', error: null };
        validateShape('cacheStatus', cache);
        state = { cache, generation };
      } catch (error) {
        const code = own(errorMessages, error?.code) ? error.code : 'transport';
        // A denied source keeps recovery metadata, but never serves cached records to this adapter.
        state = { ...state, cache: { ...state.cache, status: code === 'auth' || state.cache.status === 'access-revoked' ? 'access-revoked' : 'error', lastAttemptAt: at,
          error: { code, at, message: errorMessages[code] } } };
      } finally { clearTimeout(timer); }
      return read();
    })().finally(() => { inflight = null; });
    return inflight;
  };
  return Object.freeze({ read, refresh });
}

/** Pure facet assembly. Never refreshes a source or changes independent Atlas/HomeBox views. */
export function buildNetworkFacet({ registration, state, now, staleAfterMs = 300000 }) {
  const source = registrationOf(registration), cached = validateState(source, state);
  timestamp(now); guard(Number.isSafeInteger(staleAfterMs) && staleAfterMs > 0, 'Invalid freshness threshold');
  const ageMs = cached.cache.lastSuccessfulFetchAt === null ? null : Math.max(0, Date.parse(now) - Date.parse(cached.cache.lastSuccessfulFetchAt));
  const denied = cached.cache.status === 'access-revoked';
  const generation = denied ? null : cached.generation;
  const stale = !denied && generation !== null && (cached.cache.status !== 'fresh' || ageMs > staleAfterMs);
  const relations = generation?.networkRelations ?? [];
  return { ...scope(source), readOnly: true, status: denied ? 'revoked' : generation === null ? 'unavailable' : stale ? 'stale' : 'fresh',
    cache: cached.cache, ageMs, sourceRevision: generation?.sourceRevision ?? null, sourceSnapshotAt: generation?.sourceSnapshotAt ?? null,
    groups: generation?.inventory.groups ?? [], devices: generation?.inventory.devices ?? [], interfaces: generation?.inventory.interfaces ?? [],
    segments: generation?.inventory.segments ?? [], currentClaims: relations.filter(row => row.temporalStatus === 'current-claim'),
    history: relations.filter(row => row.temporalStatus !== 'current-claim'), observations: (generation?.observations ?? []).map(row => ({ ...row,
      freshness: row.value.invalidatedAt ? 'invalidated' : Date.parse(now) - Date.parse(row.factAt) > staleAfterMs ? 'stale' : 'recent' })),
    message: denied ? 'Network access is unavailable' : generation === null ? 'Network data is unavailable' : stale ? 'Cached Network data; device state is unknown' : 'Network source claims',
    capabilities: { demand: false, diagnostics: false, writes: false, physicalPlacement: false, electricalCircuits: false } };
}
