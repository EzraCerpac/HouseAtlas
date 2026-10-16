import type { Bounds } from './geometry';
import type { StandardGlb } from './standard-glb';

/** Reader for the producer's source-neutral browser manifest
 * (`houseatlas-private-browser-manifest.v1`). The complete v1 structure is
 * validated before any field is projected for display; additional properties
 * stay allowed for forward-compatible provenance and are kept untouched in
 * `document`. Matrices, origins, footprints and storey poses are retained as
 * declared provenance only: they are never applied, because complete poses
 * are already baked into the GLB positions. Counts are dynamic. */
export const MANIFEST_SCHEMA = 'houseatlas-private-browser-manifest.v1';
export const DERIVATIVE_SCHEMA = 'houseatlas-private-browser-derivative.v1';

export type ManifestStage = 'manifest' | 'pin' | 'binding';
export class ManifestError extends Error {
  constructor(readonly stage: ManifestStage, reason: string) { super(reason); }
}
function need(ok: unknown, reason: string, stage: ManifestStage = 'manifest'): asserts ok { if (!ok) throw new ManifestError(stage, reason); }

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Structural shape: every listed property is required and additional
 * properties are allowed, as in the v1 JSON Schema. `size` fixes a list length. */
type Shape = 'string' | 'number' | 'boolean' | 'null' | 'sha256'
  | { readonly const: string | number | boolean }
  | { readonly list: Shape; readonly size?: number }
  | { readonly object: Readonly<Record<string, Shape>> }
  | { readonly anyOf: readonly Shape[] };
type Infer<S> = S extends 'string' | 'sha256' ? string : S extends 'number' ? number : S extends 'boolean' ? boolean : S extends 'null' ? null
  : S extends { readonly const: infer C } ? C : S extends { readonly list: infer I } ? readonly Infer<I>[]
  : S extends { readonly object: infer O } ? { readonly [K in keyof O]: Infer<O[K]> }
  : S extends { readonly anyOf: readonly (infer A)[] } ? Infer<A> : never;

const BOUNDS = { list: { list: 'number', size: 3 }, size: 2 } as const;
const MATRIX4 = { list: { list: 'number', size: 4 }, size: 4 } as const;
const product = <M extends Shape>(meshIndex: M) => ({ object: { globalId: 'string', ifcClass: 'string', storey: 'string', nodeIndex: 'number',
  meshIndex, boundsLocalENNAPMetres: BOUNDS, boundsGLTFMetres: BOUNDS, closedSourceSolid: 'boolean', triangles: 'number',
  float32MaximumCoordinateErrorMetres: 'number' } }) as const;

