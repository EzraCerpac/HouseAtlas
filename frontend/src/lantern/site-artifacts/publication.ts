import { SITE_ARTIFACT_PUBLICATION_SCHEMA, type SiteAsset, type SiteAxis, type SiteFeature, type SiteFrame,
  type SiteGroup, type SitePin, type SitePublication } from './types';

export class SitePublicationError extends Error {}

type Row = Readonly<Record<string, unknown>>;
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
function need(condition: unknown, message: string): asserts condition { if (!condition) throw new SitePublicationError(message); }
const row = (value: unknown, what: string): Row => { need(isRow(value), `${what} is missing`); return value; };
const text = (value: unknown, what: string) => { need(typeof value === 'string' && value.length > 0 && value.length <= 512, `${what} is not a string`); return value; };
const maybeText = (value: unknown, what: string) => value === null || value === undefined ? null : text(value, what);
const flag = (value: unknown, what: string) => { need(typeof value === 'boolean', `${what} is not true or false`); return value; };
const count = (value: unknown, what: string) => { need(Number.isSafeInteger(value) && (value as number) >= 0, `${what} is not a count`); return value as number; };
const list = (value: unknown, what: string, max: number) => { need(Array.isArray(value) && value.length <= max, `${what} is not a bounded list`); return value as readonly unknown[]; };
const indices = (value: unknown, what: string) => {
  const items = list(value, what, 20_000).map(item => count(item, what));
  need(new Set(items).size === items.length, `${what} repeats an index`);
  return items;
};

export const SITE_LIMITS = Object.freeze({ assets: 64, groups: 20_000, features: 20_000, planFeatures: 20_000, planCoordinates: 1_000_000 });
const AXES: ReadonlySet<string> = new Set(['east', 'west', 'north', 'south', 'up', 'down']);
const axes = (value: unknown, what: string) => {
  const items = list(value, what, 3);
  need(items.length === 3 && items.every(item => typeof item === 'string' && AXES.has(item)), `${what} are not three declared axes`);
  const lines = items.map(item => item === 'west' ? 'east' : item === 'south' ? 'north' : item === 'down' ? 'up' : item);
  need(new Set(lines).size === 3, `${what} repeat a direction`);
  return items as unknown as readonly [SiteAxis, SiteAxis, SiteAxis];
};

/** Validates one publication against the exact pin the host selected. Shapes
 * are checked and copied; nothing is normalized, fitted or reinterpreted. */
