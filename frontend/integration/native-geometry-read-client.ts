import { scheduleSessionExpiry } from './session-expiry';
import { ExactDecimal, isExactDecimal } from '../src/numeric/decimal';
import { MESH_LIMITS, MESH_PROFILE } from '../src/lantern/scans/mesh-profile';
import { IFC_GLB_MIME, IFC_GLB_PROFILE } from '../src/lantern/scans/ifc-glb-profile';
import type { ScanFloor, ScanMeshDelivery, ScanMeshReadPort } from '../src/lantern/scans/mesh-profile';
import type { NativeGeometryScanCache } from './native-geometry-scan-cache';
import type {
  NativeGeometryBinding, NativeGeometryDescriptor, NativeGeometryFloor, NativeGeometryFrame,
  NativeGeometryLicense, NativeGeometryLoadOptions, NativeGeometryOffer, NativeGeometryReadClient, NativeScanFloor,
} from '../src/lantern/scans/native-read-types';

export interface NativeGeometryReadOptions {
  getBinding: () => NativeGeometryBinding | null;
  /** Host must notify every binding replacement/gap synchronously. */
  subscribeBinding: (changed: () => void) => () => void;
  /** Actual browser origin, supplied by the private host. */
  origin: string;
  transport?: typeof fetch;
  /** Opt-in page-memory reuse of verified mesh bytes; absent, every mesh is read
   * afresh. `sessionPresent` distinguishes a home-view reload gap, which keeps
   * the bytes, from sign-out or a session check, which drops them. `persist`
   * also stores verified bytes across page loads for the binding's actor and
   * home; it is consulted only for a fresh descriptor's exact offer. */
  retainMeshes?: { readonly sessionPresent: () => boolean; readonly persist?: () => Promise<NativeGeometryScanCache> };
}

export const NATIVE_GEOMETRY_READ_LIMITS = Object.freeze({
  descriptorBytes: 1024 * 1024, floors: 64, depth: 8, nodes: 4096,
  stringLength: 4096, numberLength: 20, headerBytes: 8192, chunks: 8192, requests: 2, readMs: 15000,
});
/** Page-memory mesh retention: one session/home partition. */
export const NATIVE_GEOMETRY_RETAINED_LIMITS = Object.freeze({ entries: 6, bytes: 3 * MESH_LIMITS.bytes });
/** Total optional-cache wait, leaving the reader's deadline for server reads. */
export const NATIVE_GEOMETRY_CACHE_READ_MS = 500;
const MESH_MIME = 'application/vnd.houseatlas.magicplan-authored-mesh+json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const MAX_TIMER = 2_147_483_647;
const U64_MAX = ExactDecimal.parse('18446744073709551615');
type Json = null | boolean | string | ExactDecimal | Json[] | { [key: string]: Json };
type Row = { [key: string]: Json };

export class NativeGeometryReadError extends Error {
  constructor(readonly status: number | null = null) {
    super('Native geometry is unavailable for the current view');
    this.name = 'NativeGeometryReadError';
  }
}
function need(condition: unknown): asserts condition {
  if (!condition) throw new NativeGeometryReadError();
}
function object(value: Json | undefined, fields: readonly string[]): Row {
  need(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value));
  need(Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)));
  return value;
}
function text(value: Json | undefined): string {
  need(typeof value === 'string' && value.length > 0 && value.length <= NATIVE_GEOMETRY_READ_LIMITS.stringLength);
  return value;
}
function uuid(value: Json | undefined): string { const result = text(value); need(UUID.test(result)); return result; }
function sha(value: Json | undefined): string { const result = text(value); need(SHA.test(result)); return result; }
function revision(value: Json | undefined): ExactDecimal {
  need(isExactDecimal(value) && /^[1-9][0-9]{0,19}$/.test(value.token) && value.compare(U64_MAX) <= 0);
  return value;
}
function license(value: Json | undefined): NativeGeometryLicense {
  const row = object(value, ['status', 'reference']);
  need(row.status === 'unknown' || row.status === 'permitted' || row.status === 'restricted');
  return Object.freeze({ status: row.status, reference: row.reference === null ? null : text(row.reference) });
}
function buildingPath(scope: Readonly<NativeGeometryBinding['scope']>, buildingId: string): string {
  return `/api/atlas/geometry/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/buildings/${buildingId}`;
}

