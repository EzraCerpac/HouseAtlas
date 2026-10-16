import { ExactDecimal, isExactDecimal } from '../../numeric/decimal';
import { parseIfcGlbProfile } from '../scans/ifc-glb-profile';
import { decodeMeshJson } from '../scans/mesh-profile';
import { PRESENTATION_KIND } from './model';
import type { ArtifactPin, CanonicalPresentation, OverlayLayer, PlanFeature, PresentationFloor, PresentationMesh, PresentationRoom } from './model';

/** Consumer for the PROPOSED `houseatlas.ifc-scene-read.v2` scene snapshot
 * (docs/canonical-ifc/scene-read-contract-v2.md). The routes are not live:
 * this module performs no request itself. A host injects an owned port; the
 * checked-in synthetic fixture is served by a local fake transport.
 *
 * Every pinned artifact is read through the port, length- and SHA-256-checked,
 * and cross-checked against scope, publication, source, semantic map and IFC
 * identity projection pins before anything is shown. Plan feature JSON is the
 * authoritative 2D geometry (source XY mm -> renderer (x/1000, -y/1000)); the
 * SVG derivative is verified but never injected. Floors with null elevation /
 * floorToSource are shown separately, never stacked or aligned. */
export const SCENE_SCHEMA_V2 = 'houseatlas.ifc-scene-read.v2';
export const ADAPTER_ID = 'houseatlas.ifc-scene-read.v2 consumer';

export interface SceneScope { readonly workspaceId: string; readonly homeId: string; readonly buildingId: string }
export interface SceneRequest {
  readonly scope: SceneScope;
  /** Explicit retained publication; null reads the current selection. */
  readonly publicationId: string | null;
  /** Atlas building label supplied by the host (the scene carries none). */
  readonly buildingLabel: string;
}

/** Owned transport. Implementations must honour `signal` and serve only the
 * caller's authorized scope. No default implementation exists here. */
export interface CanonicalScenePort {
  readonly transport: 'synthetic-fixture' | 'service';
  readonly owner: string;
  readScene(request: SceneRequest, signal: AbortSignal): Promise<Uint8Array>;
  readArtifact(href: string, signal: AbortSignal): Promise<Uint8Array>;
}

export type UnavailableReason = 'not-ready' | 'scope-mismatch' | 'invalid' | 'artifact-mismatch' | 'unsupported' | 'source-unavailable';
export type CanonicalAdapterResult =
  | { readonly status: 'available'; readonly presentation: CanonicalPresentation; readonly fence: { readonly selectionRevision: string; readonly publicationId: string } }
  | { readonly status: 'stale' }
  | { readonly status: 'revoked' }
  | { readonly status: 'unavailable'; readonly reason: UnavailableReason; readonly detail: string };

/** Explicit read bounds (the 8 MiB GLB cap is enforced again by the GLB parser). */
export const SCENE_LIMITS = Object.freeze({ sceneBytes: 1024 * 1024, jsonArtifactBytes: 8 * 1024 * 1024, glbBytes: 8 * 1024 * 1024,
  totalArtifactBytes: 96 * 1024 * 1024, floors: 64, rooms: 2048, occurrences: 4096 });

