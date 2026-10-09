import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const CONTRACT_VERSION = '1.1.0';
export const schema = JSON.parse(readFileSync(new URL('../schemas/atlas.schema.json', import.meta.url)));
export const boundaries = JSON.parse(readFileSync(new URL('../policy/boundaries.json', import.meta.url)));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
ajv.addSchema(schema);
const validators = new Map();
export class ContractError extends Error {
  constructor(code, message) { super(message); this.name = 'ContractError'; this.code = code; }
}
const fail = (code, message) => { throw new ContractError(code, message); };
const validUnicode = value => {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail('invalid-contract', 'Unpaired Unicode surrogate'); }
    else if (c >= 0xdc00 && c <= 0xdfff) fail('invalid-contract', 'Unpaired Unicode surrogate');
  }
  return value;
};
/** RFC 8785 JSON data serialization: ECMAScript scalars and UTF-16 key order.
 * The server parser must reject duplicate input keys before this function.
 */
export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('invalid-contract', 'Non-finite JSON number'); return JSON.stringify(value); }
  if (typeof value === 'string') return JSON.stringify(validUnicode(value));
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(validUnicode(k))}:${canonicalJson(value[k])}`).join(',')}}`;
  fail('invalid-contract', 'Canonical digest requires JSON data');
}
export const recordDigest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
export function validateShape(name, value) {
  if (!Object.hasOwn(schema.$defs, name)) fail('invalid-contract', `Unknown shape: ${name}`);
  if (!validators.has(name)) validators.set(name, ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` }));
  const validator = validators.get(name);
  if (!validator(value)) fail('invalid-contract', ajv.errorsText(validator.errors));
  return value;
}
const scopeKey = s => JSON.stringify([s.workspaceId, s.homeId]);
const sourceScopeKey = s => JSON.stringify([s.workspaceId, s.homeId, s.sourceInstanceId, s.collectionId]);
const recordKey = r => JSON.stringify([r.workspaceId, r.homeId, r.recordType, r.recordId]);
const sameScope = (a, b) => scopeKey(a) === scopeKey(b);
const keyOf = (r, source) => JSON.stringify([r.workspaceId, source.sourceInstanceId, source.collectionId, source.sourceKind, source.externalId]);
const ownerOf = k => k.startsWith('homebox-') ? 'homebox' : k.startsWith('network-') ? 'network' : 'magicplan';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Pure graph validation. This does not authorize, fetch, mutate or persist anything. */
export function validateSnapshot(snapshot) {
  validateShape('snapshot', snapshot);
  const records = new Map(), permanentIds = new Set(), registrations = new Map();
  for (const s of snapshot.sources) {
    const key = sourceScopeKey(s);
    if (registrations.has(key)) fail('identity-conflict', 'Duplicate source registration');
    registrations.set(key, s);
    if (s.partitionMode === 'exclusive-home' && s.allowedExternalIds.length) fail('invalid-contract', 'Exclusive source has no entity allowlist');
  }
  for (const a of snapshot.sources) for (const b of snapshot.sources) {
    if (a === b || a.workspaceId !== b.workspaceId || a.sourceInstanceId !== b.sourceInstanceId || a.collectionId !== b.collectionId) continue;
    if (a.owner !== b.owner) fail('identity-conflict', 'Source owner is immutable');
    if (a.partitionMode === 'exclusive-home' || b.partitionMode === 'exclusive-home' || a.allowedExternalIds.some(id => b.allowedExternalIds.includes(id))) {
      fail('identity-conflict', 'Source partitions must be disjoint across homes');
    }
  }
  for (const r of snapshot.records) {
    const permanentId = JSON.stringify([r.workspaceId, r.recordId]);
    if (permanentIds.has(permanentId)) fail('identity-conflict', 'Permanent record ID reused');
    permanentIds.add(permanentId); records.set(recordKey(r), r);
    if (Date.parse(r.updatedAt) < Date.parse(r.createdAt)) fail('invalid-contract', 'Record time moves backwards');
  }
  const get = (r, recordType, recordId) => {
    const found = records.get(recordKey({ ...r, recordType, recordId }));
    if (!found) fail('not-found', `Missing scoped ${recordType} reference`);
    return found;
  };
  const source = (r, key) => {
    const registration = registrations.get(sourceScopeKey({ ...r, ...key }));
    if (!registration || registration.owner !== ownerOf(key.sourceKind)) fail('forbidden', 'Unregistered or wrong-owner source');
    if (registration.partitionMode === 'reviewed-entity-allowlist' && !registration.allowedExternalIds.includes(key.externalId)) fail('forbidden', 'Source entity outside reviewed home partition');
    if (key.sourceKind === 'homebox-entity' && !uuidPattern.test(key.externalId)) fail('invalid-contract', 'HomeBox entity ID must be canonical lowercase UUID');
  };
  const evidence = (r, ids) => ids.map(id => get(r, 'evidence', id));
  const bindingKeys = new Set();
  const semanticKeys = new Set();
  for (const r of snapshot.records) {
    const p = r.payload;
    if (p.evidenceIds) evidence(r, p.evidenceIds);
    if (r.recordType === 'evidence') {
      const v = p.provenance;
      if (v.source) {
        if (!sameScope(r, v.source)) fail('forbidden', 'Cross-home provenance');
        source(r, v.source.key);
      }
      evidence(r, p.supersedesEvidenceIds);
      if (p.supersedesEvidenceIds.includes(r.recordId)) fail('invalid-contract', 'Evidence cannot supersede itself');
      if (v.evidenceBasis === 'inference' && v.uncertainty.status === 'supported') fail('invalid-contract', 'Inference must stay inferred');
      if (v.evidenceBasis === 'unknown' && !['unknown', 'disputed', 'withdrawn', 'superseded'].includes(v.uncertainty.status)) fail('invalid-contract', 'Unknown basis cannot support a claim');
      for (const a of p.references) {
        if (a.kind === 'atlas-asset') get(r, 'asset', a.assetId);
        if (a.kind === 'homebox-attachment') {
          if (!sameScope(r, a.entity) || a.entity.key.sourceKind !== 'homebox-entity') fail('forbidden', 'Attachment must be a scoped HomeBox entity');
          source(r, a.entity.key);
        }
      }
    }
    if (r.recordType === 'binding') {
      const identity = get(r, 'identity', p.atlasId);
      source(r, p.source);
      if (['network-segment', 'network-interface'].includes(p.source.sourceKind)) fail('invalid-contract', 'Abstract segments/interfaces cannot be physical bindings');
      if (['network-group', 'magicplan-room'].includes(p.source.sourceKind) && identity.payload.kind !== 'location') fail('invalid-contract', 'Place reference requires location identity');
      if (p.source.sourceKind === 'network-device' && identity.payload.kind !== 'item') fail('invalid-contract', 'Network device requires item identity');
      const key = keyOf(r, p.source);
      if (bindingKeys.has(key)) fail('identity-conflict', 'Qualified source key already reserved, including retired bindings');
      bindingKeys.add(key);
      if (r.lifecycle === 'active' && p.reviewStatus === 'accepted' && identity.lifecycle !== 'active') fail('invalid-transition', 'Accepted binding needs active identity');
    }
    if (r.recordType === 'location-semantics') {
      if (p.elevation) {
        if (p.semanticKind !== 'floor') fail('invalid-contract', 'Elevation requires floor semantics');
        if (p.elevation.status === 'known') {
          const datum = get(r, 'identity', p.elevation.datumAtlasId);
          if (datum.payload.kind !== 'location') fail('invalid-contract', 'Elevation datum requires location identity');
          if (r.lifecycle === 'active' && p.reviewStatus === 'accepted' && datum.lifecycle !== 'active') fail('invalid-transition', 'Accepted known elevation needs active datum');
        }
      }
      if (get(r, 'identity', p.atlasId).payload.kind !== 'location') fail('invalid-contract', 'Semantic classification requires location identity');
      if (r.lifecycle === 'active' && p.reviewStatus === 'accepted') {
        const key = JSON.stringify([r.workspaceId, r.homeId, p.atlasId]);
        if (semanticKeys.has(key)) fail('identity-conflict', 'Only one active accepted classification per location');
        semanticKeys.add(key);
      }
    }
    if (r.recordType === 'circuit' && p.panel?.kind === 'atlas-record') {
      const panel = get(r, p.panel.ref.recordType, p.panel.ref.recordId);
      if (panel.recordType !== 'identity' || panel.payload.kind !== 'item') fail('invalid-contract', 'Circuit panel must reference a physical item');
    }
    if (r.recordType === 'relation') {
      const endpoints = [p.from, p.to].map(e => e.kind === 'unresolved' ? null : get(r, e.ref.recordType, e.ref.recordId));
      for (const e of endpoints) if (e && !['identity', 'circuit', 'valve'].includes(e.recordType)) fail('invalid-contract', 'Invalid domain endpoint type');
      if (p.kind === 'circuit-supplies') {
        if (endpoints[0]?.recordType !== 'circuit' || p.medium !== 'electricity') fail('invalid-contract', 'Circuit relation must start at a circuit with electricity medium');
        if (endpoints[1] && (endpoints[1].recordType !== 'identity' || endpoints[1].payload.kind !== 'item')) fail('invalid-contract', 'Circuit endpoint must be item or unresolved');
        const claims = evidence(r, p.evidenceIds);
        if (claims.every(e => e.payload.provenance.source?.key.sourceKind.startsWith('network-'))) fail('invalid-contract', 'Network evidence alone cannot assert an electrical relation');
      }
      if (p.kind === 'valve-controls') {
        if (endpoints[0]?.recordType !== 'valve' || !['water', 'gas', 'heating', 'other', 'unknown'].includes(p.medium)) fail('invalid-contract', 'Valve relation must start at a valve with fluid medium');
        if (endpoints[0].payload.medium !== 'unknown' && endpoints[0].payload.medium !== p.medium) fail('invalid-contract', 'Valve medium mismatch');
      }
    }
    if (r.recordType === 'geometry') {
      const original = get(r, 'asset', p.originalAssetId);
      if (original.payload.purpose !== 'geometry-original') fail('invalid-contract', 'Geometry must preserve an original asset');
      if (p.coordinateUnits === 'unknown' && (p.scale !== null || p.transform !== null)) fail('invalid-contract', 'Unknown geometry units cannot imply scale or transform');
      if (p.previousGeometryId) {
        const previous = get(r, 'geometry', p.previousGeometryId);
        if (previous.payload.geometryVersion >= p.geometryVersion) fail('invalid-contract', 'Geometry versions must increase');
      }
      const rooms = new Set();
      for (const m of p.mappings) {
        if (rooms.has(m.producerRoomId)) fail('identity-conflict', 'Duplicate producer room mapping');
        rooms.add(m.producerRoomId);
        if (get(r, 'identity', m.atlasId).payload.kind !== 'location') fail('invalid-contract', 'Geometry mapping requires location identity');
        evidence(r, m.evidenceIds);
        if (m.homeboxEntity) {
          if (!sameScope(r, m.homeboxEntity) || m.homeboxEntity.key.sourceKind !== 'homebox-entity') fail('forbidden', 'Cross-home geometry binding');
          source(r, m.homeboxEntity.key);
          if (m.reviewStatus === 'accepted') {
            const binding = snapshot.records.find(b => sameScope(r, b) && b.recordType === 'binding' && b.payload.atlasId === m.atlasId && isDeepStrictEqual(b.payload.source, m.homeboxEntity.key));
            if (!binding) fail('invalid-contract', 'Historical accepted geometry requires a retained exact compatible binding');
          }
        }
      }
    }
    if (r.recordType === 'reconciliation') {
      get(r, 'identity', p.atlasId);
      const from = get(r, 'binding', p.fromBindingId), to = get(r, 'binding', p.toBindingId);
      if (from.recordId === to.recordId || from.payload.atlasId !== p.atlasId || to.payload.atlasId !== p.atlasId) fail('invalid-contract', 'Remap journal requires retained compatible bindings for the same permanent identity');
    }
  }
  // Current physical grouping is reviewed Atlas evidence, independent of source trees.
  const classifications = new Map(snapshot.records
    .filter(r => r.recordType === 'location-semantics' && r.lifecycle === 'active' && r.payload.reviewStatus === 'accepted')
    .map(r => [recordKey({ ...r, recordType: 'identity', recordId: r.payload.atlasId }), r.payload.semanticKind]));
  const buildingParents = new Map(), levelParents = new Map(), membershipParents = new Map();
  for (const r of snapshot.records.filter(r => r.recordType === 'relation' && ['location-membership', 'physical-access'].includes(r.payload.kind))) {
    const p = r.payload;
    const endpoints = [p.from, p.to].map(e => {
      if (e.kind !== 'atlas-record' || e.ref.recordType !== 'identity') fail('invalid-contract', 'Topology endpoint requires resolved location identity');
      const identity = get(r, 'identity', e.ref.recordId);
      if (identity.payload.kind !== 'location') fail('invalid-contract', 'Topology endpoint requires location identity');
      return identity;
    });
    if (p.kind === 'physical-access' && endpoints[0].recordId === endpoints[1].recordId) fail('invalid-contract', 'Physical access endpoints must be distinct');
    if (r.lifecycle !== 'active' || p.reviewStatus !== 'accepted') continue;
    if (endpoints.some(e => e.lifecycle !== 'active')) fail('invalid-transition', 'Accepted topology needs active endpoints');
    if (p.kind !== 'location-membership') continue;
    const parentKey = recordKey(endpoints[0]), childKey = recordKey(endpoints[1]);
    const parentKind = classifications.get(parentKey), childKind = classifications.get(childKey);
    if (parentKind !== (p.membershipKind === 'building' ? 'building' : 'floor')) fail('invalid-contract', 'Accepted membership requires matching parent classification');
    if (childKind === 'building' || (p.membershipKind === 'level' && childKind === 'floor')) fail('invalid-contract', 'Invalid classified membership child');
    const parents = p.membershipKind === 'building' ? buildingParents : levelParents;
    if (parents.has(childKey)) fail('identity-conflict', 'Only one active accepted parent per membership kind');
    parents.set(childKey, parentKey);
    if (!membershipParents.has(childKey)) membershipParents.set(childKey, []);
    membershipParents.get(childKey).push(parentKey);
  }
  // Iterative traversal remains bounded by the finite snapshot, without call-stack growth.
  for (const child of membershipParents.keys()) {
    const pending = [[child, false]], visiting = new Set(), visited = new Set();
    while (pending.length) {
      const [key, leaving] = pending.pop();
      if (leaving) { visiting.delete(key); visited.add(key); continue; }
      if (visiting.has(key)) fail('invalid-contract', 'Accepted membership cycle');
      if (visited.has(key)) continue;
      visiting.add(key); pending.push([key, true]);
      for (const parent of membershipParents.get(key) ?? []) pending.push([parent, false]);
    }
  }
  for (const [child, level] of levelParents) {
    const direct = buildingParents.get(child), derived = buildingParents.get(level);
    if (direct && derived && direct !== derived) fail('invalid-contract', 'Direct and level-derived building membership disagree');
  }
  // Supersession and version history remain acyclic, even when all refs exist.
  for (const start of snapshot.records.filter(r => r.recordType === 'evidence')) {
    const visit = (r, path) => {
      if (path.has(r.recordId)) fail('invalid-contract', 'Evidence supersession cycle');
      const nextPath = new Set([...path, r.recordId]);
      for (const id of r.payload.supersedesEvidenceIds) visit(get(r, 'evidence', id), nextPath);
    };
    visit(start, new Set());
  }
  // Journals are historical facts. Later retirement need not leave a live endpoint.
  for (const start of snapshot.records.filter(r => r.recordType === 'reconciliation')) {
    const visit = (binding, path) => {
      if (path.has(binding.recordId)) fail('invalid-contract', 'Binding remap cycle');
      const nextPath = new Set([...path, binding.recordId]);
      for (const j of snapshot.records.filter(j => sameScope(start, j) && j.recordType === 'reconciliation' && j.payload.atlasId === start.payload.atlasId && j.payload.fromBindingId === binding.recordId)) visit(get(start, 'binding', j.payload.toBindingId), nextPath);
    };
    visit(get(start, 'binding', start.payload.toBindingId), new Set([start.payload.fromBindingId]));
  }
  const projections = new Map();
  for (const r of snapshot.homeboxEntities) {
    if (r.source.sourceKind !== 'homebox-entity' || r.source.externalId !== r.entity.id) fail('invalid-contract', 'Projection source/entity ID mismatch');
    source(r, r.source);
    const key = keyOf(r, r.source);
    if (projections.has(key)) fail('identity-conflict', 'Duplicate projection ID');
    projections.set(key, r);
    for (const link of r.nativeLinks) {
      if (!sameScope(r, link.entity) || !isDeepStrictEqual(link.entity.key, r.source)) fail('forbidden', 'Native link source mismatch');
      const u = new URL(link.href);
      if (u.username || u.password || u.search || u.hash) fail('invalid-contract', 'Native link must use a verified credential-free route without query/fragment');
    }
  }
  for (const r of snapshot.records.filter(r => r.recordType === 'binding' && r.payload.source.sourceKind === 'homebox-entity')) {
    const p = projections.get(keyOf(r, r.payload.source));
    if (p && !sameScope(r, p)) fail('forbidden', 'Projection in wrong home');
    if (p?.entity.entityType && get(r, 'identity', r.payload.atlasId).payload.kind !== (p.entity.entityType.isLocation ? 'location' : 'item')) fail('invalid-contract', 'Explicit HomeBox location/item flag mismatch');
  }
  for (const start of snapshot.homeboxEntities) {
    const visited = new Set(); let next = start;
    while (next) {
      if (visited.has(next.entity.id)) fail('invalid-contract', 'HomeBox parent cycle');
      visited.add(next.entity.id);
      next = next.entity.parent ? projections.get(keyOf(next, { ...next.source, externalId: next.entity.parent.id })) : null;
      if (next && !sameScope(start, next)) fail('forbidden', 'Cross-home parentage');
    }
  }
  const caches = new Map();
  for (const c of snapshot.caches) {
    if (!registrations.has(sourceScopeKey(c))) fail('forbidden', 'Cache source outside registered scope');
    if (caches.has(sourceScopeKey(c))) fail('identity-conflict', 'Duplicate cache scope');
    caches.set(sourceScopeKey(c), c);
    if ((c.lastSuccessfulFetchAt === null) !== (c.generationId === null)) fail('invalid-contract', 'Cache generation and success timestamp must coexist');
    if (c.status === 'fresh' && (!c.lastSuccessfulFetchAt || c.error)) fail('invalid-contract', 'Fresh cache needs successful generation without error');
    if (c.status === 'empty' && c.lastSuccessfulFetchAt !== null) fail('invalid-contract', 'Empty cache cannot discard prior success');
    if (c.status === 'error' && !c.error) fail('invalid-contract', 'Error cache needs an error');
  }
  for (const r of snapshot.homeboxEntities) {
    const cache = caches.get(sourceScopeKey({ ...r, ...r.source }));
    if (!cache?.lastSuccessfulFetchAt || !cache.generationId) fail('invalid-contract', 'Cached projection requires successful generation metadata');
    if (Date.parse(r.retrievedAt) > Date.parse(cache.lastSuccessfulFetchAt)) fail('invalid-contract', 'Projection retrieval cannot follow its successful generation');
  }
  for (const r of snapshot.networkRelations) {
    source(r, { ...r, sourceKind: 'network-segment', externalId: r.externalId });
    if (r.kind === 'network-segment-membership' && !(r.to.kind === 'segment' && ['device', 'interface'].includes(r.from.kind))) fail('invalid-contract', 'Segment membership is member-to-segment, never a chain');
    if (r.kind === 'network-association' && r.temporalStatus === 'current-claim') fail('invalid-contract', 'Historical associations cannot become current connections');
    for (const e of [r.from, r.to]) {
      if ((e.kind === 'unresolved') !== (e.id === null)) fail('invalid-contract', 'Unknown endpoint must remain unresolved');
      if (e.kind !== 'unresolved') source(r, { ...r, sourceKind: `network-${e.kind}`, externalId: e.id });
    }
  }
  return snapshot;
}

/** Validates the immutable boundary and CAS precondition for one Atlas command.
 * Authorization, guarded-reference checks and atomic storage belong to AT-07/11.
 */
export function assertTransition(current, command, target) {
  validateShape('scope', { workspaceId: target.workspaceId, homeId: target.homeId });
  validateShape('recordRef', { recordType: target.recordType, recordId: target.recordId });
  validateShape('mutation', command);
  if (command.operation === 'create') {
    if (current) fail('identity-conflict', 'Permanent record ID already exists');
  } else {
    if (!current || !sameScope(current, target) || current.recordType !== target.recordType || current.recordId !== target.recordId) fail('not-found', 'Record not found in authorized scope');
    validateShape('record', current);
    if (current.revision !== command.expectedRevision) fail('revision-conflict', 'Re-read and review the current record before retrying');
    if (current.revision === Number.MAX_SAFE_INTEGER) fail('invalid-transition', 'Revision exhausted');
    if (command.operation === 'restore' ? current.lifecycle !== 'tombstoned' : current.lifecycle !== 'active') fail('invalid-transition', 'Lifecycle precondition failed');
  }
  if (command.value && command.value.recordType !== target.recordType) fail('invalid-contract', 'Route and payload record type mismatch');
  if (current && command.value) {
    const a = current.payload, b = command.value.payload;
    if (target.recordType === 'identity' && a.kind !== b.kind) fail('invalid-transition', 'Physical identity kind is immutable');
    if (target.recordType === 'binding' && (a.atlasId !== b.atlasId || !isDeepStrictEqual(a.source, b.source))) fail('invalid-transition', 'Binding identity/source key is immutable; use reviewed reconciliation');
    if (target.recordType === 'evidence' || target.recordType === 'reconciliation' || target.recordType === 'geometry') fail('invalid-transition', 'Evidence, geometry versions and reconciliation journal are append-only');
    if (target.recordType === 'asset' && ['owner', 'purpose', 'storageKey', 'sha256', 'byteSize', 'contentType'].some(k => a[k] !== b[k])) fail('invalid-transition', 'Original asset manifest identity/content is immutable');
  }
  return { nextRevision: current ? current.revision + 1 : 1 };
}

/** Existing references read to decide a mutation must have revision guards.
 * Pass IDs created in the same atomic batch to exempt only those new references.
 */
export function assertGuards(snapshot, current, command, target, createdInBatch = []) {
  const refs = new Map();
  const add = (recordType, recordId) => refs.set(recordKey({ ...target, recordType, recordId }), { recordType, recordId });
  const payloads = [current?.payload, command.value?.payload].filter(Boolean);
  for (const p of payloads) {
    for (const id of p.evidenceIds ?? []) add('evidence', id);
    for (const id of p.supersedesEvidenceIds ?? []) add('evidence', id);
    if (p.atlasId) add('identity', p.atlasId);
    if (p.elevation?.status === 'known') add('identity', p.elevation.datumAtlasId);
    if (p.originalAssetId) add('asset', p.originalAssetId);
    if (p.previousGeometryId) add('geometry', p.previousGeometryId);
    if (p.fromBindingId) add('binding', p.fromBindingId);
    if (p.toBindingId) add('binding', p.toBindingId);
    if (p.panel?.kind === 'atlas-record') add(p.panel.ref.recordType, p.panel.ref.recordId);
    for (const e of [p.from, p.to]) if (e?.kind === 'atlas-record') add(e.ref.recordType, e.ref.recordId);
    for (const e of p.references ?? []) if (e.kind === 'atlas-asset') add('asset', e.assetId);
    for (const m of p.mappings ?? []) {
      add('identity', m.atlasId); for (const id of m.evidenceIds) add('evidence', id);
      if (m.reviewStatus === 'accepted' && m.homeboxEntity) {
        const binding = snapshot.records.find(b => sameScope(target, b) && b.recordType === 'binding' && b.payload.atlasId === m.atlasId && isDeepStrictEqual(b.payload.source, m.homeboxEntity.key));
        if (binding) {
          const visited = new Set();
          const follow = b => {
            if (visited.has(b.recordId)) return;
            visited.add(b.recordId); add('binding', b.recordId);
            for (const j of snapshot.records.filter(j => sameScope(target, j) && j.recordType === 'reconciliation' && j.payload.fromBindingId === b.recordId)) {
              add('reconciliation', j.recordId); add('binding', j.payload.toBindingId);
              const next = snapshot.records.find(r => sameScope(target, r) && r.recordType === 'binding' && r.recordId === j.payload.toBindingId);
              if (next) follow(next);
            }
          };
          follow(binding);
        }
      }
    }
  }
  const guards = new Map();
  for (const guard of command.guards) {
    const key = recordKey({ ...target, ...guard.record });
    if (guards.has(key)) fail('invalid-contract', 'Duplicate guard target');
    guards.set(key, guard);
    const found = snapshot.records.find(r => recordKey(r) === key);
    if (!found || found.revision !== guard.expectedRevision) fail('guard-conflict', 'Referenced record changed or is outside this home');
  }
  for (const [key] of refs) {
    if (key === recordKey(target) || createdInBatch.some(r => recordKey({ ...target, ...r }) === key)) continue;
    if (!guards.has(key)) fail('guard-conflict', 'Existing reference requires a revision guard');
  }
}

/** Validate newly asserted decisions against the final atomic candidate graph.
 * Existing append-only journals and geometry keep their historical match facts
 * when records later retire; current availability is read from those records.
 */
export function assertFinalMutation(snapshot, current, command, target) {
  if (command.operation !== 'create') return;
  const record = snapshot.records.find(r => recordKey(r) === recordKey(target));
  if (!record) fail('invalid-contract', 'Final candidate is missing created record');
  const get = (type, id) => snapshot.records.find(r => sameScope(target, r) && r.recordType === type && r.recordId === id);
  if (record.recordType === 'reconciliation') {
    const p = record.payload, from = get('binding', p.fromBindingId), to = get('binding', p.toBindingId);
    if (from?.payload.reviewStatus !== 'retired' || to?.lifecycle !== 'active' || to.payload.reviewStatus !== 'accepted') fail('invalid-transition', 'New remap journal requires retired source and active accepted destination');
  }
  if (record.recordType === 'geometry') for (const m of record.payload.mappings) {
    if (m.reviewStatus !== 'accepted' || !m.homeboxEntity) continue;
    const binding = snapshot.records.find(b => sameScope(target, b) && b.recordType === 'binding' && b.payload.atlasId === m.atlasId && isDeepStrictEqual(b.payload.source, m.homeboxEntity.key));
    if (binding?.lifecycle !== 'active' || binding.payload.reviewStatus !== 'accepted') fail('invalid-transition', 'New accepted mapping requires a current active accepted binding');
  }
}

export function validateResult(result, priorRecord = undefined) {
  validateShape('mutationResult', result);
  const r = result.record, a = result.audit;
  if (!sameScope(r, a) || a.record.recordId !== r.recordId || a.record.recordType !== r.recordType || a.resultRevision !== r.revision || a.auditId !== r.lastAuditId || a.at !== r.updatedAt || (a.previousRevision === null ? a.resultRevision !== 1 : a.resultRevision !== a.previousRevision + 1)) fail('invalid-contract', 'Audit and record revision must commit together');
  if ((a.operation === 'create') !== (a.previousRevision === null) || (a.operation === 'create') !== (a.beforeDigest === null)) fail('invalid-contract', 'Audit create/prior-revision/before-digest mismatch');
  if ((a.operation === 'tombstone') !== (r.lifecycle === 'tombstoned')) fail('invalid-contract', 'Audit operation/lifecycle mismatch');
  if (a.operation === 'create' && r.createdAt !== r.updatedAt) fail('invalid-contract', 'Create timestamps must match');
  if (recordDigest(r) !== a.afterDigest) fail('invalid-contract', 'Audit digest must match canonical committed record');
  if (priorRecord !== undefined) {
    if (priorRecord === null) {
      if (a.operation !== 'create') fail('invalid-contract', 'Noncreate audit requires the supplied prior record');
    } else {
      validateShape('record', priorRecord);
      if (!sameScope(r, priorRecord) || priorRecord.recordId !== r.recordId || priorRecord.recordType !== r.recordType || priorRecord.revision !== a.previousRevision || recordDigest(priorRecord) !== a.beforeDigest || r.createdAt !== priorRecord.createdAt || Date.parse(r.updatedAt) < Date.parse(priorRecord.updatedAt)) fail('invalid-contract', 'Audit does not match supplied prior record');
      if ((a.operation === 'restore') !== (priorRecord.lifecycle === 'tombstoned')) fail('invalid-contract', 'Audit prior lifecycle mismatch');
    }
  }
  return result;
}
