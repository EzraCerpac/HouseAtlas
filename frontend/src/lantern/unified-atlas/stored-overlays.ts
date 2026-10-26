import type { AtlasScene } from './types';
import type { DocumentaryNetworkGraph, DocumentaryObservation, DocumentaryRecord, RuntimeRecords, RuntimeRoomRecords, SourceAvailability, SourceFact } from './runtime-overlays';

/** One building's overlay records as last projected on this device from a
 * current native frame, and when. Display only: holding one grants no frame,
 * lease, document access or native authority, and it is never a source. */
export interface StoredBuildingOverlays { readonly storedAt: string; readonly records: RuntimeRecords }
export type StoredOverlays = ReadonlyMap<string, StoredBuildingOverlays>;

/** Change this whenever RuntimeRecords or its parts change shape, so an older
 * stored copy is ignored rather than misread. */
export const STORED_OVERLAYS_PROFILE = 'houseatlas.stored-overlays.v1';

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';
const availability = (value: unknown): value is SourceAvailability => value === 'available' || value === 'partial' || value === 'unavailable';
function need(value: unknown): asserts value { if (!value) throw new TypeError('Stored overlays are not readable'); }
function list<T>(value: unknown, item: (row: unknown) => T): T[] { need(Array.isArray(value)); return value.map(item); }

function fact(value: unknown): SourceFact {
  need(isObject(value) && isText(value.label) && isTextOrNull(value.value));
  return { label: value.label, value: value.value };
}
function observation(value: unknown): DocumentaryObservation {
  need(isObject(value));
  const { key, id, label, category, detail, qualification, sourceDate, retrievedAt } = value;
  need(isText(key) && isText(id) && isText(label) && isText(category) && isText(detail) && isText(qualification)
    && isTextOrNull(sourceDate) && isTextOrNull(retrievedAt));
  return { key, id, label, category, detail, qualification, sourceDate, retrievedAt,
    connections: list(value.connections, row => { need(isText(row)); return row; }), sourceFacts: list(value.sourceFacts, fact) };
}
function record(value: unknown): DocumentaryRecord {
  const base = observation(value);
  const observations = (value as Record<string, unknown>).observations;
  return observations === undefined ? base : { ...base, observations: list(observations, observation) };
}
function roomRecords(value: unknown): RuntimeRoomRecords {
  need(isObject(value));
  return { network: list(value.network, record), electrical: list(value.electrical, record) };
}
function graph(value: unknown): DocumentaryNetworkGraph {
  need(isObject(value) && isText(value.key) && isText(value.qualification) && isObject(value.data));
  const data = value.data;
  // The graph data is the source's own JSON, kept byte-for-byte by the cache digest.
  need(isText(data.viewKey) && isObject(data.source) && Array.isArray(data.devices) && Array.isArray(data.links) && Array.isArray(data.endpoints)
    && [...data.devices, ...data.links, ...data.endpoints].every(row => isObject(row) && isText(row.id)));
  const keys = value.deviceRecordKeys;
  const sha = value.sourceOriginalSha256;
  need(sha === undefined || isText(sha));
  return { key: value.key, qualification: value.qualification, data: data as unknown as DocumentaryNetworkGraph['data'],
    ...(keys === undefined ? {} : { deviceRecordKeys: new Map(list(keys, row => {
      need(Array.isArray(row) && row.length === 2 && isText(row[0]) && isText(row[1])); return [row[0], row[1]] as const; })) }),
    ...(sha === undefined ? {} : { sourceOriginalSha256: sha }) };
}

function encodeRecords(records: RuntimeRecords): Json {
  return { rooms: [...records.rooms].map(([roomId, rows]) => [roomId, rows as unknown as Json]),
    network: records.network, electrical: records.electrical, sourceFacts: records.sourceFacts as unknown as Json,
    unplaced: records.unplaced as unknown as Json,
    networkGraphs: (records.networkGraphs ?? []).map(row => ({ key: row.key, qualification: row.qualification, data: row.data as unknown as Json,
      ...(row.deviceRecordKeys ? { deviceRecordKeys: [...row.deviceRecordKeys] } : {}),
      ...(row.sourceOriginalSha256 === undefined ? {} : { sourceOriginalSha256: row.sourceOriginalSha256 }) })) };
}
/** Rooms are kept only where the scene still has them with a selectable part,
 * so a stored copy can never place a marker the current model cannot show. */
function decodeRecords(value: unknown, rooms: ReadonlySet<string>): RuntimeRecords {
  need(isObject(value) && availability(value.network) && availability(value.electrical) && isObject(value.unplaced));
  const kept = new Map<string, RuntimeRoomRecords>();
  for (const row of list(value.rooms, row => { need(Array.isArray(row) && row.length === 2 && isText(row[0])); return [row[0], roomRecords(row[1])] as const; }))
    if (rooms.has(row[0])) kept.set(row[0], row[1]);
  return { rooms: kept, network: value.network, electrical: value.electrical, sourceFacts: list(value.sourceFacts, fact),
    unplaced: { network: list(value.unplaced.network, record), electrical: list(value.unplaced.electrical, record) },
    networkGraphs: list(value.networkGraphs, graph) };
}

/** UTF-8 JSON for the Atlas cache. The cache names it by publication, scene
 * revision and semantics and checks its digest; this repeats those pins. */
export function encodeStoredOverlays(scene: AtlasScene, overlays: StoredOverlays): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ profile: STORED_OVERLAYS_PROFILE, publicationId: scene.publication.publicationId,
    revision: scene.selection.revision, semanticsSha256: scene.publication.semanticsSha256,
    buildings: [...overlays].map(([buildingId, row]) => ({ buildingId, storedAt: row.storedAt, records: encodeRecords(row.records) })) }));
}

/** The stored copy for exactly this scene, limited to its floor buildings and
 * selectable rooms, or null when the bytes are for another scene or unreadable. */
export function decodeStoredOverlays(bytes: Uint8Array, scene: AtlasScene, selectable: ReadonlySet<string>): StoredOverlays | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    need(isObject(value) && value.profile === STORED_OVERLAYS_PROFILE && value.publicationId === scene.publication.publicationId
      && value.revision === scene.selection.revision && value.semanticsSha256 === scene.publication.semanticsSha256);
    const buildings = new Set(scene.buildings.filter(building => building.levelIds.length > 0).map(building => building.buildingId));
    const rooms = new Set(scene.rooms.filter(room => room.occurrenceIds.some(id => selectable.has(id))).map(room => room.roomId));
    const result = new Map<string, StoredBuildingOverlays>();
    for (const row of list(value.buildings, row => row)) {
      need(isObject(row) && isText(row.buildingId) && isText(row.storedAt) && Number.isFinite(Date.parse(row.storedAt)) && !result.has(row.buildingId));
      if (buildings.has(row.buildingId)) result.set(row.buildingId, { storedAt: row.storedAt, records: decodeRecords(row.records, rooms) });
    }
    return result.size > 0 ? result : null;
  } catch { return null; }
}
