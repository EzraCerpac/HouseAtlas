/** Explicit passive read of saved Network relations for the completed view
 * scope. The session allocation stays private to this client. */
import type { AtlasSessionInfo } from '../app/session';
import type { Scope } from '../app/types';

/** Identity of one actual session allocation and completed view scope. It
 * carries no session token; only reference equality is meaningful. */
export interface NetworkRelationsBinding {
  readonly scope: Readonly<Scope>;
}
export interface NetworkRelationEndpoint {
  readonly kind: 'device' | 'interface' | 'segment' | 'unresolved';
  readonly id: string | null;
  readonly description: string | null;
}
/** Verbatim networkRelation DTO. Dates are original strings, never parsed. */
export interface NetworkRelationItem {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly homeId: string;
  readonly sourceInstanceId: string;
  readonly collectionId: string;
  readonly externalId: string;
  readonly kind: 'network-connection' | 'network-segment-membership' | 'network-association';
  readonly from: NetworkRelationEndpoint;
  readonly to: NetworkRelationEndpoint;
  readonly medium: 'ethernet' | 'wifi' | 'powerline' | 'wan' | 'other' | 'unknown';
  readonly sourceRevision: number | null;
  readonly sourceSnapshotAt: string | null;
  readonly retrievedAt: string;
  readonly vantage: string | null;
  readonly sourceConfidence: string;
  readonly evidenceBasis: 'owner-report' | 'source-report' | 'physical-survey' | 'inference' | 'unknown';
  readonly temporalStatus: 'current-claim' | 'historical' | 'withdrawn' | 'disputed';
  readonly factAt: string | null;
  readonly notes: string;
}
export interface NetworkSourceStatusError {
  readonly code: 'timeout' | 'auth' | 'wrong-scope' | 'invalid-schema' | 'pagination' | 'size-limit' | 'transport' | 'upstream';
  readonly at: string;
  /** Retained as data; never rendered. */
  readonly message: string;
}
/** Verbatim cacheStatus DTO. It carries no owner and implies no currentness. */
export interface NetworkSourceStatus {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly homeId: string;
  readonly sourceInstanceId: string;
  readonly collectionId: string;
  readonly status: 'empty' | 'fresh' | 'stale' | 'error' | 'access-revoked';
  readonly lastSuccessfulFetchAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly generationId: string | null;
  readonly consistency: 'non-transactional-offset-pages';
  readonly error: NetworkSourceStatusError | null;
}
export interface NetworkRelationsPage {
  readonly contractVersion: typeof CONTRACT_VERSION;
  readonly items: readonly NetworkRelationItem[];
  /** Opaque continuation; never ordering, freshness or authority. */
  readonly nextCursor: string | null;
  readonly sourceStatuses: readonly NetworkSourceStatus[];
}
export type NetworkRelationsRead =
  | { readonly status: 'ready'; readonly page: NetworkRelationsPage; readonly bytes: number }
  | { readonly status: 'expired' | 'denied' | 'unavailable' | 'timedOut' | 'tooLarge' | 'continuationUnavailable' | 'invalid' };
export interface NetworkRelationsClient {
  getBinding(): NetworkRelationsBinding | null;
  subscribe(changed: () => void): () => void;
  read(binding: NetworkRelationsBinding, cursor: string | null, signal: AbortSignal): Promise<NetworkRelationsRead>;
}

/** Pinned to backend/src/storage/types.rs CONTRACT_VERSION; the page envelope always uses it. */
const CONTRACT_VERSION = '1.0.0';
/** Conservative browser policy only; the host enforces no response byte cap. */
export const networkRelationsPolicy = Object.freeze({
  limit: 25,
  maxResponseBytes: 1048576,
  maxSourceStatusesPerPage: 256,
  maxPages: 40,
  maxItems: 1000,
  maxAggregateBytes: 8388608,
  requestTimeoutMs: 30000,
  maxCursorBytes: 64,
});
const policy = networkRelationsPolicy;
const expired: NetworkRelationsRead = Object.freeze({ status: 'expired' });
const denied: NetworkRelationsRead = Object.freeze({ status: 'denied' });
const unavailable: NetworkRelationsRead = Object.freeze({ status: 'unavailable' });
const timedOut: NetworkRelationsRead = Object.freeze({ status: 'timedOut' });
const tooLarge: NetworkRelationsRead = Object.freeze({ status: 'tooLarge' });
const continuationUnavailable: NetworkRelationsRead = Object.freeze({ status: 'continuationUnavailable' });
const invalidRead: NetworkRelationsRead = Object.freeze({ status: 'invalid' });
const encoder = new TextEncoder();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/u;
const endpointKinds = ['device', 'interface', 'segment', 'unresolved'] as const;
const relationKinds = ['network-connection', 'network-segment-membership', 'network-association'] as const;
const media = ['ethernet', 'wifi', 'powerline', 'wan', 'other', 'unknown'] as const;
const evidenceBases = ['owner-report', 'source-report', 'physical-survey', 'inference', 'unknown'] as const;
const temporalStatuses = ['current-claim', 'historical', 'withdrawn', 'disputed'] as const;
const cacheStatuses = ['empty', 'fresh', 'stale', 'error', 'access-revoked'] as const;
const errorCodes = ['timeout', 'auth', 'wrong-scope', 'invalid-schema', 'pagination', 'size-limit', 'transport', 'upstream'] as const;
const relationKeys = ['schemaVersion', 'workspaceId', 'homeId', 'sourceInstanceId', 'collectionId', 'externalId',
  'kind', 'from', 'to', 'medium', 'sourceRevision', 'sourceSnapshotAt', 'retrievedAt', 'vantage',
  'sourceConfidence', 'evidenceBasis', 'temporalStatus', 'factAt', 'notes'] as const;