export function readSitePublication(value: unknown, pin: SitePin): SitePublication {
  const root = row(value, 'Publication');
  need(root.schema === SITE_ARTIFACT_PUBLICATION_SCHEMA, 'This is not a site artifact publication v1');
  const publication = row(root.publication, 'Publication identity');
  need(publication.publicationId === pin.publicationId && publication.version === pin.version, 'The publication does not match the selected version');
  need(publication.immutable === true, 'The publication is not immutable');
  const native = row(root.nativePublication, 'Native publication');
  const frame = row(root.siteFrame, 'Site frame');
  const origin = list(frame.originSource, 'Source origin', 3);
  need(origin.length === 3 && origin.every(item => typeof item === 'number' && Number.isFinite(item)), 'Source origin is not three numbers');
  const siteFrame: SiteFrame = {
    horizontalCRS: text(frame.horizontalCRS, 'Horizontal CRS'), verticalDatum: text(frame.verticalDatum, 'Vertical datum'),
    unit: text(frame.unit, 'Unit'), originSource: origin as unknown as readonly [number, number, number],
    modelingAxes: axes(frame.modelingAxes, 'Modeling axes'), rendererAxes: axes(frame.rendererAxes, 'Renderer axes'),
  };
  const assets = list(root.assets, 'Assets', SITE_LIMITS.assets).map((item, at): SiteAsset => {
    const asset = row(item, `Asset ${at + 1}`), storage = asset.storage;
    need(storage === null || storage === undefined || isRow(storage), `Asset ${at + 1} storage is invalid`);
    return { assetId: text(asset.assetId, 'Asset ID'), kind: text(asset.kind, 'Asset kind'), sha256: text(asset.sha256, 'Asset SHA-256'),
      bytes: count(asset.bytes, 'Asset bytes'), contentType: text(asset.contentType, 'Asset content type'), frame: text(asset.frame, 'Asset frame'),
      sourcePoseAlreadyApplied: flag(asset.sourcePoseAlreadyApplied, 'Source pose applied'), poseAppliedByAssembly: flag(asset.poseAppliedByAssembly, 'Assembly pose'),
      href: maybeText(asset.href, 'Asset href'), storageKind: isRow(storage) ? maybeText(storage.kind, 'Storage kind') : null };
  });
  need(new Set(assets.map(asset => asset.assetId)).size === assets.length, 'An asset ID repeats');
  const assetIds = new Set(assets.map(asset => asset.assetId));
  const groups = list(root.groups, 'Groups', SITE_LIMITS.groups).map((item, at): SiteGroup => {
    const group = row(item, `Group ${at + 1}`);
    const assetId = text(group.assetId, 'Group asset');
    need(assetIds.has(assetId), `Group ${at + 1} names an asset that is not listed`);
    return { groupId: text(group.groupId, 'Group ID'), assetId, nodeIndices: indices(group.nodeIndices, 'Group nodes'),
      meshIndices: indices(group.meshIndices, 'Group meshes'), sourceFeatureId: maybeText(group.sourceFeatureId, 'Group feature'),
      sourceGlobalId: maybeText(group.sourceGlobalId, 'Group GlobalId'), sourceStoreyLabel: maybeText(group.sourceStoreyLabel, 'Group storey label'),
      defaultVisible: flag(group.defaultVisible, 'Group visibility'), coverage: text(group.coverage, 'Group coverage') };
  });
  need(new Set(groups.map(group => group.groupId)).size === groups.length, 'A group ID repeats');
  const groupIds = new Set(groups.map(group => group.groupId));
  const features = list(root.features, 'Features', SITE_LIMITS.features).map((item, at): SiteFeature => {
    const feature = row(item, `Feature ${at + 1}`), coverage = row(feature.coverage, 'Feature coverage');
    const linked = list(feature.groupIds, 'Feature groups', 20_000).map(id => text(id, 'Feature group'));
    need(linked.every(id => groupIds.has(id)), `Feature ${at + 1} names a group that is not listed`);
    const dimensions = feature.sourceGeometryDimensions;
    need(dimensions === 2 || dimensions === 3, 'Feature dimensions are not 2 or 3');
    const elevation = feature.sourceGeometryElevation;
    need(elevation === null || typeof elevation === 'number' && Number.isFinite(elevation), 'Feature elevation is invalid');
    return { sourceFeatureId: text(feature.sourceFeatureId, 'Feature ID'), displayName: text(feature.displayName, 'Feature name'),
      defaultVisible2D: flag(feature.defaultVisible2D, '2D visibility'), defaultVisible3D: flag(feature.defaultVisible3D, '3D visibility'),
      groupIds: linked, sourceGeometryDimensions: dimensions, sourceGeometryElevation: elevation,
      coverage: { mode: text(coverage.mode, 'Coverage mode'), reason: maybeText(coverage.reason, 'Coverage reason') } };
  });
  need(new Set(features.map(feature => feature.sourceFeatureId)).size === features.length, 'A feature ID repeats');
  const house = row(root.canonicalHouse, 'Canonical house');
  const houseGroups = list(house.groupIds, 'Canonical house groups', 20_000).map(id => text(id, 'Canonical house group'));
  need(houseGroups.every(id => groupIds.has(id)), 'The canonical house names a group that is not listed');
  return {
    pin: { publicationId: pin.publicationId, version: pin.version },
    artifactAvailability: text(publication.artifactAvailability, 'Artifact availability'), kind: text(publication.kind, 'Publication kind'),
    native: { sitePublicationId: maybeText(native.sitePublicationId, 'Native publication ID'), availability: text(native.availability, 'Native availability') },
    modelingArtifactAssetId: maybeText(root.modelingArtifactAssetId, 'Modeling artifact'),
    siteFrame, assets, groups, features,
    canonicalHouse: { status: text(house.status, 'Canonical house status'), assetId: maybeText(house.assetId, 'Canonical house asset'), groupIds: houseGroups,
      qualifiedMatrixDeclared: house.qualifiedIfcToSiteMatrix !== null && house.qualifiedIfcToSiteMatrix !== undefined,
      provisionalPoseDeclared: house.provisionalPose !== null && house.provisionalPose !== undefined },
  };
}

/** The renderer draws glTF metres with +X east, +Y up, +Z south. */
export const RENDERER_AXES = ['east', 'up', 'south'] as const;
export const GLB_CONTENT_TYPE = 'model/gltf-binary';
export const PLAN_CONTENT_TYPE = 'application/geo+json';
/** Source-declared kind of the separately switchable official reference envelope. */
export const REFERENCE_ENVELOPE_KIND = 'official-reference-envelope';

