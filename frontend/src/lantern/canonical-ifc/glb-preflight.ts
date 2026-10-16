/** Closed admission for standard glTF 2.0 binaries (GLB), run before any
 * loader sees the bytes. It reads only the JSON chunk and admits a closed
 * subset: one embedded BIN chunk, no buffer or image URIs, no `extensions`
 * objects anywhere outside extras, no skins, morph targets or animations,
 * exactly one scene where every node is reached once, triangle primitives
 * whose accessors all read declared bufferView ranges, and a geometry budget
 * counted per drawn node instance (reused meshes count every time). Nothing is
 * fetched or resolved by path. Node names are labels and extras are kept as
 * opaque producer data; no room, floor or native binding is inferred. */

export const STANDARD_GLB_LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024, jsonBytes: 8 * 1024 * 1024, nodes: 20_000,
  primitives: 20_000, triangles: 600_000, vertices: 1_800_000, depth: 64, coordinate: 1e7,
  /** Copied positions, indices and prepared triangles across every instance. */
  outputBytes: 96 * 1024 * 1024 });
/** Extensions accepted anywhere. Geometry-changing extensions (compression,
 * quantization, instancing) and material extensions are deliberately absent. */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set();

export type GlbStage = 'container' | 'preflight' | 'load';
export class GlbFormatError extends Error {
  constructor(readonly stage: GlbStage, reason: string) { super(reason); }
}
function need(ok: unknown, stage: GlbStage, reason: string): asserts ok { if (!ok) throw new GlbFormatError(stage, reason); }

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
const rows = (value: unknown, what: string): readonly Row[] => {
  if (value === undefined) return [];
  need(Array.isArray(value) && value.every(isRow), 'preflight', `${what} must be a list of objects`); return value;
};
const index = (value: unknown, length: number, what: string) => {
  need(Number.isInteger(value) && (value as number) >= 0 && (value as number) < length, 'preflight', `${what} index out of range`); return value as number;
};
const count = (value: unknown, what: string, min = 0) => {
  need(Number.isInteger(value) && (value as number) >= min && (value as number) <= 0x7fffffff, 'preflight', `${what} must be an integer`); return value as number;
};
const label = (value: unknown) => typeof value === 'string' && value.length > 0 ? value.slice(0, 512) : null;

export interface GlbContainer { readonly json: Row; readonly bin: Uint8Array | null }

export const hasGlbSignature = (bytes: Uint8Array) => bytes.byteLength >= 4
  && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === 0x46546c67;

/** GLB 2.0 container: header, one JSON chunk, at most one BIN chunk, nothing else. */
export function readGlbContainer(bytes: Uint8Array): GlbContainer {
  need(bytes.byteLength >= 20, 'container', 'Too short for a GLB header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  need(view.getUint32(0, true) === 0x46546c67, 'container', 'Missing glTF binary signature');
  need(view.getUint32(4, true) === 2, 'container', 'Only GLB version 2 is supported');
  need(view.getUint32(8, true) === bytes.byteLength, 'container', 'Declared GLB length differs from the file length');
  const jsonLength = view.getUint32(12, true), jsonEnd = 20 + jsonLength;
  need(view.getUint32(16, true) === 0x4e4f534a && jsonLength > 0 && jsonEnd <= bytes.byteLength, 'container', 'First chunk must be JSON');
  need(jsonLength <= STANDARD_GLB_LIMITS.jsonBytes, 'container', 'JSON chunk is too large');
  let json: unknown;
  try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, jsonEnd))); }
  catch { throw new GlbFormatError('container', 'JSON chunk is not valid UTF-8 JSON'); }
  need(isRow(json), 'container', 'JSON chunk must be an object');
  let bin: Uint8Array | null = null;
  if (jsonEnd < bytes.byteLength) {
    need(jsonEnd + 8 <= bytes.byteLength, 'container', 'Truncated chunk header');
    const binLength = view.getUint32(jsonEnd, true), binStart = jsonEnd + 8;
    need(view.getUint32(jsonEnd + 4, true) === 0x004e4942, 'container', 'Second chunk must be BIN');
    need(binStart + binLength === bytes.byteLength, 'container', 'Only one BIN chunk is supported');
    bin = bytes.subarray(binStart, binStart + binLength);
  }
  return { json, bin };
}

