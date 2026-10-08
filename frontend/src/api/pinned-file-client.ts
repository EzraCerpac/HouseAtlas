import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import agent from '../../../contracts/stock-wire3/agent/agent.schema.json';
import atlas from '../../../packages/contracts/schemas/atlas.schema.json';
import type { AtlasSessionInfo } from '../app/session';
import type { Scope } from '../app/types';

/** Host-owned binding: the actual session allocation and completed view scope.
 * Identity follows these allocations; it grants no file, source or Media access. */
export interface PinnedFileSessionBinding {
  readonly session: AtlasSessionInfo;
  readonly scope: Scope;
}
/** Exact six-field entity reference from discovery DATA. Selector data only;
 * an opaque collection is kept as supplied and never remapped to a UUID. */
export interface PinnedSourceRef {
  readonly workspaceId: string;
  readonly homeId: string;
  readonly key: {
    readonly sourceInstanceId: string;
    readonly collectionId: string;
    readonly sourceKind: 'homebox-entity';
    readonly externalId: string;
  };
}
/** Informational: the revision is never sent or treated as a grant. Empty
 * sources means no eligible enumerable source, not proof of no configuration. */
export interface PinnedFileDiscovery {
  readonly schemaVersion: 1;
  readonly scope: Readonly<Scope>;
  readonly revision: string;
  readonly installedSources: readonly PinnedSourceRef[];
}
export interface PinnedFileTarget {
  readonly authority: 'homebox';
  readonly sourceInstanceId: string;
  readonly collectionId: string;
  readonly resourceKind: 'attachment';
  readonly entityId: string;
  readonly resourceId: string;
}
/** Frozen canonical homebox.file.download request for one genuinely new read. */
export interface PinnedFileRequest {
  readonly schemaVersion: 3;
  readonly commandId: 'homebox.file.download';
  readonly context: Readonly<Scope>;
  readonly target: PinnedFileTarget;
  readonly payload: Readonly<Record<string, never>>;
  readonly requestId: string;
}
/** Process-local capture facts with the server's exact lexical retrieval times.
 * They establish no provider version, causality or current remote availability. */
export interface PinnedCaptureFacts {
  readonly semantics: 'process-local-pinned-snapshot';
  readonly beforeRetrievedAt: string;
  readonly bodyRetrievedAt: string;
  readonly afterRetrievedAt: string;
  readonly statuses: readonly [200, 200, 200];
}
/** Artifact DATA without its token, which stays in the client's private custody.
 * The observed MIME (null, empty or unknown) is preserved and qualifies no preview. */
export interface PinnedArtifactFacts {
  readonly scope: { readonly workspaceId: string; readonly homeId: string; readonly sourceInstanceId: string; readonly collectionId: string };
  readonly target: PinnedFileTarget;
  readonly sha256: string;
  readonly byteSize: number;
  readonly contentType: string | null;
  readonly localCapture: PinnedCaptureFacts;
}
export interface PinnedFileCapture {
  readonly source: PinnedSourceRef;
  readonly attachmentId: string;
  readonly request: PinnedFileRequest;
  readonly artifact: PinnedArtifactFacts;
}
/** Display data only. expiresAt is in the performance.now() timebase, anchored at
 * the START of the availability call; neither field proves a download. */
export interface PinnedFileOffer {
  readonly href: string;
  readonly remainingMs: number;
  readonly expiresAt: number;
}
/** 'none' means no offer from this observation, not that no artifact exists. */
export type PinnedFileAvailability =
  | { readonly state: 'offer'; readonly offer: PinnedFileOffer }
  | { readonly state: 'none'; readonly observed: 'unavailable' | 'unbound' | 'expired' | 'error' | 'refused'; readonly status: number | null };
/** Sent captures whose outcome stayed unknown, for one session allocation and
 * exact source: one observed HTTP status per sent attempt, null when none. */