const statusKeys = ['schemaVersion', 'workspaceId', 'homeId', 'sourceInstanceId', 'collectionId', 'status',
  'lastSuccessfulFetchAt', 'lastAttemptAt', 'generationId', 'consistency', 'error'] as const;

function invalid(): never {
  throw new TypeError('Invalid Network relations page');
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) invalid();
  return row;
}
function array(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
}
/** Schema lengths count code points; lone surrogates are rejected. */
function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string' || /[\uD800-\uDFFF]/u.test(value)) invalid();
  const length = [...value].length;
  if (length < min || length > max) invalid();
  return value;
}
function nullable<T>(value: unknown, decode: (value: unknown) => T): T | null {
  return value === null ? null : decode(value);
}
function member<T extends string>(value: unknown, members: readonly T[]): T {
  if (typeof value !== 'string' || !(members as readonly string[]).includes(value)) invalid();
  return value as T;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid();
  return value;
}
/** RFC 3339 date-time, retained verbatim; never parsed into a Date. */
function dateTime(value: unknown): string {
  if (typeof value !== 'string') invalid();
  const match = DATE_TIME.exec(value);
  if (!match) invalid();
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0)
    || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 60
    || Number(match[7] ?? 0) > 23 || Number(match[8] ?? 0) > 59) invalid();
  return value;
}
function scoped(row: Record<string, unknown>, scope: Readonly<Scope>): { workspaceId: string; homeId: string } {
  if (row['schemaVersion'] !== 1) invalid();
  const workspaceId = uuid(row['workspaceId']), homeId = uuid(row['homeId']);
  if (workspaceId !== scope.workspaceId || homeId !== scope.homeId) invalid();
  return { workspaceId, homeId };
}
function endpoint(value: unknown): NetworkRelationEndpoint {
  const row = object(value, ['kind', 'id', 'description']);
  const decoded: NetworkRelationEndpoint = {
    kind: member(row['kind'], endpointKinds),
    id: nullable(row['id'], id => text(id, 1, 4096)),
    description: nullable(row['description'], description => text(description, 0, 16384)),
  };
  return Object.freeze(decoded);
}
function revision(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}
function relation(value: unknown, scope: Readonly<Scope>): NetworkRelationItem {
  const row = object(value, relationKeys);
  const { workspaceId, homeId } = scoped(row, scope);
  const decoded: NetworkRelationItem = {
    schemaVersion: 1,
    workspaceId,
    homeId,
    sourceInstanceId: uuid(row['sourceInstanceId']),
    collectionId: text(row['collectionId'], 1, 4096),
    externalId: text(row['externalId'], 1, 4096),
    kind: member(row['kind'], relationKinds),
    from: endpoint(row['from']),
    to: endpoint(row['to']),
    medium: member(row['medium'], media),
    sourceRevision: revision(row['sourceRevision']),
    sourceSnapshotAt: nullable(row['sourceSnapshotAt'], dateTime),
    retrievedAt: dateTime(row['retrievedAt']),
    vantage: nullable(row['vantage'], vantage => text(vantage, 1, 4096)),
    sourceConfidence: text(row['sourceConfidence'], 1, 4096),
    evidenceBasis: member(row['evidenceBasis'], evidenceBases),
    temporalStatus: member(row['temporalStatus'], temporalStatuses),
    factAt: nullable(row['factAt'], dateTime),
    notes: text(row['notes'], 0, 16384),
  };
  return Object.freeze(decoded);
}
function statusError(value: unknown): NetworkSourceStatusError {
  const row = object(value, ['code', 'at', 'message']);
  const decoded: NetworkSourceStatusError = {
    code: member(row['code'], errorCodes),
    at: dateTime(row['at']),
    message: text(row['message'], 1, 4096),
  };
  return Object.freeze(decoded);
}
function sourceStatus(value: unknown, scope: Readonly<Scope>): NetworkSourceStatus {
  const row = object(value, statusKeys);
  const { workspaceId, homeId } = scoped(row, scope);
  if (row['consistency'] !== 'non-transactional-offset-pages') invalid();
  const decoded: NetworkSourceStatus = {
    schemaVersion: 1,
    workspaceId,
    homeId,
    sourceInstanceId: uuid(row['sourceInstanceId']),
    collectionId: text(row['collectionId'], 1, 4096),
    status: member(row['status'], cacheStatuses),
    lastSuccessfulFetchAt: nullable(row['lastSuccessfulFetchAt'], dateTime),
    lastAttemptAt: nullable(row['lastAttemptAt'], dateTime),
    generationId: nullable(row['generationId'], uuid),
    consistency: 'non-transactional-offset-pages',
    error: nullable(row['error'], statusError),
  };
  return Object.freeze(decoded);
}
/** Opaque token of 1..64 UTF-8 bytes. */
function cursorText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || /[\uD800-\uDFFF]/u.test(value)
    || encoder.encode(value).length > policy.maxCursorBytes) invalid();
  return value;
}