/** Native descriptor only. Reject duplicates before a closed shape is decoded.
 * Bounded string-token JSON.parse never parses the response graph or numbers. */
async function decodeJson(bytes: Uint8Array, signal: AbortSignal, deadline: number): Promise<Json> {
  need(bytes.byteLength <= NATIVE_GEOMETRY_READ_LIMITS.descriptorBytes);
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  let offset = 0, nodes = 0;
  const checkpoint = async () => {
    signal.throwIfAborted(); need(performance.now() < deadline);
    if (nodes % 256 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
  };
  const space = () => { while (offset < source.length && ' \r\n\t'.includes(source[offset]!)) offset++; };
  const string = (): string => {
    need(source[offset] === '"'); const start = offset++;
    let escaped = false;
    while (offset < source.length) {
      const character = source[offset++]!;
      need(offset - start <= NATIVE_GEOMETRY_READ_LIMITS.stringLength * 6 + 2);
      if (!escaped && character === '"') {
        const result: unknown = JSON.parse(source.slice(start, offset));
        need(typeof result === 'string' && result.length <= NATIVE_GEOMETRY_READ_LIMITS.stringLength); return result;
      }
      if (!escaped && character === '\\') escaped = true; else escaped = false;
    }
    throw new NativeGeometryReadError();
  };
  const value = async (depth: number): Promise<Json> => {
    need(depth <= NATIVE_GEOMETRY_READ_LIMITS.depth && ++nodes <= NATIVE_GEOMETRY_READ_LIMITS.nodes);
    await checkpoint(); space(); const character = source[offset];
    if (character === '"') return string();
    if (character === '{') {
      offset++; space(); const row: Row = Object.create(null) as Row;
      if (source[offset] === '}') { offset++; return row; }
      for (;;) {
        const key = string(); need(!Object.hasOwn(row, key)); space(); need(source[offset++] === ':');
        row[key] = await value(depth + 1); space(); const end = source[offset++];
        if (end === '}') return row; need(end === ','); space();
      }
    }
    if (character === '[') {
      offset++; space(); const entries: Json[] = [];
      if (source[offset] === ']') { offset++; return entries; }
      for (;;) {
        entries.push(await value(depth + 1)); space(); const end = source[offset++];
        if (end === ']') return entries; need(end === ',');
      }
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (source.startsWith(token, offset)) { offset += token.length; return result; }
    }
    const start = offset;
    while (offset < source.length && /[0-9.eE+\-]/.test(source[offset]!)) {
      need(offset - start < NATIVE_GEOMETRY_READ_LIMITS.numberLength); offset++;
    }
    need(offset > start); return ExactDecimal.parse(source.slice(start, offset));
  };
  const result = await value(0); space(); need(offset === source.length); signal.throwIfAborted(); need(performance.now() < deadline);
  return result;
}

function decodeDescriptor(raw: Json, scope: NativeGeometryBinding['scope'], buildingId: string, headerView: string, origin: string): NativeGeometryDescriptor {
  const root = object(raw, ['schemaVersion', 'profile', 'scope', 'buildingId', 'viewKey', 'floors', 'physicalScale', 'floorAlignment', 'stageToHouseTransform']);
  need(isExactDecimal(root.schemaVersion) && root.schemaVersion.token === '1'
    && (root.profile === MESH_PROFILE || root.profile === 'houseatlas.native-geometry.v2'));
  const selected = object(root.scope, ['workspaceId', 'homeId']);
  need(uuid(selected.workspaceId) === scope.workspaceId && uuid(selected.homeId) === scope.homeId && uuid(root.buildingId) === buildingId);
  const viewKey = sha(root.viewKey); need(viewKey === headerView);
  need(root.physicalScale === 'unknown' && root.floorAlignment === 'unknown' && root.stageToHouseTransform === null);
  need(Array.isArray(root.floors) && root.floors.length <= NATIVE_GEOMETRY_READ_LIMITS.floors);
  const keys = new Set<string>(), geometryIds = new Set<string>(), pairs = new Set<string>();
  const floors: NativeGeometryOffer[] = root.floors.map(rawOffer => {
    const offer = object(rawOffer, ['floor', 'readPath']);
    const baseFields = ['key', 'exportLabel', 'originalSha256', 'derivativeSha256', 'geometryId', 'geometryRevision',
      'evidenceId', 'evidenceRevision', 'originalAssetId', 'originalRevision', 'derivativeAssetId', 'derivativeRevision', 'originalLicense', 'derivativeLicense'];
    const value = offer.floor;
    need(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value));
    const nextProfile = root.profile === MESH_PROFILE ? MESH_PROFILE : (value as Row).profile;
    need(nextProfile === MESH_PROFILE || nextProfile === IFC_GLB_PROFILE);
    const ifc = nextProfile === IFC_GLB_PROFILE;
    const row = object(value, root.profile === MESH_PROFILE ? baseFields : [...baseFields, 'profile', 'originalContentType', 'derivativeContentType',
      ...(ifc ? ['sourceUnits', 'declaredSourceUnits', 'sourceUpAxis', 'declaredSourceUpAxis', 'glbUnits', 'glbUpAxis', 'sourceToGlb', 'converter'] : [])]);
    if (root.profile !== MESH_PROFILE) {
      need(row.profile === nextProfile && row.originalContentType === (ifc ? 'application/x-step' : 'model/vnd.usdz+zip')
        && row.derivativeContentType === (ifc ? IFC_GLB_MIME : MESH_MIME));
    }
    let ifcFields: Pick<NativeGeometryFloor, 'sourceUnits' | 'declaredSourceUnits' | 'sourceUpAxis' | 'declaredSourceUpAxis' |
      'glbUnits' | 'glbUpAxis' | 'sourceToGlb' | 'converter'> = {};
    if (ifc) {
      const transform = object(row.sourceToGlb, ['axisMap', 'scale']);
      need(Array.isArray(transform.axisMap) && transform.axisMap.length === 3 && transform.axisMap[0] === 'x'
        && transform.axisMap[1] === 'z' && transform.axisMap[2] === '-y'
        && isExactDecimal(transform.scale) && transform.scale.compare(ExactDecimal.parse('0.001')) === 0);
      const converter = object(row.converter, ['name', 'version', 'configSha256']);
      need(row.sourceUnits === 'unknown' && row.declaredSourceUnits === 'mm'
        && row.sourceUpAxis === 'unknown' && row.declaredSourceUpAxis === 'Z'
        && row.glbUnits === 'm' && row.glbUpAxis === 'Y');
      ifcFields = { sourceUnits: 'unknown', declaredSourceUnits: 'mm', sourceUpAxis: 'unknown', declaredSourceUpAxis: 'Z', glbUnits: 'm', glbUpAxis: 'Y',
        sourceToGlb: { axisMap: ['x', 'z', '-y'], scale: 0.001 }, converter: {
          name: text(converter.name), version: text(converter.version), configSha256: sha(converter.configSha256) } };
    }
    const floor: NativeGeometryFloor = Object.freeze({
      key: sha(row.key), exportLabel: text(row.exportLabel), originalSha256: sha(row.originalSha256), derivativeSha256: sha(row.derivativeSha256),
      geometryId: uuid(row.geometryId), geometryRevision: revision(row.geometryRevision),
      evidenceId: uuid(row.evidenceId), evidenceRevision: revision(row.evidenceRevision),
      originalAssetId: uuid(row.originalAssetId), originalRevision: revision(row.originalRevision),
      derivativeAssetId: uuid(row.derivativeAssetId), derivativeRevision: revision(row.derivativeRevision),
      originalLicense: license(row.originalLicense), derivativeLicense: license(row.derivativeLicense),
      profile: nextProfile,
      originalContentType: ifc ? 'application/x-step' : 'model/vnd.usdz+zip',
      derivativeContentType: ifc ? IFC_GLB_MIME : MESH_MIME, ...ifcFields,
    });
    const pair = `${floor.originalAssetId}:${floor.derivativeAssetId}`;
    need(floor.originalAssetId !== floor.derivativeAssetId && !keys.has(floor.key) && !geometryIds.has(floor.geometryId) && !pairs.has(pair));
    keys.add(floor.key); geometryIds.add(floor.geometryId); pairs.add(pair);
    const readPath = text(offer.readPath);
    // Exact owner-offered relative path: no query, fragment, encoded alias,
    // alternative endpoint or cross-origin URL can be substituted.
    const expected = `${buildingPath(scope, buildingId)}/frames/${viewKey}/meshes/${floor.key}`;
    const url = new URL(readPath, origin);
    need(readPath === expected && url.origin === origin && url.pathname === expected && !url.search && !url.hash);
    return Object.freeze({ floor, readPath });
  });
  return Object.freeze({ schemaVersion: root.schemaVersion, profile: root.profile,
    scope: Object.freeze({ workspaceId: scope.workspaceId, homeId: scope.homeId }), buildingId, viewKey,
    floors: Object.freeze(floors), physicalScale: 'unknown', floorAlignment: 'unknown', stageToHouseTransform: null });
}