export interface PinnedFileUnknownRecord {
  readonly statuses: readonly (number | null)[];
}
export interface PinnedFileClient {
  /** Stable for one actual session allocation and scope object; null otherwise. */
  getBindingIdentity(): object | null;
  getBindingScope(identity: object): Readonly<Scope> | null;
  subscribeSessionBinding(changed: () => void): () => void;
  getUnknown(identity: object, source: PinnedSourceRef, attachmentId: string): PinnedFileUnknownRecord | null;
  subscribeUnknown(changed: () => void): () => void;
  discover(identity: object, signal: AbortSignal): Promise<PinnedFileDiscovery>;
  /** One explicit new read with a fresh requestId; never retried automatically. */
  capture(discovery: PinnedFileDiscovery, source: PinnedSourceRef, attachmentId: string, signal: AbortSignal): Promise<PinnedFileCapture>;
  /** At most one availability observation per capture; no renewal or recovery. */
  resolve(capture: PinnedFileCapture, signal: AbortSignal): Promise<PinnedFileAvailability>;
  isOfferCurrent(offer: PinnedFileOffer): boolean;
}
export class PinnedFileError extends Error {
  constructor(
    readonly state: 'unavailable' | 'unknown',
    readonly action: 'discovery' | 'capture',
    readonly status: number | null,
    /** False only when nothing was sent. */
    readonly sent: boolean,
  ) {
    super(state === 'unknown'
      ? `Capture outcome unknown${status === null ? '' : ` (HTTP ${status})`}. A local copy may have been issued without being delivered; do not infer failure or safe retry.`
      : `${action === 'discovery' ? 'Local file source discovery' : 'Capture'} unavailable${sent ? '' : '; nothing was sent'}.`);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RFC3339 = /^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt ]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:[.][0-9]+)?(?:[Zz]|[+-]([0-9]{2}):([0-9]{2}))$/;
const TARGET_KEYS = ['authority', 'sourceInstanceId', 'collectionId', 'resourceKind', 'entityId', 'resourceId'] as const;
const MAX_FILE_BYTES = 10_485_760;
const encoder = new TextEncoder();
const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(ajv); ajv.addSchema(atlas); ajv.addSchema(agent);
/** Resolved on first use; a missing contract refuses locally instead of failing module load. */
function contract(ref: string): () => (value: unknown) => boolean {
  let check: ((value: unknown) => boolean) | null = null;
  return () => {
    if (!check) {
      const found = ajv.getSchema(ref);
      if (!found) throw new TypeError('Pinned file contract unavailable');
      check = (value) => found(value) === true;
    }
    return check;
  };
}
const sourceRefContract = contract(`${atlas.$id}#/$defs/sourceRef`);
const requestContract = contract(`${agent.$id}#/$defs/request_homebox_file_download`);

