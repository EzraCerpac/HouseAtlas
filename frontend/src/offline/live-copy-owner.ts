import type { ReadyView, Scope } from '../app/types';
import type { OfflineBackend, OfflineTransaction, OfflineResult, OfflineFailure, OfflineDisplayData,
  OfflineElectricalPinV1, OfflineElectricalAvailability, OfflineHomeboxAttachmentRefV1, OfflineHomeboxAvailability, OfflineHomeboxPinV1, OfflineDisplayData as HeldDisplay, OfflineElectricalBuildingV1, OfflineElectricalCatalogV1, OfflineViewSnapshotV1, OfflineDocumentPinV1, OfflineDocumentReferenceV1, OfflineDocumentAvailability, OfflineCatalogV1, OfflineCopyHandle, OfflineStorageStatus } from './live-copy-types';

const MiB = 1024 * 1024;
export const LIVE_COPY_LIMITS = Object.freeze({ bytes: 250 * MiB, entryBytes: 128 * MiB,
  viewBytes: 8 * MiB, catalogBytes: 2 * MiB, documents: 2048, rows: 2056 });
const SHA = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MIMES = new Set(['application/pdf', 'application/geo+json', 'application/city+json',
  'application/json', 'image/tiff', 'image/png']);
class Refusal extends Error { readonly status: OfflineFailure; constructor(status: OfflineFailure) { super(status); this.status = status; } }
const need = (value: unknown, status: OfflineFailure = 'invalid') => { if (!value) throw new Refusal(status); };
/** No encoded temporary is allocated by these admission meters. */
export function utf8Size(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 128) bytes++; else if (c < 2048) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length
      && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}
export const stringPayload = (value: string) => value.length * 2 + utf8Size(value);
/** Exact JSON.stringify payload lengths for plain data, including property names, escapes and numbers.
 * Depth and visit limits refuse hostile caller structures before projection/serialization. */
export function admitJson(value: unknown, limit: number): { utf8: number; utf16: number } {
  let utf8 = 0, utf16 = 0, visits = 0;
  const path = new Set<object>();
  const add = (bytes: number, units = bytes) => {
    utf8 += bytes; utf16 += units; need(utf8 <= limit && utf16 <= limit, 'resource');
  };
  const text = (s: string) => {
    need(s.length <= limit, 'resource'); add(2);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 34 || c === 92 || c === 8 || c === 9 || c === 10 || c === 12 || c === 13) add(2);
      else if (c < 32) add(6);
      else if (c < 128) add(1);
      else if (c < 2048) add(2, 1);
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length
        && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) { add(4, 2); i++; }
      else if (c >= 0xd800 && c <= 0xdfff) add(6);
      else add(3, 1);
    }
  };
  const walk = (v: unknown, depth: number) => {
    need(++visits <= limit && depth <= 16, 'resource');
    if (v === null) { add(4); return; }
    if (typeof v === 'string') { text(v); return; }
    if (typeof v === 'number') { add(Number.isFinite(v) ? String(v).length : 4); return; }
    if (typeof v === 'boolean') { add(v ? 4 : 5); return; }
    need(typeof v === 'object'); const object = v as object;
    need(!path.has(object)); path.add(object);
    if (Array.isArray(v)) {
      need(v.length <= limit, 'resource'); add(2);
      for (let i = 0; i < v.length; i++) {
        if (i) add(1); const item = Object.getOwnPropertyDescriptor(v, String(i));
        need(!item || 'value' in item); walk(!item || item.value === undefined ? null : item.value, depth + 1);
      }
    } else {
      need(Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null); add(2); let count = 0;
      for (const key in object) {
        need(Object.prototype.hasOwnProperty.call(object, key));
        const field = Object.getOwnPropertyDescriptor(object, key); need(field && 'value' in field);
        if (field!.value === undefined) continue;
        if (count++) add(1); text(key); add(1); walk(field!.value, depth + 1);
      }
    }
    path.delete(object);
  };
  walk(value, 0); return { utf8, utf16 };
}
/** Reject unexpected keys before validators allocate Object.keys/sort/join arrays. */
function closed(value: unknown, keys: string): void {
  need(!!value && typeof value === 'object' && !Array.isArray(value));
  const allowed = keys.split(','); let count = 0;
  for (const key in value as object) {
    need(Object.prototype.hasOwnProperty.call(value, key) && ++count <= allowed.length && allowed.includes(key), 'integrity');
    const field = Object.getOwnPropertyDescriptor(value, key); need(field && 'value' in field, 'integrity');
  }
  need(count === allowed.length, 'integrity');
}
function admitMetadata(key: string, value: unknown): asserts value is Row {
  need(key.length <= 32768, 'resource');
  const size = admitJson(value, 65536); need(stringPayload(key) + size.utf8 + size.utf16 * 2 <= 65536, 'resource');
  closed(value, 'version,epoch,scope,kind,bytes,sha256,usedAt' + ((value as Row).pin === undefined ? '' : ',pin'));
  const row = value as Row; closed(row.scope, 'workspaceId,homeId');
  if (row.pin) {
    if (!('source' in row.pin)) closed(row.pin, 'documentId,documentRevision,assetId,assetRevision,sha256,bytes,contentType');
    else if (row.pin.source === 'homebox-attachment') closed(row.pin, 'source,sourceInstanceId,collectionId,entityId,attachmentId,observationId,sourceRegistrationVersion,sourceRegistrationSha256,sha256,bytes,contentType,sourceContentType,beforeRetrievedAt,bodyRetrievedAt,afterRetrievedAt');
    else closed(row.pin, 'source,buildingId,evidenceId,evidenceRevision,assetId,assetRevision,byteSize,sha256,contentType');
  }
  need(rowOK(row), 'integrity');
}
const bounded = (s: unknown, cap = 65536): s is string => typeof s === 'string' && s.length <= cap;
const scopeOK = (s: Scope) => s && UUID.test(s.workspaceId) && UUID.test(s.homeId);
const sameScope = (a: Scope, b: Scope) => a.workspaceId === b.workspaceId && a.homeId === b.homeId;
const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const decode = (b: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)) as unknown;
const hash = async (b: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))]
  .map(v => v.toString(16).padStart(2, '0')).join('');
