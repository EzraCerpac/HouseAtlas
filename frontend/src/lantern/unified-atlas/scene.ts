import type { PlanRing, PlanShape } from '../canonical-ifc/model';
import { LABEL_WORK, labelPoint, pointInShape, type PreparedMesh, type Projection } from '../canonical-ifc/geometry';
import type { StandardGlb } from '../canonical-ifc/standard-glb';
import {
  AtlasReadError, type AtlasBuilding, type AtlasCoverage, type AtlasExclusion, type AtlasLevel, type AtlasMeshBinding, type AtlasOccurrence,
  type AtlasOverlayBinding, type AtlasPlan, type AtlasPlanFeature, type AtlasPolygon, type AtlasRoom, type AtlasScene, type Box, type MeshRole,
  type OverlayAnchor, type OverlayKind, type PlanRole, type Vec3,
} from './types';

/** Admission and presentation for one unified Atlas scene.
 *
 * Admission is closed and exact: every member resolves inside this one
 * publication, aggregate limits are checked before any plan or loader
 * allocation, and an unresolved required member refuses the whole scene.
 * Binding then matches each declared (node, mesh, primitive) selector against
 * the actual standard-loader primitives of the pinned GLB; names, proximity,
 * materials and node order are never consulted. Explosion offsets are display
 * translations only and are applied in one place for drawing, picking, plans,
 * labels and overlay anchors. */

const MiB = 1024 * 1024;
export const ATLAS_LIMITS = Object.freeze({
  /** The companion is at most 12 MiB; the host adds pins, hrefs and overlay bindings. */
  envelopeBytes: 12 * MiB + 256 * 1024,
  semanticBytes: 4 * MiB + 256 * 1024,
  planBytes: 8 * MiB,
  modelBytes: 32 * MiB,
  aggregateBytes: 64 * MiB,
  buildings: 128, levels: 64, rooms: 2048, occurrences: 4096,
  /** Bindings and selectors per binding, as the host admits them. Together the
   * selectors cannot exceed the standard loader's drawn primitive instances
   * (STANDARD_GLB_LIMITS.primitives), since each claims exactly one. */
  meshBindings: 8192, primitivesPerBinding: 8192, drawnPrimitives: 20_000,
  polygonPoints: 200_000,
  /** Overlay bindings and unique record IDs per binding; the semantic byte budget bounds their sum. */
  overlayBindings: 8192, recordsPerBinding: 1024,
  coordinate: 1_000_000,
});
export const SCENE_PROFILE = 'houseatlas.unified-atlas-scene.v1';
/** Section height above a level's lowest room floor, in that level's own frame. */
export const SECTION_HEIGHT = 1.2;

type Row = Record<string, unknown>;
function need(ok: unknown): asserts ok { if (!ok) throw new AtlasReadError('invalid', 'The room map does not match this model'); }
function budget(ok: boolean) { if (!ok) throw new AtlasReadError('too-large', 'The model is larger than this viewer supports'); }
const isRow = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
function row(value: unknown, keys: readonly string[]): Row {
  need(isRow(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))); return value;
}
function list(value: unknown, max: number): readonly unknown[] {
  need(Array.isArray(value)); budget(value.length <= max); return value;
}
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, SHA = /^[0-9a-f]{64}$/;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function text(value: unknown, max = 512): string {
  need(typeof value === 'string' && value.length > 0 && !CONTROL.test(value));
  // Match Rust str::chars: scalar values, preserving the original source
  // string. JSON.parse can produce lone surrogates that Rust strings cannot.
  let count = 0;
  for (const scalar of value) {
    const code = scalar.codePointAt(0)!;
    need((code < 0xd800 || code > 0xdfff) && ++count <= max);
  }
  return value;
}
const nullableText = (value: unknown, max = 2048) => value === null ? null : text(value, max);
const id = (value: unknown) => text(value, 256);
const nullableId = (value: unknown) => value === null ? null : id(value);
function uuid(value: unknown): string { need(typeof value === 'string' && UUID.test(value)); return value; }
const nullableUuid = (value: unknown) => value === null ? null : uuid(value);
function sha(value: unknown): string { need(typeof value === 'string' && SHA.test(value)); return value; }
function integer(value: unknown, min: number, max: number): number {
  need(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max); return value;
}
function coordinate(value: unknown): number {
  need(typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= ATLAS_LIMITS.coordinate); return value;
}
function tuple(value: unknown, length: number): readonly unknown[] { need(Array.isArray(value) && value.length === length); return value; }
function vec3(value: unknown): Vec3 {
  const items = tuple(value, 3); return [coordinate(items[0]), coordinate(items[1]), coordinate(items[2])];
}
function box(value: unknown): Box {
  const bounds = row(value, ['min', 'max']), min = vec3(bounds.min), max = vec3(bounds.max);
  need(min[0] <= max[0] && min[1] <= max[1] && min[2] <= max[2]); return { min, max };
}
function ids(value: unknown, max: number): readonly string[] {
  const items = list(value, max).map(id);
  need(new Set(items).size === items.length); return items;
}
function unique<T>(items: readonly T[], key: (item: T) => string): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const item of items) { const k = key(item); need(!map.has(k)); map.set(k, item); }
  return map;
}
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && new Set([...a, ...b]).size === a.length;
/** Selection revision: an opaque token, or a non-negative integer kept as its decimal text. */
export function revisionText(value: unknown): string {
  if (typeof value === 'number') { need(Number.isSafeInteger(value) && value >= 0); return String(value); }
  need(typeof value === 'string' && REVISION.test(value)); return value;
}

const utf8Bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const ROLES: ReadonlySet<MeshRole> = new Set(['structure', 'roof', 'slab', 'room-pick', 'context']);
const PLAN_ROLES: ReadonlySet<PlanRole> = new Set(['room', 'wall', 'opening', 'stair', 'context']);

