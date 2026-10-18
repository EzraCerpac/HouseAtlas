import { isExactDecimal } from '../numeric/decimal';
import { parseLosslessJson, type LosslessJson } from '../numeric/lossless-json';
import { admitAtlasScene } from '../lantern/unified-atlas/scene';
import type { AtlasScene } from '../lantern/unified-atlas/types';
import { jsonRow, needPack, packText, type PackManifest } from './manifest';
import type { SavedResource } from './store';

export const SAVED_ATLAS_LIMITS = Object.freeze({ companion: 12 * 1024 * 1024, model: 32 * 1024 * 1024,
  roomLinks: 1024 * 1024, links: 2048 });
const SHA = /^[0-9a-f]{64}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, OPAQUE = /^[A-Za-z0-9_.:-]{1,128}$/;
const JSON_MIME = 'application/json', MODEL_MIME = 'model/gltf-binary';
function pin(value: LosslessJson | undefined): string { needPack(typeof value === 'string' && SHA.test(value)); return value; }
function count(value: LosslessJson | undefined, max: number): number {
  needPack(isExactDecimal(value) && /^[1-9][0-9]*$/.test(value.token));
  const result = value.toSafeInteger(); needPack(result !== undefined && result <= max); return result;
}
function scope(value: LosslessJson | undefined, manifest: PackManifest): void {
  const found = jsonRow(value, ['workspaceId', 'homeId']);
  needPack(found.workspaceId === manifest.scope.workspaceId && found.homeId === manifest.scope.homeId);
}
function overviewLabel(value: LosslessJson | undefined): string {
  needPack(typeof value === 'string' && [...value].length > 0 && [...value].length <= 128
    && !/[\u0000-\u001f\u007f]/.test(value)); return value;
}
/** Resolve by content identity. Deduplication may retain another section's role/record. */
function resource(manifest: PackManifest, digest: string, bytes: number, mime: string): SavedResource {
  const found = manifest.resources.find(item => item.sha256 === digest);
  needPack(found && found.bytes === bytes && found.contentType === mime); return found;
}
export interface SavedAtlasModel {
  readonly publicationId: string;
  /** The supplied overview digest, never derived from another resource. */
  readonly overviewManifestSha256: string;
  readonly original: SavedResource | null;
  readonly unified: null | Readonly<{ selectionRevision: string; semanticsSha256: string;
    companion: SavedResource; roomLinks: SavedResource | null }>;
}
function incompleteModel(manifest: PackManifest, code?: string): void {
  needPack(manifest.completeness === 'partial' && manifest.sections.model.state === 'partial'
    && !manifest.sections.model.requiredBytesComplete
    && manifest.exclusions.some(item => item.section === 'model' && (code === undefined || item.code === code)));
}
/** Small versioned root uses the unchanged generic 8 MiB lossless parser. */
export function readSavedAtlasModel(bytes: ArrayBuffer, manifest: PackManifest): SavedAtlasModel {
  const value = jsonRow(parseLosslessJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), ['profile', 'overview', 'unifiedAtlas']);
  needPack(value.profile === 'houseatlas.home-read-pack.model.v2');
  const overview = jsonRow(value.overview, ['profile', 'scope', 'publicationId', 'manifestSha256', 'label', 'qualification',
    'frame', 'components', 'sourceNote', 'original']);
  needPack(overview.profile === 'houseatlas.model-overview-read.v1' && overview.qualification === 'provisional-overview');
  scope(overview.scope, manifest);
  const publicationId = packText(overview.publicationId); needPack(UUID.test(publicationId));
  const overviewManifestSha256 = pin(overview.manifestSha256);
  overviewLabel(overview.label);
  needPack(overview.sourceNote === null || (typeof overview.sourceNote === 'string' && [...overview.sourceNote].length <= 2048));
  const frame = jsonRow(overview.frame, ['linearUnit', 'upAxis', 'placement', 'physicalRegistration']);
  needPack(frame.linearUnit === 'm' && frame.upAxis === 'Y' && frame.placement === 'baked-in-asset' && frame.physicalRegistration === null);
  needPack(Array.isArray(overview.components) && overview.components.length <= 256);
  const componentIds = new Set<string>();
  for (const raw of overview.components) {
    const component = jsonRow(raw, ['id', 'kind', 'label']), id = packText(component.id, 128);
    needPack(/^[A-Za-z0-9_.-]+$/.test(id) && !componentIds.has(id)); componentIds.add(id);
    needPack(component.kind === 'building' || component.kind === 'plot' || component.kind === 'context'); overviewLabel(component.label);
  }
  const original = jsonRow(overview.original, ['contentType', 'sha256', 'bytes', 'resourceSha256']);
  needPack(original.contentType === MODEL_MIME);
  const originalSha256 = pin(original.sha256), originalBytes = count(original.bytes, SAVED_ATLAS_LIMITS.model);
  let model: SavedResource | null = null;
  if (original.resourceSha256 === null) incompleteModel(manifest, 'selected-model-unavailable');
  else {
    needPack(originalSha256 === pin(original.resourceSha256));
    model = resource(manifest, originalSha256, originalBytes, MODEL_MIME);
  }
  if (value.unifiedAtlas === null) {
    incompleteModel(manifest); return { publicationId, overviewManifestSha256, original: model, unified: null };
  }
  const unified = jsonRow(value.unifiedAtlas, ['profile', 'scope', 'publicationId', 'semanticsSha256', 'selectionRevision',
    'companion', 'originalResourceSha256', 'roomLinks']);
  needPack(model && unified.profile === 'houseatlas.home-read-pack.unified-atlas.v1' && unified.publicationId === publicationId
    && pin(unified.originalResourceSha256) === model.sha256); scope(unified.scope, manifest);
  const selectionRevision = packText(unified.selectionRevision, 128); needPack(REVISION.test(selectionRevision));
  const semanticsSha256 = pin(unified.semanticsSha256);
  const referencedJson = (value: LosslessJson | undefined, cap: number) => {
    const ref = jsonRow(value, ['resourceSha256', 'bytes', 'contentType']); needPack(ref.contentType === JSON_MIME);
    return resource(manifest, pin(ref.resourceSha256), count(ref.bytes, cap), JSON_MIME);
  };
  const companion = referencedJson(unified.companion, SAVED_ATLAS_LIMITS.companion);
  needPack(companion.sha256 === semanticsSha256);
  const roomLinks = unified.roomLinks === null ? null : referencedJson(unified.roomLinks, SAVED_ATLAS_LIMITS.roomLinks);
  if (roomLinks === null) incompleteModel(manifest, 'room-map-unavailable');
  return { publicationId, overviewManifestSha256, original: model, unified: { selectionRevision, semanticsSha256, companion, roomLinks } };
}