/** Mirror of `urn:houseatlas:browser-mesh-manifest:v1`. */
export const MANIFEST_V1_SHAPE = { object: {
  schema: { const: MANIFEST_SCHEMA }, version: 'string', status: 'string',
  sourceIFC: { object: { file: 'string', sha256: 'sha256', bytes: 'number' } },
  houseGLB: { object: { file: 'string', sha256: 'sha256', bytes: 'number', meshCount: 'number', productNodes: 'number',
    roomOccurrenceNodes: 'number', triangleCount: 'number', boundsGLTFMetres: BOUNDS, boundsLocalENNAPMetres: BOUNDS,
    perProductSolidsClosed: 'boolean', wholeHouseRoofedEnvelopeClosed: 'boolean', maximumFloat32CoordinateErrorMetres: 'number' } },
  referenceGLB: { object: { file: 'string', sha256: 'sha256', bytes: 'number',
    meshGroups: { object: { GroundSurface: 'number', WallSurface: 'number', RoofSurface: 'number' } },
    referenceSolidClosed: 'boolean', boundsGLTFMetres: BOUNDS, boundsLocalENNAPMetres: BOUNDS, role: 'string' } },
  format: { object: { schema: { const: DERIVATIVE_SCHEMA }, version: 'string', sourceIFCSHA256: 'string', units: { const: 'metres' },
    axes: 'string', localENUToGLTFMatrixRowMajor: MATRIX4, originRDMetres: { list: 'number', size: 3 },
    posesAlreadyApplied: { const: true }, sourceScale: { const: 1 }, reflectionApplied: { const: false },
    physicalRegistrationEstablished: 'boolean', placementAccepted: 'boolean', atticShapeKnown: 'boolean', KiriReceived: 'boolean',
    currentNativeHeadRefreshed: 'boolean', derivation: 'string', noAdditionalStoreyTransformRequired: { const: true },
    roofAuthored: 'boolean', groundFloorAuthored: 'boolean', openingCutsAlreadyApplied: 'boolean' } },
  storeys: { list: { object: { key: 'string', sourceStoreyName: 'string', sourceStoreyGlobalId: 'string',
    ownerRotationRelativeV004Degrees: 'number', sourceToLocalENNAPMetresMatrix: MATRIX4, yawDegrees: 'number',
    translationENMetres: { list: 'number', size: 2 }, sourceSlabTopMetres: 'number', estimatedSlabTopAboveGroundProxyMetres: 'number',
    estimatedSlabTopNAPMetres: 'number', sourceToTargetZTranslationMetres: 'number', scale: 'number', mirror: 'boolean',
    placementBasis: 'string', physicalRegistrationEstablished: 'boolean', measuredFloorElevationKnown: 'boolean',
    posedSlabFootprint: { object: { type: 'string', coordinates: { list: { list: { list: 'number' } } } } },
    slabAreaInsideOfficialFootprintFraction: 'number' } } },
  products: { list: { anyOf: [product('number'), product('null')] } },
  roomOccurrences: { list: { object: { globalId: 'string', nodeIndex: 'number', footprintAvailable: 'boolean' } } },
  grouping: { object: { storeys: 'number', floorSlabMeshes: 'number', authoredRoofMeshes: 'number',
    omittedLegacyAtticPhysicalMeshes: 'number', unplacedStairSemanticNodes: 'number', groundFloorMeshes: 'number' } },
  previewLineage: { list: 'string' }, remainingUncertainty: { list: 'string' },
  storeyVisibleMeshBounds: { list: { object: { key: 'string', storeyGlobalId: 'string', visibleMeshCount: 'number',
    boundsGLTFMetres: BOUNDS, boundsLocalENNAPMetres: BOUNDS, posesAlreadyApplied: 'boolean' } } },
} } as const satisfies Shape;
export type ManifestDocument = Infer<typeof MANIFEST_V1_SHAPE>;

function conform(value: unknown, shape: Shape, path: string): void {
  if (typeof shape === 'string') {
    const ok = shape === 'null' ? value === null : shape === 'sha256' ? typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
      : shape === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === shape;
    need(ok, `${path} must be ${{ string: 'text', number: 'a number', boolean: 'true or false', null: 'null', sha256: 'a SHA-256' }[shape]}`);
  } else if ('const' in shape) need(value === shape.const, `${path} must be ${JSON.stringify(shape.const)}`);
  else if ('list' in shape) {
    need(Array.isArray(value), `${path} must be a list`);
    need(shape.size === undefined || value.length === shape.size, `${path} must have ${shape.size} items`);
    value.forEach((item, at) => conform(item, shape.list, `${path}[${at}]`));
  } else if ('object' in shape) {
    need(isRow(value), `${path} must be an object`);
    for (const [key, item] of Object.entries(shape.object)) {
      need(Object.hasOwn(value, key), `${path}.${key} is missing`);
      conform(value[key], item, `${path}.${key}`);
    }
  } else need(shape.anyOf.some(option => { try { conform(value, option, path); return true; } catch { return false; } }),
    `${path} matches none of the declared forms`);
}

const whole = (value: number, what: string) => { need(Number.isInteger(value) && value >= 0, `${what} must be a whole number`); return value; };
type Pair = ManifestDocument['houseGLB']['boundsGLTFMetres'];
function bounds(pair: Pair, what: string): Bounds {
  const [min, max] = pair as readonly (readonly number[])[];
  need(min!.every((v, i) => v <= max![i]!), `${what} minimum exceeds maximum`);
  return { min: [min![0]!, min![1]!, min![2]!], max: [max![0]!, max![1]!, max![2]!] };
}
/** Throws on the first value seen twice, naming it. */
function unique<T>(items: readonly T[], what: string) {
  const seen = new Set<T>();
  for (const item of items) { need(!seen.has(item), `${what} ${String(item)} appears more than once`); seen.add(item); }
}