/** Closed read of the host envelope against the selected scope and publication. */
export function admitAtlasScene(value: unknown, expected: { readonly scope: Readonly<{ workspaceId: string; homeId: string }>; readonly publicationId: string },
  textBytes: number): AtlasScene {
  budget(Number.isSafeInteger(textBytes) && textBytes <= ATLAS_LIMITS.envelopeBytes);
  const envelope = row(value, ['profile', 'scope', 'selection', 'publication', 'frame', 'artifacts', 'buildings', 'levels', 'rooms',
    'occurrences', 'meshBindings', 'plans', 'overlayBindings', 'coverage']);
  need(envelope.profile === SCENE_PROFILE);
  const scope = row(envelope.scope, ['workspaceId', 'homeId']);
  need(scope.workspaceId === expected.scope.workspaceId && scope.homeId === expected.scope.homeId);
  const selection = row(envelope.selection, ['revision', 'publicationId']);
  const publication = row(envelope.publication, ['publicationId', 'sourceRevisionId', 'sourceSha256', 'semanticsSha256']);
  need(selection.publicationId === expected.publicationId && publication.publicationId === expected.publicationId);
  const frame = row(envelope.frame, ['units', 'upAxis', 'horizontalAxes', 'geometryPlacement', 'physicalRegistration']);
  need(frame.units === 'm' && frame.upAxis === 'Y' && Array.isArray(frame.horizontalAxes) && frame.horizontalAxes.length === 2
    && frame.horizontalAxes[0] === 'X' && frame.horizontalAxes[1] === 'Z'
    && frame.geometryPlacement === 'gltf-world-after-node-transforms-once' && frame.physicalRegistration === null);
  const artifacts = list(envelope.artifacts, 1); need(artifacts.length === 1);
  const artifact = row(artifacts[0], ['artifactId', 'role', 'contentType', 'bytes', 'sha256', 'href']);
  need(artifact.artifactId === 'model' && artifact.role === 'model' && artifact.contentType === 'model/gltf-binary');
  const modelBytes = integer(artifact.bytes, 1, Number.MAX_SAFE_INTEGER);
  budget(modelBytes <= ATLAS_LIMITS.modelBytes && modelBytes + textBytes <= ATLAS_LIMITS.aggregateBytes);

  // Aggregate counts and inline sizes before any per-member allocation. Both
  // parts are measured compactly, so producer indentation does not count.
  budget(utf8Bytes(envelope.plans) <= ATLAS_LIMITS.planBytes && utf8Bytes({ ...envelope, plans: [] }) <= ATLAS_LIMITS.semanticBytes);
  const rawBindings = list(envelope.meshBindings, ATLAS_LIMITS.meshBindings);
  let memberships = 0;
  for (const item of rawBindings) { need(isRow(item) && Array.isArray(item.primitiveIndices)); memberships += item.primitiveIndices.length; }
  budget(memberships <= ATLAS_LIMITS.drawnPrimitives);
  const rawPlans = list(envelope.plans, ATLAS_LIMITS.levels);
  let points = 0;
  for (const plan of rawPlans) {
    need(isRow(plan) && Array.isArray(plan.features));
    for (const feature of plan.features) {
      need(isRow(feature) && Array.isArray(feature.polygons));
      for (const polygon of feature.polygons) {
        need(isRow(polygon) && Array.isArray(polygon.outer) && Array.isArray(polygon.holes));
        points += polygon.outer.length;
        for (const hole of polygon.holes) { need(Array.isArray(hole)); points += hole.length; }
        budget(points <= ATLAS_LIMITS.polygonPoints);
      }
    }
  }
  const rawOverlays = list(envelope.overlayBindings, ATLAS_LIMITS.overlayBindings);

  const buildings = list(envelope.buildings, ATLAS_LIMITS.buildings).map<AtlasBuilding>(item => {
    const building = row(item, ['buildingId', 'label', 'nativePlaceId', 'bounds', 'levelIds']);
    return { buildingId: id(building.buildingId), label: text(building.label, 128), nativePlaceId: nullableUuid(building.nativePlaceId),
      bounds: box(building.bounds), levelIds: ids(building.levelIds, ATLAS_LIMITS.levels) };
  });
  need(buildings.length > 0);
  const buildingById = unique(buildings, item => item.buildingId);
  const levels = list(envelope.levels, ATLAS_LIMITS.levels).map<AtlasLevel>(item => {
    const level = row(item, ['levelId', 'buildingId', 'label', 'nativePlaceId', 'sourceElevationM', 'elevationBasis', 'occurrenceIds', 'bounds']);
    need(buildingById.has(level.buildingId as string));
    return { levelId: id(level.levelId), buildingId: level.buildingId as string, label: text(level.label, 128),
      nativePlaceId: nullableUuid(level.nativePlaceId), sourceElevationM: level.sourceElevationM === null ? null : coordinate(level.sourceElevationM),
      elevationBasis: nullableText(level.elevationBasis, 256), occurrenceIds: ids(level.occurrenceIds, ATLAS_LIMITS.occurrences), bounds: box(level.bounds) };
  });
  const levelById = unique(levels, item => item.levelId);
  for (const building of buildings)
    need(sameSet(building.levelIds, levels.filter(level => level.buildingId === building.buildingId).map(level => level.levelId)));

  const rooms = list(envelope.rooms, ATLAS_LIMITS.rooms).map<AtlasRoom>(item => {
    const room = row(item, ['roomId', 'buildingId', 'label', 'nativePlaceId', 'nativeBinding', 'occurrenceIds']);
    need(buildingById.has(room.buildingId as string));
    const binding = row(room.nativeBinding, ['status', 'receiptSha256']);
    need(binding.status === 'reviewed' || binding.status === 'historical' || binding.status === 'unmapped');
    const nativePlaceId = nullableUuid(room.nativePlaceId);
    const receiptSha256 = binding.receiptSha256 === null ? null : sha(binding.receiptSha256);
    need(binding.status !== 'reviewed' || (nativePlaceId !== null && receiptSha256 !== null));
    return { roomId: id(room.roomId), buildingId: room.buildingId as string, label: text(room.label, 128), nativePlaceId,
      nativeBinding: { status: binding.status, receiptSha256 },
      // A room without occurrences keeps its unknown placement: listed, never drawn or selectable.
      occurrenceIds: ids(room.occurrenceIds, ATLAS_LIMITS.occurrences) };
  });
  const roomById = unique(rooms, item => item.roomId);
  const occurrences = list(envelope.occurrences, ATLAS_LIMITS.occurrences).map<AtlasOccurrence>(item => {
    const occurrence = row(item, ['spaceOccurrenceId', 'roomId', 'buildingId', 'levelId', 'bounds', 'planFeatureIds', 'geometryBasis']);
    const room = roomById.get(occurrence.roomId as string), level = levelById.get(occurrence.levelId as string);
    need(room && level && room.buildingId === occurrence.buildingId && level.buildingId === occurrence.buildingId);
    const basis = row(occurrence.geometryBasis, ['kind', 'sourceRef', 'note']);
    need(basis.kind === 'source-model' || basis.kind === 'owner-estimated-pick-proxy');
    return { spaceOccurrenceId: id(occurrence.spaceOccurrenceId), roomId: room.roomId, buildingId: room.buildingId, levelId: level.levelId,
      bounds: box(occurrence.bounds), planFeatureIds: ids(occurrence.planFeatureIds, ATLAS_LIMITS.polygonPoints),
      geometryBasis: { kind: basis.kind, sourceRef: nullableText(basis.sourceRef, 256), note: nullableText(basis.note, 1024) } };
  });
  const occurrenceById = unique(occurrences, item => item.spaceOccurrenceId);
  for (const room of rooms) need(sameSet(room.occurrenceIds, occurrences.filter(item => item.roomId === room.roomId).map(item => item.spaceOccurrenceId)));
  for (const level of levels) need(sameSet(level.occurrenceIds, occurrences.filter(item => item.levelId === level.levelId).map(item => item.spaceOccurrenceId)));

  const selectors = new Set<string>();
  const meshBindings = rawBindings.map<AtlasMeshBinding>(item => {
    const binding = row(item, ['artifactId', 'nodeIndex', 'meshIndex', 'primitiveIndices', 'buildingId', 'levelIds', 'spaceOccurrenceId', 'role']);
    need(binding.artifactId === 'model' && ROLES.has(binding.role as MeshRole) && buildingById.has(binding.buildingId as string));
    const nodeIndex = integer(binding.nodeIndex, 0, 0x7fffffff), meshIndex = integer(binding.meshIndex, 0, 0x7fffffff);
    const primitiveIndices = list(binding.primitiveIndices, ATLAS_LIMITS.primitivesPerBinding).map(value => integer(value, 0, 0x7fffffff));
    need(primitiveIndices.length > 0 && new Set(primitiveIndices).size === primitiveIndices.length);
    for (const primitive of primitiveIndices) { const key = `${nodeIndex}/${primitive}`; need(!selectors.has(key)); selectors.add(key); }
    const levelIds = ids(binding.levelIds, ATLAS_LIMITS.levels);
    for (const levelId of levelIds) need(levelById.get(levelId)?.buildingId === binding.buildingId);
    const spaceOccurrenceId = nullableId(binding.spaceOccurrenceId);
    const occurrence = spaceOccurrenceId === null ? null : occurrenceById.get(spaceOccurrenceId);
    need(occurrence !== undefined && (occurrence === null || occurrence.buildingId === binding.buildingId));
    // A room pick names its occurrence and that occurrence's own level.
    if (binding.role === 'room-pick') need(occurrence && levelIds.includes(occurrence.levelId));
    return { artifactId: 'model', nodeIndex, meshIndex, primitiveIndices, buildingId: binding.buildingId as string, levelIds,
      spaceOccurrenceId, role: binding.role as MeshRole };
  });

  const featureIds = new Set<string>();
  const featuresByOccurrence = new Map<string, string[]>();
  const plans = rawPlans.map<AtlasPlan>(item => {
    const plan = row(item, ['planId', 'buildingId', 'levelId', 'coordinates', 'featureIds', 'features']);
    const level = levelById.get(plan.levelId as string);
    need(level && level.buildingId === plan.buildingId && plan.coordinates === 'scene-XZ-metres');
    const features = (plan.features as unknown[]).map<AtlasPlanFeature>(value => {
      const feature = row(value, ['featureId', 'roomId', 'spaceOccurrenceId', 'role', 'polygons']);
      const featureId = id(feature.featureId); need(!featureIds.has(featureId)); featureIds.add(featureId);
      need(PLAN_ROLES.has(feature.role as PlanRole));
      const roomId = nullableId(feature.roomId), spaceOccurrenceId = nullableId(feature.spaceOccurrenceId);
      need(roomId === null || roomById.get(roomId)?.buildingId === level.buildingId);
      if (spaceOccurrenceId !== null) {
        const occurrence = occurrenceById.get(spaceOccurrenceId);
        need(occurrence && occurrence.levelId === level.levelId && (roomId === null || occurrence.roomId === roomId));
        const own = featuresByOccurrence.get(spaceOccurrenceId);
        if (own) own.push(featureId); else featuresByOccurrence.set(spaceOccurrenceId, [featureId]);
      }
      const polygons = (feature.polygons as unknown[]).map<AtlasPolygon>(polygon => {
        const shape = row(polygon, ['outer', 'holes']);
        return { outer: ring(shape.outer), holes: (shape.holes as unknown[]).map(ring) };
      });
      need(polygons.length > 0);
      return { featureId, roomId, spaceOccurrenceId, role: feature.role as PlanRole, polygons };
    });
    // The listed IDs and the features are the same set; their order may differ.
    need(sameSet(ids(plan.featureIds, ATLAS_LIMITS.polygonPoints), features.map(feature => feature.featureId)));
    return { planId: id(plan.planId), buildingId: level.buildingId, levelId: level.levelId, coordinates: 'scene-XZ-metres',
      featureIds: features.map(feature => feature.featureId), features };
  });
  unique(plans, plan => plan.planId);
  // Each occurrence lists exactly its own plan features.
  for (const occurrence of occurrences) for (const featureId of occurrence.planFeatureIds) need(featureIds.has(featureId));
  for (const occurrence of occurrences) {
    need(sameSet(featuresByOccurrence.get(occurrence.spaceOccurrenceId) ?? [], occurrence.planFeatureIds));
  }

  const overlayBindings = rawOverlays.map<AtlasOverlayBinding>(item => {
    const binding = row(item, ['publicationId', 'kind', 'sourceRevision', 'sourceUpdatedAt', 'retrievedAt', 'roomId', 'spaceOccurrenceId',
      'nativePlaceId', 'recordIds', 'anchor']);
    need(binding.kind === 'electrical' || binding.kind === 'network');
    return { publicationId: id(binding.publicationId), kind: binding.kind, sourceRevision: text(binding.sourceRevision, 128),
      sourceUpdatedAt: nullableText(binding.sourceUpdatedAt, 64), retrievedAt: nullableText(binding.retrievedAt, 64),
      roomId: id(binding.roomId), spaceOccurrenceId: nullableId(binding.spaceOccurrenceId), nativePlaceId: nullableUuid(binding.nativePlaceId),
      // An empty set is a valid source answer; its provenance is kept and it shows no count.
      recordIds: ids(binding.recordIds, ATLAS_LIMITS.recordsPerBinding), anchor: overlayAnchor(binding.anchor) };
  });

  const coverage = admitCoverage(envelope.coverage, occurrenceById, meshBindings, plans);
  return {
    profile: SCENE_PROFILE,
    scope: { workspaceId: scope.workspaceId as string, homeId: scope.homeId as string },
    selection: { revision: revisionText(selection.revision), publicationId: expected.publicationId },
    publication: { publicationId: expected.publicationId, sourceRevisionId: text(publication.sourceRevisionId, 256),
      sourceSha256: sha(publication.sourceSha256), semanticsSha256: sha(publication.semanticsSha256) },
    model: { bytes: modelBytes, sha256: sha(artifact.sha256), href: text(artifact.href, 2048) },
    buildings, levels, rooms, occurrences, meshBindings, plans, overlayBindings, coverage,
  };
}