function pick<T extends object>(value: T, keys: readonly (keyof T)[]): T {
  need(value && typeof value === 'object' && !Array.isArray(value));
  return Object.fromEntries(keys.flatMap(key => {
    const field = Object.getOwnPropertyDescriptor(value, key); need(!field || 'value' in field);
    return field?.value === undefined ? [] : [[key, field.value]];
  })) as T;
}
/** Meter the exact projected structure before map/clone/stringify; no projected collection is built. */
function admitDisplay(view: Pick<OfflineDisplayData, 'scope' | 'homeLabel' | 'entries' | 'caches'> & { now: string }) {
  let budget = LIVE_COPY_LIMITS.viewBytes;
  const charge = (n: number) => { budget -= n; need(budget >= 0, 'resource'); };
  const atom = (value: unknown) => { charge(admitJson(value, budget).utf8); };
  type Property = (name: string, write: () => void) => void;
  const object = (write: (property: Property) => void) => {
    charge(2); let count = 0;
    write((name, value) => { if (count++) charge(1); charge(name.length + 3); value(); });
  };
  const fields = (value: object, names: readonly string[], property: Property) => {
    need(!!value && typeof value === 'object');
    for (const name of names) {
      const slot = Object.getOwnPropertyDescriptor(value, name); need(!slot || 'value' in slot);
      if (slot?.value !== undefined) property(name, () => atom(slot.value));
    }
  };
  function array<T>(values: readonly T[], write: (value: T) => void) {
    need(Array.isArray(values)); charge(2); let count = 0;
    for (const value of values) { if (count++) charge(1); write(value); }
  }
  need(Array.isArray(view.entries) && view.entries.length <= 10000 && Array.isArray(view.caches) && view.caches.length <= 256);
  object(root => {
    root('scope', () => object(p => fields(view.scope, ['workspaceId', 'homeId'], p)));
    root('homeLabel', () => atom(view.homeLabel)); root('sourceNow', () => atom(view.now));
    root('entries', () => array(view.entries, entry => object(p => {
      fields(entry, ['workspaceId', 'homeId', 'key', 'kind', 'semanticKind', 'sourceState', 'cacheStatus', 'sourceUpdatedAt', 'retrievedAt', 'aliases', 'mobility', 'networkBound', 'networkStates'], p);
      p('source', () => object(q => fields(entry.source, ['sourceInstanceId', 'collectionId', 'sourceKind', 'externalId'], q)));
      p('entity', () => object(q => {
        fields(entry.entity, ['id', 'name', 'description', 'archived', 'quantity', 'manufacturer', 'modelNumber', 'serialNumber', 'notes'], q);
        q('entityType', () => entry.entity.entityType === null ? atom(null) : object(r => fields(entry.entity.entityType!, ['id', 'name', 'isLocation'], r)));
        q('parent', () => entry.entity.parent === null ? atom(null) : object(r => fields(entry.entity.parent!, ['id'], r)));
      }));
      need(Array.isArray(entry.attachments) && entry.attachments.length <= 2048);
      p('attachments', () => array(entry.attachments, attachment => object(q => fields(attachment, attachment.kind === 'stored-file'
        ? ['attachmentId', 'title', 'kind', 'contentType', 'byteSize'] : ['attachmentId', 'title', 'kind', 'archived'], q))));
      p('maintenance', () => array(entry.maintenance, item => object(q => fields(item, ['entryId', 'name', 'description', 'scheduledDate', 'completedDate', 'cost'], q))));
      p('networkRelations', () => array(entry.networkRelations, relation => object(q => {
        fields(relation, ['kind', 'medium', 'temporalStatus', 'sourceRevision', 'sourceConfidence', 'evidenceBasis', 'factAt', 'retrievedAt', 'sourceSnapshotAt', 'vantage', 'notes'], q);
        q('from', () => object(r => fields(relation.from, ['kind', 'id', 'description'], r)));
        q('to', () => object(r => fields(relation.to, ['kind', 'id', 'description'], r)));
      })));
    })));
    root('caches', () => array(view.caches, cache => object(p => fields(cache, ['owner', 'status', 'displayStatus', 'sourceInstanceId', 'collectionId', 'lastSuccessfulFetchAt'], p))));
  });
}
/** Explicit field projection. URLs, native links, service flags and edit authority never survive. */
export function projectOfflineDisplay(view: Pick<OfflineDisplayData, 'scope' | 'homeLabel' | 'entries' | 'caches'> & { readonly now: string }): OfflineDisplayData {
  admitDisplay(view);
  need(scopeOK(view.scope) && bounded(view.homeLabel, 256) && bounded(view.now, 64));
  need(Array.isArray(view.entries) && view.entries.length <= 10000 && Array.isArray(view.caches) && view.caches.length <= 256);
  const entries = view.entries.map(entry => {
    need(sameScope(entry, view.scope) && Array.isArray(entry.attachments) && entry.attachments.length <= 2048);
    const row = pick(entry, ['workspaceId', 'homeId', 'key', 'kind', 'semanticKind', 'sourceState', 'cacheStatus',
      'sourceUpdatedAt', 'retrievedAt', 'aliases', 'mobility', 'networkBound', 'networkStates']);
    return { ...row, source: pick(entry.source, ['sourceInstanceId', 'collectionId', 'sourceKind', 'externalId']),
      entity: { ...pick(entry.entity, ['id', 'name', 'description', 'archived', 'quantity', 'manufacturer', 'modelNumber', 'serialNumber', 'notes']),
        entityType: entry.entity.entityType === null ? null : pick(entry.entity.entityType, ['id', 'name', 'isLocation']),
        parent: entry.entity.parent === null ? null : pick(entry.entity.parent, ['id']) },
      attachments: entry.attachments.map(attachment => attachment.kind === 'stored-file'
        ? pick(attachment, ['attachmentId', 'title', 'kind', 'contentType', 'byteSize'])
        : pick(attachment, ['attachmentId', 'title', 'kind', 'archived'])),
      maintenance: entry.maintenance.map(item => pick(item, ['entryId', 'name', 'description', 'scheduledDate', 'completedDate', 'cost'])),
      networkRelations: entry.networkRelations.map(relation => ({
        ...pick(relation, ['kind', 'medium', 'temporalStatus', 'sourceRevision', 'sourceConfidence', 'evidenceBasis',
          'factAt', 'retrievedAt', 'sourceSnapshotAt', 'vantage', 'notes']),
        from: pick(relation.from, ['kind', 'id', 'description']), to: pick(relation.to, ['kind', 'id', 'description']),
      })) };
  });
  // Clone before the caller's view can change during hashing/queueing.
  return JSON.parse(JSON.stringify({ scope: { workspaceId: view.scope.workspaceId, homeId: view.scope.homeId },
    homeLabel: view.homeLabel, sourceNow: view.now, entries,
    caches: view.caches.map(row => pick(row, ['owner', 'status', 'displayStatus', 'sourceInstanceId', 'collectionId', 'lastSuccessfulFetchAt'])) })) as OfflineDisplayData;
}
interface Control { version: 1; epoch: string; actorId: string | null; home: Scope | null }
interface Binding { epoch: string; actorId: string; scope: Scope; serial: number; live: boolean; current: () => boolean }
interface Row { version: 1; epoch: string; scope: Scope; kind: 'view' | 'catalog' | 'document' | 'electrical-catalog' | 'electrical-document' | 'homebox-document';
  bytes: number; sha256: string; usedAt: number; pin?: StoredPin }
export interface LiveCopyActor { readonly kind: 'online-observed-actor' }
export interface LiveCopyHome { readonly kind: 'online-observed-home' }
export function validOfflinePin(pin: OfflineDocumentPinV1): boolean {
  return !!pin && UUID.test(pin.documentId) && UUID.test(pin.assetId) && Number.isSafeInteger(pin.documentRevision)
    && pin.documentRevision > 0 && Number.isSafeInteger(pin.assetRevision) && pin.assetRevision > 0
    && SHA.test(pin.sha256) && Number.isSafeInteger(pin.bytes) && pin.bytes > 0
    && pin.bytes <= LIVE_COPY_LIMITS.entryBytes && MIMES.has(pin.contentType)
    && exactKeys(pin, 'assetId,assetRevision,bytes,contentType,documentId,documentRevision,sha256');
}
function samePin(a: OfflineDocumentPinV1, b: OfflineDocumentPinV1): boolean {
  return a.documentId === b.documentId && a.documentRevision === b.documentRevision && a.assetId === b.assetId
    && a.assetRevision === b.assetRevision && a.sha256 === b.sha256 && a.bytes === b.bytes && a.contentType === b.contentType;
}
function controlOK(v: Control | undefined): v is Control {
  return !!v && v.version === 1 && UUID.test(v.epoch) && (v.actorId === null || bounded(v.actorId, 1024) && v.actorId.length > 0)
    && (v.home === null || scopeOK(v.home));
}
function rowOK(row: Row): boolean {
  return !!row && row.version === 1 && UUID.test(row.epoch) && scopeOK(row.scope)
    && ['view', 'catalog', 'document', 'electrical-catalog', 'electrical-document', 'homebox-document'].includes(row.kind) && Number.isSafeInteger(row.bytes) && row.bytes > 0
    && row.bytes <= (row.kind === 'view' ? LIVE_COPY_LIMITS.viewBytes : row.kind === 'catalog' || row.kind === 'electrical-catalog' ? LIVE_COPY_LIMITS.catalogBytes : LIVE_COPY_LIMITS.entryBytes) && SHA.test(row.sha256) && Number.isFinite(row.usedAt)
    && (row.kind !== 'document' || !!row.pin && validOfflinePin(row.pin as OfflineDocumentPinV1) && row.pin.sha256 === row.sha256 && (row.pin as OfflineDocumentPinV1).bytes === row.bytes)
    && (row.kind !== 'electrical-document' || !!row.pin && validElectricalPin(row.pin as OfflineElectricalPinV1) && row.pin.sha256 === row.sha256 && electricalPinBytes(row.pin as OfflineElectricalPinV1) === row.bytes)
    && (row.kind !== 'homebox-document' || !!row.pin && validHomeboxPin(row.pin as OfflineHomeboxPinV1) && row.pin.sha256 === row.sha256 && (row.pin as OfflineHomeboxPinV1).bytes === row.bytes);
}
type StoredPin = OfflineDocumentPinV1 | OfflineElectricalPinV1 | OfflineHomeboxPinV1;
// One HomeBox row per exact association: a newer observation replaces, never accumulates beside, the older one.
const keyFor = (b: Binding, kind: string, pin?: StoredPin | OfflineHomeboxAttachmentRefV1) => JSON.stringify([b.epoch, b.scope.workspaceId, b.scope.homeId, kind,
  ...(!pin ? [] : 'source' in pin ? pin.source === 'homebox-attachment' ? homeboxAssociation(pin)
    : [pin.source, pin.buildingId, pin.evidenceId, pin.evidenceRevision, pin.assetId, pin.assetRevision, pin.sha256, pin.byteSize, pin.contentType]
    : [pin.documentId, pin.documentRevision, pin.assetId, pin.assetRevision, pin.sha256, pin.bytes, pin.contentType])]);