export interface ManifestArtifact { readonly file: string; readonly sha256: string; readonly bytes: number; readonly declaredBounds: Bounds }
export interface BrowserManifest {
  /** The complete validated document, additional properties included. */
  readonly document: ManifestDocument;
  readonly version: string;
  readonly status: string;
  readonly formatVersion: string;
  readonly axes: string;
  readonly sourceIFC: { readonly file: string; readonly sha256: string; readonly bytes: number };
  readonly house: ManifestArtifact & { readonly declaredMeshes: number; readonly declaredTriangles: number; readonly float32ErrorMetres: number;
    readonly productNodes: number; readonly roomOccurrenceNodes: number;
    readonly perProductSolidsClosed: boolean; readonly wholeHouseRoofedEnvelopeClosed: boolean };
  readonly reference: ManifestArtifact & { readonly role: string; readonly referenceSolidClosed: boolean;
    /** Declared reference surface groups and their mesh counts, in manifest order. */
    readonly groups: readonly { readonly name: string; readonly meshes: number }[] };
  readonly qualifications: {
    readonly derivation: string; readonly physicalRegistrationEstablished: boolean; readonly placementAccepted: boolean;
    readonly atticShapeKnown: boolean; readonly kiriReceived: boolean; readonly currentNativeHeadRefreshed: boolean;
    readonly roofAuthored: boolean; readonly groundFloorAuthored: boolean; readonly openingCutsAlreadyApplied: boolean;
  };
  readonly storeys: readonly { readonly key: string; readonly label: string; readonly globalId: string; readonly placementBasis: string;
    readonly physicalRegistrationEstablished: boolean; readonly measuredFloorElevationKnown: boolean;
    /** Declared visible mesh count for this storey, or null when not listed. */
    readonly visibleMeshes: number | null }[];
  /** Opaque product identities; meshIndex null marks a geometry-free node. */
  readonly products: readonly { readonly globalId: string; readonly ifcClass: string; readonly storey: string; readonly nodeIndex: number; readonly meshIndex: number | null }[];
  readonly roomOccurrences: readonly { readonly globalId: string; readonly nodeIndex: number; readonly footprintAvailable: boolean }[];
  readonly grouping: ManifestDocument['grouping'];
  readonly remainingUncertainty: readonly string[];
  readonly previewLineage: readonly string[];
}