function overlayAnchor(value: unknown): OverlayAnchor {
  if (isRow(value) && value.kind === 'room-summary') { row(value, ['kind']); return { kind: 'room-summary' }; }
  const anchor = row(value, ['kind', 'position', 'basis']); need(anchor.kind === 'source-position');
  return { kind: 'source-position', position: vec3(anchor.position), basis: text(anchor.basis, 1024) };
}

function ring(value: unknown): PlanRing {
  const points = list(value, ATLAS_LIMITS.polygonPoints).map(point => {
    const pair = tuple(point, 2); return [coordinate(pair[0]), coordinate(pair[1])] as const;
  });
  need(points.length >= 3); return points;
}

function occurrenceList(value: unknown, known: ReadonlyMap<string, AtlasOccurrence>): { readonly ids: readonly string[] | null; readonly count: number } {
  if (typeof value === 'number') return { ids: null, count: integer(value, 0, ATLAS_LIMITS.occurrences) };
  const items = ids(value, ATLAS_LIMITS.occurrences);
  for (const item of items) need(known.has(item));
  return { ids: items, count: items.length };
}

/** Coverage is checked, never trusted: every selectable occurrence has room-pick
 * membership and its own room plan polygons. */
function admitCoverage(value: unknown, occurrences: ReadonlyMap<string, AtlasOccurrence>, bindings: readonly AtlasMeshBinding[],
  plans: readonly AtlasPlan[]): AtlasCoverage {
  const coverage = row(value, ['selectableOccurrences', 'unselectableOccurrences', 'exclusions']);
  const selectable = occurrenceList(coverage.selectableOccurrences, occurrences);
  const unselectable = occurrenceList(coverage.unselectableOccurrences, occurrences);
  const picks = new Set(bindings.flatMap(binding => binding.role === 'room-pick' && binding.spaceOccurrenceId !== null ? [binding.spaceOccurrenceId] : []));
  const planned = new Set(plans.flatMap(plan => plan.features.flatMap(feature => feature.role === 'room' && feature.spaceOccurrenceId !== null ? [feature.spaceOccurrenceId] : [])));
  const complete = [...occurrences.keys()].filter(key => picks.has(key) && planned.has(key));
  if (selectable.ids) for (const key of selectable.ids) need(picks.has(key) && planned.has(key));
  else need(selectable.count === complete.length);
  if (selectable.ids && unselectable.ids) need(sameSet([...selectable.ids, ...unselectable.ids], [...occurrences.keys()]));
  else need(selectable.count + unselectable.count === occurrences.size);
  const exclusions = list(coverage.exclusions, ATLAS_LIMITS.occurrences).map<AtlasExclusion>(item => {
    if (typeof item === 'string') return { id: null, reason: text(item, 1024) };
    need(isRow(item));
    // The exclusion shape is producer text; it is shown, never interpreted.
    const reason = [item.reason, item.note, item.detail].find(part => typeof part === 'string');
    const key = [item.spaceOccurrenceId, item.occurrenceId, item.roomId, item.id].find(part => typeof part === 'string');
    return { id: key === undefined ? null : id(key), reason: reason === undefined ? null : text(reason, 1024) };
  });
  return { selectable: selectable.ids, selectableCount: selectable.count, unselectable: unselectable.ids,
    unselectableCount: unselectable.count, exclusions };
}

// ---------------------------------------------------------------------------
// Binding to the pinned GLB

export interface AtlasPart {
  readonly mesh: PreparedMesh;
  readonly role: MeshRole;
  readonly buildingId: string;
  readonly levelIds: readonly string[];
  /** The one level this part moves with when exploded; null for shared or level-free parts. */
  readonly levelId: string | null;
  /** Set only for room-pick parts. */
  readonly occurrenceId: string | null;
}
export interface LabelAnchor { readonly x: number; readonly z: number; readonly clearance: number }
export interface OverlayPlacement {
  readonly kind: OverlayKind;
  readonly roomId: string;
  /** Exactly this occurrence; room-summary bindings are expanded separately. */
  readonly occurrenceId: string;
  /** Available without materializing a mixed occurrence's detail arrays. */
  readonly recordCount: number;
  readonly recordIds: readonly string[];
  /** Qualified source positions with their occurrence; never derived from a room link. */
  readonly positions: readonly { readonly occurrenceId: string; readonly position: Vec3; readonly basis: string }[];
  readonly bindings: readonly AtlasOverlayBinding[];
}
export type UnplacedReason = 'other-publication' | 'room-absent' | 'not-linked' | 'occurrence-mismatch' | 'no-placement' | 'not-selectable';
export interface OverlayLayerIndex {
  readonly kind: OverlayKind;
  readonly placed: ReadonlyMap<string, OverlayPlacement>; // keyed by occurrence ID
  readonly unplaced: readonly { readonly binding: AtlasOverlayBinding; readonly reason: UnplacedReason }[];
  readonly records: number;
  readonly unplacedRecords: number;
}
export interface AtlasModel {
  readonly scene: AtlasScene;
  readonly parts: readonly AtlasPart[];
  readonly meshes: readonly PreparedMesh[];
  readonly buildingsById: ReadonlyMap<string, AtlasBuilding>;
  readonly levelsById: ReadonlyMap<string, AtlasLevel>;
  readonly roomsById: ReadonlyMap<string, AtlasRoom>;
  readonly occurrencesById: ReadonlyMap<string, AtlasOccurrence>;
  /** Levels per building, lowest floor first by actual scene height. */
  readonly levelsByBuilding: ReadonlyMap<string, readonly AtlasLevel[]>;
  /** Buildings with floors, in source order. Groups without floors are drawn as context only. */
  readonly floorBuildings: readonly AtlasBuilding[];
  /** The building shown when nothing more specific is chosen: the first with a plan, else the first with floors. */
  readonly defaultBuildingId: string | null;
  readonly levelIndex: ReadonlyMap<string, number>;
  /** Lowest room floor of each level in the scene frame (level bounds when it has no rooms). */
  readonly floorY: ReadonlyMap<string, number>;
  /** Display gap per building for exploded floors. */
  readonly spread: ReadonlyMap<string, number>;
  /** All authored plans for each level, preserving source order and IDs. */
  readonly plansByLevel: ReadonlyMap<string, readonly AtlasPlan[]>;
  readonly featureRings: ReadonlyMap<string, readonly PlanRing[]>;
  /** Room plan shape of each occurrence: its own features only. */
  readonly shapes: ReadonlyMap<string, PlanShape>;
  /** The same room features with their outer/hole grouping kept. */
  readonly roomPolygons: ReadonlyMap<string, readonly AtlasPolygon[]>;
  readonly labels: ReadonlyMap<string, LabelAnchor>;
  readonly selectable: ReadonlySet<string>;
  readonly pickParts: ReadonlyMap<string, readonly AtlasPart[]>;
  readonly overlays: ReadonlyMap<OverlayKind, OverlayLayerIndex>;
}

const median = (values: readonly number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0; };
const ringRings = (feature: AtlasPlanFeature): readonly PlanRing[] => feature.polygons.flatMap(polygon => [polygon.outer, ...polygon.holes]);

/** Matches every declared selector to exactly one actual loader primitive and
 * every loader primitive to exactly one declaration. */