/** Why an asset is not drawn in 3D, or null when it is drawn exactly as stored. */
export function notDrawnReason(asset: SiteAsset, frame: SiteFrame): string | null {
  if (asset.contentType !== GLB_CONTENT_TYPE) return asset.contentType === PLAN_CONTENT_TYPE ? 'Source plan, shown in 2D only' : `Not a GLB (${asset.contentType})`;
  if (frame.unit !== 'm') return `Unit ${frame.unit} is not metres; not rescaled`;
  if (frame.rendererAxes.some((axis, at) => axis !== RENDERER_AXES[at])) return `Renderer axes ${frame.rendererAxes.join(', ')} are not east, up, south; not reflected or rotated`;
  if (asset.frame !== 'declared-renderer-frame') return `Frame ${asset.frame} is not the declared renderer frame`;
  if (!asset.sourcePoseAlreadyApplied || asset.poseAppliedByAssembly) return 'Its pose would have to be applied here; no pose is applied';
  return null;
}

/** Why a plan cannot be shown in 2D, or null. */
export function planReason(frame: SiteFrame): string | null {
  const [x, y] = frame.modelingAxes;
  return x === 'east' && y === 'north' ? null : `Modeling axes ${frame.modelingAxes.join(', ')} are not east, north; not reflected or rotated`;
}

export type PlanPath = readonly (readonly [number, number])[];
export interface PlanShape {
  readonly featureId: string | null;
  readonly kind: 'area' | 'line' | 'point';
  /** Source coordinates minus the declared origin, at double precision. */
  readonly paths: readonly PlanPath[];
}
export interface SitePlan { readonly shapes: readonly PlanShape[]; readonly skipped: number }

/** Reads the declared GeoJSON geometry kinds; other kinds are counted, not guessed. */
export function readPlan(value: unknown, origin: readonly [number, number, number]): SitePlan {
  const root = row(value, 'Plan');
  need(root.type === 'FeatureCollection', 'The plan is not a FeatureCollection');
  const items = list(root.features, 'Plan features', SITE_LIMITS.planFeatures);
  let coordinates = 0, skipped = 0;
  const point = (value: unknown): readonly [number, number] => {
    need(Array.isArray(value) && value.length >= 2 && value.length <= 3 && value.every(item => typeof item === 'number' && Number.isFinite(item)), 'A plan coordinate is invalid');
    need(++coordinates <= SITE_LIMITS.planCoordinates, 'The plan has too many coordinates');
    return [(value[0] as number) - origin[0], (value[1] as number) - origin[1]];
  };
  const path = (value: unknown) => list(value, 'Plan path', SITE_LIMITS.planCoordinates).map(point);
  const shapes: PlanShape[] = [];
  for (const item of items) {
    const feature = row(item, 'Plan feature');
    const properties = isRow(feature.properties) ? feature.properties : null;
    const featureId = typeof properties?.sourceFeatureId === 'string' ? properties.sourceFeatureId : null;
    if (feature.geometry === null) { skipped++; continue; }
    const geometry = row(feature.geometry, 'Plan geometry'), c = geometry.coordinates;
    switch (geometry.type) {
      case 'Point': shapes.push({ featureId, kind: 'point', paths: [[point(c)]] }); break;
      case 'MultiPoint': shapes.push({ featureId, kind: 'point', paths: list(c, 'Points', SITE_LIMITS.planCoordinates).map(item => [point(item)]) }); break;
      case 'LineString': shapes.push({ featureId, kind: 'line', paths: [path(c)] }); break;
      case 'MultiLineString': shapes.push({ featureId, kind: 'line', paths: list(c, 'Lines', SITE_LIMITS.planCoordinates).map(path) }); break;
      case 'Polygon': shapes.push({ featureId, kind: 'area', paths: list(c, 'Rings', SITE_LIMITS.planCoordinates).map(path) }); break;
      case 'MultiPolygon': shapes.push({ featureId, kind: 'area', paths: list(c, 'Polygons', SITE_LIMITS.planCoordinates).flatMap(rings => list(rings, 'Rings', SITE_LIMITS.planCoordinates).map(path)) }); break;
      default: skipped++;
    }
  }
  return { shapes, skipped };
}

export const hex = (bytes: ArrayBuffer) => crypto.subtle.digest('SHA-256', bytes)
  .then(digest => [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''));
/** Accepts `sha256:<hex>` or bare lowercase hex as the declared digest form. */
export const declaredHex = (value: string) => value.startsWith('sha256:') ? value.slice(7) : value;
