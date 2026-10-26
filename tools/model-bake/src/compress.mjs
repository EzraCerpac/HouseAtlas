/** Transfer compression for a baked GLB: `EXT_meshopt_compression`, decoded
 * by the viewer and the server back to the plain profile before any check.
 *
 * Two steps make the streams compress well without changing what is drawn:
 * each primitive's triangles and vertices are reordered for the GPU's vertex
 * cache and fetch (the same triangles, in another order), and positions are
 * snapped to a grid of `grid` metres (2^-12 m, a quarter millimetre, by
 * default) so their low mantissa bits are zero. They stay Float32, so the
 * decoded file has the same accessor layouts as an uncompressed bake and no
 * quantization extension is needed. Room-pick and slab primitives are neither
 * reordered nor snapped: the server compares them with plan footprints. A
 * snapped vertex that would leave a bound the server checks (its building,
 * declared levels or occurrence) keeps its exact position instead.
 *
 * Every vertex attribute view is encoded in ATTRIBUTES mode and every index
 * view in TRIANGLES mode, without filters; images and room-pick and slab
 * views stay as they are. Each stream is decoded again before the file is
 * returned: vertex streams must match byte for byte, index streams triangle
 * for triangle (the index codec may rotate a triangle's corners, keeping its
 * winding). */
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { COMPONENT_BYTES, COMPONENTS, maxScale, meshInstances, readAccessor, readGlb, writeGlb } from './glb.mjs';

export const MESHOPT = 'EXT_meshopt_compression';
export const COMPRESS_DEFAULTS = Object.freeze({ grid: 2 ** -12 });

const pad = length => (length + 3) & ~3;
const key = (mesh, primitive) => `${mesh}/${primitive}`;
const largestPowerOfTwoAtMost = value => 2 ** Math.floor(Math.log2(value));
const transform = (m, x, y, z) => [0, 1, 2].map(r => Math.fround(m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]));
const inside = (bounds, p) => p.every((value, axis) => value >= bounds.min[axis] && value <= bounds.max[axis]);

/** Per primitive slot, the bounds the server checks every world vertex against,
 * with the node world each applies under. */
function slotBounds(companion, worlds) {
  const slots = new Map();
  if (!companion) return slots;
  const byId = (rows, id) => new Map((rows ?? []).map(row => [row[id], row.bounds]));
  const buildings = byId(companion.buildings, 'buildingId'), levels = byId(companion.levels, 'levelId'), occurrences = byId(companion.occurrences, 'spaceOccurrenceId');
  for (const binding of companion.meshBindings ?? []) {
    const tests = [buildings.get(binding.buildingId)];
    // Shared geometry is checked against the union of its declared levels.
    const each = binding.levelIds.map(id => levels.get(id)).filter(Boolean);
    if (each.length > 0)
      tests.push({ min: [0, 1, 2].map(a => Math.min(...each.map(b => b.min[a]))), max: [0, 1, 2].map(a => Math.max(...each.map(b => b.max[a]))) });
    if (binding.spaceOccurrenceId) tests.push(occurrences.get(binding.spaceOccurrenceId));
    tests.splice(0, tests.length, ...tests.filter(Boolean));
    for (const primitive of binding.primitiveIndices) {
      const slot = key(binding.meshIndex, primitive);
      if (!slots.has(slot)) slots.set(slot, []);
      slots.get(slot).push({ world: worlds.get(binding.nodeIndex), tests });
    }
  }
  return slots;
}

const sameTriangles = (a, b) => {
  for (let t = 0; t < a.length; t += 3) {
    const [x, y, z] = [a[t], a[t + 1], a[t + 2]], [p, q, r] = [b[t], b[t + 1], b[t + 2]];
    if (!(x === p && y === q && z === r || x === q && y === r && z === p || x === r && y === p && z === q)) return false;
  }
  return a.length === b.length;
};

