/** Overview bake: one detailed master GLB in, one display GLB out that fits a
 * triangle budget, with the same nodes, meshes and primitive slots so every
 * companion mesh binding keeps pointing at the same thing.
 *
 * Simplification uses meshoptimizer edge collapse with an absolute error in
 * metres, searched globally so the whole house shares one error bound instead
 * of each mesh losing the same percentage. Edge collapse only keeps original
 * vertices, so every baked position is a source position and every source
 * bound still contains the baked geometry. Room-pick and slab primitives carry
 * plan footprints and are never changed; structure and roof are held to a
 * tighter error than context. Untouched primitives keep their exact accessors.
 */
import { createHash } from 'node:crypto';
import { MeshoptSimplifier } from 'meshoptimizer';
import { COMPONENT_BYTES, COMPONENTS, maxScale, meshInstances, readAccessor, readGlb, writeGlb } from './glb.mjs';

export const BAKE_DEFAULTS = Object.freeze({
  /** Drawn triangles, counted per node instance like the viewer counts them. */
  triangles: 520_000,
  /** Largest allowed context error in metres before the bake gives up. */
  maxError: 0.05,
  /** Structure and roof errors are this share of the context error. */
  structureWeight: 0.25,
});
/** Roles whose primitives must stay byte-identical. */
export const LOCKED_ROLES = Object.freeze(['room-pick', 'slab']);
const ROLE_RANK = { 'room-pick': 4, slab: 3, structure: 2, roof: 2, context: 1 };

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const key = (mesh, primitive) => `${mesh}/${primitive}`;

/** The most protective role bound to each primitive slot. */
function primitiveRoles(companion) {
  const roles = new Map();
  for (const binding of companion?.meshBindings ?? [])
    for (const primitive of binding.primitiveIndices) {
      const slot = key(binding.meshIndex, primitive), current = roles.get(slot);
      if (!current || ROLE_RANK[binding.role] > ROLE_RANK[current]) roles.set(slot, binding.role);
    }
  return roles;
}

const textured = (json, materialIndex) => {
  const material = materialIndex === undefined ? undefined : json.materials?.[materialIndex];
  if (!material) return false;
  const pbr = material.pbrMetallicRoughness ?? {};
  return [pbr.baseColorTexture, pbr.metallicRoughnessTexture, material.normalTexture, material.occlusionTexture, material.emissiveTexture]
    .some(texture => texture !== undefined);
};

/** Indices welded by exact position, so collapse crosses split normals and UVs. */
function weld(positions, indices) {
  const remap = MeshoptSimplifier.generatePositionRemap(positions, 3);
  return indices.map(i => remap[i]);
}

function simplifyAt(candidate, error) {
  if (error <= 0) return candidate.indices;
  const local = error / candidate.scale;
  const [indices] = MeshoptSimplifier.simplify(candidate.indices, candidate.positions, 3, 0, local, candidate.flags);
  return indices;
}

/** Collapses each candidate at the smallest global error that meets the budget. */
function search(candidates, fixedTriangles, options) {
  const total = error => candidates.reduce((sum, c) => {
    const triangles = simplifyAt(c, error * c.weight).length / 3;
    c.cache = { error, triangles }; return sum + triangles * c.instances;
  }, fixedTriangles);
  const original = total(0);
  if (original <= options.triangles) return { error: 0, triangles: original };
  if (total(options.maxError) > options.triangles)
    throw new Error(`Cannot reach ${options.triangles} triangles within ${options.maxError} m; lower detail in the source or raise --max-error`);
  let low = 0, high = options.maxError;
  // 24 halvings resolve the error to well under a millimetre at a 5 cm cap.
  for (let step = 0; step < 24; step++) {
    const mid = (low + high) / 2;
    if (total(mid) > options.triangles) low = mid; else high = mid;
  }
  return { error: high, triangles: total(high) };
}

/** New accessor bytes appended after the retained buffer views. */
class BinWriter {
  constructor() { this.parts = []; this.length = 0; }
  add(bytes) {
    const offset = this.length; this.parts.push(bytes); this.length += bytes.byteLength;
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.parts.push(new Uint8Array(pad)); this.length += pad; }
    return offset;
  }
  bytes() { const out = new Uint8Array(this.length); let at = 0; for (const part of this.parts) { out.set(part, at); at += part.byteLength; } return out; }
}

/**
 * @param {Uint8Array} masterBytes detailed GLB
 * @param {object|null} companion atlas-scene.json, or null for a model without bindings
 * @param {Partial<typeof BAKE_DEFAULTS>} [overrides]
 */