/** The older closed HouseAtlas IFC-derived profile declares itself here. */
export const isClosedIfcProfile = (container: GlbContainer) => {
  const asset = container.json.asset;
  return isRow(asset) && isRow(asset.extras) && Object.hasOwn(asset.extras, 'houseatlasIfcDerivative');
};

/** Retained node facts. Names are labels and extras are opaque producer data. */
export interface GlbNodeFacts {
  readonly nodeIndex: number;
  readonly name: string | null;
  readonly parent: number | null;
  readonly meshIndex: number | null;
  /** Whether glTF declares a non-identity local transform. The loader applies
   * it once, as glTF defines the scene; producer provenance is never applied. */
  readonly localTransform: 'identity' | 'declared';
  readonly extras: unknown;
}
export interface GlbAdmission {
  readonly generator: string | null;
  /** asset.copyright, kept as the file's own attribution. */
  readonly copyright: string | null;
  readonly assetExtras: unknown;
  /** Nodes reachable from the default scene, in traversal order. */
  readonly nodes: readonly GlbNodeFacts[];
  /** Totals declared in the file (reachable or not). */
  readonly declaredNodes: number;
  readonly declaredMeshes: number;
  /** Loader-visible work admitted before loading, expanded per node instance. */
  readonly work: { readonly instances: number; readonly vertices: number; readonly triangles: number; readonly outputBytes: number };
}

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const sameNumbers = (value: unknown, expected: readonly number[]) => Array.isArray(value) && value.length === expected.length
  && value.every((item, i) => item === expected[i]);
function localTransform(node: Row, at: number): GlbNodeFacts['localTransform'] {
  const trs = node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined;
  need(node.matrix === undefined || !trs, 'preflight', `Node ${at} declares both a matrix and TRS`);
  if (node.matrix !== undefined) return sameNumbers(node.matrix, IDENTITY_MATRIX) ? 'identity' : 'declared';
  return (node.translation === undefined || sameNumbers(node.translation, [0, 0, 0]))
    && (node.rotation === undefined || sameNumbers(node.rotation, [0, 0, 0, 1]))
    && (node.scale === undefined || sameNumbers(node.scale, [1, 1, 1])) ? 'identity' : 'declared';
}

const COMPONENT_BYTES: Readonly<Record<number, number>> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENTS: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const INDEX_TYPES = new Set([5121, 5123, 5125]);

/** Refuses any `extensions` object outside extras, wherever a plugin might read it. */
function refuseExtensions(json: Row) {
  const pending: unknown[] = [json];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) { pending.push(...value); continue; }
    if (!isRow(value)) continue;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'extras') continue;
      if (key === 'extensions')
        need(isRow(item) && Object.keys(item).every(name => ALLOWED_EXTENSIONS.has(name)), 'preflight', 'An unsupported glTF extension is used');
      pending.push(item);
    }
  }
}