const documentKind = (kind: Row['kind']) => kind === 'document' || kind === 'electrical-document' || kind === 'homebox-document';
const samePinned = (stored: StoredPin, pin: StoredPin) => !('source' in pin) ? !('source' in stored) && samePin(stored, pin)
  : pin.source === 'homebox-attachment' ? sameHomeboxPin(stored as OfflineHomeboxPinV1, pin)
  : sameElectricalPin(stored as OfflineElectricalPinV1, pin);
/** Local storage/display owner only; caller supplies actual completed canonical observations. */
export function createLiveCopyOwner(backend: OfflineBackend, options: {
  readonly now?: () => number; readonly changed?: () => void;
  readonly limits?: Partial<Record<keyof typeof LIVE_COPY_LIMITS, number>>;
  readonly storage?: Pick<StorageManager, 'estimate' | 'persisted' | 'persist'>;
} = {}) {
  const limits = { ...LIVE_COPY_LIMITS, ...options.limits };
  for (const key of Object.keys(LIVE_COPY_LIMITS) as (keyof typeof LIVE_COPY_LIMITS)[])
    need(Number.isSafeInteger(limits[key]) && limits[key] > 0 && limits[key] <= LIVE_COPY_LIMITS[key]);
  const now = options.now ?? Date.now, actors = new WeakMap<object, { epoch: string; actorId: string; serial: number; current: () => boolean }>();
  const homes = new WeakMap<object, Binding>(), copies = new WeakMap<object, Binding>();
  const listeners = new Set<() => void>(); let serial = 0, readSerial = 0, closed = false;
  let observedActor: string | null | undefined;
  const emit = () => { for (const cb of [...listeners]) { try { cb(); } catch { /* observers do not own storage */ } } };
  const changed = () => { emit(); try { options.changed?.(); } catch { /* commit is already acknowledged */ } };
  const check = (b?: Binding, signal?: AbortSignal) => {
    if (signal?.aborted) throw new Refusal('aborted');
    need(!closed && (!b || b.serial === (b.live ? serial : readSerial) && b.current()), 'retired');
  };
  const run = async <T>(work: () => Promise<T>): Promise<OfflineResult<T>> => {
    try { return { status: 'ok', value: await work() }; }
    catch (error) { return { status: error instanceof Refusal ? error.status
      : (error as { name?: string })?.name === 'OfflineResourceLimit' ? 'resource'
      : (error as { name?: string })?.name === 'OfflineCommitUnknown' ? 'uncertain'
      : (error as { name?: string })?.name === 'QuotaExceededError' ? 'quota' : 'unavailable' }; }
  };
  const fence = async (tx: OfflineTransaction, b: Binding) => {
    check(b); const c = await tx.get<Control>('control', 'witness');
    if (c !== undefined) {
      const size = admitJson(c, 65536); need(size.utf8 + size.utf16 * 2 <= 65536, 'resource');
      closed(c, 'version,epoch,actorId,home'); if (c.home !== null) closed(c.home, 'workspaceId,homeId');
    }
    need(controlOK(c) && c.epoch === b.epoch && c.actorId === b.actorId, 'retired'); check(b); return c;
  };
  const put = async (b: Binding, kind: Row['kind'], bytes: Uint8Array<ArrayBuffer>, sha256: string, signal: AbortSignal,
    pin?: StoredPin, expectedSha256?: string | null, admit?: (tx: OfflineTransaction) => Promise<{
      supersedes(row: Row): boolean; commit(): Promise<void> }>): Promise<number> => {
    check(b, signal); need(bytes.byteLength > 0 && bytes.byteLength <= limits.entryBytes, 'limit'); const key = keyFor(b, kind, pin);
    return backend.transaction(true, async tx => {
      const c = await fence(tx, b); check(b, signal);
      const admission = admit ? await admit(tx) : null; check(b, signal);
      const listed: { key: string; value: Pick<Row, 'kind' | 'bytes' | 'sha256' | 'usedAt'>; superseded: boolean }[] = [];
      let payload = 0;
      await tx.scan('metadata', limits.rows, (rowKey, value) => {
        check(b, signal); admitMetadata(rowKey, value); need(value.epoch === b.epoch, 'integrity');
        payload += stringPayload(rowKey) + stringPayload(value.sha256) + stringPayload(value.kind);
        need(payload <= 8 * MiB, 'resource');
        listed.push({ key: rowKey, value: { kind: value.kind, bytes: value.bytes, sha256: value.sha256, usedAt: value.usedAt },
          superseded: rowKey !== key && !!admission?.supersedes(value) });
      });
      const row: Row = { version: 1, epoch: b.epoch, scope: b.scope, kind, bytes: bytes.byteLength, sha256, usedAt: now(),
        ...(pin ? { pin: { ...pin } } : {}) };
      admitMetadata(key, row);
      check(b, signal); await admission?.commit();
      const superseded = listed.filter(r => r.superseded);
      for (const r of superseded) { await tx.remove('metadata', r.key); await tx.remove('bytes', r.key); }
      const rows = listed.filter(r => !superseded.includes(r));
      const previous = rows.find(r => r.key === key);
      if (expectedSha256 !== undefined) need((previous?.value.sha256 ?? null) === expectedSha256, 'retired');
      let total = rows.reduce((sum, r) => sum + r.value.bytes, 0) - (previous?.value.bytes ?? 0);
      let count = rows.length - (previous ? 1 : 0), evicted = 0;
      let documentCount = rows.filter(r => r.key !== key && documentKind(r.value.kind)).length;
      const ordered = rows.filter(r => r.key !== key).sort((a, z) => Number(!documentKind(a.value.kind)) - Number(!documentKind(z.value.kind)) || a.value.usedAt - z.value.usedAt);
      while (total + bytes.byteLength > limits.bytes || count + 1 > limits.rows || documentKind(kind) && documentCount + 1 > limits.documents) {
        const old = ordered.shift(); need(old, 'limit');
        await tx.remove('metadata', old!.key); await tx.remove('bytes', old!.key);
        total -= old!.value.bytes; count--; if (documentKind(old!.value.kind)) documentCount--; evicted++;
      }
      check(b, signal);
      await tx.put('bytes', key, bytes.slice().buffer); await tx.put('metadata', key, row);
      if (kind === 'view') await tx.put('control', 'witness', { ...c, home: b.scope });
      check(b, signal); return evicted;
    });
  };
  const read = async (b: Binding, kind: Row['kind'], signal: AbortSignal, pin?: StoredPin) => {
    check(b, signal); const key = keyFor(b, kind, pin);
    const value = await backend.transaction(true, async tx => {
      await fence(tx, b); const row = await tx.get<Row>('metadata', key), bytes = await tx.get<ArrayBuffer>('bytes', key);
      need(row && bytes, 'missing'); admitMetadata(key, row); need(row!.epoch === b.epoch && sameScope(row!.scope, b.scope)
        && row!.kind === kind && bytes instanceof ArrayBuffer && bytes.byteLength === row!.bytes, 'integrity');
      if (pin) need(row!.pin && samePinned(row!.pin, pin), 'integrity');
      await tx.put('metadata', key, { ...row, usedAt: now() }); check(b, signal);
      return { row: row!, bytes: new Uint8Array(bytes!) };
    });
    const digest = await hash(value.bytes); check(b, signal); need(digest === value.row.sha256, 'integrity');
    await backend.transaction(false, async tx => { await fence(tx, b); const latest = await tx.get<Row>('metadata', key);
      need(latest, 'missing'); admitMetadata(key, latest);
      need(latest.epoch === b.epoch && sameScope(latest.scope, b.scope) && latest.kind === kind, 'integrity');
      if (pin) need(latest.pin && samePinned(latest.pin, pin), 'integrity');
      need(latest.sha256 === value.row.sha256 && latest.bytes === value.row.bytes, 'integrity'); });
    check(b, signal); return value.bytes;
  };
  const home = (handle: LiveCopyHome) => { const b = homes.get(handle); need(b?.live, 'retired'); check(b); return b!; };
  const catalogPin = (catalog: OfflineCatalogV1, pin: OfflineDocumentPinV1) => catalog.documents.some(row =>
    row.documentId === pin.documentId && row.documentRevision === pin.documentRevision && row.assetId === pin.assetId
      && row.assetRevision === pin.assetRevision && row.sha256 === pin.sha256 && row.bytes === pin.bytes && row.lifecycle === 'active');
  const copy = (handle: OfflineCopyHandle) => { const b = copies.get(handle); need(b && !b.live, 'retired'); check(b); return b!; };
  const invalidate = () => { serial++; readSerial++; emit(); };
  const wipe = async (current: () => boolean) => {
    need(current() && !closed, 'retired');
    const tombstone: Control = { version: 1, epoch: crypto.randomUUID(), actorId: null, home: null };
    await backend.transaction(true, async tx => { need(current() && !closed, 'retired'); await tx.put('control', 'witness', tombstone); });
    // Durable retirement is already committed. Notify other visible tabs even if physical deletion fails.
    changed();
    await backend.transaction(true, async tx => {
      need(current() && !closed, 'retired');
      const latest = await tx.get<Control>('control', 'witness');
      need(latest?.epoch === tombstone.epoch && latest.actorId === null, 'retired');
      await tx.empty('metadata'); await tx.empty('bytes'); await dropRegistrations(tx); need(current() && !closed, 'retired');
    });
  };
  const readDocument = (handle: OfflineCopyHandle, pin: OfflineDocumentPinV1, signal: AbortSignal) => {
      return run(async () => { const b = copy(handle); need(validOfflinePin(pin)); pin = { ...pin }; const before = decode(await read(b, 'catalog', signal)) as OfflineCatalogV1; validateCatalog(before); need(catalogPin(before, pin), 'missing');
        const bytes = await read(b, 'document', signal, pin);
        const after = decode(await read(b, 'catalog', signal)) as OfflineCatalogV1; validateCatalog(after); need(catalogPin(after, pin), 'missing');
        check(b, signal); return new Blob([bytes], { type: pin.contentType }); });
  };
  // Open eligibility follows the newest held view: a withdrawn or re-associated attachment stays unavailable.
  const heldAssociation = async (b: Binding, pin: OfflineHomeboxPinV1, signal: AbortSignal) => {
    const view = decode(await read(b, 'view', signal)) as OfflineViewSnapshotV1;
    need(view?.data && sameScope(view.data.scope, b.scope), 'integrity');
    need(listsAttachment(view.data, pin), 'missing');
  };
  // Live exact-observation reads validate the same stored envelope/projection without returning readLast's
  // snapshot or retaining its raw/text stages. Only the decoded value crosses the first helper boundary.
  const parsedView = async (b: Binding, signal: AbortSignal) => {
    const bytes = await read(b, 'view', signal);
    const value = decode(bytes) as OfflineViewSnapshotV1;
    admitJson(value, limits.viewBytes); return value;
  };
  const validatedLiveView = async (b: Binding, signal: AbortSignal, ref?: OfflineHomeboxAttachmentRefV1) => {
    const value = await parsedView(b, signal);
    closed(value, 'actorRevision,capturedAt,coverage,data,freshness,kind,payloadSha256,snapshotRevision,version');
    need(value.version === 1 && value.kind === 'stored-display' && value.freshness === 'stale'
      && value.actorRevision === b.epoch && UUID.test(value.snapshotRevision) && Number.isFinite(Date.parse(value.capturedAt))
      && SHA.test(value.payloadSha256) && sameScope(value.data.scope, b.scope), 'integrity');
    const projection = projectOfflineDisplay({ ...value.data, now: value.data.sourceNow });
    need(JSON.stringify(projection) === JSON.stringify(value.data), 'integrity');
    need(await hash(encode(projection)) === value.payloadSha256, 'integrity');
    need(JSON.stringify(value.coverage) === JSON.stringify({ entries: 'captured', geometry: 'unavailable', history: 'unavailable',
      topology: 'unavailable', electrical: 'unavailable', nativeCatalog: 'separate-read' }), 'integrity');
    if (ref) need(listsAttachment(value.data, ref), 'missing');
    await backend.transaction(false, tx => fence(tx, b)); check(b, signal);
  };
  const readBoundHomebox = async (b: Binding, pin: OfflineHomeboxPinV1, signal: AbortSignal) => {
    const measured = admitJson(pin, 40960); need(measured.utf8 + measured.utf16 * 2 <= 40960, 'resource');
    need(validHomeboxPin(pin)); if (!Object.isFrozen(pin)) pin = Object.freeze({ ...pin });
    await validatedLiveView(b, signal, pin);
    const bytes = await read(b, 'homebox-document', signal, pin);
    await validatedLiveView(b, signal, pin); check(b, signal);
    return new Blob([bytes], { type: pin.contentType ?? 'application/octet-stream' });
  };
  const readHomeboxDocument = (handle: OfflineCopyHandle, pin: OfflineHomeboxPinV1, signal: AbortSignal) => run(async () => {
    const b = copy(handle); need(validHomeboxPin(pin)); pin = { ...pin };
    await heldAssociation(b, pin, signal);
    const bytes = await read(b, 'homebox-document', signal, pin);
    await heldAssociation(b, pin, signal); check(b, signal);
    return new Blob([bytes], { type: pin.contentType ?? 'application/octet-stream' });
  });
  let electricalTail: Promise<unknown> = Promise.resolve();
  const readElectricalCatalog = (handle: OfflineCopyHandle, signal: AbortSignal) => run(async () => {
    const b = copy(handle), value = decode(await read(b, 'electrical-catalog', signal)) as OfflineElectricalCatalogV1;
    validateElectricalCatalog(value); return value;
  });
  const electricalCatalogPin = (catalog: OfflineElectricalCatalogV1, pin: OfflineElectricalPinV1) => catalog.buildings.some(building =>
    building.buildingId === pin.buildingId && building.documents.some(document => sameElectricalPin(document.pin, pin)));
  const readElectricalDocument = (handle: OfflineCopyHandle, pin: OfflineElectricalPinV1, signal: AbortSignal) => run(async () => {
    const b = copy(handle); need(validElectricalPin(pin)); pin = { ...pin };
    const before = decode(await read(b, 'electrical-catalog', signal)) as OfflineElectricalCatalogV1; validateElectricalCatalog(before);
    need(electricalCatalogPin(before, pin), 'missing');
    const bytes = await read(b, 'electrical-document', signal, pin);
    const after = decode(await read(b, 'electrical-catalog', signal)) as OfflineElectricalCatalogV1; validateElectricalCatalog(after);
    need(electricalCatalogPin(after, pin), 'missing'); check(b, signal);
    return new Blob([bytes], { type: pin.contentType });
  });
  return {
    subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    /** Retire borrowed UI handles on another tab's change; next read reacquires the durable witness. */
    invalidate,
    refreshCopies() { readSerial++; emit(); },
    observeActor(actorId: string | null, current: () => boolean): Promise<OfflineResult<LiveCopyActor | null>> {
      invalidate(); const admittedSerial = serial;
      if (current()) observedActor = actorId;
      return run(async () => {
        need(current() && admittedSerial === serial && !closed, 'retired');
        need(actorId === null || bounded(actorId, 1024) && actorId.length > 0);
        if (actorId === null) { await wipe(() => current() && admittedSerial === serial); changed(); return null; }
        const c = await backend.transaction(true, async tx => {
          need(current() && admittedSerial === serial && !closed, 'retired');
          const prior = await tx.get<Control>('control', 'witness');
          need(prior === undefined || controlOK(prior), 'integrity');
          if (prior?.actorId === actorId && actorId !== null) return prior!;
          const next: Control = { version: 1, epoch: crypto.randomUUID(), actorId, home: null };
          await tx.put('control', 'witness', next);
          await tx.empty('metadata'); await tx.empty('bytes'); await dropRegistrations(tx);
          need(current() && admittedSerial === serial && !closed, 'retired'); return next;
        });
        need(current() && admittedSerial === serial && !closed, 'retired'); changed();
        const token: LiveCopyActor = Object.freeze({ kind: 'online-observed-actor' });
        need(current() && admittedSerial === serial && !closed, 'retired');
        actors.set(token, { epoch: c.epoch, actorId, serial: admittedSerial, current }); return token;
      });
    },
    /** Internal non-allocating check; it mints no home/copy handle and performs no IO. */
    currentActor(actor: LiveCopyActor): boolean {
      const a = actors.get(actor); return !!a && a.serial === serial && !closed && a.current();
    },
    bindHome(actor: LiveCopyActor, scope: Scope, current: () => boolean): OfflineResult<LiveCopyHome> {
      const a = actors.get(actor);
      if (!a || a.serial !== serial || !a.current() || !current() || closed) return { status: 'retired' };
      if (!scopeOK(scope)) return { status: 'invalid' };
      const token: LiveCopyHome = Object.freeze({ kind: 'online-observed-home' });
      homes.set(token, { ...a, scope: { ...scope }, live: true, current: () => a.current() && current() }); return { status: 'ok', value: token };
    },
    keepView(handle: LiveCopyHome, view: ReadyView, signal: AbortSignal) {
      return run(async () => {
        const b = home(handle); check(b, signal); need(view.status === 'ready' && sameScope(view.scope, b.scope));
        const data = projectOfflineDisplay(view), payload = encode(data); need(payload.byteLength <= limits.viewBytes, 'limit');
        const payloadSha256 = await hash(payload); check(b, signal);
        const snapshot: OfflineViewSnapshotV1 = { version: 1, kind: 'stored-display', freshness: 'stale', actorRevision: b.epoch,
          snapshotRevision: crypto.randomUUID(), capturedAt: new Date(now()).toISOString(), payloadSha256, data,
          coverage: { entries: 'captured', geometry: 'unavailable', history: 'unavailable', topology: 'unavailable', electrical: 'unavailable', nativeCatalog: 'separate-read' } };
        const bytes = encode(snapshot); need(bytes.byteLength <= limits.viewBytes, 'limit');
        const sha = await hash(bytes); check(b, signal); const evicted = await put(b, 'view', bytes, sha, signal); check(b, signal); changed(); return { evicted };
      });
    },
    keepCatalog(handle: LiveCopyHome, catalog: OfflineCatalogV1, signal: AbortSignal) {
      return run(async () => {
        const b = home(handle); validateCatalog(catalog); const bytes = encode(catalog);
        need(bytes.byteLength <= limits.catalogBytes, 'limit'); const sha = await hash(bytes); check(b, signal);
        const evicted = await put(b, 'catalog', bytes, sha, signal); check(b, signal); changed(); return { evicted };
      });
    },
    keepDocument(handle: LiveCopyHome, pin: OfflineDocumentPinV1, input: ArrayBuffer, signal: AbortSignal) {
      return run(async () => {
        const b = home(handle); need(validOfflinePin(pin)); pin = { ...pin }; need(input instanceof ArrayBuffer && input.byteLength === pin.bytes, 'integrity');
        const bytes = new Uint8Array(input.slice(0)), sha = await hash(bytes); check(b, signal); need(sha === pin.sha256, 'integrity');
        const evicted = await put(b, 'document', bytes, sha, signal, pin); check(b, signal); changed(); return { evicted };
      });
    },
    /** Building captures are serialized in this owner; each remains independently timestamped. */
    keepElectricalCatalog(handle: LiveCopyHome, building: OfflineElectricalBuildingV1, signal: AbortSignal) {
      const captured = structuredClone(building);
      const pending = electricalTail.then(() => run(async () => {
        const b = home(handle); check(b, signal); let previous: OfflineElectricalCatalogV1 | null = null, previousSha: string | null = null;
        try { const priorBytes = await read(b, 'electrical-catalog', signal); previous = decode(priorBytes) as OfflineElectricalCatalogV1; validateElectricalCatalog(previous); previousSha = await hash(priorBytes); }
        catch (error) { if (!(error instanceof Refusal && error.status === 'missing')) throw error; }
        const value: OfflineElectricalCatalogV1 = { version: 1, capturedAt: new Date(now()).toISOString(),
          buildings: [...(previous?.buildings ?? []).filter(row => row.buildingId !== captured.buildingId), captured] };
        validateElectricalCatalog(value); const bytes = encode(value); need(bytes.byteLength <= limits.catalogBytes, 'limit');
        const sha = await hash(bytes); check(b, signal); const evicted = await put(b, 'electrical-catalog', bytes, sha, signal, undefined, previousSha);
        check(b, signal); changed(); return { evicted };
      }));
      electricalTail = pending.catch(() => undefined); return pending;
    },
    keepElectricalDocument(handle: LiveCopyHome, pin: OfflineElectricalPinV1, input: ArrayBuffer, signal: AbortSignal) {
      return run(async () => {
        const b = home(handle); need(validElectricalPin(pin)); pin = { ...pin };
        need(input instanceof ArrayBuffer && input.byteLength === electricalPinBytes(pin), 'integrity');
        const bytes = new Uint8Array(input.slice(0)), sha = await hash(bytes); check(b, signal); need(sha === pin.sha256, 'integrity');
        const evicted = await put(b, 'electrical-document', bytes, sha, signal, pin); check(b, signal); changed(); return { evicted };
      });
    },
    readElectricalCatalog,
    readElectricalDocument,
    /** Bytes must equal the measured pin; superseded rows for this association/source registration leave atomically. */
    keepHomeboxDocument(handle: LiveCopyHome, pin: OfflineHomeboxPinV1, input: ArrayBuffer, signal: AbortSignal) {
      return run(async () => {
        const b = home(handle), size = admitJson(pin, 40960);
        need(size.utf8 + size.utf16 * 2 <= 40960, 'resource');
        need(validHomeboxPin(pin)); pin = { ...pin };
        need(input instanceof ArrayBuffer && input.byteLength === pin.bytes, 'integrity');
        const bytes = new Uint8Array(input.slice(0)), sha = await hash(bytes); check(b, signal); need(sha === pin.sha256, 'integrity');
        const kept = pin, mark = registrationKey(b, kept);
        // Durable per-partition high-water inside the storage transaction: a late lower (or conflicting equal)
        // registration is refused instead of deleting newer originals. Configuration provenance only.
        const admit = async (tx: OfflineTransaction) => {
          const prior = await tx.get<Registration>('control', mark);
          need(prior === undefined || registrationOK(prior, b.epoch), 'integrity');
          if (prior) {
            need(kept.sourceRegistrationVersion >= prior.registrationVersion, 'retired');
            need(kept.sourceRegistrationVersion > prior.registrationVersion || kept.sourceRegistrationSha256 === prior.registrationSha256, 'integrity');
          }
          return {
            commit: async () => { await tx.put('control', mark, { version: 1, epoch: b.epoch, registrationVersion: kept.sourceRegistrationVersion,
              registrationSha256: kept.sourceRegistrationSha256 } satisfies Registration); },
            supersedes: (row: Row) => row.kind === 'homebox-document' && sameScope(row.scope, b.scope) && !!row.pin && (row.pin as OfflineHomeboxPinV1).sourceInstanceId === kept.sourceInstanceId
              && (row.pin as OfflineHomeboxPinV1).collectionId === kept.collectionId
              && (row.pin as OfflineHomeboxPinV1).sourceRegistrationVersion < kept.sourceRegistrationVersion,
          };
        };
        const evicted = await put(b, 'homebox-document', bytes, sha, signal, pin, undefined, admit); check(b, signal); changed(); return { evicted };
      });
    },
    readHomeboxDocument,
    readHomeboxObservation(handle: LiveCopyHome, pin: OfflineHomeboxPinV1, signal: AbortSignal) {
      return run(() => readBoundHomebox(home(handle), pin, signal));
    },
    homeboxObservationStatus(handle: LiveCopyHome, ref: OfflineHomeboxAttachmentRefV1, signal: AbortSignal) {
      return run(async () => {
        const b = home(handle); need(validHomeboxRef(ref)); const key = keyFor(b, 'homebox-document', ref);
        // Release the delivered metadata row before the exact read's own row/control stages.
        const storedPin = async () => {
          const row = await backend.transaction(false, async tx => { await fence(tx, b); return tx.get<Row>('metadata', key); });
          check(b, signal); if (!row) return null;
          admitMetadata(key, row); need(row.kind === 'homebox-document' && row.pin, 'integrity');
          return Object.freeze({ ...(row.pin as OfflineHomeboxPinV1) });
        };
        const pin = await storedPin();
        if (!pin) return { availability: 'not-held' as const, bytes: null };
        await readBoundHomebox(b, pin, signal); check(b, signal);
        return { availability: 'held' as const, bytes: pin.bytes, pin };
      });
    },
    homeboxFillSummary(handle: LiveCopyHome, signal: AbortSignal) {
      return run(async () => {
        const b = home(handle); await validatedLiveView(b, signal);
        const foldNative = async () => {
          try {
            const value = decode(await read(b, 'catalog', signal)) as OfflineCatalogV1;
            admitJson(value, limits.catalogBytes); validateCatalog(value);
            let total = 0;
            for (const row of value.documents) if (row.lifecycle === 'active') { total += row.bytes; need(Number.isSafeInteger(total), 'integrity'); }
            return total;
          } catch (error) { if (error instanceof Refusal && error.status === 'missing') return 0; throw error; }
        };
        const nativeBytes = await foldNative();
        const foldElectrical = async () => {
          try {
            const value = decode(await read(b, 'electrical-catalog', signal)) as OfflineElectricalCatalogV1;
            admitJson(value, limits.catalogBytes); validateElectricalCatalog(value);
            let total = 0;
            for (const building of value.buildings) for (const document of building.documents) {
              total += electricalPinBytes(document.pin); need(Number.isSafeInteger(total), 'integrity');
            }
            return total;
          } catch (error) { if (error instanceof Refusal && error.status === 'missing') return 0; throw error; }
        };
        const electricalBytes = await foldElectrical(); check(b, signal);
        return { nativeBytes, electricalBytes, budgetBytes: limits.bytes };
      });
    },
    homeboxStatus(handle: OfflineCopyHandle, ref: OfflineHomeboxAttachmentRefV1, signal: AbortSignal): Promise<OfflineResult<OfflineHomeboxAvailability>> {
      return run(async () => {
        const b = copy(handle); need(validHomeboxRef(ref)); const key = keyFor(b, 'homebox-document', ref);
        const row = await backend.transaction(false, async tx => { await fence(tx, b); return tx.get<Row>('metadata', key); });
        check(b, signal);
        if (!row) return { availability: 'not-held', bytes: null };
        need(rowOK(row) && row.kind === 'homebox-document' && row.epoch === b.epoch, 'integrity');
        const pin = { ...(row.pin as OfflineHomeboxPinV1) };
        // The stored pin must name exactly the requested association; a row under another key never stands in.
        if (homeboxAssociation(pin).join('\n') !== homeboxAssociation(ref).join('\n')) return { availability: 'failed-integrity', bytes: null };
        const result = await readHomeboxDocument(handle, pin, signal);
        if (result.status === 'integrity') return { availability: 'failed-integrity', bytes: pin.bytes };
        if (result.status === 'missing') return { availability: 'not-held', bytes: null };
        if (result.status !== 'ok') throw new Refusal(result.status);
        return { availability: 'held', bytes: pin.bytes, pin };
      });
    },
    electricalStatus(handle: OfflineCopyHandle, pin: OfflineElectricalPinV1, signal: AbortSignal): Promise<OfflineResult<OfflineElectricalAvailability>> {
      return run(async () => {
        need(validElectricalPin(pin)); const result = await readElectricalDocument(handle, pin, signal), bytes = electricalPinBytes(pin);
        if (result.status === 'integrity') return { availability: 'failed-integrity', bytes };
        if (result.status === 'missing') return { availability: 'not-held', bytes };
        if (result.status !== 'ok') throw new Refusal(result.status);
        return { availability: 'held', bytes, pin: { ...pin } };
      });
    },
    readLast(signal: AbortSignal) {
      return run(async () => {
        check(undefined, signal); const initialSerial = readSerial;
        const c = await backend.transaction(false, tx => tx.get<Control>('control', 'witness'));
        check(undefined, signal); need(initialSerial === readSerial, 'retired');
        need(c !== undefined, observedActor === undefined ? 'missing' : 'retired'); need(controlOK(c), 'integrity');
        need(observedActor === undefined || c!.actorId === observedActor, 'retired'); need(c!.actorId !== null && c!.home !== null, 'retired');
        const b: Binding = { epoch: c!.epoch, actorId: c!.actorId!, scope: { ...c!.home! }, serial: readSerial, live: false, current: () => true };
        let bytes: Uint8Array<ArrayBuffer>;
        try { bytes = await read(b, 'view', signal); } catch (error) {
          if (error instanceof Refusal && error.status === 'missing') throw new Refusal('retired'); throw error;
        }
        const value = decode(bytes) as OfflineViewSnapshotV1;
        need(exactKeys(value, 'actorRevision,capturedAt,coverage,data,freshness,kind,payloadSha256,snapshotRevision,version')
          && value.version === 1 && value.kind === 'stored-display' && value.freshness === 'stale'
          && value.actorRevision === b.epoch && UUID.test(value.snapshotRevision) && Number.isFinite(Date.parse(value.capturedAt))
          && SHA.test(value.payloadSha256) && sameScope(value.data.scope, b.scope), 'integrity');
        const projection = projectOfflineDisplay({ ...value.data, now: value.data.sourceNow });
        need(JSON.stringify(projection) === JSON.stringify(value.data) && await hash(encode(projection)) === value.payloadSha256, 'integrity');
        need(JSON.stringify(value.coverage) === JSON.stringify({ entries: 'captured', geometry: 'unavailable', history: 'unavailable',
          topology: 'unavailable', electrical: 'unavailable', nativeCatalog: 'separate-read' }), 'integrity');
        await backend.transaction(false, tx => fence(tx, b)); check(b, signal);
        const handle: OfflineCopyHandle = Object.freeze({ kind: 'stored-copy' }); copies.set(handle, b);
        return { handle, snapshot: value };
      });
    },
    readCatalog(handle: OfflineCopyHandle, signal: AbortSignal) {
      return run(async () => { const b = copy(handle); const bytes = await read(b, 'catalog', signal);
        const value = decode(bytes) as OfflineCatalogV1; validateCatalog(value); return value; });
    },
    readDocument,
    copyIdentity(handle: OfflineCopyHandle, signal: AbortSignal) {
      return run(async () => { const b = copy(handle); check(b, signal);
        await backend.transaction(false, tx => fence(tx, b)); check(b, signal);
        return { actorId: b.actorId, actorRevision: b.epoch, scope: { ...b.scope } };
      });
    },
    documentStatus(handle: OfflineCopyHandle, reference: OfflineDocumentReferenceV1, signal: AbortSignal): Promise<OfflineResult<OfflineDocumentAvailability>> {
      return run(async () => {
        const b = copy(handle);
        need(reference && UUID.test(reference.documentId) && UUID.test(reference.assetId) && SHA.test(reference.sha256)
          && Number.isSafeInteger(reference.documentRevision) && reference.documentRevision > 0
          && Number.isSafeInteger(reference.assetRevision) && reference.assetRevision > 0
          && Number.isSafeInteger(reference.bytes) && reference.bytes > 0 && reference.bytes <= LIVE_COPY_LIMITS.entryBytes);
        const ref = { ...reference };
        const matches = await backend.transaction(false, async tx => {
          await fence(tx, b); const rows: { value: Row }[] = [];
          await tx.scan('metadata', limits.rows, (key, value) => {
            check(b, signal); admitMetadata(key, value); const row = value;
            const p = row.pin as OfflineDocumentPinV1 | undefined;
            const matched = row.kind === 'document' && row.epoch === b.epoch && sameScope(row.scope, b.scope) && p
              && p.documentId === ref.documentId && p.documentRevision === ref.documentRevision && p.assetId === ref.assetId
              && p.assetRevision === ref.assetRevision && p.sha256 === ref.sha256 && p.bytes === ref.bytes;
            if (matched) { need(rows.length === 0, 'integrity'); rows.push({ value: row }); }
          });
          return rows;
        });
        check(b, signal);
        if (!matches.length) return { availability: 'not-held', bytes: ref.bytes };
        need(matches.length === 1 && matches[0]!.value.pin, 'integrity');
        const pin = { ...matches[0]!.value.pin! }, result = await readDocument(handle, pin as OfflineDocumentPinV1, signal);
        if (result.status === 'integrity') return { availability: 'failed-integrity', bytes: ref.bytes };
        if (result.status === 'missing') return { availability: 'not-held', bytes: ref.bytes };
        if (result.status !== 'ok') throw new Refusal(result.status);
        check(b, signal); return { availability: 'held', bytes: (pin as OfflineDocumentPinV1).bytes, pin: pin as OfflineDocumentPinV1 };
      });
    },
    removeDocument(handle: LiveCopyHome, pin: OfflineDocumentPinV1, signal: AbortSignal) {
      return run(async () => { const b = home(handle); need(validOfflinePin(pin)); pin = { ...pin }; const key = keyFor(b, 'document', pin);
        await backend.transaction(true, async tx => { await fence(tx, b); check(b, signal);
          await tx.remove('metadata', key); await tx.remove('bytes', key); check(b, signal); }); changed(); return null; });
    },
    status(signal: AbortSignal) {
      return run(async (): Promise<OfflineStorageStatus> => {
        check(undefined, signal);
        let bytes = 0, documents = 0;
        await backend.transaction(false, tx => tx.scan('metadata', limits.rows, (key, row) => {
          check(undefined, signal); admitMetadata(key, row); bytes += row.bytes;
          need(Number.isSafeInteger(bytes), 'integrity'); if (documentKind(row.kind)) documents++;
        }));
        const [estimate, persisted] = options.storage ? await Promise.all([options.storage.estimate(), options.storage.persisted()])
          : [null, null];
        check(undefined, signal);
        return { bytes, documents,
          budgetBytes: limits.bytes, estimatedUsage: estimate?.usage ?? null, estimatedQuota: estimate?.quota ?? null,
          persistence: persisted === null ? 'unsupported' : persisted ? 'granted' : 'not-granted' };
      });
    },
    requestPersistence(signal: AbortSignal) {
      return run(async () => { check(undefined, signal); if (!options.storage) return 'unsupported' as const;
        const granted = await options.storage.persist(); check(undefined, signal); return granted ? 'granted' as const : 'not-granted' as const; });
    },
    clear() {
      invalidate(); observedActor = null; const clearingSerial = serial;
      return run(async () => {
        // Commit the tombstone before deletion: a failed second phase cannot resurrect old handles on reload.
        await wipe(() => clearingSerial === serial);
        changed(); return null;
      });
    },
    close() { invalidate(); closed = true; backend.close(); listeners.clear(); },
  };
}
function validateCatalog(catalog: OfflineCatalogV1): void {
  closed(catalog, 'version,capturedAt,completeness,documents');
  need(catalog?.version === 1 && Number.isFinite(Date.parse(catalog.capturedAt))
    && ['captured-pages', 'captured-complete'].includes(catalog.completeness) && Array.isArray(catalog.documents)
    && catalog.documents.length <= LIVE_COPY_LIMITS.documents);
  const ids = new Set<string>();
  for (const row of catalog.documents) {
    closed(row, 'documentId,documentRevision,assetId,assetRevision,sha256,bytes,title,lifecycle,recordedAvailability');
    need(UUID.test(row.documentId) && UUID.test(row.assetId) && Number.isSafeInteger(row.documentRevision) && row.documentRevision > 0
      && Number.isSafeInteger(row.assetRevision) && row.assetRevision > 0 && SHA.test(row.sha256) && Number.isSafeInteger(row.bytes)
      && row.bytes > 0 && row.bytes <= LIVE_COPY_LIMITS.entryBytes && bounded(row.title, 4096)
      && ['active', 'tombstoned'].includes(row.lifecycle)
      && ['available', 'unavailable', 'access-revoked', 'stale', 'quarantined'].includes(row.recordedAvailability) && !ids.has(row.documentId));
    ids.add(row.documentId);
    need(exactKeys(row, 'documentId,documentRevision,title,lifecycle,assetId,assetRevision,sha256,bytes,recordedAvailability'));
  }
  need(exactKeys(catalog, 'capturedAt,completeness,documents,version'));
}