export function bindAtlasModel(scene: AtlasScene, glb: Pick<StandardGlb, 'drawn' | 'meshes'>): AtlasModel {
  need(glb.drawn.length === glb.meshes.length);
  const drawnAt = new Map<string, number>();
  glb.drawn.forEach((drawn, at) => {
    need(drawn.nodeIndex !== null && drawn.meshIndex !== null && drawn.primitiveIndex !== null && glb.meshes[at]!.meshKey === drawn.meshKey);
    const key = `${drawn.nodeIndex}/${drawn.meshIndex}/${drawn.primitiveIndex}`; need(!drawnAt.has(key)); drawnAt.set(key, at);
  });
  // Dense from the start, so an unclaimed primitive is a visible gap, never a skipped hole.
  const claimed: (AtlasPart | undefined)[] = Array.from({ length: glb.meshes.length }, () => undefined);
  let claims = 0;
  for (const binding of scene.meshBindings) for (const primitive of binding.primitiveIndices) {
    const at = drawnAt.get(`${binding.nodeIndex}/${binding.meshIndex}/${primitive}`);
    need(at !== undefined && claimed[at] === undefined);
    claims++;
    const occurrenceId = binding.role === 'room-pick' ? binding.spaceOccurrenceId : null;
    const levelId = binding.levelIds.length === 1 ? binding.levelIds[0]! : null;
    const source = glb.meshes[at]!;
    claimed[at] = { mesh: { ...source, floorId: levelId, occurrenceId }, role: binding.role, buildingId: binding.buildingId,
      levelIds: binding.levelIds, levelId, occurrenceId };
  }
  // Explicit building and level membership for every drawn primitive.
  need(claims === glb.meshes.length && claimed.every(part => part !== undefined));
  const parts = claimed as AtlasPart[];

  const buildingsById = new Map(scene.buildings.map(item => [item.buildingId, item]));
  const levelsById = new Map(scene.levels.map(item => [item.levelId, item]));
  const roomsById = new Map(scene.rooms.map(item => [item.roomId, item]));
  const occurrencesById = new Map(scene.occurrences.map(item => [item.spaceOccurrenceId, item]));
  const floorY = new Map(scene.levels.map(level => {
    const own = level.occurrenceIds.map(key => occurrencesById.get(key)!.bounds.min[1]);
    return [level.levelId, own.length ? Math.min(...own) : level.bounds.min[1]] as const;
  }));
  const levelsByBuilding = new Map<string, readonly AtlasLevel[]>(), levelIndex = new Map<string, number>(), spread = new Map<string, number>();
  for (const building of scene.buildings) {
    const order = building.levelIds.map(key => levelsById.get(key)!);
    const sorted = order.map((level, at) => ({ level, at })).sort((a, b) => floorY.get(a.level.levelId)! - floorY.get(b.level.levelId)! || a.at - b.at).map(item => item.level);
    levelsByBuilding.set(building.buildingId, sorted);
    sorted.forEach((level, at) => levelIndex.set(level.levelId, at));
    // A display gap close to one actual storey; never a source elevation.
    const heights = sorted.map(level => level.bounds.max[1] - level.bounds.min[1]).filter(height => height > 0);
    spread.set(building.buildingId, Math.min(6, Math.max(2, median(heights) || building.bounds.max[1] - building.bounds.min[1])));
  }
  const plansByLevel = new Map<string, AtlasPlan[]>();
  for (const plan of scene.plans) {
    let own = plansByLevel.get(plan.levelId);
    if (!own) { own = []; plansByLevel.set(plan.levelId, own); }
    own.push(plan);
  }
  for (const own of plansByLevel.values()) Object.freeze(own);
  const floorBuildings = scene.buildings.filter(building => building.levelIds.length > 0);
  const defaultBuildingId = (floorBuildings.find(building => building.levelIds.some(levelId => plansByLevel.has(levelId))) ?? floorBuildings[0])?.buildingId ?? null;
  const featureRings = new Map(scene.plans.flatMap(plan => plan.features.map(feature => [feature.featureId, ringRings(feature)] as const)));
  const shapes = new Map<string, PlanShape[number][]>(), roomPolygons = new Map<string, AtlasPolygon[]>();
  for (const plan of scene.plans) for (const feature of plan.features) if (feature.role === 'room' && feature.spaceOccurrenceId !== null) {
    let shape = shapes.get(feature.spaceOccurrenceId), polygons = roomPolygons.get(feature.spaceOccurrenceId);
    if (!shape) { shape = []; shapes.set(feature.spaceOccurrenceId, shape); }
    if (!polygons) { polygons = []; roomPolygons.set(feature.spaceOccurrenceId, polygons); }
    shape.push(featureRings.get(feature.featureId)!);
    for (const polygon of feature.polygons) polygons.push(polygon);
  }
  const pickParts = new Map<string, AtlasPart[]>();
  for (const part of parts) if (part.occurrenceId !== null && part.mesh.triangles > 0) {
    let own = pickParts.get(part.occurrenceId);
    if (!own) { own = []; pickParts.set(part.occurrenceId, own); }
    own.push(part);
    pickTree(part.mesh);
  }
  for (const entries of shapes.values()) Object.freeze(entries);
  for (const entries of roomPolygons.values()) Object.freeze(entries);
  for (const entries of pickParts.values()) Object.freeze(entries);
  const listed = scene.coverage.selectable ?? scene.occurrences.map(item => item.spaceOccurrenceId);
  const selectable = new Set(listed.filter(key => pickParts.has(key) && shapes.has(key)));
  // Listed coverage must survive binding to the actual primitives.
  if (scene.coverage.selectable) need(selectable.size === scene.coverage.selectable.length);
  else need(selectable.size === scene.coverage.selectableCount);
  const work = { remaining: LABEL_WORK }, labels = new Map<string, LabelAnchor>();
  for (const key of selectable) { const point = labelPoint(shapes.get(key)!, work); if (point) labels.set(key, point); }
  return { scene, parts, meshes: parts.map(part => part.mesh), buildingsById, levelsById, roomsById, occurrencesById, levelsByBuilding,
    floorBuildings, defaultBuildingId, levelIndex, floorY, spread, plansByLevel, featureRings, shapes, roomPolygons, labels, selectable, pickParts, overlays: joinOverlays(scene, roomsById, occurrencesById, selectable) };
}

/** Rendering and framing consume every plan for a level, in source order. */
export const planFeaturesForLevel = (model: AtlasModel, levelId: string): readonly AtlasPlanFeature[] =>
  model.plansByLevel.get(levelId)?.flatMap(plan => plan.features) ?? [];

/** Joins host-qualified overlay bindings by publication, room and its reviewed
 * native place only. Labels, record text and positions never create a link. */
function joinOverlays(scene: AtlasScene, rooms: ReadonlyMap<string, AtlasRoom>, occurrences: ReadonlyMap<string, AtlasOccurrence>, selectable: ReadonlySet<string>): ReadonlyMap<OverlayKind, OverlayLayerIndex> {
  const roomTargets = new Map([...rooms.values()].map(room => [room.roomId, room.occurrenceIds.filter(id => selectable.has(id))]));
  const layers = new Map<OverlayKind, OverlayLayerIndex>();
  for (const kind of ['electrical', 'network'] as const) {
    type Group = { records: Set<string>; bindings: AtlasOverlayBinding[]; positions: OverlayPlacement['positions'][number][]; recordIds: readonly string[] };
    const common = new Map<string, Group>(), local = new Map<string, Group>();
    const order = new Map<AtlasOverlayBinding, number>(), candidates = new Set<string>();
    const allRecords = new Set<string>(), unplacedIds = new Set<string>();
    const group = (): Group => ({ records: new Set(), bindings: [], positions: [], recordIds: [] });
    const unplaced: { binding: AtlasOverlayBinding; reason: UnplacedReason }[] = [];
    for (const [ordinal, binding] of scene.overlayBindings.entries()) {
      if (binding.kind !== kind) continue;
      order.set(binding, ordinal);
      for (const record of binding.recordIds) allRecords.add(record);
      const room = rooms.get(binding.roomId), occurrence = binding.spaceOccurrenceId === null ? null : occurrences.get(binding.spaceOccurrenceId);
      const reason: UnplacedReason | null = binding.publicationId !== scene.publication.publicationId ? 'other-publication'
        : !room ? 'room-absent'
        : room.nativeBinding.status !== 'reviewed' || room.nativePlaceId === null || binding.nativePlaceId !== room.nativePlaceId ? 'not-linked'
        : occurrence === undefined || (occurrence !== null && occurrence.roomId !== room.roomId) ? 'occurrence-mismatch'
        : room.occurrenceIds.length === 0 ? 'no-placement'
        : (occurrence !== null && !selectable.has(occurrence.spaceOccurrenceId)) || roomTargets.get(room.roomId)!.length === 0 ? 'not-selectable' : null;
      if (reason !== null || !room) {
        unplaced.push({ binding, reason: reason ?? 'room-absent' });
        for (const record of binding.recordIds) unplacedIds.add(record);
        continue;
      }
      const groups = occurrence ? local : common, key = occurrence ? occurrence.spaceOccurrenceId : room.roomId;
      let own = groups.get(key);
      if (!own) {
        own = group(); groups.set(key, own);
        // Expand membership once per group, never records or provenance per occurrence.
        for (const id of occurrence ? [occurrence.spaceOccurrenceId] : roomTargets.get(room.roomId)!) candidates.add(id);
      }
      for (const record of binding.recordIds) own.records.add(record);
      own.bindings.push(binding);
      if (binding.anchor.kind === 'source-position' && occurrence)
        own.positions.push({ occurrenceId: occurrence.spaceOccurrenceId, position: binding.anchor.position, basis: binding.anchor.basis });
    }
    for (const own of [...common.values(), ...local.values()]) {
      own.recordIds = Object.freeze([...own.records]); Object.freeze(own.bindings); Object.freeze(own.positions);
    }
    const emptyPositions: OverlayPlacement['positions'] = Object.freeze([]);
    const rows = new Map<string, OverlayPlacement>();
    for (const occurrenceId of candidates) {
      const roomId = occurrences.get(occurrenceId)!.roomId, shared = common.get(roomId), specific = local.get(occurrenceId);
      const only = (shared ?? specific)!;
      // Mixed details merge source entries only when requested by the selected inspector.
      // Do not cache them on every occurrence: common records/bindings stay shared.
      const bindings = (): readonly AtlasOverlayBinding[] => {
        if (!shared || !specific) return only.bindings;
        const merged: AtlasOverlayBinding[] = []; let a = 0, b = 0;
        while (a < shared.bindings.length || b < specific.bindings.length) {
          if (b >= specific.bindings.length || (a < shared.bindings.length && order.get(shared.bindings[a]!)! < order.get(specific.bindings[b]!)!))
            merged.push(shared.bindings[a++]!);
          else merged.push(specific.bindings[b++]!);
        }
        return merged;
      };
      let recordCount = only.records.size;
      if (shared && specific) {
        recordCount = shared.records.size;
        for (const record of specific.records) if (!shared.records.has(record)) recordCount++;
      }
      rows.set(occurrenceId, { kind, roomId, occurrenceId, recordCount,
        get recordIds() {
          if (!shared || !specific) return only.recordIds;
          const records = new Set<string>();
          for (const binding of bindings()) for (const record of binding.recordIds) records.add(record);
          return [...records];
        },
        get bindings() { return bindings(); },
        positions: specific?.positions ?? emptyPositions });
    }
    layers.set(kind, { kind, placed: rows, unplaced,
      records: allRecords.size, unplacedRecords: unplacedIds.size });
  }
  return layers;
}