function discard(response: Response): void { void response.body?.cancel().catch(() => undefined); }
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => { signal.removeEventListener('abort', stop); reject(signal.reason ?? new NativeGeometryReadError()); };
    signal.addEventListener('abort', stop, { once: true });
    promise.then(value => { signal.removeEventListener('abort', stop); resolve(value); },
      error => { signal.removeEventListener('abort', stop); reject(error); });
    if (signal.aborted) stop();
  });
}
function responseHeaders(response: Response, mime: string, limit: number, url: string): { viewKey: string; length: number | null } {
  need(response.status === 200 && !response.redirected && response.type !== 'opaque' && response.type !== 'opaqueredirect');
  need(response.url === '' || response.url === url);
  let headerBytes = 0;
  for (const [key, value] of response.headers) {
    headerBytes += new TextEncoder().encode(key).byteLength + new TextEncoder().encode(value).byteLength;
    need(headerBytes <= NATIVE_GEOMETRY_READ_LIMITS.headerBytes);
  }
  const type = response.headers.get('content-type');
  need(type !== null && (type.toLowerCase() === mime || type.toLowerCase() === `${mime}; charset=utf-8`));
  const viewKey = response.headers.get('x-atlas-geometry-view'); need(viewKey !== null && SHA.test(viewKey));
  const token = response.headers.get('content-length');
  need(token === null || (/^(0|[1-9][0-9]{0,19})$/.test(token) && ExactDecimal.parse(token).compare(ExactDecimal.parse(String(limit))) <= 0));
  return { viewKey, length: token === null ? null : Number(token) }; // proven within the small byte bound
}
async function receive(response: Response, limit: number, expectedLength: number | null, signal: AbortSignal, deadline: number): Promise<Uint8Array> {
  const reader = response.body?.getReader(); need(reader);
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); need(performance.now() < deadline);
      const next = await abortable(reader.read(), signal); signal.throwIfAborted(); need(performance.now() < deadline);
      if (next.done) break;
      need(chunks.length < NATIVE_GEOMETRY_READ_LIMITS.chunks && next.value instanceof Uint8Array && next.value.byteLength <= limit - length);
      length += next.value.byteLength; chunks.push(new Uint8Array(next.value));
    }
    need(length > 0 && (expectedLength === null || length === expectedLength));
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