function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
const text = (value: unknown): value is string => typeof value === 'string' && wellFormed(value);
const utf8 = (value: string) => encoder.encode(value).length;
function plain(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    throw new TypeError('Expected a plain JSON object');
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const row = plain(value);
  if (Reflect.ownKeys(row).length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(row, key)))
    throw new TypeError('Unexpected JSON fields');
  return row;
}
function list(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max)
    throw new TypeError('Expected a bounded JSON array');
  return value;
}
/** Lexical RFC 3339 check with calendar ranges; the original spelling is kept. */
function rfc3339(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = RFC3339.exec(value);
  if (!match) return false;
  const part = (index: number) => Number(match[index] ?? '0');
  const year = part(1), month = part(2), day = part(3);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return month >= 1 && month <= 12 && day >= 1 && day <= days
    && part(4) <= 23 && part(5) <= 59 && part(6) <= 60 && part(7) <= 23 && part(8) <= 59;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
const identityOf = (source: PinnedSourceRef) => [source.workspaceId, source.homeId, source.key.sourceInstanceId,
  source.key.collectionId, source.key.sourceKind, source.key.externalId];

export const isPinnedUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
/** Exact string equality on all six fields; no case folding or UUID equivalence. */
export function samePinnedSource(a: PinnedSourceRef, b: PinnedSourceRef): boolean {
  return a.workspaceId === b.workspaceId && a.homeId === b.homeId
    && a.key.sourceInstanceId === b.key.sourceInstanceId && a.key.collectionId === b.key.collectionId
    && a.key.sourceKind === b.key.sourceKind && a.key.externalId === b.key.externalId;
}
export const pinnedAttemptKey = (source: PinnedSourceRef, attachmentId: string) => JSON.stringify([...identityOf(source), attachmentId]);
/** Current capture requests require canonical lowercase UUIDs as supplied. */
export function pinnedCapturable(source: PinnedSourceRef, attachmentId: string): boolean {
  return isPinnedUuid(source.workspaceId) && isPinnedUuid(source.homeId) && isPinnedUuid(source.key.sourceInstanceId)
    && isPinnedUuid(source.key.collectionId) && source.key.sourceKind === 'homebox-entity'
    && isPinnedUuid(source.key.externalId) && isPinnedUuid(attachmentId);
}
export function buildPinnedFileRequest(source: PinnedSourceRef, attachmentId: string, requestId: string): PinnedFileRequest {
  if (!pinnedCapturable(source, attachmentId) || !isPinnedUuid(requestId)) throw new TypeError('Capture request is incompatible');
  const request: PinnedFileRequest = {
    schemaVersion: 3,
    commandId: 'homebox.file.download',
    context: { workspaceId: source.workspaceId, homeId: source.homeId },
    target: {
      authority: 'homebox', sourceInstanceId: source.key.sourceInstanceId, collectionId: source.key.collectionId,
      resourceKind: 'attachment', entityId: source.key.externalId, resourceId: attachmentId,
    },
    payload: {},
    requestId,
  };
  if (!requestContract()(request)) throw new TypeError('Capture request is incompatible');
  return deepFreeze(request);
}
/** Exactly one request field; the server's decoded and raw query bounds apply. */
export function pinnedCaptureQuery(request: PinnedFileRequest): string {
  const wire = JSON.stringify(request);
  if (utf8(wire) > 16_384) throw new TypeError('Capture request exceeds transport bound');
  const query = new URLSearchParams({ request: wire }).toString();
  if (query.length > 32_768) throw new TypeError('Capture request exceeds transport bound');
  return `?${query}`;
}
function decodeSourceRef(value: unknown): PinnedSourceRef {
  if (!sourceRefContract()(value)) throw new TypeError('Source reference is incompatible');
  const row = exact(value, ['workspaceId', 'homeId', 'key']);
  const key = exact(row['key'], ['sourceInstanceId', 'collectionId', 'sourceKind', 'externalId']);
  const workspaceId = row['workspaceId'], homeId = row['homeId'];
  const sourceInstanceId = key['sourceInstanceId'], collectionId = key['collectionId'], externalId = key['externalId'];
  if (!text(workspaceId) || !text(homeId) || !text(sourceInstanceId) || !text(collectionId) || !text(externalId)
    || key['sourceKind'] !== 'homebox-entity') throw new TypeError('Source reference is incompatible');
  return Object.freeze({
    workspaceId, homeId,
    key: Object.freeze({ sourceInstanceId, collectionId, sourceKind: 'homebox-entity' as const, externalId }),
  });
}
export function decodePinnedDiscovery(value: unknown, scope: Readonly<Scope>): PinnedFileDiscovery {
  const row = exact(value, ['schemaVersion', 'scope', 'revision', 'installedSources']);
  const returned = exact(row['scope'], ['workspaceId', 'homeId']);
  const revision = row['revision'];
  if (row['schemaVersion'] !== 1 || returned['workspaceId'] !== scope.workspaceId || returned['homeId'] !== scope.homeId
    || !text(revision) || revision.length === 0 || utf8(revision) > 128) throw new TypeError('Discovery is incompatible');
  const seen = new Set<string>();
  const installedSources = list(row['installedSources'], 64).map((item) => {
    const source = decodeSourceRef(item);
    const identity = JSON.stringify(identityOf(source));
    if (source.workspaceId !== scope.workspaceId || source.homeId !== scope.homeId || seen.has(identity))
      throw new TypeError('Discovery source is incompatible');
    seen.add(identity);
    return source;
  });
  return Object.freeze({
    schemaVersion: 1,
    scope: Object.freeze({ workspaceId: scope.workspaceId, homeId: scope.homeId }),
    revision,
    installedSources: Object.freeze(installedSources),
  });
}
/** Correlated by exact scope and the six original target fields; the artifact
 * carries no requestId. Any mismatch is a decode failure for the caller. */
export function decodePinnedArtifact(value: unknown, request: PinnedFileRequest): { readonly facts: PinnedArtifactFacts; readonly downloadToken: string } {
  const row = exact(value, ['scope', 'target', 'downloadToken', 'sha256', 'byteSize', 'contentType', 'localCapture']);
  const scope = exact(row['scope'], ['workspaceId', 'homeId', 'sourceInstanceId', 'collectionId']);
  const target = exact(row['target'], TARGET_KEYS);
  const capture = exact(row['localCapture'], ['semantics', 'beforeRetrievedAt', 'bodyRetrievedAt', 'afterRetrievedAt', 'statuses']);
  const statuses = list(capture['statuses'], 3);
  const downloadToken = row['downloadToken'], sha256 = row['sha256'], byteSize = row['byteSize'], contentType = row['contentType'];
  const before = capture['beforeRetrievedAt'], body = capture['bodyRetrievedAt'], after = capture['afterRetrievedAt'];
  if (scope['workspaceId'] !== request.context.workspaceId || scope['homeId'] !== request.context.homeId
    || scope['sourceInstanceId'] !== request.target.sourceInstanceId || scope['collectionId'] !== request.target.collectionId
    || !TARGET_KEYS.every((key) => target[key] === request.target[key])
    || !isPinnedUuid(downloadToken) || typeof sha256 !== 'string' || !SHA256.test(sha256)
    || typeof byteSize !== 'number' || !Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > MAX_FILE_BYTES
    || !(contentType === null || (text(contentType) && utf8(contentType) <= 4096))
    || capture['semantics'] !== 'process-local-pinned-snapshot'
    || !rfc3339(before) || !rfc3339(body) || !rfc3339(after)
    || statuses.length !== 3 || !statuses.every((status) => status === 200))
    throw new TypeError('Local pinned artifact correlation differs');
  const facts: PinnedArtifactFacts = deepFreeze({
    scope: { workspaceId: request.context.workspaceId, homeId: request.context.homeId, sourceInstanceId: request.target.sourceInstanceId, collectionId: request.target.collectionId },
    target: { ...request.target },
    sha256: sha256 as string,
    byteSize: byteSize as number,
    contentType: contentType as string | null,
    localCapture: {
      semantics: 'process-local-pinned-snapshot',
      beforeRetrievedAt: before as string,
      bodyRetrievedAt: body as string,
      afterRetrievedAt: after as string,
      statuses: [200, 200, 200],
    },
  });
  return Object.freeze({ facts, downloadToken: downloadToken as string });
}
/** Owner availability DATA, not a capability. Positive floored budget <= 60 s. */
export function decodePinnedAvailability(value: unknown): { readonly state: 'available'; readonly remainingMs: number } | { readonly state: 'unavailable' | 'unbound' } {
  const state = plain(value)['state'];
  if (state === 'unavailable' || state === 'unbound') { exact(value, ['state']); return { state }; }
  if (state !== 'available') throw new TypeError('Availability is incompatible');
  const remainingMs = exact(exact(value, ['state', 'lifetime'])['lifetime'], ['remainingMs'])['remainingMs'];
  if (typeof remainingMs !== 'number' || !Number.isSafeInteger(remainingMs) || remainingMs < 1 || remainingMs > 60_000)
    throw new TypeError('Availability is incompatible');
  return { state: 'available', remainingMs };
}