/** Distinct record IDs per unplaced reason, counted like the layer total. One
 * record may have several reasons, so these need not sum to that total. */
export function unplacedByReason(layer: OverlayLayerIndex): ReadonlyMap<UnplacedReason, number> {
  const reasons = new Map<UnplacedReason, Set<string>>();
  for (const row of layer.unplaced) {
    let own = reasons.get(row.reason);
    if (!own) { own = new Set(); reasons.set(row.reason, own); }
    for (const record of row.binding.recordIds) own.add(record);
  }
  return new Map([...reasons].flatMap(([reason, records]) => records.size > 0 ? [[reason, records.size] as const] : []));
}

// ---------------------------------------------------------------------------
// View state

export type AtlasViewMode = '3d' | 'plan';
/** Independent layers: any combination may be on, and selection never filters them. */
export type AtlasLayer = OverlayKind | 'measurements';
export type AtlasLayers = Readonly<Record<AtlasLayer, boolean>>;
export const NO_LAYERS: AtlasLayers = Object.freeze({ electrical: false, network: false, measurements: false });
export const ATLAS_LAYERS: readonly AtlasLayer[] = Object.freeze(['electrical', 'network', 'measurements']);
/** Property → building → floor → room, independent of the camera and of 3D or Plan. */
export interface AtlasViewState {
  /** null is the whole property. */
  readonly buildingId: string | null;
  /** null shows the whole building. */
  readonly levelId: string | null;
  readonly occurrenceId: string | null;
  readonly view: AtlasViewMode;
  /** Physical floor separation; set only by the explicit Exploded control. */
  readonly exploded: boolean;
  readonly layers: AtlasLayers;
}
export type AtlasAction =
  | { readonly type: 'select'; readonly occurrenceId: string | null }
  | { readonly type: 'building'; readonly buildingId: string | null }
  | { readonly type: 'level'; readonly levelId: string | null }
  | { readonly type: 'view'; readonly view: AtlasViewMode }
  | { readonly type: 'explode'; readonly exploded: boolean }
  | { readonly type: 'layer'; readonly layer: AtlasLayer; readonly on: boolean }
  /** One level out: room → floor → building → property. */
  | { readonly type: 'out' };

/** Explosion separates levels within a building, never separate buildings. */
export function hasExplodableLevels(model: AtlasModel, buildingId: string | null): boolean {
  return buildingId === null ? model.floorBuildings.some(building => building.levelIds.length > 1)
    : (model.levelsByBuilding.get(buildingId)?.length ?? 0) > 1;
}

/** Opens on the host-bound entry building when it has floors; an explicit
 * context-only entry opens the property. With no entry, opens on the only
 * building with floors, else the property. Names, plan order and size never
 * choose an entry. Floors
 * open in their source positions; only the explicit control separates them. */
export function initialAtlasState(model: AtlasModel, entryBuildingId: string | null = null): AtlasViewState {
  const entry = entryBuildingId !== null && model.floorBuildings.some(building => building.buildingId === entryBuildingId) ? entryBuildingId : null;
  const single = model.floorBuildings.length === 1 ? model.floorBuildings[0]!.buildingId : null;
  return { buildingId: entryBuildingId === null ? single : entry, levelId: null, occurrenceId: null, view: '3d', exploded: false, layers: NO_LAYERS };
}

/** The building a plan or floor list follows: the chosen one, else the selected room's, else the default. */
export function focusBuildingId(model: AtlasModel, state: AtlasViewState): string | null {
  const selected = state.occurrenceId === null ? undefined : model.occurrencesById.get(state.occurrenceId);
  return state.buildingId ?? selected?.buildingId ?? model.defaultBuildingId;
}

/** The floor a plan shows: the chosen floor, else the selected room's, else the lowest with a plan. */
export function planLevelId(model: AtlasModel, state: AtlasViewState): string | null {
  if (state.levelId !== null) return state.levelId;
  const selected = state.occurrenceId === null ? undefined : model.occurrencesById.get(state.occurrenceId);
  const buildingId = focusBuildingId(model, state);
  if (buildingId === null) return null;
  if (selected && selected.buildingId === buildingId) return selected.levelId;
  const levels = model.levelsByBuilding.get(buildingId) ?? [];
  return (levels.find(level => model.plansByLevel.has(level.levelId)) ?? levels[0])?.levelId ?? null;
}

export function atlasReducer(model: AtlasModel, state: AtlasViewState, action: AtlasAction): AtlasViewState {
  switch (action.type) {
    case 'select': {
      if (action.occurrenceId === null) return state.occurrenceId === null ? state : { ...state, occurrenceId: null };
      const occurrence = model.occurrencesById.get(action.occurrenceId);
      if (!occurrence || !model.selectable.has(occurrence.spaceOccurrenceId)) return state;
      // Semantic ancestry stays complete even when Exploded displays every floor.
      return { ...state, occurrenceId: occurrence.spaceOccurrenceId, buildingId: occurrence.buildingId,
        levelId: occurrence.levelId };
    }
    case 'building': {
      if (action.buildingId !== null && !model.floorBuildings.some(row => row.buildingId === action.buildingId)) return state;
      if (action.buildingId === state.buildingId && state.levelId === null && state.occurrenceId === null) return state;
      return { ...state, buildingId: action.buildingId, levelId: null, occurrenceId: null };
    }
    case 'level': {
      const selected = state.occurrenceId === null ? undefined : model.occurrencesById.get(state.occurrenceId);
      if (action.levelId === null) {
        if (state.levelId === null && state.occurrenceId === null) return state;
        return { ...state, levelId: null, occurrenceId: null };
      }
      const level = model.levelsById.get(action.levelId);
      if (!level) return state;
      // The current floor again leaves its room for the floor itself.
      if (state.levelId === level.levelId && state.buildingId === level.buildingId)
        return state.occurrenceId === null ? state : { ...state, occurrenceId: null };
      return { ...state, buildingId: level.buildingId, levelId: level.levelId,
        occurrenceId: selected?.levelId === level.levelId ? state.occurrenceId : null };
    }
    // Plan and 3D show the same building, floor, room and layers.
    case 'view': return action.view === state.view ? state : { ...state, view: action.view };
    case 'explode': return state.exploded === action.exploded ? state : { ...state, exploded: action.exploded };
    case 'layer': return state.layers[action.layer] === action.on ? state : { ...state, layers: { ...state.layers, [action.layer]: action.on } };
    case 'out': {
      if (state.occurrenceId !== null) {
        const occurrence = model.occurrencesById.get(state.occurrenceId);
        return { ...state, occurrenceId: null, buildingId: occurrence?.buildingId ?? state.buildingId,
          levelId: occurrence?.levelId ?? state.levelId };
      }
      if (state.levelId !== null) return { ...state, levelId: null };
      if (state.buildingId !== null) return { ...state, buildingId: null };
      return state;
    }
  }
}

/** Each building's lowest floor with a plan, in source building order: the property plan. */
export function sitePlanLevels(model: AtlasModel): readonly string[] {
  return model.floorBuildings.flatMap(building => {
    const level = (model.levelsByBuilding.get(building.buildingId) ?? []).find(item => model.plansByLevel.has(item.levelId));
    return level ? [level.levelId] : [];
  });
}

/** Other occurrences of the selected logical room, through explicit membership only. */
export function contextOccurrenceIds(model: AtlasModel, occurrenceId: string | null): readonly string[] {
  if (occurrenceId === null) return [];
  const room = model.roomsById.get(model.occurrencesById.get(occurrenceId)?.roomId ?? '');
  return room ? room.occurrenceIds.filter(key => key !== occurrenceId && model.selectable.has(key)) : [];
}

// ---------------------------------------------------------------------------
// Presentation: one rule set for drawing, picking, plans, labels and anchors

export interface AtlasPresentation {
  /** Full exploded display offset per level (metres); scaled by the eased explode factor. */
  readonly offsets: ReadonlyMap<string, number>;
  readonly explodeTarget: 0 | 1;
  readonly visibleLevels: ReadonlySet<string>;
  /** Mesh keys left out of the drawing; room picks stay pickable while hidden. */
  readonly hidden: ReadonlySet<string>;
  /** Section height per mesh in its own source frame; null draws full height. */
  readonly clips: ReadonlyMap<string, number | null>;
  readonly dims: ReadonlyMap<string, number>;
  /** Occurrences that can be picked in the current state. */
  readonly pickable: ReadonlySet<string>;
  readonly focusLevelId: string | null;
  /** Floors drawn as plans: the focus floor, or each building's lowest planned floor for the property. */
  readonly planLevels: readonly string[];
  /** Faded cutaway in normal (unexploded) 3D: null fades a whole hidden part,
   * a height fades only what lies above that section. Never picked. */
  readonly ghosts: ReadonlyMap<string, number | null>;
}