export async function bakeOverview(masterBytes, companion, overrides = {}) {
  const options = { ...BAKE_DEFAULTS, ...overrides };
  if (companion && companion.original?.sha256 !== sha256(masterBytes))
    throw new Error('The companion does not pin this master GLB');
  const { json: source, bin } = readGlb(masterBytes);
  for (const name of source.extensionsUsed ?? []) throw new Error(`The master uses glTF extension ${name}; the overview profile admits none`);
  const json = structuredClone(source), roles = primitiveRoles(companion), instances = meshInstances(json);
  await MeshoptSimplifier.ready;

  const candidates = [], report = [];
  let fixedTriangles = 0;
  (json.meshes ?? []).forEach((mesh, meshIndex) => mesh.primitives.forEach((primitive, primitiveIndex) => {
    const uses = instances.get(meshIndex) ?? [];
    const slot = key(meshIndex, primitiveIndex), role = roles.get(slot) ?? (companion ? null : 'context');
    if (role === null) throw new Error(`Primitive ${slot} has no companion binding`);
    const positions = Float32Array.from(readAccessor(json, bin, primitive.attributes.POSITION));
    const indices = primitive.indices === undefined ? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i)
      : Uint32Array.from(readAccessor(json, bin, primitive.indices));
    const triangles = indices.length / 3, hasTextures = textured(json, primitive.material);
    const entry = { mesh: meshIndex, primitive: primitiveIndex, name: mesh.name ?? null, role, instances: uses.length,
      textured: hasTextures, triangles, bakedTriangles: triangles, changed: false };
    report.push(entry);
    if (LOCKED_ROLES.includes(role) || uses.length === 0 || triangles < 4) { fixedTriangles += triangles * uses.length; return; }
    candidates.push({ entry, primitive, positions, original: indices, instances: uses.length,
      // Welding would merge across UV seams the material path needs; textured slots collapse unwelded.
      indices: hasTextures ? indices : weld(positions, indices),
      scale: Math.max(...uses.map(use => maxScale(use.world)), 1e-9),
      weight: role === 'context' ? 1 : options.structureWeight,
      flags: role === 'context' ? ['ErrorAbsolute', 'Prune'] : ['ErrorAbsolute'] });
  }));

  const result = search(candidates, fixedTriangles, options);
  const writer = new BinWriter(), added = [];
  const addAccessor = (array, type, componentType, extra = {}) => {
    const view = { buffer: 0, byteLength: array.byteLength };
    added.push({ view, offset: writer.add(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)) });
    json.accessors.push({ bufferView: -added.length, componentType, count: array.length / COMPONENTS[type], type, ...extra });
    return json.accessors.length - 1;
  };
  for (const c of candidates) {
    const baked = simplifyAt(c, result.error * c.weight);
    if (baked.length === c.original.length) continue;
    // Compact to the vertices still referenced, keeping their original order.
    const used = new Int32Array(c.positions.length / 3).fill(-1);
    let count = 0;
    for (const v of baked) if (used[v] < 0) used[v] = 0;
    for (let v = 0; v < used.length; v++) if (used[v] === 0) used[v] = count++;
    const attributes = {};
    const sources = c.entry.textured ? Object.entries(c.primitive.attributes) : [['POSITION', c.primitive.attributes.POSITION]];
    for (const [name, accessorIndex] of sources) {
      const accessor = source.accessors[accessorIndex], width = COMPONENTS[accessor.type];
      const values = readAccessor(source, bin, accessorIndex), out = new values.constructor(count * width);
      for (let v = 0; v < used.length; v++) if (used[v] >= 0) out.set(values.subarray(v * width, v * width + width), used[v] * width);
      const extra = { ...(accessor.normalized ? { normalized: true } : {}) };
      if (name === 'POSITION') {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < out.length; i++) { min[i % 3] = Math.min(min[i % 3], out[i]); max[i % 3] = Math.max(max[i % 3], out[i]); }
        Object.assign(extra, { min, max });
      }
      attributes[name] = addAccessor(out, accessor.type, accessor.componentType, extra);
    }
    const remapped = baked.map(v => used[v]);
    const indices = count <= 0xffff ? Uint16Array.from(remapped) : Uint32Array.from(remapped);
    c.primitive.attributes = attributes;
    c.primitive.indices = addAccessor(indices, 'SCALAR', count <= 0xffff ? 5123 : 5125);
    c.entry.bakedTriangles = baked.length / 3; c.entry.changed = true;
    c.entry.droppedAttributes = Object.keys(c.entry.textured ? {} : source.meshes[c.entry.mesh].primitives[c.entry.primitive].attributes)
      .filter(name => name !== 'POSITION');
  }

  const out = repack(json, bin, writer, added, referencedViews(source));
  const outBytes = writeGlb(out.json, out.bin);
  const bakedCompanion = companion ? { ...companion, original: { sha256: sha256(outBytes), bytes: outBytes.byteLength } } : null;
  const drawn = rows => rows.reduce((sum, row) => sum + row.bakedTriangles * row.instances, 0);
  return {
    glb: outBytes, companion: bakedCompanion,
    report: {
      profile: 'houseatlas.overview-bake-report.v1',
      master: { sha256: sha256(masterBytes), bytes: masterBytes.byteLength, drawnTriangles: report.reduce((s, r) => s + r.triangles * r.instances, 0) },
      overview: { sha256: sha256(outBytes), bytes: outBytes.byteLength, drawnTriangles: drawn(report) },
      budget: { triangles: options.triangles, maxError: options.maxError, structureWeight: options.structureWeight },
      contextErrorMetres: result.error, structureErrorMetres: result.error * options.structureWeight,
      lockedRoles: LOCKED_ROLES, masterOrphanBytesDropped: out.orphanBytes, replacedBytesDropped: out.replacedBytes,
      primitives: report,
    },
  };
}

