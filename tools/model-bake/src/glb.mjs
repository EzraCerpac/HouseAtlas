/** Minimal GLB 2.0 container and accessor access for the overview bake.
 * Reads one JSON chunk and at most one BIN chunk, and reads/writes the plain
 * accessor layouts the installed viewer admits. No extension is decoded. */

const GLB_MAGIC = 0x46546c67, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;
export const COMPONENT_BYTES = Object.freeze({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 });
export const COMPONENTS = Object.freeze({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 });
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

export function readGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2)
    throw new Error('Not a GLB 2.0 file');
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error('GLB length differs from the file length');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK) throw new Error('First GLB chunk must be JSON');
  const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength)));
  let bin = null;
  const binAt = 20 + jsonLength;
  if (binAt < bytes.byteLength) {
    if (view.getUint32(binAt + 4, true) !== BIN_CHUNK) throw new Error('Second GLB chunk must be BIN');
    const binLength = view.getUint32(binAt, true);
    if (binAt + 8 + binLength !== bytes.byteLength) throw new Error('Only one BIN chunk is supported');
    bin = bytes.subarray(binAt + 8, binAt + 8 + binLength);
  }
  return { json, bin };
}

export function writeGlb(json, bin) {
  const pad = length => (length + 3) & ~3;
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad(text.byteLength), binLength = bin ? pad(bin.byteLength) : 0;
  const total = 20 + jsonLength + (bin ? 8 + binLength : 0);
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, JSON_CHUNK, true);
  out.set(text, 20); out.fill(0x20, 20 + text.byteLength, 20 + jsonLength);
  if (bin) {
    view.setUint32(20 + jsonLength, binLength, true); view.setUint32(24 + jsonLength, BIN_CHUNK, true);
    out.set(bin, 28 + jsonLength);
  }
  return out;
}

/** Reads an accessor into a tightly packed typed array of its component type. */
export function readAccessor(json, bin, index) {
  const accessor = json.accessors[index];
  if (accessor.sparse !== undefined) throw new Error(`Accessor ${index} is sparse`);
  if (accessor.bufferView === undefined) throw new Error(`Accessor ${index} has no buffer view`);
  const view = json.bufferViews[accessor.bufferView];
  const components = COMPONENTS[accessor.type], size = COMPONENT_BYTES[accessor.componentType];
  if (!components || !size) throw new Error(`Accessor ${index} type is not supported`);
  const element = components * size, stride = view.byteStride ?? element;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const Out = ARRAYS[accessor.componentType], out = new Out(accessor.count * components);
  const source = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const read = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[accessor.componentType];
  for (let item = 0; item < accessor.count; item++)
    for (let c = 0; c < components; c++) out[item * components + c] = source[read](start + item * stride + c * size, true);
  return out;
}

/** Column-major glTF node local matrix from TRS or matrix. */
export function localMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1], [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
export function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
/** Largest stretch a world matrix applies to a local length. */
export const maxScale = m => Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));

/** Drawn node instances of each mesh in the default scene, with world matrices. */
export function meshInstances(json) {
  const instances = new Map(), nodes = json.nodes ?? [];
  const scene = (json.scenes ?? [])[json.scene ?? 0];
  const visit = (at, parent) => {
    const node = nodes[at], world = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      if (!instances.has(node.mesh)) instances.set(node.mesh, []);
      instances.get(node.mesh).push({ nodeIndex: at, world });
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of scene?.nodes ?? []) visit(root, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return instances;
}
