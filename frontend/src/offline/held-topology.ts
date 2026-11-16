import { parseLosslessJson, stringifyLosslessJson, type JsonForSerialization } from '../numeric/lossless-json';
import { isExactDecimal, type ExactDecimal } from '../numeric/decimal';
import type { Scope } from '../app/types';
import type { AtlasReadStatus, TopologyBinding, TopologyClient, TopologyKind, TopologyRead, TopologyRecord } from '../api/topology-client';

/** The four whole-home lists the Rooms & places lens reads. */
export type HeldTopologyKind = 'identity' | 'binding' | 'location-semantics' | 'relation';
export const HELD_TOPOLOGY_KINDS: readonly HeldTopologyKind[] = ['identity', 'binding', 'location-semantics', 'relation'];
export interface HeldTopologyListV1<K extends HeldTopologyKind> {
  readonly records: readonly TopologyRecord<K>[]; readonly sourceStatus: AtlasReadStatus;
}
/** Building records exactly as one complete live read returned them: the four lists and every reviewed
 * building's membership list, all under one server snapshot. Records keep their original fields, exact
 * numbers, unknowns and uncertainty; capturedAt is this device's retrieval time, never a source date. */
export interface HeldTopologyV1 {
  readonly version: 1; readonly scope: Readonly<Scope>; readonly capturedAt: string; readonly snapshotSha256: string;
  readonly lists: { readonly [K in HeldTopologyKind]: HeldTopologyListV1<K> };
  readonly buildings: readonly Readonly<{ buildingId: string; members: HeldTopologyListV1<'identity'> }>[];
}
/** The same bounds the live read applies to each list. */
export const HELD_TOPOLOGY_LIMITS = Object.freeze({ records: 5000, buildings: 128 });
const SHA = /^[a-f0-9]{64}$/;
const STATUSES: readonly string[] = ['current', 'stale', 'unavailable', 'unresolved'];
const need = (ok: unknown): void => { if (!ok) throw new TypeError('Held building records are malformed'); };
type Node = Record<string, unknown>;
const object = (value: unknown): Node => {
  need(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value)); return value as Node;
};
const keys = (value: Node, names: string) => {
  const allowed = names.split(','); let count = 0;
  for (const key in value) need(Object.prototype.hasOwnProperty.call(value, key) && allowed.includes(key) && ++count);
  need(count === allowed.length);
};
const text = (value: unknown, cap = 4096): value is string => typeof value === 'string' && value.length > 0 && value.length <= cap;

/** Same checks as the live list read: Atlas authority, the list's kind, active records, unique IDs. */
function list<K extends HeldTopologyKind>(value: unknown, kind: K, decoded: boolean, buildingId?: string): HeldTopologyListV1<K> {
  const row = object(value); keys(row, 'records,sourceStatus');
  need(Array.isArray(row.records) && row.records.length <= HELD_TOPOLOGY_LIMITS.records && STATUSES.includes(row.sourceStatus as string));
  const ids = new Set<string>();
  for (const item of row.records as unknown[]) {
    const record = object(item), target = object(record.target), payload = object(record.payload);
    need(target.authority === 'atlas' && target.recordType === kind && text(target.recordId) && !ids.has(target.recordId)
      && record.lifecycle === 'active');
    ids.add(target.recordId as string);
    // Stored as an exact token; the live read converts only this bounded field to a number.
    if (decoded) { const revision = record.revision; need(isExactDecimal(revision)); record.revision = (revision as ExactDecimal).toSafeInteger(); }
    need(Number.isSafeInteger(record.revision) && (record.revision as number) > 0);
    if (buildingId !== undefined) need(payload.kind === 'location');
    if (payload.elevation !== undefined && object(payload.elevation).status === 'known') need(isExactDecimal(object(payload.elevation).metres));
  }
  if (buildingId !== undefined) need(ids.has(buildingId));
  return row as unknown as HeldTopologyListV1<K>;
}
function validate(value: unknown, scope: Readonly<Scope>, decoded: boolean): HeldTopologyV1 {
  const root = object(value); keys(root, 'version,scope,capturedAt,snapshotSha256,lists,buildings');
  const held = object(root.scope); keys(held, 'workspaceId,homeId');
  if (decoded) { need(isExactDecimal(root.version) && root.version.token === '1'); root.version = 1; }
  need(root.version === 1 && held.workspaceId === scope.workspaceId && held.homeId === scope.homeId
    && typeof root.capturedAt === 'string' && Number.isFinite(Date.parse(root.capturedAt)) && SHA.test(root.snapshotSha256 as string));
  const lists = object(root.lists); keys(lists, HELD_TOPOLOGY_KINDS.join(','));
  for (const kind of HELD_TOPOLOGY_KINDS) list(lists[kind], kind, decoded);
  need(Array.isArray(root.buildings) && root.buildings.length <= HELD_TOPOLOGY_LIMITS.buildings);
  const buildings = new Set<string>();
  for (const item of root.buildings as unknown[]) {
    const building = object(item); keys(building, 'buildingId,members');
    need(text(building.buildingId) && !buildings.has(building.buildingId));
    buildings.add(building.buildingId as string); list(building.members, 'identity', decoded, building.buildingId as string);
  }
  return root as unknown as HeldTopologyV1;
}

/** Exact serialization: decimal tokens are written as read, never rounded through a float. */
export function encodeHeldTopology(value: HeldTopologyV1): Uint8Array<ArrayBuffer> {
  validate(value, value.scope, false);
  return new TextEncoder().encode(stringifyLosslessJson(value as unknown as JsonForSerialization));
}
/** Parses a held row for exactly the copy's home; anything else is refused, never repaired. */
export function decodeHeldTopology(bytes: Uint8Array, scope: Readonly<Scope>): HeldTopologyV1 {
  return Object.freeze(validate(parseLosslessJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), scope, true));
}

/** A read-only topology source over one held copy. It never reaches a transport, and a list or building it
 * does not hold reads as unavailable, as a failed live read does. */
export function createHeldTopologyClient(held: HeldTopologyV1): TopologyClient {
  const binding: TopologyBinding = Object.freeze({ scope: Object.freeze({ ...held.scope }) });
  const ready = <K extends TopologyKind>(read: HeldTopologyListV1<HeldTopologyKind> | undefined, given: TopologyBinding): TopologyRead<K> =>
    read && given === binding ? { status: 'ready', records: read.records as unknown as TopologyRecord<K>[], sourceStatus: read.sourceStatus, snapshotSha256: held.snapshotSha256 }
      : { status: 'unavailable' };
  return {
    getBinding: () => binding,
    subscribe: () => () => {},
    async listAll(given, kind, signal) {
      signal.throwIfAborted();
      return ready((HELD_TOPOLOGY_KINDS as readonly string[]).includes(kind) ? held.lists[kind as HeldTopologyKind] : undefined, given);
    },
    async buildingMembers(given, buildingId, signal) {
      signal.throwIfAborted();
      return ready(held.buildings.find(row => row.buildingId === buildingId)?.members, given);
    },
  };
}
