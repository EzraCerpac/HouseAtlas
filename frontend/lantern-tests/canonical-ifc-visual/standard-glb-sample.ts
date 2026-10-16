/** SYNTHETIC standard GLB and browser manifest sample. Anonymous generated
 * blocks only: no real building, place, identifier, coordinate or pin. The
 * house is already posed (identity nodes); provenance matrices in extras and
 * in the manifest are deliberately non-identity so a preview that applied them
 * again would visibly move the geometry. */

type Vec3 = readonly [number, number, number];
export interface SampleMesh { readonly positions: readonly number[]; readonly indices: readonly number[] }
export interface SampleNode { readonly name?: string; readonly mesh?: number; readonly children?: readonly number[];
  readonly translation?: Vec3; readonly extras?: unknown }
export interface SampleGlb {
  readonly asset?: Readonly<Record<string, unknown>>;
  readonly nodes: readonly SampleNode[];
  readonly meshes: readonly SampleMesh[];
  readonly roots: readonly number[];
  /** Last-step edit of the glTF JSON, for explicit refusal checks. */
  readonly patch?: (json: Record<string, unknown>) => void;
}

/** Closed box from min to max, outward winding; `unused` adds unreferenced vertices. */
export function box(min: Vec3, max: Vec3, unused: readonly Vec3[] = []): SampleMesh {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const corners = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
  return { positions: [...corners, ...unused].flat(), indices: faces.flatMap(([a, b, c, d]) => [a!, b!, c!, a!, c!, d!]) };
}
const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): SampleMesh => ({ positions: [a, b, c, d].flat(), indices: [0, 1, 2, 0, 2, 3] });

const pad = (length: number) => (4 - length % 4) % 4;
/** Embedded-BIN glTF 2.0 binary with float positions and uint16 indices. */
export function buildGlb(spec: SampleGlb): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [], bufferViews: object[] = [], accessors: object[] = [];
  let offset = 0;
  const push = (bytes: Uint8Array, target: number) => {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    parts.push(bytes, new Uint8Array(pad(bytes.byteLength))); offset += bytes.byteLength + pad(bytes.byteLength);
    return bufferViews.length - 1;
  };
  const meshes = spec.meshes.map(mesh => {
    const positions = Float32Array.from(mesh.positions), count = positions.length / 3;
    const min = [0, 1, 2].map(axis => Math.min(...positions.filter((_, i) => i % 3 === axis)));
    const max = [0, 1, 2].map(axis => Math.max(...positions.filter((_, i) => i % 3 === axis)));
    accessors.push({ bufferView: push(new Uint8Array(positions.buffer), 34962), componentType: 5126, count, type: 'VEC3', min, max });
    const position = accessors.length - 1;
    accessors.push({ bufferView: push(new Uint8Array(Uint16Array.from(mesh.indices).buffer), 34963), componentType: 5123, count: mesh.indices.length, type: 'SCALAR' });
    return { primitives: [{ attributes: { POSITION: position }, indices: accessors.length - 1, mode: 4 }] };
  });
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'HouseAtlas synthetic sample generator', ...spec.asset },
    scene: 0, scenes: [{ nodes: spec.roots }], nodes: spec.nodes, meshes, accessors, bufferViews,
    buffers: offset > 0 ? [{ byteLength: offset }] : [],
  };
  spec.patch?.(json);
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonChunk = new Uint8Array(text.byteLength + pad(text.byteLength)).fill(0x20); jsonChunk.set(text);
  const bin = new Uint8Array(offset); let at = 0; for (const part of parts) { bin.set(part, at); at += part.byteLength; }
  const total = 12 + 8 + jsonChunk.byteLength + (offset > 0 ? 8 + offset : 0);
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk.byteLength, true); view.setUint32(16, 0x4e4f534a, true); out.set(jsonChunk, 20);
  if (offset > 0) { const binAt = 20 + jsonChunk.byteLength; view.setUint32(binAt, offset, true); view.setUint32(binAt + 4, 0x004e4942, true); out.set(bin, binAt + 8); }
  return out;
}

const POSED = { posesAlreadyApplied: true, applyTransformAgain: false } as const;
/** Inert provenance: never applied to geometry. */
const PROVENANCE = [[0, -1, 0, 120.5], [1, 0, 0, -48], [0, 0, 1, 3.25], [0, 0, 0, 1]];