const sectionOf = (model: AtlasModel, levelId: string) => model.floorY.get(levelId)! + SECTION_HEIGHT;
const GHOST_ROLES: ReadonlySet<MeshRole> = new Set(['structure', 'roof', 'slab']);

export function presentAtlas(model: AtlasModel, state: AtlasViewState, highlighted: ReadonlySet<string>): AtlasPresentation {
  const plan = state.view === 'plan';
  // Plan shows a floor of the chosen building without changing the chosen scope.
  const focusLevelId = plan ? (state.buildingId === null ? null : planLevelId(model, state)) : state.levelId;
  const planLevels = !plan ? [] : focusLevelId !== null ? [focusLevelId] : sitePlanLevels(model);
  const planned = new Set(planLevels);
  const exploded = state.exploded && !plan && hasExplodableLevels(model, state.buildingId);
  const offsets = new Map<string, number>();
  for (const [buildingId, levels] of model.levelsByBuilding) levels.forEach((level, at) => offsets.set(level.levelId, at * model.spread.get(buildingId)!));
  const focusIndex = focusLevelId === null ? null : model.levelIndex.get(focusLevelId)!;
  const focusBuilding = focusLevelId === null ? state.buildingId : model.levelsById.get(focusLevelId)!.buildingId;
  const visibleLevels = new Set<string>();
  for (const level of model.scene.levels) {
    const own = focusBuilding === null || level.buildingId === focusBuilding;
    const shown = plan ? planned.has(level.levelId)
      : !own || focusIndex === null || exploded || model.levelIndex.get(level.levelId)! <= focusIndex;
    if (shown) visibleLevels.add(level.levelId);
  }
  const hidden = new Set<string>(), clips = new Map<string, number | null>(), dims = new Map<string, number>();
  for (const part of model.parts) {
    const key = part.mesh.meshKey, own = focusBuilding === null || part.buildingId === focusBuilding;
    const partExploded = exploded && hasExplodableLevels(model, part.buildingId);
    const members = part.levelIds.map(levelId => model.levelIndex.get(levelId)!);
    const highest = part.levelIds.reduce<string | null>((best, levelId) => best === null || model.levelIndex.get(levelId)! > model.levelIndex.get(best)! ? levelId : best, null);
    let visible: boolean, clip: number | null = null, dim = 0;
    if (part.role === 'context') { visible = !plan; dim = focusLevelId !== null || state.buildingId !== null ? .35 : 0; }
    else if (!own) { visible = !plan && !(part.role === 'roof' && partExploded); dim = .6; clip = partExploded && highest ? sectionOf(model, highest) : null; }
    else if (part.role === 'roof') visible = !plan && !partExploded && focusLevelId === null;
    else if (plan) {
      const shown = part.levelIds.find(levelId => planned.has(levelId));
      visible = shown !== undefined;
      clip = shown === undefined ? null : sectionOf(model, shown);
    } else if (part.levelId !== null) {
      visible = visibleLevels.has(part.levelId);
      clip = partExploded ? sectionOf(model, part.levelId) : focusLevelId !== null ? sectionOf(model, focusLevelId) : null;
      dim = focusLevelId !== null && part.levelId !== focusLevelId ? .5 : 0;
    } else {
      // Shared or level-free geometry stays at its source position.
      visible = focusIndex === null || partExploded || members.length === 0 || Math.min(...members) <= focusIndex;
      clip = partExploded ? (highest ? sectionOf(model, highest) : null) : focusLevelId !== null ? sectionOf(model, focusLevelId) : null;
      dim = partExploded ? .4 : focusLevelId !== null ? .3 : 0;
    }
    if (part.role === 'room-pick' && (part.occurrenceId === null || !highlighted.has(part.occurrenceId))) visible = false;
    if (!visible) hidden.add(key);
    clips.set(key, clip);
    if (dim > 0) dims.set(key, dim);
  }
  // Rooms are picked on the focus floor, or anywhere in an exploded building;
  // other visible geometry resolves to its floor or building instead.
  const pickable = new Set<string>();
  for (const key of model.selectable) {
    const occurrence = model.occurrencesById.get(key)!;
    if (exploded ? visibleLevels.has(occurrence.levelId) && (state.buildingId === null || occurrence.buildingId === state.buildingId)
      : focusLevelId !== null && occurrence.levelId === focusLevelId) pickable.add(key);
  }
  // Normal cutaway keeps every floor in its source position and fades the
  // roof and the floors above the focus instead of separating them.
  const ghosts = new Map<string, number | null>();
  if (!plan && !exploded && focusLevelId !== null) for (const part of model.parts) {
    if (part.buildingId !== focusBuilding || !GHOST_ROLES.has(part.role) || part.mesh.triangles === 0) continue;
    const key = part.mesh.meshKey, clip = clips.get(key) ?? null;
    if (hidden.has(key)) ghosts.set(key, null);
    else if (clip !== null && clip < part.mesh.yRange[1]) ghosts.set(key, clip);
  }
  return { offsets, explodeTarget: exploded ? 1 : 0, visibleLevels, hidden, clips, dims, pickable, focusLevelId, planLevels, ghosts };
}

// ---------------------------------------------------------------------------
// Transitions: one section plane per building with floors, and the explode factor

const highestLevel = (model: AtlasModel, levelIds: readonly string[]) =>
  levelIds.reduce<string | null>((best, levelId) => best === null || model.levelIndex.get(levelId)! > model.levelIndex.get(best)! ? levelId : best, null);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Rest height of each building's section plane, in `floorBuildings` order:
 * just above its drawn geometry, so it cuts nothing. */
export function sectionCeilings(model: AtlasModel): readonly number[] {
  const tops = new Map<string, number>();
  for (const part of model.parts) if (part.role !== 'context' && part.mesh.triangles > 0)
    tops.set(part.buildingId, Math.max(tops.get(part.buildingId) ?? -Infinity, part.mesh.bounds.max[1]));
  return model.floorBuildings.map(building => (tops.get(building.buildingId) ?? building.bounds.max[1]) + .01);
}

/** Height each section plane settles at: the focus floor's section when that
 * building is stacked or in plan, else its ceiling. */
export function sectionTargets(model: AtlasModel, presentation: AtlasPresentation, ceilings: readonly number[]): readonly number[] {
  const focus = presentation.focusLevelId;
  const focusBuilding = focus === null ? null : model.levelsById.get(focus)!.buildingId;
  return model.floorBuildings.map((building, at) => building.buildingId === focusBuilding && presentation.explodeTarget === 0
    ? Math.min(ceilings[at]!, sectionOf(model, focus!)) : ceilings[at]!);
}

/** Centre of all building bounds: the fixed datum eased values are taken
 * against, so their settle tolerance never depends on where the source frame
 * places the model. */
export function atlasOrigin(model: AtlasModel): Vec3 {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const building of model.scene.buildings) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis]!, building.bounds.min[axis]!); max[axis] = Math.max(max[axis]!, building.bounds.max[axis]!);
  }
  return [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2];
}

/** Section heights as easing goals, relative to the datum height. A 3 m move
 * near source Y = 100 000 m must ease like the same move near 0 m. */
export const sectionGoals = (targets: readonly number[], datum: number): Record<string, number> =>
  Object.fromEntries(targets.map((target, at) => [`s${at}`, target - datum]));

/** Eased goals back in source Y. A settled goal returns its exact target, so
 * settled and reduced-motion presentations are the target presentation. */
export const sectionCuts = (eased: Readonly<Record<string, number>>, targets: readonly number[], datum: number): readonly number[] =>
  targets.map((target, at) => { const value = eased[`s${at}`]!; return value === target - datum ? target : value + datum; });

/** The presentation at eased section heights `cuts` and explode factor t.
 * Floors above a new focus are cut away by their building's moving section
 * instead of vanishing; exploded walls lower to their own sections as floors
 * part, and the roof is cut away first. Hidden parts are drawn again only while
 * their building's section or the explosion still moves, and settled values
 * return the target presentation itself. A target-pickable room stays pickable
 * only while one of its pick parts is below its current cut, the same test the
 * picker applies; drawing, picking, labels and markers all use the result, so
 * no room control stands where its floor is not yet revealed. */