interface AccessorShape { readonly count: number; readonly components: number; readonly componentType: number; readonly normalized: boolean }
/** Every accessor reads a declared bufferView range; the loader never zero-fills one. */
function admitAccessors(json: Row, bufferLength: number): readonly AccessorShape[] {
  const views = rows(json.bufferViews, 'Buffer views');
  let viewBytes = 0;
  const viewLengths = views.map((view, at) => {
    index(view.buffer, bufferLength > 0 ? 1 : 0, `Buffer view ${at} buffer`);
    const offset = view.byteOffset === undefined ? 0 : count(view.byteOffset, 'Buffer view offset');
    const length = count(view.byteLength, 'Buffer view length', 1);
    need(offset + length <= bufferLength, 'preflight', `Buffer view ${at} is outside the buffer`);
    need(view.byteStride === undefined || Number.isInteger(view.byteStride) && (view.byteStride as number) >= 4
      && (view.byteStride as number) <= 252 && (view.byteStride as number) % 4 === 0, 'preflight', `Buffer view ${at} has an invalid stride`);
    viewBytes += length;
    return length;
  });
  // The loader copies each referenced view once.
  need(viewBytes <= STANDARD_GLB_LIMITS.bytes, 'preflight', 'Buffer views exceed the preview limit');
  return rows(json.accessors, 'Accessors').map((accessor, at) => {
    need(accessor.sparse === undefined, 'preflight', 'Sparse accessors are not supported');
    need(accessor.normalized === undefined || typeof accessor.normalized === 'boolean', 'preflight', `Accessor ${at} normalized must be true or false`);
    const view = index(accessor.bufferView, views.length, `Accessor ${at} buffer view`);
    const components = COMPONENTS[accessor.type as string], size = COMPONENT_BYTES[accessor.componentType as number];
    need(components !== undefined && size !== undefined, 'preflight', `Accessor ${at} type is not supported`);
    const items = count(accessor.count, 'Accessor count', 1);
    const offset = accessor.byteOffset === undefined ? 0 : count(accessor.byteOffset, 'Accessor offset');
    need(offset % size === 0, 'preflight', `Accessor ${at} is misaligned`);
    const element = components * size, stride = views[view]!.byteStride as number | undefined;
    // Interleaved reads span whole strides from the slice that holds the offset.
    const end = stride !== undefined && stride !== element ? (Math.floor(offset / stride) + items) * stride : offset + items * element;
    need(stride === undefined || stride >= element, 'preflight', `Accessor ${at} is wider than its stride`);
    need(end <= viewLengths[view]!, 'preflight', `Accessor ${at} reads past its buffer view`);
    return { count: items, components, componentType: accessor.componentType as number, normalized: accessor.normalized === true };
  });
}

interface PrimitiveWork { readonly vertices: number; readonly indices: number }
function admitMeshes(json: Row, accessors: readonly AccessorShape[]): readonly (readonly PrimitiveWork[])[] {
  const meshes = rows(json.meshes, 'Meshes');
  let primitives = 0;
  return meshes.map(mesh => rows(mesh.primitives, 'Primitives').map(primitive => {
    need(++primitives <= STANDARD_GLB_LIMITS.primitives, 'preflight', 'Too many primitives');
    need(primitive.mode === undefined || primitive.mode === 4, 'preflight', 'Only triangle primitives are supported');
    need(primitive.targets === undefined, 'preflight', 'Morph targets are not supported');
    need(isRow(primitive.attributes) && primitive.attributes.POSITION !== undefined, 'preflight', 'A primitive has no positions');
    const position = accessors[index(primitive.attributes.POSITION, accessors.length, 'Position accessor')]!;
    need(position.components === 3 && position.componentType === 5126 && !position.normalized,
      'preflight', 'Positions must be float VEC3');
    for (const attribute of Object.values(primitive.attributes))
      need(accessors[index(attribute, accessors.length, 'Attribute accessor')]!.count === position.count,
        'preflight', 'Primitive attributes disagree on vertex count');
    let indices = position.count;
    if (primitive.indices !== undefined) {
      const source = accessors[index(primitive.indices, accessors.length, 'Index accessor')]!;
      // A normalized index would be read as a fraction and truncate to another vertex.
      need(source.components === 1 && INDEX_TYPES.has(source.componentType) && !source.normalized, 'preflight', 'Indices must be unnormalized unsigned scalars');
      indices = source.count;
    }
    need(indices % 3 === 0, 'preflight', 'Triangle indices must come in threes');
    return { vertices: position.count, indices };
  }));
}