function row(value: unknown, keys: readonly string[]): Record<string, unknown> {
  needPack(value !== null && typeof value === 'object' && !Array.isArray(value));
  needPack(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
  return value as Record<string, unknown>;
}
/** Decode only the separately bounded companion. Keep raw bytes separately;
 * this envelope is an in-memory presentation projection, never a replacement. */
export function admitSavedAtlasCompanion(bytes: ArrayBuffer, manifest: PackManifest, model: SavedAtlasModel): AtlasScene {
  const selected = model.unified; needPack(model.original && selected && bytes.byteLength === selected.companion.bytes
    && bytes.byteLength <= SAVED_ATLAS_LIMITS.companion);
  const source = row(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), ['profile', 'scope', 'publicationId',
    'sourceRevisionId', 'sourceSha256', 'original', 'frame', 'buildings', 'levels', 'rooms', 'occurrences', 'meshBindings',
    'plans', 'overlayBindings', 'coverage']);
  needPack(source.profile === 'houseatlas.unified-atlas-publication.v1' && source.publicationId === model.publicationId);
  const original = row(source.original, ['bytes', 'sha256']);
  needPack(original.bytes === model.original.bytes && original.sha256 === model.original.sha256);
  return admitAtlasScene({ profile: 'houseatlas.unified-atlas-scene.v1', scope: source.scope,
    selection: { revision: selected.selectionRevision, publicationId: model.publicationId },
    publication: { publicationId: source.publicationId, sourceRevisionId: source.sourceRevisionId,
      sourceSha256: source.sourceSha256, semanticsSha256: selected.semanticsSha256 },
    artifacts: [{ artifactId: 'model', role: 'model', contentType: MODEL_MIME, bytes: model.original.bytes,
      sha256: model.original.sha256, href: `saved-resource:${model.original.sha256}` }],
    frame: source.frame, buildings: source.buildings, levels: source.levels, rooms: source.rooms, occurrences: source.occurrences,
    meshBindings: source.meshBindings, plans: source.plans, overlayBindings: source.overlayBindings, coverage: source.coverage,
  }, { scope: manifest.scope, publicationId: model.publicationId }, bytes.byteLength);
}

export interface SavedAtlasRoomLinks {
  readonly profile: 'houseatlas.unified-atlas-room-links.v1';
  readonly workspaceId: string; readonly homeId: string; readonly publicationId: string; readonly semanticsSha256: string;
  readonly links: readonly Readonly<{ roomId: string; nativePlaceId: string; packagePlaceKey: string; packagePlaceUuid: string }>[];
}
/** Historical correlations only: no live checkedAt, review owner or lease. */
export function readSavedAtlasRoomLinks(bytes: ArrayBuffer, scene: AtlasScene): SavedAtlasRoomLinks {
  needPack(bytes.byteLength > 0 && bytes.byteLength <= SAVED_ATLAS_LIMITS.roomLinks);
  const map = jsonRow(parseLosslessJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    ['profile', 'workspaceId', 'homeId', 'publicationId', 'semanticsSha256', 'links']);
  needPack(map.profile === 'houseatlas.unified-atlas-room-links.v1' && map.workspaceId === scene.scope.workspaceId
    && map.homeId === scene.scope.homeId && map.publicationId === scene.publication.publicationId
    && map.semanticsSha256 === scene.publication.semanticsSha256 && Array.isArray(map.links) && map.links.length <= SAVED_ATLAS_LIMITS.links);
  const rooms = new Map(scene.rooms.map(room => [room.roomId, room])), seen = new Set<string>(), triples = new Set<string>();
  const links = map.links.map(raw => {
    const link = jsonRow(raw, ['roomId', 'nativePlaceId', 'packagePlaceKey', 'packagePlaceUuid']);
    const roomId = packText(link.roomId, 128), nativePlaceId = packText(link.nativePlaceId),
      packagePlaceKey = packText(link.packagePlaceKey, 128), packagePlaceUuid = packText(link.packagePlaceUuid);
    const triple = JSON.stringify([nativePlaceId, packagePlaceKey, packagePlaceUuid]);
    needPack(OPAQUE.test(roomId) && OPAQUE.test(packagePlaceKey) && UUID.test(nativePlaceId) && UUID.test(packagePlaceUuid)
      && !seen.has(roomId) && !triples.has(triple) && rooms.get(roomId)?.nativePlaceId === nativePlaceId);
    seen.add(roomId); triples.add(triple); return { roomId, nativePlaceId, packagePlaceKey, packagePlaceUuid };
  });
  return { profile: 'houseatlas.unified-atlas-room-links.v1', workspaceId: scene.scope.workspaceId, homeId: scene.scope.homeId,
    publicationId: scene.publication.publicationId, semanticsSha256: scene.publication.semanticsSha256, links };
}