/** Anonymous house: two blocks at unequal heights with a slab between, one
 * unreferenced far vertex, a geometry-free product and a geometry-free room occurrence. */
export const SAMPLE_HOUSE: SampleGlb = {
  meshes: [box([0, 0, 0], [6, 2.7, 4], [[400, 400, 400]]), box([0.5, 3.1, 0.5], [5, 5.5, 3.5]), box([0, 2.7, 0], [6, 3.1, 4])],
  roots: [0],
  nodes: [
    { name: 'Group A', children: [1, 2, 3, 4, 5], extras: { ...POSED, groupId: 'grp-synthetic-a', sourceToPreviewMatrixRowMajor: PROVENANCE } },
    { name: 'Lower block', mesh: 0, extras: { ...POSED, globalId: 'syn-product-0001' } },
    { name: 'Upper block', mesh: 1, extras: { ...POSED, globalId: 'syn-product-0002' } },
    { name: 'Slab', mesh: 2, extras: { ...POSED, globalId: 'syn-product-0003' } },
    { name: 'Room occurrence without geometry', extras: { ...POSED, occurrenceId: 'syn-occurrence-0001', level: null, footprint: null } },
    { name: 'Product without geometry', extras: { ...POSED, globalId: 'syn-product-0004', pose: null } },
  ],
};
export const SAMPLE_HOUSE_BOUNDS: readonly [Vec3, Vec3] = [[0, 0, 0], [6, 5.5, 4]];

export const SAMPLE_REFERENCE: SampleGlb = {
  asset: { copyright: 'Synthetic reference surfaces generated for tests; no real place' },
  meshes: [
    quad([-2, 0, -2], [-2, 0, 6], [8, 0, 6], [8, 0, -2]),
    quad([-0.2, 0, -0.2], [6.2, 0, -0.2], [6.2, 5.6, -0.2], [-0.2, 5.6, -0.2]),
    quad([-0.2, 5.6, -0.2], [6.2, 5.6, -0.2], [6.2, 6.4, 2], [-0.2, 6.4, 2]),
  ],
  roots: [0, 1, 2],
  nodes: [{ name: 'GroundSurface', mesh: 0, extras: POSED }, { name: 'WallSurface', mesh: 1, extras: POSED }, { name: 'RoofSurface', mesh: 2, extras: POSED }],
};
export const SAMPLE_REFERENCE_BOUNDS: readonly [Vec3, Vec3] = [[-2, 0, -2], [8, 6.4, 6]];

const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