interface Owner {
  readonly sessionIdentity: object;
  /** Authenticated actor naming the persistent partition; null persists nothing. */
  readonly actorId: string | null;
  readonly scopeAllocation: NativeGeometryBinding['scope'];
  readonly scope: NativeGeometryBinding['scope'];
  readonly expiresAt: string;
  readonly expiry: number;
}
interface LiveFrame {
  readonly owner: Owner;
  readonly generation: number;
  readonly descriptor: NativeGeometryDescriptor;
  readonly offers: ReadonlyMap<ScanFloor, NativeGeometryOffer>;
  readonly listeners: Set<() => void>;
  /** Explicit refresh: read every mesh afresh, then retain the new bytes. */
  readonly refresh: boolean;
}
interface RetainedPartition {
  readonly sessionIdentity: object;
  readonly expiresAt: string;
  readonly workspaceId: string;
  readonly homeId: string;
}
/** Exact offered derivative, independent of the home-wide view key: unrelated
 * record changes keep it; a new floor, asset, revision, digest, type or
 * licence does not. */
function retainedKey(descriptor: NativeGeometryDescriptor, floor: NativeGeometryFloor): string {
  return JSON.stringify([descriptor.scope.workspaceId, descriptor.scope.homeId, descriptor.buildingId, floor.key, floor.geometryId,
    floor.derivativeAssetId, floor.derivativeRevision.token, floor.derivativeSha256, floor.derivativeContentType,
    floor.derivativeLicense.status, floor.derivativeLicense.reference]);
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Clear after the server transition, including its failure path. Clearing
 * before logout lets another still-authorized page join the new generation. */
export async function signOutWithScanCleanup(signOut: () => Promise<unknown>, clearScans: () => Promise<void>): Promise<void> {
  try { await signOut(); }
  finally { await clearScans(); }
}

/** Passive native reads. The server authorizes each GET afresh; a local frame
 * is only a fence over this host observation and never a permission fallback.
 * With `retainMeshes`, a freshly authorized descriptor may be served verified
 * mesh bytes this page already read for the identical offered derivative under
 * the same canonical session object and home, or, with `persist`, bytes stored
 * by an earlier page for the same authenticated actor and home. The descriptor
 * itself is always read afresh and never stored. */
export function createNativeGeometryReadClient(options: NativeGeometryReadOptions): NativeGeometryReadClient {
  const parsedOrigin = new URL(options.origin);
  need((parsedOrigin.protocol === 'https:' || parsedOrigin.protocol === 'http:') && parsedOrigin.origin === options.origin
    && !parsedOrigin.username && !parsedOrigin.password);
  const origin = parsedOrigin.origin, transport = options.transport ?? globalThis.fetch;
  let owner: Owner | null = null, active: LiveFrame | null = null, generation = 0, disposed = false;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const requests = new Set<AbortController>(), frames = new WeakMap<NativeGeometryFrame, LiveFrame>();
  // Least recently used first. A home-view reload gap keeps the partition; a
  // different session object, expiry or home, an invalid binding, a gap without
  // a session (sign-out or session check), session expiry or dispose clears it.
  const retention = options.retainMeshes ?? null, persist = retention?.persist ?? null;
  let retainedFor: RetainedPartition | null = null, retainedBytes = 0;
  let cancelRetainedExpiry: (() => void) | undefined;
  const retained = new Map<string, Uint8Array>();
  const discardRetained = () => {
    cancelRetainedExpiry?.();
    cancelRetainedExpiry = undefined; retainedFor = null; retained.clear(); retainedBytes = 0;
  };
  const sessionPresent = () => { try { return retention?.sessionPresent() === true; } catch { return false; } };
  const partition = (binding: NativeGeometryBinding | null) => {
    if (!retention) return;
    if (!binding) {
      if (retainedFor && (!sessionPresent() || !(Date.parse(retainedFor.expiresAt) > Date.now()))) discardRetained();
      return;
    }
    if (retainedFor?.sessionIdentity === binding.sessionIdentity && retainedFor.expiresAt === binding.expiresAt
      && retainedFor.workspaceId === binding.scope.workspaceId && retainedFor.homeId === binding.scope.homeId) return;
    discardRetained();
    retainedFor = Object.freeze({ sessionIdentity: binding.sessionIdentity, expiresAt: binding.expiresAt,
      workspaceId: binding.scope.workspaceId, homeId: binding.scope.homeId });
    // Session expiry drops the bytes even while no read observes the binding.
    cancelRetainedExpiry = scheduleSessionExpiry(Date.parse(binding.expiresAt), discardRetained);
  };
  const partitionOf = (found: Owner) => retainedFor !== null && retainedFor.sessionIdentity === found.sessionIdentity
    && retainedFor.expiresAt === found.expiresAt && retainedFor.workspaceId === found.scope.workspaceId
    && retainedFor.homeId === found.scope.homeId;
  const retain = (key: string, bytes: Uint8Array) => {
    const previous = retained.get(key);
    if (previous) { retained.delete(key); retainedBytes -= previous.byteLength; }
    if (bytes.byteLength > NATIVE_GEOMETRY_RETAINED_LIMITS.bytes) return;
    for (const [oldest, value] of retained) {
      if (retained.size < NATIVE_GEOMETRY_RETAINED_LIMITS.entries
        && retainedBytes + bytes.byteLength <= NATIVE_GEOMETRY_RETAINED_LIMITS.bytes) break;
      retained.delete(oldest); retainedBytes -= value.byteLength;
    }
    retained.set(key, new Uint8Array(bytes)); retainedBytes += bytes.byteLength;
  };
  const notify = (callback: () => void) => { try { callback(); } catch { /* One subscriber cannot stop other invalidations. */ } };
  const invalidate = () => {
    const reservedGeneration = ++generation; const previous = active; active = null;
    for (const controller of [...requests]) controller.abort(new NativeGeometryReadError());
    if (previous) { const listeners = [...previous.listeners]; previous.listeners.clear(); for (const listener of listeners) notify(listener); }
    return reservedGeneration;
  };
  const clearExpiry = () => { if (expiryTimer !== undefined) clearTimeout(expiryTimer); expiryTimer = undefined; };
  const dropOwner = () => { owner = null; clearExpiry(); invalidate(); };
  const observe = (): Owner | null => {
    if (disposed) return null;
    let binding: NativeGeometryBinding | null;
    try { binding = options.getBinding(); } catch { dropOwner(); return null; }
    const expiry = binding ? Date.parse(binding.expiresAt) : NaN;
    if (!binding || typeof binding.sessionIdentity !== 'object' || binding.sessionIdentity === null
      || !binding.scope || !UUID.test(binding.scope.workspaceId) || !UUID.test(binding.scope.homeId) || !Number.isFinite(expiry) || expiry <= Date.now()) {
      if (binding) discardRetained(); else partition(null);
      if (owner || active || requests.size) dropOwner(); return null;
    }
    partition(binding);
    const actorId = typeof binding.actorId === 'string' && binding.actorId.length > 0
      && binding.actorId.length <= NATIVE_GEOMETRY_READ_LIMITS.stringLength ? binding.actorId : null;
    if (!owner || owner.sessionIdentity !== binding.sessionIdentity || owner.actorId !== actorId || owner.scopeAllocation !== binding.scope
      || owner.expiresAt !== binding.expiresAt || owner.scope.workspaceId !== binding.scope.workspaceId || owner.scope.homeId !== binding.scope.homeId) {
      dropOwner();
      owner = Object.freeze({ sessionIdentity: binding.sessionIdentity, actorId, scopeAllocation: binding.scope,
        scope: Object.freeze({ workspaceId: binding.scope.workspaceId, homeId: binding.scope.homeId }), expiresAt: binding.expiresAt, expiry });
      scheduleExpiry();
    }
    return owner;
  };
  const scheduleExpiry = () => {
    clearExpiry(); if (disposed || !owner) return;
    const remaining = owner.expiry - Date.now();
    if (remaining <= 0) { dropOwner(); return; }
    expiryTimer = setTimeout(() => { expiryTimer = undefined; observe(); scheduleExpiry(); }, Math.min(remaining + 1, MAX_TIMER));
  };
  const unsubscribeBinding = options.subscribeBinding(() => { if (!disposed) { dropOwner(); observe(); } });
  observe();
  const current = (live: LiveFrame) => !disposed && observe() === live.owner && active === live && generation === live.generation;
  const subscribe = (live: LiveFrame | undefined, callback: () => void) => {
    if (!live || !current(live)) { notify(callback); return () => undefined; }
    live.listeners.add(callback);
    if (!current(live)) { live.listeners.delete(callback); notify(callback); }
    return () => { live.listeners.delete(callback); };
  };
  const exchange = async <T>(found: Owner, expectedGeneration: number, path: string, mime: string, limit: number,
    signal: AbortSignal, accept: (bytes: Uint8Array, headerView: string, signal: AbortSignal, deadline: number) => Promise<T>): Promise<T> => {
    const controller = new AbortController(), deadline = performance.now() + NATIVE_GEOMETRY_READ_LIMITS.readMs;
    const abort = () => controller.abort(signal.reason);
    const guard = () => { controller.signal.throwIfAborted(); need(performance.now() < deadline && observe() === found && generation === expectedGeneration); };
    need(requests.size < NATIVE_GEOMETRY_READ_LIMITS.requests);
    requests.add(controller); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    const timer = setTimeout(() => controller.abort(new NativeGeometryReadError()), NATIVE_GEOMETRY_READ_LIMITS.readMs);
    const operation = async () => {
      guard(); const url = new URL(path, origin).href;
      const response = await transport(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: mime }, signal: controller.signal });
      try {
        guard(); if (response.status !== 200) throw new NativeGeometryReadError(response.status);
        const headers = responseHeaders(response, mime, limit, url);
        const bytes = await receive(response, limit, headers.length, controller.signal, deadline); guard();
        const result = await accept(bytes, headers.viewKey, controller.signal, deadline); guard(); return result;
      } catch (error) { discard(response); throw error; }
    };
    try {
      const result = await abortable(operation(), controller.signal); guard(); return result;
    } catch (error) {
      signal.throwIfAborted(); if (error instanceof NativeGeometryReadError) throw error; throw new NativeGeometryReadError();
    } finally {
      clearTimeout(timer); requests.delete(controller); signal.removeEventListener('abort', abort); controller.abort();
    }
  };

  const loadBuilding = async (buildingId: string, signal: AbortSignal, read?: NativeGeometryLoadOptions): Promise<NativeGeometryFrame> => {
    const found = observe(); const expectedGeneration = invalidate(); signal.throwIfAborted();
    need(found && UUID.test(buildingId) && generation === expectedGeneration);
    const descriptor = await exchange(found, expectedGeneration, buildingPath(found.scope, buildingId), 'application/json',
      NATIVE_GEOMETRY_READ_LIMITS.descriptorBytes, signal, async (bytes, viewKey, readSignal, deadline) =>
        decodeDescriptor(await decodeJson(bytes, readSignal, deadline), found.scope, buildingId, viewKey, origin));
    need(observe() === found && generation === expectedGeneration); signal.throwIfAborted();
    const floors: readonly NativeScanFloor[] = Object.freeze(descriptor.floors.map(({ floor }) => {
      const { originalSha256, derivativeSha256, ...facts } = floor;
      return Object.freeze({ ...facts, originalSHA256: originalSha256, derivativeSHA256: derivativeSha256 });
    }));
    const offers = new Map<ScanFloor, NativeGeometryOffer>(floors.map((floor, index) => [floor, descriptor.floors[index]!]));
    const live: LiveFrame = { owner: found, generation: expectedGeneration, descriptor, offers, listeners: new Set(), refresh: read?.refresh === true };
    const readPort: ScanMeshReadPort = Object.freeze({
      isCurrent: (viewKey: string) => current(live) && viewKey === descriptor.viewKey,
      subscribeInvalidation: (viewKey: string, callback: () => void) => {
        if (!current(live) || viewKey !== descriptor.viewKey) { notify(callback); return () => undefined; } return subscribe(live, callback);
      },
      read: async (viewKey: string, floor: ScanFloor, readSignal: AbortSignal): Promise<ScanMeshDelivery> => {
        try {
          need(current(live) && viewKey === descriptor.viewKey); readSignal.throwIfAborted();
          const offer = live.offers.get(floor); need(offer);
          // Only this fresh descriptor's exact offer selects retained or stored
          // bytes; an explicit refresh reads afresh and replaces them.
          const key = retention ? retainedKey(descriptor, offer.floor) : null;
          // The persistent partition is the authenticated actor and this home.
          const place = key !== null && persist && found.actorId !== null
            ? JSON.stringify([found.actorId, found.scope.workspaceId, found.scope.homeId]) : null;
          let cache: NativeGeometryScanCache | null = null;
          let bytes: Uint8Array | null = null;
          if (key !== null && !live.refresh) {
            const kept = partitionOf(found) ? retained.get(key) : undefined;
            if (kept) {
              retained.delete(key); retained.set(key, kept);
              bytes = new Uint8Array(kept);
            }
          }
          if (!bytes && place !== null && key !== null) {
            // One budget covers module loading, database readiness and lookup.
            // Late results are ignored and never used for a subsequent write.
            let timer: ReturnType<typeof setTimeout> | undefined;
            const consulted = persist!().then(async candidate => {
              await candidate.ready();
              return { cache: candidate, stored: live.refresh ? null : await candidate.read(place, key) };
            }).catch(() => null);
            const result = await Promise.race([consulted, new Promise<null>(resolve => {
              timer = setTimeout(resolve, NATIVE_GEOMETRY_CACHE_READ_MS, null);
            })]);
            clearTimeout(timer);
            cache = result?.cache ?? null;
            const stored = result?.stored;
            need(current(live)); readSignal.throwIfAborted();
            if (stored) {
              // Stored bytes are used only if they still match this offer.
              const digest = await sha256Hex(stored);
              need(current(live)); readSignal.throwIfAborted();
              if (digest === offer.floor.derivativeSha256 && stored.byteLength <= MESH_LIMITS.bytes) {
                bytes = stored; if (partitionOf(found)) retain(key, stored);
              } else cache!.remove(place, key);
            }
          }
          if (!bytes) {
            bytes = await exchange(found, expectedGeneration, offer.readPath, offer.floor.derivativeContentType, MESH_LIMITS.bytes, readSignal,
              async (body, headerView) => { need(headerView === descriptor.viewKey); return body; });
            if (key !== null) {
              const digest = await sha256Hex(bytes);
              need(current(live)); readSignal.throwIfAborted();
              // Unverified bytes are delivered for the reader to refuse, never kept.
              if (digest === offer.floor.derivativeSha256) {
                if (partitionOf(found)) retain(key, bytes);
                // Geometry record identity survives revision, licence and
                // floor-key changes; each native floor has its own record.
                if (place !== null && cache) cache.write(place, JSON.stringify([descriptor.buildingId, offer.floor.geometryId]), key, bytes);
              }
            }
          }
          need(current(live)); readSignal.throwIfAborted();
          return Object.freeze({ viewKey: descriptor.viewKey, floorKey: floor.key, bytes });
        } catch (error) { if (!readSignal.aborted && active === live) invalidate(); throw error; }
      },
    });
    const frame: NativeGeometryFrame = Object.freeze({ lease: Object.freeze({}), viewKey: descriptor.viewKey, descriptor,
      floors, readPort });
    frames.set(frame, live); active = live; need(current(live)); return frame;
  };
  return Object.freeze({ loadBuilding,
    isCurrent: (frame: NativeGeometryFrame) => { observe(); const live = frames.get(frame); return !!live && current(live); },
    subscribeInvalidation: (frame: NativeGeometryFrame, callback: () => void) => subscribe(frames.get(frame), callback),
    dispose: () => { if (disposed) return; disposed = true; dropOwner(); discardRetained(); unsubscribeBinding(); },
  });
}