export function easePresentation(model: AtlasModel, presentation: AtlasPresentation, t: number,
  cuts: readonly number[], targets: readonly number[], ceilings: readonly number[]): AtlasPresentation {
  const exploding = t !== presentation.explodeTarget;
  const cutting = cuts.map((cut, at) => cut !== targets[at]);
  if (!exploding && !cutting.some(Boolean)) return presentation;
  const plan = presentation.planLevels.length > 0;
  const index = new Map(model.floorBuildings.map((building, at) => [building.buildingId, at]));
  const explodable = new Map<string, boolean>();
  const hidden = new Set<string>(), clips = new Map<string, number | null>(), ghosts = new Map<string, number | null>();
  for (const part of model.parts) {
    const key = part.mesh.meshKey, was = presentation.hidden.has(key);
    if (part.role === 'context' || part.mesh.triangles === 0) {
      if (was) hidden.add(key);
      clips.set(key, presentation.clips.get(key) ?? null); continue;
    }
    const at = index.get(part.buildingId);
    const cut = at === undefined || cuts[at]! >= ceilings[at]! - 1e-3 ? null : cuts[at]!;
    if (!explodable.has(part.buildingId)) explodable.set(part.buildingId, hasExplodableLevels(model, part.buildingId));
    let wipe: number | null = null;
    if (t > 1e-3 && explodable.get(part.buildingId)) {
      const [bottom, top] = part.mesh.yRange;
      if (part.role === 'roof') wipe = lerp(top, bottom, Math.min(1, t * 2.5));
      else {
        const level = highestLevel(model, part.levelIds);
        if (level !== null) wipe = lerp(top, Math.min(top, sectionOf(model, level)), t);
      }
    }
    const clip = cut === null ? wipe : wipe === null ? cut : Math.min(cut, wipe);
    let visible = !was;
    // Room picks keep their target visibility; only their section moves.
    if (was && part.role !== 'room-pick' && ((at !== undefined && cutting[at]) || (exploding && part.role === 'roof')))
      visible = clip === null || part.mesh.yRange[0] < clip;
    if (!visible) hidden.add(key);
    clips.set(key, clip);
    // A moving section fades what it cuts away; the explosion wipe does not.
    if (wipe === null && !plan && GHOST_ROLES.has(part.role) && at !== undefined && (cutting[at] || presentation.ghosts.has(key))) {
      if (!visible) ghosts.set(key, null);
      else if (clip !== null && clip < part.mesh.yRange[1]) ghosts.set(key, clip);
    }
  }
  // Hidden room-pick drawing is not a reason to drop a pick; its cut is.
  const pickable = new Set([...presentation.pickable].filter(occurrenceId => (model.pickParts.get(occurrenceId) ?? []).some(part => {
    const clip = clips.get(part.mesh.meshKey) ?? null;
    return clip === null || part.mesh.yRange[0] <= clip;
  })));
  return { ...presentation, hidden, clips, pickable, ghosts };
}

/** Display lift of a level at explode factor t. */
export const levelLift = (presentation: AtlasPresentation, levelId: string | null, t: number) =>
  levelId === null ? 0 : (presentation.offsets.get(levelId) ?? 0) * t;

/** Per-mesh display lifts at explode factor t: single-level parts only. */
export function partLifts(model: AtlasModel, presentation: AtlasPresentation, t: number): ReadonlyMap<string, number> {
  const lifts = new Map<string, number>();
  if (t === 0) return lifts;
  for (const part of model.parts) if (part.levelId !== null) lifts.set(part.mesh.meshKey, levelLift(presentation, part.levelId, t));
  return lifts;
}

/** Bounds the camera frames for a state at its target explode factor. */
export function frameBox(model: AtlasModel, state: AtlasViewState, presentation: AtlasPresentation): Box {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const add = (x: number, y: number, z: number) => {
    min[0] = Math.min(min[0]!, x); min[1] = Math.min(min[1]!, y); min[2] = Math.min(min[2]!, z);
    max[0] = Math.max(max[0]!, x); max[1] = Math.max(max[1]!, y); max[2] = Math.max(max[2]!, z);
  };
  const t = presentation.explodeTarget, focus = presentation.focusLevelId;
  if (state.view === 'plan' && presentation.planLevels.length > 0) {
    for (const levelId of presentation.planLevels) {
      const y = model.floorY.get(levelId)!;
      for (const feature of planFeaturesForLevel(model, levelId))
        for (const ring of model.featureRings.get(feature.featureId)!) for (const [x, z] of ring) add(x, y, z);
      for (const key of model.levelsById.get(levelId)!.occurrenceIds) { const b = model.occurrencesById.get(key)!.bounds; add(b.min[0], y, b.min[2]); add(b.max[0], y, b.max[2]); }
    }
  } else {
    const buildingId = focus !== null ? model.levelsById.get(focus)!.buildingId : state.buildingId;
    for (const part of model.parts) {
      // Hidden room picks still frame their rooms when their floor is shown.
      const shown = !presentation.hidden.has(part.mesh.meshKey)
        || (part.role === 'room-pick' && part.levelIds.some(levelId => presentation.visibleLevels.has(levelId)));
      if (part.role === 'context' || !shown) continue;
      if (buildingId !== null && part.buildingId !== buildingId) continue;
      if (t === 0 && focus !== null && part.levelId !== focus && !(part.levelId === null && part.levelIds.includes(focus))) continue;
      const lift = levelLift(presentation, part.levelId, t), b = part.mesh.bounds;
      const top = Math.min(b.max[1], presentation.clips.get(part.mesh.meshKey) ?? Infinity);
      add(b.min[0], b.min[1] + lift, b.min[2]); add(b.max[0], Math.max(b.min[1], top) + lift, b.max[2]);
    }
  }
  if (!Number.isFinite(min[0]!)) return model.buildingsById.get(focusBuildingId(model, state) ?? model.scene.buildings[0]!.buildingId)!.bounds;
  return { min: [min[0]!, min[1]!, min[2]!], max: [max[0]!, max[1]!, max[2]!] };
}

interface PickTree {
  readonly start: number; readonly end: number; readonly bounds: PreparedMesh['bounds'];
  readonly left: PickTree | null; readonly right: PickTree | null;
}
const pickTrees = new WeakMap<PreparedMesh, PickTree>();
/** Built once from actual prepared positions. Fixed source-order leaves avoid
 * vertex copies and preserve the exact triangle/depth tie order. */
function pickTree(mesh: PreparedMesh): PickTree {
  const cached = pickTrees.get(mesh); if (cached) return cached;
  const leaves: PickTree[] = [], data = mesh.vertices;
  for (let start = 0; start < mesh.triangles; start += 64) {
    const end = Math.min(start + 64, mesh.triangles);
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let at = start; at < end; at++) for (const corner of [0, 6, 12]) for (const axis of [0, 1, 2] as const) {
      const value = data[at * 18 + corner + axis]!;
      min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
    }
    leaves.push({ start, end, bounds: { min, max }, left: null, right: null });
  }
  const combine = (start: number, end: number): PickTree => {
    if (end - start === 1) return leaves[start]!;
    const middle = Math.floor((start + end) / 2), left = combine(start, middle), right = combine(middle, end);
    return { start: left.start, end: right.end, left, right, bounds: {
      min: [Math.min(left.bounds.min[0], right.bounds.min[0]), Math.min(left.bounds.min[1], right.bounds.min[1]), Math.min(left.bounds.min[2], right.bounds.min[2])],
      max: [Math.max(left.bounds.max[0], right.bounds.max[0]), Math.max(left.bounds.max[1], right.bounds.max[1]), Math.max(left.bounds.max[2], right.bounds.max[2])],
    } };
  };
  const tree = combine(0, leaves.length); pickTrees.set(mesh, tree); return tree;
}

function* pickRanges(mesh: PreparedMesh, projection: Projection, lift: number, px: number, py: number): Generator<PickTree> {
  const pending = [pickTree(mesh)];
  while (pending.length > 0) {
    const node = pending.pop()!, { min, max } = node.bounds;
    let l = Infinity, r = -Infinity, top = Infinity, bottom = -Infinity;
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
      const point = projection.project(x, y + lift, z);
      l = Math.min(l, point[0]); r = Math.max(r, point[0]); top = Math.min(top, point[1]); bottom = Math.max(bottom, point[1]);
    }
    // Conservative for the narrow phase's 1e-10 barycentric edge allowance and
    // projection roundoff, including large translated source coordinates.
    const pad = 4e-10 * Math.max(1, r - l, bottom - top)
      + 64 * Number.EPSILON * Math.max(1, Math.abs(l), Math.abs(r), Math.abs(top), Math.abs(bottom));
    if (px < l - pad || px > r + pad || py < top - pad || py > bottom + pad) continue;
    if (node.left && node.right) { pending.push(node.right, node.left); }
    else yield node;
  }
}

interface RayHit { readonly depth: number; readonly y: number }
/** Nearest drawn point of one part under a pixel, at its lift and below its section. */
function rayHit(part: AtlasPart, lift: number, clip: number | null, projection: Projection, px: number, py: number): RayHit | null {
  if (clip !== null && part.mesh.yRange[0] > clip) return null;
  let best: RayHit | null = null;
  const data = part.mesh.vertices;
  for (const range of pickRanges(part.mesh, projection, lift, px, py)) for (let at = range.start; at < range.end; at++) {
    const base = at * 18;
    const a = projection.project(data[base]!, data[base + 1]! + lift, data[base + 2]!);
    const b = projection.project(data[base + 6]!, data[base + 7]! + lift, data[base + 8]!);
    const c = projection.project(data[base + 12]!, data[base + 13]! + lift, data[base + 14]!);
    const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(det) < 1e-9) continue;
    const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / det;
    const l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / det;
    const l3 = 1 - l1 - l2;
    // Adjacent triangles share their edges. Projection roundoff can put an
    // interior seam a few ulps outside both triangles, especially after a
    // large source-frame translation; retain that boundary as pickable.
    const edgeTolerance = 1e-10;
    if (l1 < -edgeTolerance || l2 < -edgeTolerance || l3 < -edgeTolerance) continue;
    const sourceY = l1 * data[base + 1]! + l2 * data[base + 7]! + l3 * data[base + 13]!;
    if (clip !== null && sourceY > clip) continue;
    const depth = l1 * a[2] + l2 * b[2] + l3 * c[2];
    if (best === null || depth > best.depth) best = { depth, y: sourceY };
  }
  return best;
}