/** Positive integral JSON decimal, retaining its lexical token without rounding. */
function positiveDecimal(token: string): boolean {
  if (typeof token !== 'string' || token.length > 4096) return false;
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
  if (!match) return false;
  const digits = (match[1]! + (match[2] ?? '')).replace(/^0+/, '');
  const exponent = Number(match[3] ?? '0');
  if (!digits || !Number.isSafeInteger(exponent) || Math.abs(exponent) > 4096) return false;
  const shift = exponent - (match[2]?.length ?? 0);
  return shift >= 0 || -shift <= digits.length && digits.endsWith('0'.repeat(-shift));
}
export function electricalPinBytes(pin: OfflineElectricalPinV1): number { return Number(pin.byteSize); }
export function validElectricalPin(pin: OfflineElectricalPinV1): boolean {
  return !!pin && pin.source === 'electrical-evidence' && UUID.test(pin.buildingId) && UUID.test(pin.evidenceId)
    && Number.isSafeInteger(pin.evidenceRevision) && pin.evidenceRevision > 0 && UUID.test(pin.assetId)
    && positiveDecimal(pin.assetRevision) && positiveDecimal(pin.byteSize) && SHA.test(pin.sha256)
    && Number.isSafeInteger(electricalPinBytes(pin)) && electricalPinBytes(pin) > 0 && electricalPinBytes(pin) <= LIVE_COPY_LIMITS.entryBytes
    && pin.contentType === 'application/pdf' && exactKeys(pin,
      'assetId,assetRevision,buildingId,byteSize,contentType,evidenceId,evidenceRevision,sha256,source');
}
function sameElectricalPin(a: OfflineElectricalPinV1, b: OfflineElectricalPinV1): boolean {
  return validElectricalPin(a) && validElectricalPin(b) && a.source === b.source && a.buildingId === b.buildingId
    && a.evidenceId === b.evidenceId && a.evidenceRevision === b.evidenceRevision && a.assetId === b.assetId
    && a.assetRevision === b.assetRevision && a.byteSize === b.byteSize && a.sha256 === b.sha256 && a.contentType === b.contentType;
}
function exactKeys(value: object, keys: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = keys.split(','); let count = 0;
  for (const key in value) if (!Object.prototype.hasOwnProperty.call(value, key) || ++count > allowed.length || !allowed.includes(key)) return false;
  return count === allowed.length;
}
function validateElectricalCatalog(value: OfflineElectricalCatalogV1): void {
  closed(value, 'version,capturedAt,buildings');
  need(value?.version === 1 && Number.isFinite(Date.parse(value.capturedAt)) && Array.isArray(value.buildings)
    && value.buildings.length <= 256 && exactKeys(value, 'buildings,capturedAt,version'));
  const buildings = new Set<string>(); let count = 0;
  for (const building of value.buildings) {
    need(UUID.test(building.buildingId) && !buildings.has(building.buildingId) && Number.isFinite(Date.parse(building.capturedAt))
      && Array.isArray(building.documents) && exactKeys(building, 'buildingId,capturedAt,documents,provenance'));
    buildings.add(building.buildingId); const ids = new Set<string>();
    if (building.provenance !== null) {
      const p = building.provenance;
      need(exactKeys(p, 'currentNativeRoomReview,fixtureLedgerSha256,historicalRoomMappingReceipt,supportOriginalSha256')
        && SHA.test(p.fixtureLedgerSha256) && SHA.test(p.supportOriginalSha256));
      for (const receipt of [p.historicalRoomMappingReceipt, p.currentNativeRoomReview])
        need(exactKeys(receipt, 'id,sha256') && bounded(receipt.id, 4096) && receipt.id.length > 0 && SHA.test(receipt.sha256));
    }
    for (const document of building.documents) {
      count++; need(count <= LIVE_COPY_LIMITS.documents && exactKeys(document, 'pages,pin') && validElectricalPin(document.pin)
        && document.pin.buildingId === building.buildingId && !ids.has(document.pin.evidenceId)
        && Array.isArray(document.pages) && document.pages.length > 0 && document.pages.length <= 2048);
      ids.add(document.pin.evidenceId); const pages = new Set<string>();
      for (const page of document.pages) {
        need(exactKeys(page, 'correlationId,correlationSha256,originalPhotoSha256,pdfPage,renderedPhotoSha256,sheetId,sourceDate,title')
          && bounded(page.sheetId, 4096) && page.sheetId.length > 0 && !pages.has(page.sheetId) && bounded(page.title, 4096)
          && Number.isSafeInteger(page.pdfPage) && page.pdfPage > 0 && (page.sourceDate === null || bounded(page.sourceDate, 256))
          && bounded(page.correlationId, 4096) && page.correlationId.length > 0 && SHA.test(page.correlationSha256)
          && SHA.test(page.originalPhotoSha256) && SHA.test(page.renderedPhotoSha256));
        pages.add(page.sheetId);
      }
    }
  }
}