/** Exact page envelope for the captured scope; every row is copied and frozen. */
export function decodeNetworkRelationsPage(value: unknown, scope: Readonly<Scope>): NetworkRelationsPage {
  const row = object(value, ['contractVersion', 'items', 'nextCursor', 'sourceStatuses']);
  if (row['contractVersion'] !== CONTRACT_VERSION) invalid();
  const items = array(row['items'], policy.limit).map(item => relation(item, scope));
  const nextCursor = cursorText(row['nextCursor']);
  // The host issues a continuation only after a full page.
  if (nextCursor !== null && items.length !== policy.limit) invalid();
  const sourceStatuses = array(row['sourceStatuses'], policy.maxSourceStatusesPerPage)
    .map(status => sourceStatus(status, scope));
  const page: NetworkRelationsPage = {
    contractVersion: CONTRACT_VERSION,
    items: Object.freeze(items),
    nextCursor,
    sourceStatuses: Object.freeze(sourceStatuses),
  };
  return Object.freeze(page);
}

/** One read sequence. Pages are kept in server order and never merged,
 * deduplicated or re-sorted; a reload starts a new sequence. */
export interface NetworkRelationsSequence {
  readonly pages: readonly NetworkRelationsPage[];
  readonly sourceStatuses: readonly NetworkSourceStatus[];
  readonly itemCount: number;
  readonly bytes: number;
  readonly cursors: readonly string[];
  readonly nextCursor: string | null;
}
export type NetworkRelationsLimit = 'pageLimit' | 'itemLimit' | 'byteLimit';
export type NetworkRelationsStop = 'inconsistent' | 'nonAdvancing' | NetworkRelationsLimit;

export function startSequence(page: NetworkRelationsPage, bytes: number): NetworkRelationsSequence {
  const sequence: NetworkRelationsSequence = {
    pages: Object.freeze([page]),
    sourceStatuses: page.sourceStatuses,
    itemCount: page.items.length,
    bytes,
    cursors: Object.freeze(page.nextCursor === null ? [] : [page.nextCursor]),
    nextCursor: page.nextCursor,
  };
  return Object.freeze(sequence);
}
/** Browser budget for one more page; null when another request is allowed. */
export function sequenceLimit(sequence: NetworkRelationsSequence): NetworkRelationsLimit | null {
  if (sequence.pages.length >= policy.maxPages) return 'pageLimit';
  if (sequence.itemCount + policy.limit > policy.maxItems) return 'itemLimit';
  if (sequence.bytes + policy.maxResponseBytes > policy.maxAggregateBytes) return 'byteLimit';
  return null;
}
export function extendSequence(
  sequence: NetworkRelationsSequence, page: NetworkRelationsPage, bytes: number,
): NetworkRelationsSequence | NetworkRelationsStop {
  // Decoded rows are built in schema key order, so serialization is a deep comparison.
  if (JSON.stringify(page.sourceStatuses) !== JSON.stringify(sequence.sourceStatuses)) return 'inconsistent';
  if (page.nextCursor !== null && sequence.cursors.includes(page.nextCursor)) return 'nonAdvancing';
  if (sequence.pages.length + 1 > policy.maxPages) return 'pageLimit';
  if (sequence.itemCount + page.items.length > policy.maxItems) return 'itemLimit';
  if (sequence.bytes + bytes > policy.maxAggregateBytes) return 'byteLimit';
  const next: NetworkRelationsSequence = {
    pages: Object.freeze([...sequence.pages, page]),
    sourceStatuses: sequence.sourceStatuses,
    itemCount: sequence.itemCount + page.items.length,
    bytes: sequence.bytes + bytes,
    cursors: Object.freeze(page.nextCursor === null ? sequence.cursors : [...sequence.cursors, page.nextCursor]),
    nextCursor: page.nextCursor,
  };
  return Object.freeze(next);
}

