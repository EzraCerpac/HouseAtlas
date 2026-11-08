import type { ReadyView, Scope } from '../app/types';
import type { OfflineBackend, OfflineTransaction, OfflineResult, OfflineFailure, OfflineDisplayData,
  OfflineElectricalPinV1, OfflineElectricalAvailability, OfflineElectricalBuildingV1, OfflineElectricalCatalogV1, OfflineViewSnapshotV1, OfflineDocumentPinV1, OfflineDocumentReferenceV1, OfflineDocumentAvailability, OfflineCatalogV1, OfflineCopyHandle, OfflineStorageStatus } from './live-copy-types';

const MiB = 1024 * 1024;
export const LIVE_COPY_LIMITS = Object.freeze({ bytes: 250 * MiB, entryBytes: 128 * MiB,
  viewBytes: 8 * MiB, catalogBytes: 2 * MiB, documents: 2048, rows: 2056 });
const SHA = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MIMES = new Set(['application/pdf', 'application/geo+json', 'application/city+json',
  'application/json', 'image/tiff', 'image/png']);
class Refusal extends Error { readonly status: OfflineFailure; constructor(status: OfflineFailure) { super(status); this.status = status; } }
const need = (value: unknown, status: OfflineFailure = 'invalid') => { if (!value) throw new Refusal(status); };
const bounded = (s: unknown, cap = 65536): s is string => typeof s === 'string' && s.length <= cap;
const scopeOK = (s: Scope) => s && UUID.test(s.workspaceId) && UUID.test(s.homeId);
const sameScope = (a: Scope, b: Scope) => a.workspaceId === b.workspaceId && a.homeId === b.homeId;
const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const decode = (b: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)) as unknown;
const hash = async (b: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))]
  .map(v => v.toString(16).padStart(2, '0')).join('');