/** Accessors read by exactly one primitive slot (and nothing else), so reordering or snapping them changes nothing else. */
function soleUses(json) {
  const uses = new Map(), use = (at, slot) => uses.set(at, uses.has(at) && uses.get(at) !== slot ? null : slot);
  json.meshes.forEach((mesh, m) => mesh.primitives.forEach((p, i) => {
    for (const at of Object.values(p.attributes)) use(at, key(m, i));
    if (p.indices !== undefined) use(p.indices, key(m, i));
  }));
  return uses;
}

/**
 * @param {Uint8Array} plainBytes a baked GLB in the plain profile
 * @param {{ companion?: object|null, locked?: ReadonlySet<string>, grid?: number }} options
 *   `locked` holds `mesh/primitive` slots kept byte for byte (room picks, slabs).
 */
export async function compressGlb(plainBytes, { companion = null, locked = new Set(), grid = COMPRESS_DEFAULTS.grid } = {}) {
  if (!(grid > 0) || !Number.isFinite(grid)) throw new Error('The snapping grid must be a positive number of metres');
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const { json: source, bin } = readGlb(plainBytes);
  if ((source.buffers ?? []).length !== 1 || source.extensionsUsed?.length) throw new Error('Only a plain single-buffer GLB can be compressed');
  const json = structuredClone(source), instances = meshInstances(json);
  const worlds = new Map([...instances.values()].flat().map(({ nodeIndex, world }) => [nodeIndex, world]));
  const bounded = slotBounds(companion, worlds), sole = soleUses(json);
  // Rewritten accessor values; everything else is read from the plain bytes.
  const values = new Map();
  const read = at => values.get(at) ?? readAccessor(source, bin, at);
  let reordered = 0, snapped = 0, kept = 0, displacement = 0;

  json.meshes.forEach((mesh, meshIndex) => mesh.primitives.forEach((primitive, primitiveIndex) => {
    const slot = key(meshIndex, primitiveIndex), accessors = [...Object.values(primitive.attributes), primitive.indices];
    if (locked.has(slot) || primitive.indices === undefined || !accessors.every(at => sole.get(at) === slot)) return;
    // Same triangles in vertex-cache order, vertices in first-use order; unreferenced vertices drop.
    const indices = Uint32Array.from(read(primitive.indices)), [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, false);
    for (const [name, at] of Object.entries(primitive.attributes)) {
      const accessor = json.accessors[at], width = COMPONENTS[accessor.type], from = read(at), to = new from.constructor(unique * width);
      for (let v = 0; v < remap.length; v++) if (remap[v] !== 0xffffffff) to.set(from.subarray(v * width, v * width + width), remap[v] * width);
      values.set(at, to); accessor.count = unique;
      if (name !== 'POSITION') continue;
      const uses = instances.get(meshIndex), scale = Math.max(...uses.map(use => maxScale(use.world)), 1e-9);
      // A power of two in local units keeps every snapped value exact in Float32.
      const step = largestPowerOfTwoAtMost(grid / scale), checks = bounded.get(slot) ?? [];
      for (let v = 0; v < unique; v++) {
        const [x, y, z] = to.subarray(v * 3, v * 3 + 3), s = [x, y, z].map(c => Math.fround(Math.round(c / step) * step));
        if (checks.some(({ world, tests }) => !tests.every(bounds => inside(bounds, transform(world, ...s))))) { kept++; continue; }
        to.set(s, v * 3);
        displacement = Math.max(displacement, Math.hypot(s[0] - x, s[1] - y, s[2] - z) * scale);
      }
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < to.length; i++) { min[i % 3] = Math.min(min[i % 3], to[i]); max[i % 3] = Math.max(max[i % 3], to[i]); }
      Object.assign(accessor, { min, max });
      snapped++;
    }
    values.set(primitive.indices, json.accessors[primitive.indices].componentType === 5123 ? Uint16Array.from(indices) : indices);
    reordered++;
  }));

  // One stream per view: the accessor it holds, or the image bytes.
  const viewAccessor = new Map();
  json.accessors.forEach((accessor, at) => viewAccessor.set(accessor.bufferView, viewAccessor.has(accessor.bufferView) ? null : at));
  const indexAccessors = new Set(json.meshes.flatMap(mesh => mesh.primitives.map(p => p.indices)).filter(at => at !== undefined));
  // Locked primitives stay byte for byte, so their views are not encoded at all.
  const lockedAccessors = new Set(json.meshes.flatMap((mesh, m) => mesh.primitives.flatMap((p, i) => locked.has(key(m, i))
    ? [...Object.values(p.attributes), ...(p.indices === undefined ? [] : [p.indices])] : [])));
  const out = [];
  let binLength = 0, fallbackLength = 0, compressedViews = 0;
  const place = bytes => { const offset = binLength; out.push(bytes); binLength += pad(bytes.byteLength); return offset; };
  json.bufferViews = source.bufferViews.map((view, at) => {
    const accessorIndex = viewAccessor.get(at), accessor = accessorIndex == null ? null : json.accessors[accessorIndex];
    const start = view.byteOffset ?? 0, original = bin.subarray(start, start + view.byteLength);
    if (!accessor || accessor.byteOffset || lockedAccessors.has(accessorIndex)) return { ...view, buffer: 0, byteOffset: place(original) };
    // Only tightly packed views are encoded; reordering only touches those.
    if (view.byteStride !== undefined && view.byteStride !== COMPONENTS[accessor.type] * COMPONENT_BYTES[accessor.componentType])
      return { ...view, buffer: 0, byteOffset: place(original) };
    const array = read(accessorIndex), bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const element = COMPONENTS[accessor.type] * COMPONENT_BYTES[accessor.componentType], isIndex = indexAccessors.has(accessorIndex);
    const mode = isIndex && element !== 1 && accessor.count % 3 === 0 ? 'TRIANGLES' : !isIndex && element % 4 === 0 ? 'ATTRIBUTES' : null;
    if (!mode) return { ...view, buffer: 0, byteOffset: place(original) };
    const encoded = MeshoptEncoder.encodeGltfBuffer(bytes, accessor.count, element, mode, 0);
    const check = new Uint8Array(bytes.byteLength);
    MeshoptDecoder.decodeGltfBuffer(check, accessor.count, element, encoded, mode);
    // The index codec may rotate a triangle's corners (winding kept); vertex streams decode byte for byte.
    if (!(mode === 'TRIANGLES' ? sameTriangles(array, new array.constructor(check.buffer)) : check.every((byte, i) => byte === bytes[i])))
      throw new Error(`Buffer view ${at} did not survive its meshopt round trip`);
    compressedViews++;
    const decodedAt = fallbackLength; fallbackLength += pad(bytes.byteLength);
    const { byteStride: _stride, ...rest } = view;
    return { ...rest, buffer: 1, byteOffset: decodedAt, byteLength: bytes.byteLength, ...(mode === 'ATTRIBUTES' ? { byteStride: element } : {}),
      extensions: { [MESHOPT]: { buffer: 0, byteOffset: place(encoded), byteLength: encoded.byteLength, byteStride: element, count: accessor.count, mode } } };
  });
  const outBin = new Uint8Array(binLength);
  let at = 0;
  for (const part of out) { outBin.set(part, at); at += pad(part.byteLength); }
  json.buffers = [{ byteLength: binLength }, { byteLength: fallbackLength, extensions: { [MESHOPT]: { fallback: true } } }];
  json.extensionsUsed = [MESHOPT]; json.extensionsRequired = [MESHOPT];
  const glb = writeGlb(json, outBin);
  return { glb, report: { codec: MESHOPT, plainBytes: plainBytes.byteLength, bytes: glb.byteLength, ratio: Number((glb.byteLength / plainBytes.byteLength).toFixed(4)),
    decodedBufferBytes: json.bufferViews.reduce((sum, view) => sum + pad(view.byteLength), 0),
    gridMetres: grid, maxDisplacementMetres: displacement, snappedPrimitives: snapped, verticesKeptInsideBounds: kept,
    reorderedPrimitives: reordered, compressedViews, plainViews: json.bufferViews.length - compressedViews } };
}
