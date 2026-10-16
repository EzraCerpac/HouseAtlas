import { LoadingManager, Matrix4, Vector3, type Material, type Mesh, type Object3D, type Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { prepareMeshes, type PreparedMesh } from './geometry';
import { GlbFormatError, preflightGltf, readGlbContainer, STANDARD_GLB_LIMITS, type GlbAdmission, type GlbContainer } from './glb-preflight';

/** Standard glTF 2.0 binary preview loading through three.js GLTFLoader.
 *
 * The closed preflight runs first and admits a bounded amount of work; the
 * loader then parses an owned copy in memory. Its resource resolver refuses
 * every URL, so nothing is fetched or resolved by path, and textures are
 * declined because the preview draws geometry in Lantern tones. The loader
 * never sees extras: they stay opaque facts from the original JSON, so no
 * loader-specific extras key (such as `pivot`) can move geometry. Positions are
 * glTF right-handed Y-up metres; the loader's scene graph applies glTF core
 * node transforms exactly once. Producer provenance (source-to-preview
 * matrices in extras or a manifest) is never multiplied in. Each drawn
 * primitive is copied out as an unbound mesh within the admitted work, and
 * every loader geometry, material and texture is disposed before return. */

export interface DrawnPrimitive { readonly meshKey: string; readonly nodeIndex: number | null; readonly meshIndex: number | null; readonly primitiveIndex: number | null }
export interface StandardGlb extends GlbAdmission {
  readonly drawn: readonly DrawnPrimitive[];
  readonly meshes: readonly PreparedMesh[];
  readonly counts: { readonly triangles: number; readonly vertices: number; readonly metadataOnlyNodes: number; readonly declaredTransforms: number };
}

const refuseUrl = (): string => { throw new GlbFormatError('load', 'The file asks for an external resource'); };
/** GLTFLoader skips a material map whose texture resolves to null. */
const declineTexture = () => Promise.resolve(null) as unknown as Promise<Texture>;

function disposeGltf(gltf: GLTF) {
  const owned = new Set<{ dispose(): void }>();
  for (const scene of gltf.scenes) scene.traverse(object => {
    const { geometry, material } = object as Partial<Mesh>;
    if (geometry) owned.add(geometry);
    for (const item of material === undefined ? [] : ([] as Material[]).concat(material)) {
      owned.add(item);
      for (const value of Object.values(item)) if ((value as Partial<Texture> | null)?.isTexture) owned.add(value as Texture);
    }
  });
  for (const resource of owned) resource.dispose();
  for (const scene of gltf.scenes) scene.clear();
}

/** Loader input: the original BIN chunk and a JSON copy without any extras. */
function loaderInput({ json, bin }: GlbContainer): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json, (key, value: unknown) => key === 'extras' ? undefined : value));
  const pad = (length: number) => (length + 3) & ~3;
  const jsonLength = pad(text.byteLength), binLength = bin === null ? 0 : pad(bin.byteLength);
  const total = 20 + jsonLength + (bin === null ? 0 : 8 + binLength);
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20); out.fill(0x20, 20 + text.byteLength, 20 + jsonLength);
  if (bin !== null) {
    view.setUint32(20 + jsonLength, binLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
    out.set(bin, 28 + jsonLength);
  }
  return out.buffer;
}

/** Loads one GLB after preflight. `keyPrefix` names the layer in mesh keys.
 * `admit` sees the admitted work before the loader copy or any extraction
 * allocation; throwing from it refuses the file with nothing loaded. */
export async function loadStandardGlb(bytes: Uint8Array, keyPrefix: string, signal: AbortSignal,
  admit?: (admission: GlbAdmission) => void): Promise<StandardGlb> {
  if (bytes.byteLength > STANDARD_GLB_LIMITS.bytes) throw new GlbFormatError('container', 'File is larger than the preview limit');
  const container = readGlbContainer(bytes), admission = preflightGltf(container);
  admit?.(admission);
  const input = loaderInput(container);
  signal.throwIfAborted();
  const manager = new LoadingManager();
  manager.setURLModifier(refuseUrl);
  const loader = new GLTFLoader(manager).register(() => ({ name: 'houseatlas_preview_declines_textures', loadTexture: declineTexture }));
  let gltf: GLTF | null = null;
  try {
    try { gltf = await loader.parseAsync(input, ''); }
    catch (error) {
      if (error instanceof GlbFormatError) throw error;
      throw new GlbFormatError('load', 'The standard glTF loader could not read this file');
    }
    signal.throwIfAborted();
    return { ...admission, ...extract(gltf, admission, keyPrefix) };
  } finally {
    if (gltf) disposeGltf(gltf);
  }
}