/** CPU pick through the renderer's projection: only room-pick geometry of
 * pickable occurrences takes part, at the same lifts and sections as drawn.
 * Structure and context never claim a room. */
export function pickOccurrenceHit(model: AtlasModel, presentation: AtlasPresentation, t: number, projection: Projection, px: number, py: number): { readonly occurrenceId: string; readonly depth: number } | null {
  let best: string | null = null, bestDepth = -Infinity;
  for (const occurrenceId of presentation.pickable) for (const part of model.pickParts.get(occurrenceId) ?? []) {
    const hit = rayHit(part, levelLift(presentation, part.levelId, t), presentation.clips.get(part.mesh.meshKey) ?? null, projection, px, py);
    if (hit && hit.depth > bestDepth) { bestDepth = hit.depth; best = occurrenceId; }
  }
  return best === null ? null : { occurrenceId: best, depth: bestDepth };
}

export const pickOccurrence = (model: AtlasModel, presentation: AtlasPresentation, t: number, projection: Projection, px: number, py: number): string | null =>
  pickOccurrenceHit(model, presentation, t, projection, px, py)?.occurrenceId ?? null;

/** Depth tolerance (metres) for a room against a coplanar surface of another building. */
export const PICK_DEPTH_TOLERANCE = .05;
export type AtlasTarget =
  | { readonly kind: 'room'; readonly occurrenceId: string }
  | { readonly kind: 'level'; readonly levelId: string }
  | { readonly kind: 'building'; readonly buildingId: string };

/** Nearest opaque structure, slab or roof under a pixel. Hidden parts and the
 * faded part above a section are not drawn opaque, so they never take a pick. */
function pickSurface(model: AtlasModel, presentation: AtlasPresentation, t: number, projection: Projection, px: number, py: number): { readonly part: AtlasPart; readonly hit: RayHit } | null {
  let best: { part: AtlasPart; hit: RayHit } | null = null;
  for (const part of model.parts) {
    const key = part.mesh.meshKey;
    if (!GHOST_ROLES.has(part.role) || part.mesh.triangles === 0 || presentation.hidden.has(key)) continue;
    if (!model.levelsByBuilding.get(part.buildingId)?.length) continue;
    const hit = rayHit(part, levelLift(presentation, part.levelId, t), presentation.clips.get(key) ?? null, projection, px, py);
    if (hit && (best === null || hit.depth > best.hit.depth)) best = { part, hit };
  }
  return best;
}

/** The floor a surface point belongs to, from the part's authored floors only:
 * the highest declared floor at or below the hit. Equal or missing floors stay
 * ambiguous (null), which keeps the building as the target. */
export function surfaceLevel(model: AtlasModel, levelIds: readonly string[], y: number): string | null {
  if (levelIds.length === 1) return levelIds[0]!;
  let best: string | null = null, tied = false;
  for (const levelId of levelIds) {
    const floor = model.floorY.get(levelId)!;
    if (floor > y + PICK_DEPTH_TOLERANCE) continue;
    const current = best === null ? -Infinity : model.floorY.get(best)!;
    if (Math.abs(floor - current) <= 1e-6) tied = true;
    else if (floor > current) { best = levelId; tied = false; }
  }
  return tied ? null : best;
}

/** One semantic target for a 3D tap. A room proxy may pass through its own
 * floor's structure, but another floor's opaque surface or any opaque roof
 * still occludes it while a cutaway transitions. Otherwise the nearest
 * visible surface selects its building from the property or from another
 * building's scope, and its floor from the building's own scope or any floor.
 * Context geometry never takes a pick; null means nothing semantic was hit. */
export function pickTarget(model: AtlasModel, presentation: AtlasPresentation, state: AtlasViewState, t: number,
  projection: Projection, px: number, py: number): AtlasTarget | null {
  const room = pickOccurrenceHit(model, presentation, t, projection, px, py);
  const surface = pickSurface(model, presentation, t, projection, px, py);
  const occurrence = room ? model.occurrencesById.get(room.occurrenceId)! : null;
  const ownFloor = surface && occurrence && surface.part.role === 'structure'
    && surface.part.buildingId === occurrence.buildingId
    && surfaceLevel(model, surface.part.levelIds, surface.hit.y) === occurrence.levelId;
  if (room && (!surface || ownFloor || room.depth >= surface.hit.depth - PICK_DEPTH_TOLERANCE))
    return { kind: 'room', occurrenceId: room.occurrenceId };
  if (!surface) return null;
  const buildingId = surface.part.buildingId, levelId = surfaceLevel(model, surface.part.levelIds, surface.hit.y);
  const deep = buildingId === state.buildingId;
  return deep && levelId !== null ? { kind: 'level', levelId } : { kind: 'building', buildingId };
}

/** One semantic target for a plan tap: a room on the shown floor once that floor
 * is chosen, else the floor itself; on the property plan, the building. */
export function planPickTarget(model: AtlasModel, presentation: AtlasPresentation, state: AtlasViewState, t: number,
  projection: Projection, px: number, py: number): AtlasTarget | null {
  const selected = state.occurrenceId === null ? undefined : model.occurrencesById.get(state.occurrenceId);
  for (const levelId of presentation.planLevels) {
    const [x, z] = planPoint(projection, model.floorY.get(levelId)! + levelLift(presentation, levelId, t), px, py);
    const hit = (model.levelsById.get(levelId)?.occurrenceIds ?? []).flatMap(key => {
      const shape = model.shapes.get(key);
      return model.selectable.has(key) && shape && pointInShape(x, z, shape) ? [{ key, area: occurrenceArea(model, key) }] : [];
    }).sort((a, b) => a.area - b.area)[0]?.key;
    const structure = hit === undefined && planFeaturesForLevel(model, levelId).some(feature =>
      (feature.role === 'wall' || feature.role === 'opening' || feature.role === 'stair')
      && pointInShape(x, z, feature.polygons.map(polygon => [polygon.outer, ...polygon.holes])));
    if (hit === undefined && !structure) continue;
    if (presentation.focusLevelId === null) return { kind: 'building', buildingId: model.levelsById.get(levelId)!.buildingId };
    return hit !== undefined && (state.levelId === levelId || selected?.levelId === levelId)
      ? { kind: 'room', occurrenceId: hit } : { kind: 'level', levelId };
  }
  return null;
}

/** The reducer action for a picked target; nothing picked moves out one level. */
export function targetAction(target: AtlasTarget | null): AtlasAction {
  if (target === null) return { type: 'out' };
  switch (target.kind) {
    case 'room': return { type: 'select', occurrenceId: target.occurrenceId };
    case 'level': return { type: 'level', levelId: target.levelId };
    case 'building': return { type: 'building', buildingId: target.buildingId };
  }
}

/** Inverts a pixel to scene (x, z) on the plane at display height y. */
export function planPoint(projection: Projection, y: number, px: number, py: number): readonly [number, number] {
  const u = (px - projection.ox) / projection.k;
  const v = (py - projection.oy + projection.k * (y - projection.center[1]) * projection.cf) / (projection.k * Math.max(projection.sf, 1e-6));
  return [projection.ct * u + projection.st * v + projection.center[0], -projection.st * u + projection.ct * v + projection.center[2]];
}

const ringArea = (ring: PlanRing) => {
  let area = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; area += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(area / 2);
};
/** Filled area of an occurrence's own room polygons, whatever their winding:
 * each outer ring less its own holes. */
export function occurrenceArea(model: AtlasModel, occurrenceId: string): number {
  return model.roomPolygons.get(occurrenceId)?.reduce((sum, polygon) =>
    sum + Math.max(0, ringArea(polygon.outer) - polygon.holes.reduce((holes, hole) => holes + ringArea(hole), 0)), 0) ?? 0;
}

/** Plan pick on one level's own room polygons; the smallest containing room wins. */
export function planPickOccurrence(model: AtlasModel, presentation: AtlasPresentation, levelId: string, x: number, z: number): string | null {
  const hits = (model.levelsById.get(levelId)?.occurrenceIds ?? []).flatMap(key => {
    const shape = model.shapes.get(key);
    return presentation.pickable.has(key) && shape && pointInShape(x, z, shape) ? [{ key, area: occurrenceArea(model, key) }] : [];
  });
  return hits.sort((a, b) => a.area - b.area)[0]?.key ?? null;
}

/** Display height of an occurrence label: its top, or the section where it is cut. */
export function labelHeight(model: AtlasModel, presentation: AtlasPresentation, occurrenceId: string, plan: boolean): number {
  const occurrence = model.occurrencesById.get(occurrenceId)!;
  if (plan) return model.floorY.get(occurrence.levelId)!;
  const cuts = (model.pickParts.get(occurrenceId) ?? []).map(part => presentation.clips.get(part.mesh.meshKey) ?? null);
  const clip = cuts.length > 0 && cuts.every(value => value !== null) ? Math.max(...cuts as number[]) : null;
  return clip === null ? occurrence.bounds.max[1] : Math.min(occurrence.bounds.max[1], clip);
}

/** Room-pick parts of an occurrence that move with a level, or the level of the occurrence itself. */
export function occurrenceLiftLevel(model: AtlasModel, occurrenceId: string): string | null {
  const parts = model.pickParts.get(occurrenceId) ?? [];
  return parts.length > 0 && parts.every(part => part.levelId === null) ? null : model.occurrencesById.get(occurrenceId)?.levelId ?? null;
}