/** Closed preflight on the container JSON; returns retained scene facts. */
export function preflightGltf({ json, bin }: GlbContainer): GlbAdmission {
  const asset = json.asset;
  need(isRow(asset) && asset.version === '2.0', 'preflight', 'Only glTF 2.0 is supported');
  need(asset.minVersion === undefined || asset.minVersion === '2.0', 'preflight', 'Unsupported glTF minimum version');
  const required = json.extensionsRequired, used = json.extensionsUsed;
  need(required === undefined || Array.isArray(required) && required.length === 0, 'preflight', 'Required extensions are not supported');
  need(used === undefined || Array.isArray(used) && used.every(name => typeof name === 'string'), 'preflight', 'Invalid extension list');
  const unknown = ((used ?? []) as string[]).filter(name => !ALLOWED_EXTENSIONS.has(name));
  need(unknown.length === 0, 'preflight', 'An unsupported glTF extension is used');
  refuseExtensions(json);
  const buffers = rows(json.buffers, 'Buffers');
  need(buffers.length <= 1, 'preflight', 'Only the embedded GLB buffer is supported');
  let bufferLength = 0;
  for (const buffer of buffers) {
    need(buffer.uri === undefined, 'preflight', 'External or data URI buffers are not supported');
    bufferLength = count(buffer.byteLength, 'Buffer length', 1);
    need(bin !== null && bufferLength <= bin.byteLength, 'preflight', 'Buffer is larger than the BIN chunk');
  }
  for (const image of rows(json.images, 'Images')) need(image.uri === undefined, 'preflight', 'Image URIs are not supported');
  need(rows(json.skins, 'Skins').length === 0, 'preflight', 'Skins are not supported');
  need(rows(json.animations, 'Animations').length === 0, 'preflight', 'Animations are not supported');
  // The loader builds every declared camera.
  need(rows(json.cameras, 'Cameras').length <= STANDARD_GLB_LIMITS.nodes, 'preflight', 'Too many cameras');
  const meshWork = admitMeshes(json, admitAccessors(json, bufferLength));

  const nodes = rows(json.nodes, 'Nodes'), scenes = rows(json.scenes, 'Scenes');
  need(nodes.length <= STANDARD_GLB_LIMITS.nodes, 'preflight', 'Too many nodes');
  for (const node of nodes) {
    need(node.skin === undefined && node.weights === undefined, 'preflight', 'Skinned or morphed nodes are not supported');
    if (isRow(node.extras)) {
      // Poses are baked into positions; a request to apply one again cannot be honoured.
      need(node.extras.applyTransformAgain !== true, 'preflight', 'A node asks for its pose to be applied again');
      need(node.extras.posesAlreadyApplied !== false, 'preflight', 'A node declares its pose is not applied');
    }
  }
  // The loader builds every scene, so exactly one is admitted.
  need(scenes.length === 1, 'preflight', 'Exactly one scene is supported');
  need(json.scene === undefined || json.scene === 0, 'preflight', 'Scene index out of range');
  const facts: GlbNodeFacts[] = [], visited = new Set<number>();
  let instances = 0, vertices = 0, indices = 0;
  const visit = (at: number, parent: number | null, depth: number) => {
    need(depth <= STANDARD_GLB_LIMITS.depth, 'preflight', 'Node hierarchy is too deep');
    need(!visited.has(at), 'preflight', 'A node is reached twice');
    visited.add(at);
    const node = nodes[at]!;
    const meshIndex = node.mesh === undefined ? null : index(node.mesh, meshWork.length, `Node ${at} mesh`);
    // Each node using a mesh is a separate drawn instance, whether or not the mesh is shared.
    for (const primitive of meshIndex === null ? [] : meshWork[meshIndex]!) {
      instances++; vertices += primitive.vertices; indices += primitive.indices;
    }
    need(instances <= STANDARD_GLB_LIMITS.primitives && vertices <= STANDARD_GLB_LIMITS.vertices
      && indices <= STANDARD_GLB_LIMITS.triangles * 3, 'preflight', 'Too much geometry for the preview');
    facts.push({ nodeIndex: at, name: label(node.name), parent, meshIndex,
      localTransform: localTransform(node, at), extras: node.extras ?? null });
    const children = node.children ?? [];
    need(Array.isArray(children), 'preflight', 'Node children must be a list');
    for (const child of children) visit(index(child, nodes.length, 'Child node'), at, depth + 1);
  };
  const roots = scenes[0]!.nodes ?? [];
  need(Array.isArray(roots), 'preflight', 'Scene nodes must be a list');
  for (const root of roots) visit(index(root, nodes.length, 'Scene node'), null, 0);
  const triangles = indices / 3, outputBytes = vertices * 12 + indices * 4 + triangles * 72;
  need(outputBytes <= STANDARD_GLB_LIMITS.outputBytes, 'preflight', 'Too much geometry for the preview');
  return { generator: label(asset.generator), copyright: label(asset.copyright), assetExtras: asset.extras ?? null,
    nodes: facts, declaredNodes: nodes.length, declaredMeshes: meshWork.length,
    work: { instances, vertices, triangles, outputBytes } };
}