function pick<T extends object>(value: T, keys: readonly (keyof T)[]): T {
  need(value && typeof value === 'object' && !Array.isArray(value));
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]])) as T;
}
/** Explicit field projection. URLs, native links, service flags and edit authority never survive. */
export function projectOfflineDisplay(view: Pick<OfflineDisplayData, 'scope' | 'homeLabel' | 'entries' | 'caches'> & { readonly now: string }): OfflineDisplayData {
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
interface Row { version: 1; epoch: string; scope: Scope; kind: 'view' | 'catalog' | 'document' | 'electrical-catalog' | 'electrical-document';
  bytes: number; sha256: string; usedAt: number; pin?: OfflineDocumentPinV1 | OfflineElectricalPinV1 }
export interface LiveCopyActor { readonly kind: 'online-observed-actor' }
export interface LiveCopyHome { readonly kind: 'online-observed-home' }
export function validOfflinePin(pin: OfflineDocumentPinV1): boolean {
  return !!pin && UUID.test(pin.documentId) && UUID.test(pin.assetId) && Number.isSafeInteger(pin.documentRevision)
    && pin.documentRevision > 0 && Number.isSafeInteger(pin.assetRevision) && pin.assetRevision > 0
    && SHA.test(pin.sha256) && Number.isSafeInteger(pin.bytes) && pin.bytes > 0
    && pin.bytes <= LIVE_COPY_LIMITS.entryBytes && MIMES.has(pin.contentType)
    && Object.keys(pin).sort().join(',') === 'assetId,assetRevision,bytes,contentType,documentId,documentRevision,sha256';
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
    && ['view', 'catalog', 'document', 'electrical-catalog', 'electrical-document'].includes(row.kind) && Number.isSafeInteger(row.bytes) && row.bytes > 0
    && row.bytes <= (row.kind === 'view' ? LIVE_COPY_LIMITS.viewBytes : row.kind === 'catalog' || row.kind === 'electrical-catalog' ? LIVE_COPY_LIMITS.catalogBytes : LIVE_COPY_LIMITS.entryBytes) && SHA.test(row.sha256) && Number.isFinite(row.usedAt)
    && (row.kind !== 'document' || !!row.pin && validOfflinePin(row.pin as OfflineDocumentPinV1) && row.pin.sha256 === row.sha256 && (row.pin as OfflineDocumentPinV1).bytes === row.bytes)
    && (row.kind !== 'electrical-document' || !!row.pin && validElectricalPin(row.pin as OfflineElectricalPinV1) && row.pin.sha256 === row.sha256 && electricalPinBytes(row.pin as OfflineElectricalPinV1) === row.bytes);
}
type StoredPin = OfflineDocumentPinV1 | OfflineElectricalPinV1;
const keyFor = (b: Binding, kind: string, pin?: StoredPin) => JSON.stringify([b.epoch, b.scope.workspaceId, b.scope.homeId, kind,
  ...(pin ? 'source' in pin ? [pin.source, pin.buildingId, pin.evidenceId, pin.evidenceRevision, pin.assetId, pin.assetRevision, pin.sha256, pin.byteSize, pin.contentType]
    : [pin.documentId, pin.documentRevision, pin.assetId, pin.assetRevision, pin.sha256, pin.bytes, pin.contentType] : [])]);
const documentKind = (kind: Row['kind']) => kind === 'document' || kind === 'electrical-document';
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
      : (error as { name?: string })?.name === 'OfflineCommitUnknown' ? 'uncertain'
      : (error as { name?: string })?.name === 'QuotaExceededError' ? 'quota' : 'unavailable' }; }
  };
  const fence = async (tx: OfflineTransaction, b: Binding) => {
    check(b); const c = await tx.get<Control>('control', 'witness');
    need(controlOK(c) && c.epoch === b.epoch && c.actorId === b.actorId, 'retired'); check(b); return c;
  };
  const put = async (b: Binding, kind: Row['kind'], bytes: Uint8Array<ArrayBuffer>, sha256: string, signal: AbortSignal,
    pin?: StoredPin, expectedSha256?: string | null): Promise<number> => {
    check(b, signal); need(bytes.byteLength > 0 && bytes.byteLength <= limits.entryBytes, 'limit'); const key = keyFor(b, kind, pin);
    return backend.transaction(true, async tx => {
      const c = await fence(tx, b); check(b, signal);
      const rows = await tx.list<Row>('metadata'); need(rows.length <= limits.rows, 'integrity');
      need(rows.every(r => rowOK(r.value) && r.value.epoch === b.epoch), 'integrity');
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
      const row: Row = { version: 1, epoch: b.epoch, scope: b.scope, kind, bytes: bytes.byteLength, sha256, usedAt: now(),
        ...(pin ? { pin: { ...pin } } : {}) };
      await tx.put('bytes', key, bytes.slice().buffer); await tx.put('metadata', key, row);
      if (kind === 'view') await tx.put('control', 'witness', { ...c, home: b.scope });
      check(b, signal); return evicted;
    });
  };
  const read = async (b: Binding, kind: Row['kind'], signal: AbortSignal, pin?: StoredPin) => {
    check(b, signal); const key = keyFor(b, kind, pin);
    const value = await backend.transaction(true, async tx => {
      await fence(tx, b); const row = await tx.get<Row>('metadata', key), bytes = await tx.get<ArrayBuffer>('bytes', key);
      need(row && bytes, 'missing'); need(rowOK(row!) && row!.epoch === b.epoch && sameScope(row!.scope, b.scope)
        && row!.kind === kind && bytes instanceof ArrayBuffer && bytes.byteLength === row!.bytes, 'integrity');
      if (pin) need(row!.pin && ('source' in pin ? sameElectricalPin(row!.pin as OfflineElectricalPinV1, pin) : samePin(row!.pin as OfflineDocumentPinV1, pin)), 'integrity');
      await tx.put('metadata', key, { ...row, usedAt: now() }); check(b, signal);
      return { row: row!, bytes: new Uint8Array(bytes!) };
    });
    const digest = await hash(value.bytes); check(b, signal); need(digest === value.row.sha256, 'integrity');
    await backend.transaction(false, async tx => { await fence(tx, b); const latest = await tx.get<Row>('metadata', key);
      need(latest && rowOK(latest) && latest.sha256 === value.row.sha256 && latest.bytes === value.row.bytes, 'missing'); });
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
      await tx.empty('metadata'); await tx.empty('bytes'); need(current() && !closed, 'retired');
    });
  };
  const readDocument = (handle: OfflineCopyHandle, pin: OfflineDocumentPinV1, signal: AbortSignal) => {
      return run(async () => { const b = copy(handle); need(validOfflinePin(pin)); pin = { ...pin }; const before = decode(await read(b, 'catalog', signal)) as OfflineCatalogV1; validateCatalog(before); need(catalogPin(before, pin), 'missing');
        const bytes = await read(b, 'document', signal, pin);
        const after = decode(await read(b, 'catalog', signal)) as OfflineCatalogV1; validateCatalog(after); need(catalogPin(after, pin), 'missing');
        check(b, signal); return new Blob([bytes], { type: pin.contentType }); });
  };
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
          await tx.empty('metadata'); await tx.empty('bytes');
          need(current() && admittedSerial === serial && !closed, 'retired'); return next;
        });
        need(current() && admittedSerial === serial && !closed, 'retired'); changed();
        const token: LiveCopyActor = Object.freeze({ kind: 'online-observed-actor' });
        need(current() && admittedSerial === serial && !closed, 'retired');
        actors.set(token, { epoch: c.epoch, actorId, serial: admittedSerial, current }); return token;
      });
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
        need(Object.keys(value).sort().join(',') === 'actorRevision,capturedAt,coverage,data,freshness,kind,payloadSha256,snapshotRevision,version'
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
          await fence(tx, b); const rows = await tx.list<Row>('metadata'); need(rows.length <= limits.rows, 'integrity');
          return rows.filter(({ value: row }) => {
            need(rowOK(row), 'integrity');
            const p = row.pin as OfflineDocumentPinV1 | undefined;
            return row.kind === 'document' && row.epoch === b.epoch && sameScope(row.scope, b.scope) && p
              && p.documentId === ref.documentId && p.documentRevision === ref.documentRevision && p.assetId === ref.assetId
              && p.assetRevision === ref.assetRevision && p.sha256 === ref.sha256 && p.bytes === ref.bytes;
          });
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
        const rows = await backend.transaction(false, tx => tx.list<Row>('metadata'));
        need(rows.length <= LIVE_COPY_LIMITS.rows && rows.every(r => rowOK(r.value)), 'integrity');
        const [estimate, persisted] = options.storage ? await Promise.all([options.storage.estimate(), options.storage.persisted()])
          : [null, null];
        check(undefined, signal);
        return { bytes: rows.reduce((sum, r) => sum + r.value.bytes, 0), documents: rows.filter(r => documentKind(r.value.kind)).length,
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
  need(catalog?.version === 1 && Number.isFinite(Date.parse(catalog.capturedAt))
    && ['captured-pages', 'captured-complete'].includes(catalog.completeness) && Array.isArray(catalog.documents)
    && catalog.documents.length <= LIVE_COPY_LIMITS.documents);
  const ids = new Set<string>();
  for (const row of catalog.documents) {
    need(UUID.test(row.documentId) && UUID.test(row.assetId) && Number.isSafeInteger(row.documentRevision) && row.documentRevision > 0
      && Number.isSafeInteger(row.assetRevision) && row.assetRevision > 0 && SHA.test(row.sha256) && Number.isSafeInteger(row.bytes)
      && row.bytes > 0 && row.bytes <= LIVE_COPY_LIMITS.entryBytes && bounded(row.title, 4096)
      && ['active', 'tombstoned'].includes(row.lifecycle)
      && ['available', 'unavailable', 'access-revoked', 'stale', 'quarantined'].includes(row.recordedAvailability) && !ids.has(row.documentId));
    ids.add(row.documentId);
    need(Object.keys(row).sort().join(',') === ['documentId', 'documentRevision', 'title', 'lifecycle', 'assetId',
      'assetRevision', 'sha256', 'bytes', 'recordedAvailability'].sort().join(','));
  }
  need(Object.keys(catalog).sort().join(',') === 'capturedAt,completeness,documents,version');
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
    && pin.contentType === 'application/pdf' && Object.keys(pin).sort().join(',') ===
      'assetId,assetRevision,buildingId,byteSize,contentType,evidenceId,evidenceRevision,sha256,source';
}
function sameElectricalPin(a: OfflineElectricalPinV1, b: OfflineElectricalPinV1): boolean {
  return validElectricalPin(a) && validElectricalPin(b) && a.source === b.source && a.buildingId === b.buildingId
    && a.evidenceId === b.evidenceId && a.evidenceRevision === b.evidenceRevision && a.assetId === b.assetId
    && a.assetRevision === b.assetRevision && a.byteSize === b.byteSize && a.sha256 === b.sha256 && a.contentType === b.contentType;
}
function exactKeys(value: object, keys: string): boolean { return !!value && Object.keys(value).sort().join(',') === keys; }
function validateElectricalCatalog(value: OfflineElectricalCatalogV1): void {
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
