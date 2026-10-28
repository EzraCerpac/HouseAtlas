/** SYNTHETIC standard GLB sample. Anonymous generated blocks only: no real
 * building, place, identifier, coordinate or pin. The house is already posed
 * (identity nodes); provenance matrices in extras are deliberately
 * non-identity so a loader that applied them again would visibly move the
 * geometry. */

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
