import { LoadingManager, Matrix3, Matrix4, Vector3, type Material, type Mesh, type Object3D, type Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { prepareMeshes, primitiveBaseColor, primitiveGlow, primitiveNight, primitiveRoughness, type MeshInput, type PreparedMesh } from './geometry';
import { GlbFormatError, preflightGltf, readGlbContainer, STANDARD_GLB_LIMITS, type GlbAdmission, type GlbContainer, type GlbLimits } from './glb-preflight';
import type { EmbeddedMaterial } from './embedded-png-material';

/** Standard glTF 2.0 binary preview loading through three.js GLTFLoader.
 *
 * The closed preflight runs first and admits a bounded amount of work; the
 * loader then parses an owned copy in memory. Its resource resolver refuses
 * every URL, so nothing is fetched or resolved by path, and textures are
 * declined; explicit core base colours are retained as presentation metadata.
 * Viewers may opt in to those colours without acquiring textures or PBR. The loader
 * never sees extras: they stay opaque facts from the original JSON, so no
 * loader-specific extras key (such as `pivot`) can move geometry. Positions are
 * glTF right-handed Y-up metres; the loader's scene graph applies glTF core
 * node transforms exactly once. Producer provenance (source-to-preview
 * matrices in extras or a manifest) is never multiplied in. Each drawn
 * primitive is copied out as an unbound mesh within the admitted work, and
 * every loader geometry, material and texture is disposed before return. The
 * explicit Unified opt-in separately returns owned decoded PNG samples and
 * source shading attributes; its renderer owns their GPU allocations. */

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
function loaderInput({ json, bin }: GlbContainer): { readonly bytes: ArrayBuffer; readonly bin: Uint8Array<ArrayBuffer> | null } {
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
  return { bytes: out.buffer, bin: bin === null ? null : out.subarray(28 + jsonLength, 28 + jsonLength + bin.byteLength) };
}

export type StandardGlbOptions = Readonly<{ embeddedPngMaterials?: true; limits?: GlbLimits }>;

/** Loads one GLB after preflight. `keyPrefix` names the layer in mesh keys.
 * `admit` sees the admitted work before the loader copy or any extraction
 * allocation; throwing (or rejecting) from it refuses the file with nothing loaded.
 * `limits` selects a tier; only a publication's detail GLB uses the Full one,
 * and it loads through standard-glb-thread so the page keeps drawing. */
export async function loadStandardGlb(bytes: Uint8Array, keyPrefix: string, signal: AbortSignal,
  admit?: (admission: GlbAdmission) => void | Promise<void>, options?: StandardGlbOptions): Promise<StandardGlb> {
  const limits = options?.limits ?? STANDARD_GLB_LIMITS;
  if (bytes.byteLength > limits.bytes) throw new GlbFormatError('container', 'File is larger than the preview limit');
  // The geometry loader still declines every texture. Only this explicit
  // opt-in admits and decodes PNG bytes through a separate, URL-free path.
  const materialReader = options?.embeddedPngMaterials ? await import('./embedded-png-material') : null;
  signal.throwIfAborted();
  const container = readGlbContainer(bytes, limits), plainAdmission = preflightGltf(container, limits);
  let plan = materialReader?.admitEmbeddedPngMaterials(container, plainAdmission, limits);
  const admission: GlbAdmission = plan ? { ...plainAdmission, work: { ...plainAdmission.work,
    outputBytes: plan.preparedBytes, gpuBytes: plan.gpuBytes } } : plainAdmission;
  await admit?.(admission);
  signal.throwIfAborted();
  // Reserve all work first, then reuse the loader's existing owned BIN copy.
  // Rebase every admitted PNG byte view; decoding never reads caller storage.
  const input = loaderInput(container);
  if (plan && input.bin && container.bin) {
    const bin = input.bin, start = container.bin.byteOffset;
    const own = (view: Uint8Array) => bin.subarray(view.byteOffset - start, view.byteOffset - start + view.byteLength);
    plan = { ...plan, images: plan.images.map(image => ({ ...image, encoded: own(image.encoded) })) };
  }
  const materials = plan && materialReader ? await materialReader.decodeEmbeddedMaterials(plan, signal) : undefined;
  signal.throwIfAborted();
  const manager = new LoadingManager();
  manager.setURLModifier(refuseUrl);
  const loader = new GLTFLoader(manager).register(() => ({ name: 'houseatlas_preview_declines_textures', loadTexture: declineTexture }));
  let gltf: GLTF | null = null;
  try {
    try { gltf = await loader.parseAsync(input.bytes, ''); }
    catch (error) {
      if (error instanceof GlbFormatError) throw error;
      throw new GlbFormatError('load', 'The standard glTF loader could not read this file');
    }
    signal.throwIfAborted();
    return { ...admission, ...extract(gltf, admission, keyPrefix, container.json, limits.coordinate, materials, plan) };
  } finally {
    if (gltf) disposeGltf(gltf);
  }
}

const IDENTITY = new Matrix4();
function extract(gltf: GLTF, admission: GlbAdmission, keyPrefix: string, json: GlbContainer['json'], coordinate: number,
  materials?: ReadonlyMap<string, EmbeddedMaterial>, expectedMaterialWork?: Readonly<{ attributeBytes: number; expandedAttributeBytes: number }>): Pick<StandardGlb, 'drawn' | 'meshes' | 'counts'> {
  const { associations } = gltf.parser;
  const nodeOf = (object: Object3D): number | null => {
    for (let at: Object3D | null = object; at; at = at.parent) { const node = associations.get(at)?.nodes; if (node !== undefined) return node; }
    return null;
  };
  const { work } = admission;
  gltf.scene.updateMatrixWorld(true);
  const inputs: MeshInput[] = [];
  const drawn: DrawnPrimitive[] = [];
  let triangles = 0, vertices = 0, failure: GlbFormatError | null = null;
  let attributeBytes = 0, expandedAttributeBytes = 0;
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
          if (!Number.isFinite(value) || Math.abs(value) > coordinate) throw new GlbFormatError('load', 'Position outside the preview range'); }
      }
      triangles += indices.length / 3; vertices += items;
      const reference = associations.get(object), nodeIndex = nodeOf(object);
      const meshKey = `${keyPrefix}#${drawn.length}`;
      const sourceMaterial = materials?.get(`${reference?.meshes}/${reference?.primitives}`);
      const sourceBaseColor = sourceMaterial?.baseColor ?? primitiveBaseColor(json, reference?.meshes ?? null, reference?.primitives ?? null);
      let sourceAttributes: MeshInput['sourceAttributes'];
      if (sourceMaterial) {
        const uv = mesh.geometry.getAttribute('uv'), normal = mesh.geometry.getAttribute('normal'), tangent = mesh.geometry.getAttribute('tangent');
        if (!uv || !normal || uv.itemSize !== 2 || normal.itemSize !== 3 || uv.count !== items || normal.count !== items
          || sourceMaterial.normalTexture && (!tangent || tangent.itemSize !== 4 || tangent.count !== items)
          || !Number.isFinite(world.determinant()) || world.determinant() === 0) throw new GlbFormatError('load', 'Required source shading attributes unavailable');
        const uvs = new Float32Array(items * 2), normals = new Float32Array(items * 3), tangents = sourceMaterial.normalTexture ? new Float32Array(items * 4) : null;
        const normalMatrix = new Matrix3().getNormalMatrix(world), linear = new Matrix3().setFromMatrix4(world), n = new Vector3(), t = new Vector3();
        for (let i = 0; i < items; i++) {
          uvs[i * 2] = uv.getX(i); uvs[i * 2 + 1] = uv.getY(i);
          n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix);
          if (!(n.lengthSq() > 0) || !Number.isFinite(n.lengthSq())) throw new GlbFormatError('load', 'Required source normal has no direction');
          n.normalize(); normals[i * 3] = n.x; normals[i * 3 + 1] = n.y; normals[i * 3 + 2] = n.z;
          if (tangents && tangent) {
            t.set(tangent.getX(i), tangent.getY(i), tangent.getZ(i)).applyMatrix3(linear);
            t.addScaledVector(n, -t.dot(n));
            if (!(t.lengthSq() > 0) || !Number.isFinite(t.lengthSq())) throw new GlbFormatError('load', 'Required source tangent has no direction');
            t.normalize(); tangents[i * 4] = t.x; tangents[i * 4 + 1] = t.y; tangents[i * 4 + 2] = t.z;
            tangents[i * 4 + 3] = tangent.getW(i) * (world.determinant() < 0 ? -1 : 1);
          }
        }
        sourceAttributes = { uv: uvs, normal: normals, tangent: tangents };
        attributeBytes += uvs.byteLength + normals.byteLength + (tangents?.byteLength ?? 0); expandedAttributeBytes += indices.length * 36;
      }
      const sourceNight = primitiveNight(json, reference?.meshes ?? null, reference?.primitives ?? null);
      // Only a stated factor frosts glass; an admitted material's roughness already holds the default 1.
      const sourceRoughness = sourceNight === 'glazing' ? primitiveRoughness(json, reference?.meshes ?? null, reference?.primitives ?? null) : undefined;
      const sourceGlow = sourceNight === 'emitter' ? primitiveGlow(json, reference?.meshes ?? null, reference?.primitives ?? null) : undefined;
      inputs.push({ meshKey, floorId: null, occurrenceId: null, positions, indices, ...(sourceBaseColor ? { sourceBaseColor } : {}),
        ...(sourceNight ? { sourceNight } : {}), ...(sourceGlow ? { sourceGlow } : {}), ...(sourceRoughness !== undefined ? { sourceRoughness } : {}),
        ...(sourceMaterial && sourceAttributes ? { sourceMaterial, sourceAttributes } : {}) });
      drawn.push({ meshKey, nodeIndex, meshIndex: reference?.meshes ?? null, primitiveIndex: reference?.primitives ?? null });
    } catch (error) { failure = error instanceof GlbFormatError ? error : new GlbFormatError('load', 'A drawn primitive could not be read'); }
  });
  if (failure) throw failure;
  if (drawn.length !== work.instances || vertices !== work.vertices || triangles !== work.triangles)
    throw new GlbFormatError('load', 'The loader produced different geometry than the preflight admitted');
  if (expectedMaterialWork && (attributeBytes !== expectedMaterialWork.attributeBytes || expandedAttributeBytes !== expectedMaterialWork.expandedAttributeBytes))
    throw new GlbFormatError('load', 'The loader did not preserve every required textured primitive');
  return { drawn,
    // Every drawn primitive is unbound: no occurrence, room or floor is inferred.
    meshes: prepareMeshes(inputs, () => null),
    counts: { triangles, vertices, metadataOnlyNodes: admission.nodes.filter(node => node.meshIndex === null).length,
      declaredTransforms: admission.nodes.filter(node => node.localTransform === 'declared').length } };
}