/** Restates the localReadUrl rule in src/api/client.ts (not exported); the
 * path must also survive URL parsing unchanged. */
function localReadUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//'))
    throw new TypeError('Expected same-origin read route');
  const url = new URL(path, 'https://atlas.invalid');
  if (url.origin !== 'https://atlas.invalid' || url.hash || url.username || url.password
    || url.pathname + url.search !== path)
    throw new TypeError('Expected same-origin read route');
  return path;
}
function discard(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}
/** Bounded byte read. Overflow yields 'tooLarge' and stream failure null; a
 * stale binding or abort cancels the stream and throws. */
async function receive(body: ReadableStream<Uint8Array>, assertCurrent: () => void): Promise<Uint8Array | 'tooLarge' | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const chunk = await reader.read().catch(() => null);
      assertCurrent();
      if (chunk === null) return null;
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > policy.maxResponseBytes) {
        void reader.cancel().catch(() => undefined);
        return 'tooLarge';
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function createNetworkRelationsClient(options: {
  readonly getSessionBinding: () => { readonly session: AtlasSessionInfo; readonly scope: Scope } | null;
  readonly subscribeSessionBinding: (changed: () => void) => () => void;
  readonly fetch?: typeof fetch;
}): NetworkRelationsClient {
  const request = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let cached: { readonly session: AtlasSessionInfo; readonly scope: Scope; readonly binding: NetworkRelationsBinding } | null = null;
  // Stable while both the session allocation and the scope reference persist.
  function getBinding(): NetworkRelationsBinding | null {
    const next = options.getSessionBinding();
    if (!next) { cached = null; return null; }
    if (!cached || cached.session !== next.session || cached.scope !== next.scope)
      cached = { session: next.session, scope: next.scope, binding: Object.freeze({
        scope: Object.freeze({ workspaceId: next.scope.workspaceId, homeId: next.scope.homeId }),
      }) };
    return cached.binding;
  }
  async function read(binding: NetworkRelationsBinding, cursor: string | null, signal: AbortSignal): Promise<NetworkRelationsRead> {
    const assertCurrent = () => {
      signal.throwIfAborted();
      if (getBinding() !== binding) throw new Error('Network relations binding changed');
    };
    assertCurrent();
    const { workspaceId, homeId } = binding.scope;
    let url: string;
    try {
      if (!UUID.test(workspaceId) || !UUID.test(homeId)) invalid();
      if (cursor !== null) cursorText(cursor);
      // Same limit on every page; the host binds it into the cursor context.
      const query = new URLSearchParams({ limit: String(policy.limit) });
      if (cursor !== null) query.set('cursor', cursor);
      url = localReadUrl(`/api/atlas/v1/workspaces/${encodeURIComponent(workspaceId)}/homes/${encodeURIComponent(homeId)}/network/relations?${query.toString()}`);
    } catch {
      return invalidRead;
    }
    const timeout = new AbortController();
    let expiredTimer = false;
    const abort = () => timeout.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { expiredTimer = true; timeout.abort(); }, policy.requestTimeoutMs);
    try {
      let response: Response;
      try {
        response = await request(url, {
          method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: timeout.signal,
          headers: { Accept: 'application/json' },
        });
      } catch (error) {
        if (signal.aborted) throw error;
        assertCurrent();
        return expiredTimer ? timedOut : unavailable;
      }
      try { assertCurrent(); } catch (error) { discard(response); throw error; }
      // Error bodies are never parsed; no status is read as an empty result.
      if (response.status === 401) { discard(response); return expired; }
      if (response.status === 403) { discard(response); return denied; }
      // The host collapses every continuation cause into 422.
      if (response.status === 422) { discard(response); return cursor === null ? invalidRead : continuationUnavailable; }
      if (response.status !== 200 || !response.body) { discard(response); return unavailable; }
      if (Number(response.headers.get('Content-Length')) > policy.maxResponseBytes) { discard(response); return tooLarge; }
      const bytes = await receive(response.body, assertCurrent);
      if (bytes === 'tooLarge') return tooLarge;
      if (bytes === null) return expiredTimer ? timedOut : unavailable;
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { return invalidRead; }
      assertCurrent();
      try { return { status: 'ready', page: decodeNetworkRelationsPage(value, binding.scope), bytes: bytes.byteLength }; } catch { return invalidRead; }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  return { getBinding, subscribe: changed => options.subscribeSessionBinding(changed), read };
}