export function readBrowserManifest(value: unknown): BrowserManifest {
  need(isRow(value) && value.schema === MANIFEST_SCHEMA, 'Unsupported manifest schema');
  conform(value, MANIFEST_V1_SHAPE, 'manifest');
  const document = value as ManifestDocument, { format, sourceIFC, houseGLB: house, referenceGLB: reference } = document;
  // This preview applies no transform; it can only show already-posed artifacts.
  need((format as Row).applyTransformAgain === undefined || (format as Row).applyTransformAgain === false, 'The manifest asks for a transform to be applied again');
  need(value.applyTransformAgain === undefined || value.applyTransformAgain === false, 'The manifest asks for a transform to be applied again');
  need(format.sourceIFCSHA256 === sourceIFC.sha256, 'The derivative format names a different source IFC than sourceIFC');
  need(house.sha256 !== reference.sha256, 'The house and reference GLB pins are the same file');
  for (const [what, bytes] of [['Source IFC bytes', sourceIFC.bytes], ['House bytes', house.bytes], ['Reference bytes', reference.bytes]] as const) whole(bytes, what);

  // Identities are checked before any lookup is built; no row silently wins.
  const products = document.products.map(item => ({ globalId: item.globalId, ifcClass: item.ifcClass, storey: item.storey,
    nodeIndex: whole(item.nodeIndex, 'Product node'), meshIndex: item.meshIndex === null ? null : whole(item.meshIndex, 'Product mesh') }));
  const roomOccurrences = document.roomOccurrences.map(item => ({ globalId: item.globalId,
    nodeIndex: whole(item.nodeIndex, 'Room occurrence node'), footprintAvailable: item.footprintAvailable }));
  unique(products.map(item => item.nodeIndex), 'Product node');
  unique(products.map(item => item.globalId), 'Product GlobalId');
  unique(roomOccurrences.map(item => item.nodeIndex), 'Room occurrence node');
  unique(roomOccurrences.map(item => item.globalId), 'Room occurrence GlobalId');
  const productAt = new Map(products.map(item => [item.nodeIndex, item.globalId]));
  const productOf = new Map(products.map(item => [item.globalId, item.nodeIndex]));
  for (const occurrence of roomOccurrences) {
    const sameNode = productAt.get(occurrence.nodeIndex), sameId = productOf.get(occurrence.globalId);
    need(sameNode === undefined || sameNode === occurrence.globalId, `Node ${occurrence.nodeIndex} has a different product and room occurrence identity`);
    need(sameId === undefined || sameId === occurrence.nodeIndex, `GlobalId ${occurrence.globalId} names different product and room occurrence nodes`);
  }
  unique(document.storeys.map(storey => storey.key), 'Storey key');
  unique(document.storeys.map(storey => storey.sourceStoreyGlobalId), 'Storey GlobalId');
  unique(document.storeyVisibleMeshBounds.map(item => item.key), 'Storey bounds key');
  const storeyIds = new Map(document.storeys.map(storey => [storey.key, storey.sourceStoreyGlobalId]));
  for (const item of document.storeyVisibleMeshBounds)
    need(storeyIds.get(item.key) === item.storeyGlobalId, `Storey bounds ${item.key} do not match a declared storey`);
  const visible = new Map(document.storeyVisibleMeshBounds.map(item => [item.key, item.visibleMeshCount]));

  const groups = reference.meshGroups as Readonly<Record<string, unknown>>;
  return {
    document, version: document.version, status: document.status, formatVersion: format.version, axes: format.axes,
    sourceIFC: { file: sourceIFC.file, sha256: sourceIFC.sha256, bytes: sourceIFC.bytes },
    house: { file: house.file, sha256: house.sha256, bytes: house.bytes, declaredBounds: bounds(house.boundsGLTFMetres, 'House bounds'),
      declaredMeshes: house.meshCount, declaredTriangles: house.triangleCount, float32ErrorMetres: house.maximumFloat32CoordinateErrorMetres,
      productNodes: house.productNodes, roomOccurrenceNodes: house.roomOccurrenceNodes,
      perProductSolidsClosed: house.perProductSolidsClosed, wholeHouseRoofedEnvelopeClosed: house.wholeHouseRoofedEnvelopeClosed },
    reference: { file: reference.file, sha256: reference.sha256, bytes: reference.bytes,
      declaredBounds: bounds(reference.boundsGLTFMetres, 'Reference bounds'), role: reference.role,
      referenceSolidClosed: reference.referenceSolidClosed,
      groups: Object.entries(groups).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
        .map(([name, meshes]) => ({ name, meshes: whole(meshes, `Reference group ${name}`) })) },
    qualifications: { derivation: format.derivation, physicalRegistrationEstablished: format.physicalRegistrationEstablished,
      placementAccepted: format.placementAccepted, atticShapeKnown: format.atticShapeKnown, kiriReceived: format.KiriReceived,
      currentNativeHeadRefreshed: format.currentNativeHeadRefreshed, roofAuthored: format.roofAuthored,
      groundFloorAuthored: format.groundFloorAuthored, openingCutsAlreadyApplied: format.openingCutsAlreadyApplied },
    storeys: document.storeys.map(storey => ({ key: storey.key, label: storey.sourceStoreyName, globalId: storey.sourceStoreyGlobalId,
      placementBasis: storey.placementBasis, physicalRegistrationEstablished: storey.physicalRegistrationEstablished,
      measuredFloorElevationKnown: storey.measuredFloorElevationKnown, visibleMeshes: visible.get(storey.key) ?? null })),
    products, roomOccurrences, grouping: document.grouping,
    remainingUncertainty: document.remainingUncertainty, previewLineage: document.previewLineage,
  };
}