const IDENTITY = new Matrix4();
function extract(gltf: GLTF, admission: GlbAdmission, keyPrefix: string): Pick<StandardGlb, 'drawn' | 'meshes' | 'counts'> {
  const { associations } = gltf.parser;
  const nodeOf = (object: Object3D): number | null => {
    for (let at: Object3D | null = object; at; at = at.parent) { const node = associations.get(at)?.nodes; if (node !== undefined) return node; }
    return null;
  };
  const { work } = admission;
  gltf.scene.updateMatrixWorld(true);
  const inputs: { meshKey: string; floorId: null; occurrenceId: null; positions: Float32Array; indices: Uint32Array }[] = [];
  const drawn: DrawnPrimitive[] = [];
  let triangles = 0, vertices = 0, failure: GlbFormatError | null = null;
  const point = new Vector3();
  gltf.scene.traverse(object => {
    const mesh = object as Partial<Mesh>;
    if (failure || !mesh.isMesh || !mesh.geometry) return;
    try {
      const position = mesh.geometry.getAttribute('position');
      if (!position || position.itemSize !== 3) throw new GlbFormatError('load', 'A drawn primitive has no positions');
      const source = mesh.geometry.getIndex(), items = position.count, corners = source ? source.count : items;
      // Incremental guard: the loader must not produce more than the preflight admitted.
      if (drawn.length + 1 > work.instances || vertices + items > work.vertices || triangles + corners / 3 > work.triangles)
        throw new GlbFormatError('load', 'The loader produced more geometry than the preflight admitted');
      const positions = new Float32Array(items * 3);
      const world = object.matrixWorld, applies = !world.equals(IDENTITY);
      for (let i = 0; i < items; i++) {
        point.fromBufferAttribute(position, i);
        if (applies) point.applyMatrix4(world);
        positions[i * 3] = point.x; positions[i * 3 + 1] = point.y; positions[i * 3 + 2] = point.z;
      }
      const indices = source ? Uint32Array.from({ length: source.count }, (_, i) => source.getX(i)) : Uint32Array.from({ length: items }, (_, i) => i);
      if (indices.length % 3 !== 0) throw new GlbFormatError('load', 'Triangle indices must come in threes');
      if (applies && world.determinant() < 0)
        for (let t = 0; t < indices.length; t += 3) { const swap = indices[t + 1]!; indices[t + 1] = indices[t + 2]!; indices[t + 2] = swap; }
      for (const vertex of indices) {
        if (vertex >= items) throw new GlbFormatError('load', 'Index out of range');
        for (let axis = 0; axis < 3; axis++) { const value = positions[vertex * 3 + axis]!;
          if (!Number.isFinite(value) || Math.abs(value) > STANDARD_GLB_LIMITS.coordinate) throw new GlbFormatError('load', 'Position outside the preview range'); }
      }
      triangles += indices.length / 3; vertices += items;
      const reference = associations.get(object), nodeIndex = nodeOf(object);
      const meshKey = `${keyPrefix}#${drawn.length}`;
      inputs.push({ meshKey, floorId: null, occurrenceId: null, positions, indices });
      drawn.push({ meshKey, nodeIndex, meshIndex: reference?.meshes ?? null, primitiveIndex: reference?.primitives ?? null });
    } catch (error) { failure = error instanceof GlbFormatError ? error : new GlbFormatError('load', 'A drawn primitive could not be read'); }
  });
  if (failure) throw failure;
  if (drawn.length !== work.instances || vertices !== work.vertices || triangles !== work.triangles)
    throw new GlbFormatError('load', 'The loader produced different geometry than the preflight admitted');
  return { drawn,
    // Every drawn primitive is unbound: no occurrence, room or floor is inferred.
    meshes: prepareMeshes(inputs, () => null),
    counts: { triangles, vertices, metadataOnlyNodes: admission.nodes.filter(node => node.meshIndex === null).length,
      declaredTransforms: admission.nodes.filter(node => node.localTransform === 'declared').length } };
}