/** Schema-complete anonymous manifest pinning exactly the given files. */
export async function sampleManifest(house: Uint8Array<ArrayBuffer>, reference: Uint8Array<ArrayBuffer>, overrides: Readonly<Record<string, unknown>> = {}) {
  const product = (globalId: string, ifcClass: string, storey: string, nodeIndex: number, meshIndex: number | null, triangles: number) => ({
    globalId, ifcClass, storey, nodeIndex, meshIndex, boundsLocalENNAPMetres: [[0, 0, 0], [0, 0, 0]], boundsGLTFMetres: [[0, 0, 0], [0, 0, 0]],
    closedSourceSolid: meshIndex !== null, triangles, float32MaximumCoordinateErrorMetres: 0 });
  const storey = (key: string, name: string, slab: number) => ({ key, sourceStoreyName: name, sourceStoreyGlobalId: `syn-storey-${key}`,
    ownerRotationRelativeV004Degrees: 0, sourceToLocalENNAPMetresMatrix: PROVENANCE, yawDegrees: 90, translationENMetres: [120.5, -48],
    sourceSlabTopMetres: slab, estimatedSlabTopAboveGroundProxyMetres: slab, estimatedSlabTopNAPMetres: slab, sourceToTargetZTranslationMetres: 3.25,
    scale: 1, mirror: false, placementBasis: 'synthetic generated sample', physicalRegistrationEstablished: false, measuredFloorElevationKnown: false,
    posedSlabFootprint: { type: 'Polygon', coordinates: [] }, slabAreaInsideOfficialFootprintFraction: 0 });
  return {
    schema: 'houseatlas-private-browser-manifest.v1', version: 'synthetic-1', status: 'synthetic sample, not a building',
    sourceIFC: { file: 'synthetic.ifc', sha256: '0'.repeat(64), bytes: 0 },
    houseGLB: { file: 'sample-house.glb', sha256: await sha256(house), bytes: house.byteLength, meshCount: 3, productNodes: 4, roomOccurrenceNodes: 1,
      triangleCount: 36, boundsGLTFMetres: SAMPLE_HOUSE_BOUNDS, boundsLocalENNAPMetres: [[0, 0, 0], [6, 4, 5.5]],
      perProductSolidsClosed: true, wholeHouseRoofedEnvelopeClosed: false, maximumFloat32CoordinateErrorMetres: 0 },
    referenceGLB: { file: 'sample-reference.glb', sha256: await sha256(reference), bytes: reference.byteLength,
      meshGroups: { GroundSurface: 1, WallSurface: 1, RoofSurface: 1 }, referenceSolidClosed: false,
      boundsGLTFMetres: SAMPLE_REFERENCE_BOUNDS, boundsLocalENNAPMetres: [[-2, -6, 0], [8, 2, 6.4]], role: 'synthetic reference observation' },
    format: { schema: 'houseatlas-private-browser-derivative.v1', version: 'synthetic-1', sourceIFCSHA256: '0'.repeat(64), units: 'metres',
      axes: 'glTF right-handed, Y up', localENUToGLTFMatrixRowMajor: [[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], originRDMetres: [0, 0, 0],
      posesAlreadyApplied: true, sourceScale: 1, reflectionApplied: false, physicalRegistrationEstablished: false, placementAccepted: false,
      atticShapeKnown: false, KiriReceived: false, currentNativeHeadRefreshed: false, derivation: 'Synthetic generated sample',
      noAdditionalStoreyTransformRequired: true, roofAuthored: false, groundFloorAuthored: true, openingCutsAlreadyApplied: false },
    storeys: [storey('a', 'Storey A', 0), storey('b', 'Storey B', 3.1)],
    products: [product('syn-product-0001', 'IfcBuildingElementProxy', 'a', 1, 0, 12), product('syn-product-0002', 'IfcBuildingElementProxy', 'b', 2, 1, 12),
      product('syn-product-0003', 'IfcSlab', 'b', 3, 2, 12), product('syn-product-0004', 'IfcBuildingElementProxy', 'b', 5, null, 0)],
    roomOccurrences: [{ globalId: 'syn-occurrence-0001', nodeIndex: 4, footprintAvailable: false }],
    grouping: { storeys: 2, floorSlabMeshes: 1, authoredRoofMeshes: 0, omittedLegacyAtticPhysicalMeshes: 0, unplacedStairSemanticNodes: 0, groundFloorMeshes: 1 },
    previewLineage: ['Generated by standard-glb-sample.ts'],
    remainingUncertainty: ['Synthetic sample: no real building is represented.', 'Block heights are generated values, not measurements.'],
    storeyVisibleMeshBounds: [
      { key: 'a', storeyGlobalId: 'syn-storey-a', visibleMeshCount: 1, boundsGLTFMetres: [[0, 0, 0], [6, 2.7, 4]], boundsLocalENNAPMetres: [[0, 0, 0], [6, 4, 2.7]], posesAlreadyApplied: true },
      { key: 'b', storeyGlobalId: 'syn-storey-b', visibleMeshCount: 2, boundsGLTFMetres: [[0, 2.7, 0], [6, 5.5, 4]], boundsLocalENNAPMetres: [[0, 0, 2.7], [6, 4, 5.5]], posesAlreadyApplied: true },
    ],
    ...overrides,
  };
}

/** The three sample files as a browser chooser would hand them over. */
export async function standardGlbSampleFiles(): Promise<readonly File[]> {
  const house = buildGlb(SAMPLE_HOUSE), reference = buildGlb(SAMPLE_REFERENCE);
  const manifest = new TextEncoder().encode(JSON.stringify(await sampleManifest(house, reference), null, 2));
  return [new File([manifest], 'sample-manifest.json', { type: 'application/json' }),
    new File([house], 'sample-house.glb', { type: 'model/gltf-binary' }), new File([reference], 'sample-reference.glb', { type: 'model/gltf-binary' })];
}