const usedAccessors = json => {
  const used = new Set();
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    for (const accessor of Object.values(primitive.attributes)) used.add(accessor);
    if (primitive.indices !== undefined) used.add(primitive.indices);
  }
  return used;
};
/** Buffer views a scene's primitives and images read. */
function referencedViews(json) {
  const views = new Set();
  for (const at of usedAccessors(json)) if (json.accessors[at].bufferView !== undefined) views.add(json.accessors[at].bufferView);
  for (const image of json.images ?? []) if (image.bufferView !== undefined) views.add(image.bufferView);
  return views;
}

/** Keeps only referenced buffer views (original bytes, original order) and appends new ones.
 * Dropped views are counted as master orphans (unreferenced before the bake) or replaced. */
function repack(json, bin, writer, added, masterViews) {
  const used = usedAccessors(json), accessorMap = new Map(), accessors = [];
  json.accessors.forEach((accessor, at) => { if (used.has(at)) { accessorMap.set(at, accessors.length); accessors.push(accessor); } });
  const usedViews = new Set();
  for (const accessor of accessors) if (accessor.bufferView >= 0) usedViews.add(accessor.bufferView);
  for (const image of json.images ?? []) if (image.bufferView !== undefined) usedViews.add(image.bufferView);
  const viewMap = new Map(), views = [], kept = new BinWriter();
  let orphanBytes = 0, replacedBytes = 0;
  (json.bufferViews ?? []).forEach((view, at) => {
    if (!usedViews.has(at)) { if (masterViews.has(at)) replacedBytes += view.byteLength; else orphanBytes += view.byteLength; return; }
    const start = view.byteOffset ?? 0;
    viewMap.set(at, views.length);
    // Keep 4-byte alignment for strided and float views.
    views.push({ ...view, byteOffset: kept.add(bin.subarray(start, start + view.byteLength)) });
  });
  const appended = writer.bytes(), base = kept.length;
  for (const { view, offset } of added) views.push({ ...view, byteOffset: base + offset });
  for (const accessor of accessors)
    accessor.bufferView = accessor.bufferView >= 0 ? viewMap.get(accessor.bufferView) : views.length - added.length + (-accessor.bufferView - 1);
  for (const image of json.images ?? []) if (image.bufferView !== undefined) image.bufferView = viewMap.get(image.bufferView);
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    for (const name of Object.keys(primitive.attributes)) primitive.attributes[name] = accessorMap.get(primitive.attributes[name]);
    if (primitive.indices !== undefined) primitive.indices = accessorMap.get(primitive.indices);
  }
  const keptBytes = kept.bytes(), out = new Uint8Array(keptBytes.byteLength + appended.byteLength);
  out.set(keptBytes); out.set(appended, keptBytes.byteLength);
  json.accessors = accessors; json.bufferViews = views;
  if (views.length === 0) { delete json.bufferViews; delete json.buffers; return { json, bin: null, orphanBytes, replacedBytes }; }
  json.buffers = [{ byteLength: out.byteLength }];
  return { json, bin: out, orphanBytes, replacedBytes };
}