type Json = null | boolean | string | ExactDecimal | Json[] | { [key: string]: Json };
type Row = { [key: string]: Json };
class Rejected extends Error { constructor(readonly reason: UnavailableReason, detail: string) { super(detail); } }
const reject = (reason: UnavailableReason, detail: string): never => { throw new Rejected(reason, detail); };
function need(ok: unknown, detail: string, reason: UnavailableReason = 'invalid'): asserts ok { if (!ok) reject(reason, detail); }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const GLOBAL_ID = /^[0-9A-Za-z_$]{22}$/;
function row(value: Json | undefined, keys: readonly string[], what: string): Row {
  need(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value), `${what}: object required`);
  need(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), `${what}: unexpected fields`);
  return value;
}
function list(value: Json | undefined, max: number, what: string): Json[] { need(Array.isArray(value) && value.length <= max, `${what}: bounded array required`); return value; }
function text(value: Json | undefined, what: string, max = 256): string { need(typeof value === 'string' && value.length > 0 && value.length <= max, `${what}: text required`); return value; }
function uuid(value: Json | undefined, what: string): string { const result = text(value, what); need(UUID.test(result), `${what}: UUID required`); return result; }
function sha(value: Json | undefined, what: string): string { const result = text(value, what); need(SHA.test(result), `${what}: SHA-256 required`); return result; }
function globalId(value: Json | undefined, what: string): string { const result = text(value, what); need(GLOBAL_ID.test(result), `${what}: IFC GlobalId required`); return result; }
// eslint-disable-next-line no-control-regex
function token(value: Json | undefined, what: string): string { const result = text(value, what); need(!/[\u0000-\u001f\u007f]/.test(result), `${what}: opaque token`); return result; }
function integer(value: Json | undefined, what: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  need(isExactDecimal(value) && value.isInteger, `${what}: integer required`);
  const result = value.toSafeInteger(); need(result !== undefined && result >= min && result <= max, `${what}: integer bound`); return result;
}
function finite(value: Json | undefined, what: string): number {
  need(isExactDecimal(value), `${what}: number required`);
  const result = Number(value.toString()); need(Number.isFinite(result) && Math.abs(result) <= 1e9, `${what}: finite bound`); return result;
}
/** Structural equality over decoded JSON, comparing numbers exactly. */
function same(a: Json | undefined, b: Json | undefined): boolean {
  if (isExactDecimal(a) || isExactDecimal(b)) return isExactDecimal(a) && isExactDecimal(b) && a.compare(b) === 0;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
}
const owned = (bytes: Uint8Array) => new Uint8Array(bytes);
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', owned(bytes)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const live = (signal: AbortSignal) => { signal.throwIfAborted(); };

interface Pinned { readonly sha256: string; readonly bytes: number; readonly href: string }
const INERT_ORIGIN = 'https://scene-route.invalid';
/** A canonical path below the exact publication prefix, unchanged by URL
 * parsing: no query, fragment, escape, backslash, empty or dot segment. */