export interface ManifestCheck {
  /** Loaded counts beside declared counts; differences are shown, not hidden. */
  readonly meshes: { readonly declared: number; readonly loaded: number };
  readonly triangles: { readonly declared: number; readonly loaded: number };
  /** Largest per-axis difference between declared and loaded visible bounds, in metres. */
  readonly boundsDifference: number | null;
  readonly boundsTolerance: number;
  readonly geometryFreeProducts: number;
  readonly occurrencesWithFootprint: number;
  /** Listed nodes whose own `extras.globalId` agrees with the manifest; others stay undeclared. */
  readonly identitiesInExtras: number;
}

const maxDifference = (a: Bounds, b: Bounds) => Math.max(...[0, 1, 2].flatMap(i => [Math.abs(a.min[i]! - b.min[i]!), Math.abs(a.max[i]! - b.max[i]!)]));
/** The one producer identity key read from node extras; other extras stay opaque. */
const extrasIdentity = (extras: unknown) => isRow(extras) && typeof extras.globalId === 'string' ? extras.globalId : null;

/** Checks exact pins and node identities of one manifest version against its
 * own loaded files. Any mismatch refuses the whole set: versions are never mixed. */
export function checkManifest(manifest: BrowserManifest, house: { readonly sha256: string; readonly bytes: number; readonly glb: StandardGlb; readonly bounds: Bounds | null },
  reference: { readonly sha256: string; readonly bytes: number } | null): ManifestCheck {
  need(house.sha256 === manifest.house.sha256 && house.bytes === manifest.house.bytes, 'The house GLB differs from the manifest pin', 'pin');
  need(reference === null || reference.sha256 === manifest.reference.sha256 && reference.bytes === manifest.reference.bytes,
    'The reference GLB differs from the manifest pin', 'pin');
  // Manifest identities are already unique and consistent (readBrowserManifest).
  const nodes = new Map(house.glb.nodes.map(node => [node.nodeIndex, node]));
  for (const product of manifest.products) {
    const node = nodes.get(product.nodeIndex);
    need(node !== undefined && node.meshIndex === product.meshIndex, `Product node ${product.nodeIndex} differs from the GLB scene`, 'binding');
  }
  for (const occurrence of manifest.roomOccurrences)
    need(nodes.has(occurrence.nodeIndex), `Room occurrence node ${occurrence.nodeIndex} is not in the GLB scene`, 'binding');
  const listedAt = new Map<number, string>(), listedOf = new Map<string, number>();
  for (const item of [...manifest.products, ...manifest.roomOccurrences]) { listedAt.set(item.nodeIndex, item.globalId); listedOf.set(item.globalId, item.nodeIndex); }
  const declaredOf = new Map<string, number>();
  let identitiesInExtras = 0;
  for (const node of house.glb.nodes) {
    const declared = extrasIdentity(node.extras);
    if (declared === null) continue;
    const other = declaredOf.get(declared), listed = listedAt.get(node.nodeIndex);
    need(other === undefined, `GLB nodes ${other} and ${node.nodeIndex} declare the same identity`, 'binding');
    declaredOf.set(declared, node.nodeIndex);
    need(listed === undefined || listed === declared, `GLB node ${node.nodeIndex} declares a different identity than the manifest`, 'binding');
    need(listed !== undefined || !listedOf.has(declared), `GLB node ${node.nodeIndex} declares the identity the manifest gives node ${listedOf.get(declared)}`, 'binding');
    if (listed !== undefined) identitiesInExtras++;
  }
  return {
    meshes: { declared: manifest.house.declaredMeshes, loaded: house.glb.declaredMeshes },
    triangles: { declared: manifest.house.declaredTriangles, loaded: house.glb.counts.triangles },
    boundsDifference: house.bounds ? maxDifference(manifest.house.declaredBounds, house.bounds) : null,
    boundsTolerance: Math.max(1e-4, manifest.house.float32ErrorMetres * 2),
    geometryFreeProducts: manifest.products.filter(product => product.meshIndex === null).length,
    occurrencesWithFootprint: manifest.roomOccurrences.filter(occurrence => occurrence.footprintAvailable).length,
    identitiesInExtras,
  };
}