/** Matches the existing 10 MiB HomeBox capture bound; offline storage does not enlarge it. */
export const HOMEBOX_ORIGINAL_MAX_BYTES = 10_485_760;
const RFC3339 = /^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]+)?(?:[Zz]|[+-][0-9]{2}:[0-9]{2})$/;
const homeboxText = (value: unknown, cap: number): value is string => bounded(value, cap) && value.length > 0;
function homeboxAssociation(ref: OfflineHomeboxAttachmentRefV1): string[] {
  return [ref.source, ref.sourceInstanceId, ref.collectionId, ref.entityId, ref.attachmentId];
}
export function validHomeboxRef(ref: OfflineHomeboxAttachmentRefV1): boolean {
  return !!ref && ref.source === 'homebox-attachment' && UUID.test(ref.sourceInstanceId) && homeboxText(ref.collectionId, 4096)
    && UUID.test(ref.entityId) && UUID.test(ref.attachmentId);
}
export function validHomeboxPin(pin: OfflineHomeboxPinV1): boolean {
  return validHomeboxRef(pin) && UUID.test(pin.observationId) && Number.isSafeInteger(pin.sourceRegistrationVersion)
    && pin.sourceRegistrationVersion >= 0 && SHA.test(pin.sourceRegistrationSha256) && SHA.test(pin.sha256)
    && Number.isSafeInteger(pin.bytes) && pin.bytes > 0 && pin.bytes <= HOMEBOX_ORIGINAL_MAX_BYTES
    && (pin.contentType === null || pin.contentType === 'application/pdf')
    && (pin.sourceContentType === null || bounded(pin.sourceContentType, 4096))
    && [pin.beforeRetrievedAt, pin.bodyRetrievedAt, pin.afterRetrievedAt].every(time => typeof time === 'string' && RFC3339.test(time))
    && exactKeys(pin, 'afterRetrievedAt,attachmentId,beforeRetrievedAt,bodyRetrievedAt,bytes,collectionId,contentType,entityId,observationId,sha256,source,sourceContentType,sourceInstanceId,sourceRegistrationSha256,sourceRegistrationVersion');
}
function sameHomeboxPin(a: OfflineHomeboxPinV1, b: OfflineHomeboxPinV1): boolean {
  return validHomeboxPin(a) && validHomeboxPin(b) && (Object.keys(a) as (keyof OfflineHomeboxPinV1)[]).every(key => a[key] === b[key]);
}
/** Exact source-native identity in held display data; no title, filename or UUID coincidence join. */
export function listsAttachment(data: Readonly<{ entries: readonly Readonly<{ source: Readonly<Pick<HeldDisplay['entries'][number]['source'], 'sourceInstanceId' | 'collectionId' | 'sourceKind' | 'externalId'>>;
  attachments: readonly Readonly<{ kind: string; attachmentId: string }>[] }>[] }>, ref: OfflineHomeboxAttachmentRefV1): boolean {
  return data.entries.some(entry => entry.source?.sourceKind === 'homebox-entity'
    && entry.source.sourceInstanceId === ref.sourceInstanceId && entry.source.collectionId === ref.collectionId
    && entry.source.externalId === ref.entityId
    && entry.attachments.some(attachment => attachment.kind === 'stored-file' && attachment.attachmentId === ref.attachmentId));
}
interface Registration { version: 1; epoch: string; registrationVersion: number; registrationSha256: string }
const REGISTRATION = 'homebox-registration';
const registrationKey = (b: Pick<Binding, 'epoch' | 'scope'>, ref: OfflineHomeboxAttachmentRefV1) =>
  JSON.stringify([REGISTRATION, b.epoch, b.scope.workspaceId, b.scope.homeId, ref.sourceInstanceId, ref.collectionId]);
function registrationOK(value: Registration, epoch: string): boolean {
  return exactKeys(value, 'epoch,registrationSha256,registrationVersion,version') && value.version === 1 && value.epoch === epoch
    && Number.isSafeInteger(value.registrationVersion) && value.registrationVersion >= 0 && SHA.test(value.registrationSha256);
}
/** Registration marks live beside the witness in control; account change and clear remove them with the data. */
async function dropRegistrations(tx: OfflineTransaction): Promise<void> {
  await tx.scan('control', LIVE_COPY_LIMITS.rows + 1, async (key, value) => {
    need(key.length <= 32768, 'resource'); const size = admitJson(value, 65536);
    need(stringPayload(key) + size.utf8 + size.utf16 * 2 <= 65536, 'resource');
    if (key.startsWith(`["${REGISTRATION}"`)) await tx.remove('control', key);
  });
}