function scopedRoute(href: string, prefix: string): boolean {
  if (!href.startsWith(prefix) || /[?#%\\]/.test(href)) return false;
  if (href.slice(prefix.length).split('/').some(segment => segment === '' || segment === '.' || segment === '..')) return false;
  let url: URL;
  try { url = new URL(href, INERT_ORIGIN); } catch { return false; }
  return url.origin === INERT_ORIGIN && url.pathname === href && url.search === '' && url.hash === '';
}
function pinned(value: Json | undefined, what: string, prefix: string, max: number): Pinned {
  const item = row(value, ['bytes', 'href', 'sha256'], what);
  const href = text(item.href, `${what} href`, 1024);
  need(scopedRoute(href, prefix), `${what}: artifact outside this publication scope`, 'scope-mismatch');
  return { sha256: sha(item.sha256, `${what} sha256`), bytes: integer(item.bytes, `${what} bytes`, 1, max), href };
}

/** Reads one whole v2 scene snapshot and its pinned artifacts into a presentation. */
export async function readCanonicalSceneV2(port: CanonicalScenePort, request: SceneRequest, signal: AbortSignal,
  options: { readonly overlays?: readonly OverlayLayer[]; readonly now?: () => string } = {}): Promise<CanonicalAdapterResult> {
  try {
    let sceneBytes: Uint8Array;
    try { sceneBytes = await port.readScene(request, signal); } catch (error) { live(signal); throw new Rejected('source-unavailable', String(error)); }
    live(signal);
    need(sceneBytes.byteLength <= SCENE_LIMITS.sceneBytes, 'Scene byte bound');
    const decoded = await decodeMeshJson(sceneBytes, signal); live(signal);
    need(decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded) && !isExactDecimal(decoded), 'Scene: object required');
    need(decoded.schema === SCENE_SCHEMA_V2, 'Unsupported scene schema', 'unsupported');
    if (decoded.availability === 'stale') return { status: 'stale' };
    if (decoded.availability === 'revoked') return { status: 'revoked' };
    need(decoded.availability === 'ready', 'Scene is not ready', 'not-ready');
    const scene = row(decoded, ['availability', 'axes', 'electricalGroups', 'floors', 'overlays', 'publication', 'rooms', 'schema', 'scope', 'selection', 'semantics'], 'Scene');

    const scope = row(scene.scope, ['buildingId', 'homeId', 'workspaceId'], 'Scope');
    need(scope.workspaceId === request.scope.workspaceId && scope.homeId === request.scope.homeId && scope.buildingId === request.scope.buildingId,
      'Scene scope differs from the request', 'scope-mismatch');
    const selection = row(scene.selection, ['mode', 'publicationId', 'revision'], 'Selection');
    need(selection.mode === 'published' || selection.mode === 'preview', 'Selection mode');
    const selectionRevision = uuid(selection.revision, 'Selection revision');
    const pub = row(scene.publication, ['publicationId', 'semanticMapRevisionId', 'semanticMapSha256', 'sourceIfcSha256', 'sourceRevisionId', 'sourceRevisionSha256', 'validation'], 'Publication');
    const publicationId = uuid(pub.publicationId, 'Publication ID');
    need(uuid(selection.publicationId, 'Selected publication') === publicationId, 'Selection and publication differ', 'scope-mismatch');
    need(request.publicationId === null || request.publicationId === publicationId, 'A different publication was returned', 'scope-mismatch');
    const pins = { semanticMapRevisionId: uuid(pub.semanticMapRevisionId, 'Map revision'), semanticMapSha256: sha(pub.semanticMapSha256, 'Map SHA'),
      sourceIfcSha256: sha(pub.sourceIfcSha256, 'Source IFC SHA'), sourceRevisionId: uuid(pub.sourceRevisionId, 'Source revision'),
      sourceRevisionSha256: sha(pub.sourceRevisionSha256, 'Source revision SHA'), validation: text(pub.validation, 'Validation') };

    // Only the pinned conversion is implemented; anything else is unsupported, not reinterpreted.
    const axes = row(scene.axes, ['glb', 'physicalRegistration', 'source', 'sourceToGlb'], 'Axes');
    need(same(axes.source, { units: 'mm', upAxis: 'Z' }) && same(axes.glb, { units: 'm', upAxis: 'Y' })
      && same(axes.sourceToGlb, { axisMap: ['x', 'z', '-y'], scale: ExactDecimal.parse('0.001') }), 'Unsupported axes', 'unsupported');
    const registration = row(axes.physicalRegistration, ['status', 'transform'], 'Registration');
    need(registration.transform === null && typeof registration.status === 'string', 'Physical transforms are not supported yet', 'unsupported');

    const overlayKeys = row(scene.overlays, ['electricalGroupKey', 'publicationId', 'roomKey', 'semanticMapRevisionId', 'spaceKey'], 'Overlay keys');
    need(overlayKeys.publicationId === publicationId && overlayKeys.semanticMapRevisionId === pins.semanticMapRevisionId
      && overlayKeys.roomKey === 'roomId' && overlayKeys.spaceKey === 'spaceOccurrenceId' && overlayKeys.electricalGroupKey === 'groupId', 'Overlay keys');
    list(scene.electricalGroups, 4096, 'Electrical groups');

    // Logical rooms and their floor-qualified occurrences.
    const occurrenceRoom = new Map<string, { roomId: string; floorId: string; ifcGlobalId: string }>();
    const rooms: PresentationRoom[] = list(scene.rooms, SCENE_LIMITS.rooms, 'Rooms').map((value, index) => {
      const room = row(value, ['atlasPlaceId', 'displayName', 'occurrences', 'packagePlace', 'roomId'], `Room ${index}`);
      const roomId = uuid(room.roomId, 'Room ID');
      const occurrences = list(room.occurrences, 64, 'Occurrences').map(raw => {
        const occurrence = row(raw, ['floorId', 'ifcSpaceGlobalId', 'spaceOccurrenceId'], 'Occurrence');
        const spaceOccurrenceId = token(occurrence.spaceOccurrenceId, 'Space occurrence');
        need(!occurrenceRoom.has(spaceOccurrenceId), 'Duplicate space occurrence');
        const entry = { roomId, floorId: uuid(occurrence.floorId, 'Occurrence floor'), ifcGlobalId: globalId(occurrence.ifcSpaceGlobalId, 'Space GlobalId') };
        occurrenceRoom.set(spaceOccurrenceId, entry);
        return { spaceOccurrenceId, floorId: entry.floorId, ifcGlobalId: entry.ifcGlobalId };
      });
      need(occurrences.length > 0, 'A room needs at least one occurrence');
      return { roomId, label: text(room.displayName, 'Room name'), atlasPlaceId: room.atlasPlaceId === null ? null : uuid(room.atlasPlaceId, 'Atlas place'), occurrences };
    });
    need(new Set(rooms.map(room => room.roomId)).size === rooms.length && occurrenceRoom.size <= SCENE_LIMITS.occurrences, 'Duplicate room');

    const prefix = `/api/atlas/ifc/v2/workspaces/${request.scope.workspaceId}/homes/${request.scope.homeId}/buildings/${request.scope.buildingId}/publications/${publicationId}/`;
    const sceneFloors = list(scene.floors, SCENE_LIMITS.floors, 'Floors').map((value, index) => {
      const floor = row(value, ['artifacts', 'elevationMm', 'floorId', 'floorToSource', 'ifcBuildingStoreyGlobalId', 'label', 'spaceOccurrenceIds'], `Floor ${index}`);
      const artifacts = row(floor.artifacts, ['floorplan2d', 'floorplanFeatures', 'glb'], 'Floor artifacts');
      need(floor.floorToSource === null, 'Floor transforms are not supported yet', 'unsupported');
      return {
        raw: floor, floorId: uuid(floor.floorId, 'Floor ID'), label: text(floor.label, 'Floor label'), storey: globalId(floor.ifcBuildingStoreyGlobalId, 'Storey GlobalId'),
        elevationMm: floor.elevationMm === null ? null : finite(floor.elevationMm, 'Elevation'),
        occurrenceIds: list(floor.spaceOccurrenceIds, SCENE_LIMITS.occurrences, 'Floor occurrences').map(id => token(id, 'Floor occurrence')),
        glb: pinned(artifacts.glb, 'GLB', prefix, SCENE_LIMITS.glbBytes),
        features: pinned(artifacts.floorplanFeatures, 'Plan features', prefix, SCENE_LIMITS.jsonArtifactBytes),
        svg: pinned(artifacts.floorplan2d, 'Plan SVG', prefix, SCENE_LIMITS.jsonArtifactBytes),
      };
    });
    need(new Set(sceneFloors.map(floor => floor.floorId)).size === sceneFloors.length, 'Duplicate floor');
    // Every occurrence appears in exactly one floor, matching its own floor link.
    const listed = new Map<string, string>();
    for (const floor of sceneFloors) for (const id of floor.occurrenceIds) {
      need(!listed.has(id) && occurrenceRoom.get(id)?.floorId === floor.floorId, 'Floor occurrence membership'); listed.set(id, floor.floorId);
    }
    need(listed.size === occurrenceRoom.size, 'Every occurrence must belong to one listed floor');
    const semanticsPin = pinned(scene.semantics, 'Semantics', prefix, SCENE_LIMITS.jsonArtifactBytes);
    const all = [semanticsPin, ...sceneFloors.flatMap(floor => [floor.glb, floor.features, floor.svg])];
    need(all.reduce((sum, item) => sum + item.bytes, 0) <= SCENE_LIMITS.totalArtifactBytes, 'Artifact byte bound');

    const read = async (item: Pinned, what: string) => {
      let bytes: Uint8Array;
      try { bytes = await port.readArtifact(item.href, signal); } catch (error) { live(signal); throw new Rejected('source-unavailable', `${what}: ${String(error)}`); }
      live(signal);
      need(bytes.byteLength === item.bytes, `${what}: byte length differs from its pin`, 'artifact-mismatch');
      need(await sha256Hex(bytes) === item.sha256, `${what}: digest differs from its pin`, 'artifact-mismatch');
      live(signal); return bytes;
    };

    // Publication-wide semantics: same pins, same logical map, exact IFC identity projection.
    const semantics = row(await decodeMeshJson(await read(semanticsPin, 'Semantics'), signal), ['floors', 'ifcIdentityProjection', 'meshBindings', 'profile',
      'semanticMap', 'semanticMapRevisionId', 'semanticMapSha256', 'sourceIfcSha256', 'sourceRevisionId'], 'Semantics');
    live(signal);
    need(semantics.profile === 'houseatlas.ifc-semantics.v2' && semantics.semanticMapRevisionId === pins.semanticMapRevisionId
      && semantics.semanticMapSha256 === pins.semanticMapSha256 && semantics.sourceIfcSha256 === pins.sourceIfcSha256
      && semantics.sourceRevisionId === pins.sourceRevisionId, 'Semantics pins differ from the publication', 'artifact-mismatch');
    const map = row(semantics.semanticMap, ['buildingId', 'electricalGroups', 'floors', 'homeId', 'ifcOriginalSha256', 'previousSemanticMapRevisionId', 'rooms',
      'schema', 'semanticMapRevisionId', 'sourceRevisionId', 'transitions', 'workspaceId'], 'Semantic map');
    need(map.schema === 'houseatlas.ifc-semantic-map.v2' && map.buildingId === request.scope.buildingId && map.homeId === request.scope.homeId
      && map.workspaceId === request.scope.workspaceId && map.semanticMapRevisionId === pins.semanticMapRevisionId
      && map.sourceRevisionId === pins.sourceRevisionId && map.ifcOriginalSha256 === pins.sourceIfcSha256, 'Semantic map pins differ', 'artifact-mismatch');
    need(same(map.rooms, scene.rooms), 'Scene rooms differ from the pinned semantic map', 'artifact-mismatch');
    const mapFloors = list(map.floors, SCENE_LIMITS.floors, 'Map floors');
    need(mapFloors.length === sceneFloors.length && sceneFloors.every(floor => mapFloors.some(raw => {
      const value = row(raw, ['atlasPlaceId', 'displayName', 'floorId', 'ifcBuildingStoreyGlobalId'], 'Map floor');
      return value.floorId === floor.floorId && value.ifcBuildingStoreyGlobalId === floor.storey && value.displayName === floor.label;
    })), 'Scene floors differ from the semantic map', 'artifact-mismatch');
    // Non-null reviewed Atlas place IDs are unique across map floors and rooms.
    const atlasPlaces = [...mapFloors.map(raw => (raw as Row).atlasPlaceId), ...rooms.map(room => room.atlasPlaceId)].filter(id => id !== null);
    need(new Set(atlasPlaces).size === atlasPlaces.length, 'Duplicate reviewed Atlas place link');
    const floorShape = (floor: typeof sceneFloors[number]): Json => ({ elevationMm: floor.raw.elevationMm ?? null, floorId: floor.floorId,
      floorToSource: null, ifcBuildingStoreyGlobalId: floor.storey, label: floor.label });
    const semanticFloors = list(semantics.floors, SCENE_LIMITS.floors, 'Semantics floors');
    need(semanticFloors.length === sceneFloors.length && sceneFloors.every(floor => semanticFloors.some(value => same(value, floorShape(floor)))), 'Semantics floors differ', 'artifact-mismatch');
    const projection = row(semantics.ifcIdentityProjection, ['entities', 'groupAssignments', 'spatialAggregates'], 'IFC identity projection');
    const entities = list(projection.entities, 16384, 'IFC entities').map(value => value as Row);
    const aggregates = list(projection.spatialAggregates, 16384, 'IFC aggregates').map(value => row(value, ['globalId', 'relatedSpaceGlobalIds', 'relatingStoreyGlobalId'], 'IFC aggregate'));
    for (const [id, entry] of occurrenceRoom) {
      const space = entities.filter(entity => entity?.globalId === entry.ifcGlobalId);
      const pset = space.length === 1 && space[0]!.type === 'IfcSpace' ? space[0]!.identityPset as Row | null : null;
      need(pset !== null && typeof pset === 'object' && pset.EntityId === entry.roomId && pset.spaceOccurrenceId === id, 'IFC space identity differs from the map', 'artifact-mismatch');
      const storey = sceneFloors.find(floor => floor.floorId === entry.floorId)!.storey;
      const relations = aggregates.filter(rel => list(rel.relatedSpaceGlobalIds, 16384, 'Related spaces').includes(entry.ifcGlobalId));
      need(relations.length === 1 && relations[0]!.relatingStoreyGlobalId === storey, 'An occurrence needs exactly one reviewed storey relation', 'artifact-mismatch');
    }
    type Binding = { meshIndex: number; nodeIndex: number; roomId: string; spaceOccurrenceId: string; ifcGlobalId: string };
    const binding = (value: Json | undefined, withFloor: boolean): Binding & { floorId?: string } => {
      const keys = ['entityType', 'ifcGlobalId', 'meshIndex', 'nodeIndex', 'roomId', 'spaceOccurrenceId', ...(withFloor ? ['floorId'] : [])];
      const item = row(value, keys, 'Mesh binding');
      need(item.entityType === 'spaceOccurrence', 'Mesh binding entity type');
      const result = { meshIndex: integer(item.meshIndex, 'Mesh index', 0, 511), nodeIndex: integer(item.nodeIndex, 'Node index', 0, 511),
        roomId: uuid(item.roomId, 'Binding room'), spaceOccurrenceId: token(item.spaceOccurrenceId, 'Binding occurrence'), ifcGlobalId: globalId(item.ifcGlobalId, 'Binding GlobalId') };
      const entry = occurrenceRoom.get(result.spaceOccurrenceId);
      need(entry?.roomId === result.roomId && entry.ifcGlobalId === result.ifcGlobalId, 'Mesh binding identity differs from the map', 'artifact-mismatch');
      return withFloor ? { ...result, floorId: uuid(item.floorId, 'Binding floor') } : result;
    };
    const semanticBindings = list(semantics.meshBindings, 8192, 'Semantic bindings').map(value => binding(value, true));
    need(semanticBindings.every(item => occurrenceRoom.get(item.spaceOccurrenceId)?.floorId === item.floorId), 'Semantic binding floor differs from the map', 'artifact-mismatch');

    const floors: PresentationFloor[] = [], meshes: PresentationMesh[] = [], artifacts: ArtifactPin[] = [
      { label: 'Semantics', floorId: null, sha256: semanticsPin.sha256, bytes: semanticsPin.bytes }];
    const converters: CanonicalPresentation['coordinates']['converters'][number][] = [];
    for (const [index, floor] of sceneFloors.entries()) {
      const features = row(await decodeMeshJson(await read(floor.features, `${floor.label} plan features`), signal),
        ['floor', 'meshBindings', 'profile', 'semanticMapRevisionId', 'sourceIfcSha256', 'sourceRevisionId', 'spaces', 'units', 'upAxis'], 'Plan features');
      live(signal);
      need(features.profile === 'houseatlas.ifc-floorplan.v2' && features.units === 'mm' && features.upAxis === 'Z'
        && features.semanticMapRevisionId === pins.semanticMapRevisionId && features.sourceIfcSha256 === pins.sourceIfcSha256
        && features.sourceRevisionId === pins.sourceRevisionId && same(features.floor, floorShape(floor)), 'Plan feature pins differ', 'artifact-mismatch');
      const planFeatures: PlanFeature[] = [];
      const spaces = list(features.spaces, SCENE_LIMITS.occurrences, 'Spaces').map(value => row(value, ['ifcGlobalId', 'polygons', 'roomId', 'spaceOccurrenceId'], 'Space'));
      need(spaces.length === floor.occurrenceIds.length && new Set(spaces.map(space => space.spaceOccurrenceId)).size === spaces.length, 'Plan spaces differ from the floor');
      let points = 0;
      for (const space of spaces) {
        const id = token(space.spaceOccurrenceId, 'Space occurrence'), entry = occurrenceRoom.get(id);
        need(floor.occurrenceIds.includes(id) && entry !== undefined && entry.roomId === space.roomId && entry.ifcGlobalId === space.ifcGlobalId, 'Plan space identity differs', 'artifact-mismatch');
        // Each polygon is its own filled feature (union); source XY mm -> renderer (x/1000, -y/1000).
        for (const polygon of list(space.polygons, 4096, 'Polygons')) {
          const ring = list(polygon, 100_000, 'Polygon').map(point => {
            const pair = list(point, 2, 'Point'); need(pair.length === 2, 'Point');
            return [finite(pair[0], 'x') / 1000, -finite(pair[1], 'y') / 1000] as const;
          });
          points += ring.length; need(ring.length >= 3 && points <= 200_000, 'Polygon bound');
          planFeatures.push({ occurrenceId: id, role: 'space', rings: [ring] });
        }
      }
      const floorBindings = list(features.meshBindings, 512, 'Floor bindings').map(value => binding(value, false));
      need(new Set(floorBindings.map(item => item.meshIndex)).size === floorBindings.length
        && floorBindings.every(item => floor.occurrenceIds.includes(item.spaceOccurrenceId)), 'Floor bindings must target this floor\'s spaces');
      const expected = semanticBindings.filter(item => item.floorId === floor.floorId);
      need(expected.length === floorBindings.length && floorBindings.every(item => expected.some(other => other.meshIndex === item.meshIndex
        && other.nodeIndex === item.nodeIndex && other.spaceOccurrenceId === item.spaceOccurrenceId)), 'Floor bindings differ from semantics', 'artifact-mismatch');

      await read(floor.svg, `${floor.label} plan SVG`);
      const profile = await parseIfcGlbProfile(await read(floor.glb, `${floor.label} GLB`), signal, decodeMeshJson);
      live(signal);
      need(profile.source.originalSHA256 === pins.sourceIfcSha256, 'GLB source lineage differs', 'artifact-mismatch');
      const bound = new Map<number, string>();
      for (const item of floorBindings) {
        const mesh = profile.meshes[item.meshIndex];
        // The closed GLB profile pairs node i with mesh i under one shared name.
        need(mesh && item.nodeIndex === item.meshIndex && mesh.sourceName === `ha-space/${item.roomId}/${await sha256Hex(new TextEncoder().encode(item.spaceOccurrenceId))}`,
          'GLB mesh name differs from its binding', 'artifact-mismatch');
        bound.set(item.meshIndex, item.spaceOccurrenceId);
      }
      live(signal);
      for (const [meshIndex, mesh] of profile.meshes.entries()) {
        need(mesh.composedLocalToStageMatrixTokens.every((value, i) => value === (i % 5 === 0 ? '1' : '0')), 'GLB transform');
        meshes.push({ meshKey: `${floor.floorId}#${meshIndex}`, floorId: floor.floorId, glbMeshIndex: meshIndex, occurrenceId: bound.get(meshIndex) ?? null,
          positions: Float32Array.from(mesh.positionsLocalTokens, Number), indices: Uint32Array.from(mesh.triangleIndicesTokens, Number) });
      }
      converters.push({ floorId: floor.floorId, ...profile.source.converter });
      artifacts.push({ label: 'GLB', floorId: floor.floorId, sha256: floor.glb.sha256, bytes: floor.glb.bytes },
        { label: 'plan features', floorId: floor.floorId, sha256: floor.features.sha256, bytes: floor.features.bytes },
        { label: 'plan SVG', floorId: floor.floorId, sha256: floor.svg.sha256, bytes: floor.svg.bytes });
      floors.push({ floorId: floor.floorId, label: floor.label, short: String(index + 1), ifcStoreyGlobalId: floor.storey,
        elevation: floor.elevationMm === null ? null : { metres: floor.elevationMm / 1000, basis: 'IFC storey elevation' },
        plan: { features: planFeatures } });
    }
    live(signal);
    const presentation: CanonicalPresentation = {
      kind: PRESENTATION_KIND,
      origin: { kind: 'adapted-publication', adapter: ADAPTER_ID, transport: port.transport },
      publication: { publicationId, sourceRevisionId: pins.sourceRevisionId, sourceRevisionSha256: pins.sourceRevisionSha256,
        sourceIfcSha256: pins.sourceIfcSha256, semanticMapRevision: pins.semanticMapRevisionId, semanticMapSha256: pins.semanticMapSha256,
        selection: { mode: selection.mode === 'preview' ? 'preview' : 'published', revision: selectionRevision }, validation: pins.validation,
        publishedAt: null, sourceDate: null, retrievedAt: options.now?.() ?? new Date().toISOString(), owner: port.owner, artifacts },
      coordinates: { renderer: { units: 'm', upAxis: 'Y' }, source: { units: 'mm', upAxis: 'Z', basis: 'converter-declaration' }, converters, physicalAlignment: 'unknown' },
      registration: { kind: 'isolated-floors' },
      building: { buildingId: request.scope.buildingId, label: request.buildingLabel, scope: { workspaceId: request.scope.workspaceId, homeId: request.scope.homeId } },
      floors, rooms, meshes,
      overlays: (options.overlays ?? []).filter(layer => layer.publicationId === publicationId),
    };
    return { status: 'available', presentation, fence: { selectionRevision, publicationId } };
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    if (error instanceof Rejected) return { status: 'unavailable', reason: error.reason, detail: error.message };
    return { status: 'unavailable', reason: 'invalid', detail: error instanceof Error ? error.message : 'Unreadable scene' };
  }
}
