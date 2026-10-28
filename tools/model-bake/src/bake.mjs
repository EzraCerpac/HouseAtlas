/** Overview bake: one detailed master GLB in, one display GLB out that fits a
 * triangle budget, with the same nodes and drawn mesh/primitive slots so every
 * companion mesh binding keeps pointing at the same thing.
 *
 * Simplification uses meshoptimizer with an absolute error in metres, searched
 * globally so the whole house shares one error bound instead of each mesh
 * losing the same percentage. Both edge collapse and the clustering fallback
 * keep only original vertices, so every baked position is a source position
 * and every source bound still contains the baked geometry. Room-pick and slab
 * primitives carry plan footprints and textured primitives carry UV mappings,
 * so neither is changed; structure and roof are held to a tighter error than
 * context. Reported errors include the welding displacement.
 */
import { createHash } from 'node:crypto';
import { MeshoptSimplifier } from 'meshoptimizer';
import { COMPONENTS, maxScale, meshInstances, readAccessor, readGlb, writeGlb } from './glb.mjs';
import { decodePng, encodePng, shrinkImage } from './png.mjs';

export const BAKE_DEFAULTS = Object.freeze({
  /** Drawn triangles, counted per node instance like the viewer counts them. */
  triangles: 520_000,
  /** Largest allowed context error in metres before the bake gives up. */
  maxError: 0.05,
  /** Structure and roof errors are this share of the context error. */
  structureWeight: 0.25,
  /** Site context (bound to no level: garden, terrain, surroundings) takes this
   * multiple of the context error, so the budget goes to the house. */
  siteWeight: 4,
  /** Untextured vertices closer than this (metres, per axis cell) are welded
   * before simplification, so exporter-split or clipped surfaces collapse as
   * one surface. Welding keeps the first source vertex of each cell. */
  weld: 0.0005,
  /** Embedded textures larger than this many pixels on a side are halved until
   * they fit: the overview is what phones draw, and its GPU budget holds the
   * geometry and every texture. The Full tier keeps them as authored. */
  textureSize: 512,

});
/** Roles whose primitives must stay byte-identical. */
export const LOCKED_ROLES = Object.freeze(['room-pick', 'slab']);
const ROLE_RANK = { 'room-pick': 4, slab: 3, structure: 2, roof: 2, context: 1 };

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const key = (mesh, primitive) => `${mesh}/${primitive}`;

/** The most protective role per primitive slot, and the slots bound to any
 * level: companion bindings when given, otherwise the producer's `semanticRole`
 * and `levelIds` node extras. Slots with no role count as context. */
function primitiveRoles(json, companion, instances) {
  const roles = new Map(), onLevel = new Set(), keep = (slot, role, levelIds) => {
    if (Array.isArray(levelIds) && levelIds.length > 0) onLevel.add(slot);
    if (!(role in ROLE_RANK)) return;
    const current = roles.get(slot);
    if (!current || ROLE_RANK[role] > ROLE_RANK[current]) roles.set(slot, role);
  };
  if (companion) {
    for (const binding of companion.meshBindings ?? [])
      for (const primitive of binding.primitiveIndices) keep(key(binding.meshIndex, primitive), binding.role, binding.levelIds);
    return { roles, onLevel };
  }
  for (const [meshIndex, uses] of instances)
    for (const { nodeIndex } of uses) {
      const extras = json.nodes[nodeIndex].extras;
      json.meshes[meshIndex].primitives.forEach((_, primitive) => keep(key(meshIndex, primitive), extras?.semanticRole, extras?.levelIds));
    }
  return { roles, onLevel };
}

const textured = (json, materialIndex) => {
  const material = materialIndex === undefined ? undefined : json.materials?.[materialIndex];
  if (!material) return false;
  const pbr = material.pbrMetallicRoughness ?? {};
  return [pbr.baseColorTexture, pbr.metallicRoughnessTexture, material.normalTexture, material.occlusionTexture, material.emissiveTexture]
    .some(texture => texture !== undefined);
};

/** Vertex attributes the server admits: position and normal, plus UVs and
 * tangents where the material samples a base colour, normal or
 * metallic-roughness texture. The viewer draws no others (vertex colours,
 * further UV sets), so the bake drops them from every primitive. */
const admittedAttributes = (json, materialIndex) => {
  const material = materialIndex === undefined ? undefined : json.materials?.[materialIndex];
  const pbr = material?.pbrMetallicRoughness ?? {};
  const mapped = [pbr.baseColorTexture, material?.normalTexture, pbr.metallicRoughnessTexture].some(texture => texture !== undefined);
  return mapped ? ['POSITION', 'NORMAL', 'TEXCOORD_0', 'TANGENT'] : ['POSITION', 'NORMAL'];
};

/** Area-weighted mean of a primitive's COLOR_0, linear RGB in 0–1, or null
 * without vertex colours. glTF multiplies COLOR_0 into the base colour, and
 * the viewer draws neither vertex colours nor anything but the factor and
 * admitted textures, so the bake folds this mean into the material factor
 * before dropping the attribute; an export that keeps a surface's colour only
 * in vertex colours would otherwise lose it. Alpha is not folded: the viewer
 * draws opaque surfaces. */
function meanVertexColour(json, bin, primitive) {
  if (primitive.attributes.COLOR_0 === undefined) return null;
  const accessor = json.accessors[primitive.attributes.COLOR_0], width = COMPONENTS[accessor.type];
  const scale = accessor.componentType === 5121 ? 255 : accessor.componentType === 5123 ? 65535 : 1;
  const colours = readAccessor(json, bin, primitive.attributes.COLOR_0), positions = readAccessor(json, bin, primitive.attributes.POSITION);
  const indices = primitive.indices === undefined ? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i) : readAccessor(json, bin, primitive.indices);
  const sum = [0, 0, 0];
  let weight = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const u = [0, 1, 2].map(k => positions[b * 3 + k] - positions[a * 3 + k]), v = [0, 1, 2].map(k => positions[c * 3 + k] - positions[a * 3 + k]);
    const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    for (let k = 0; k < 3; k++) sum[k] += area * (colours[a * width + k] + colours[b * width + k] + colours[c * width + k]) / (3 * scale);
    weight += area;
  }
  // Degenerate geometry has no area to weigh by; every vertex then counts once.
  if (weight === 0) {
    const count = colours.length / width;
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) sum[k] += colours[i * width + k] / scale;
    weight = count;
  }
  return weight > 0 ? sum.map(value => Math.min(1, Math.max(0, value / weight))) : null;
}

/** Indices welded on a grid of `cell` local units, dropping triangles that weld shut. */
function weld(positions, indices, cell) {
  const remap = new Uint32Array(positions.length / 3), seen = new Map();
  for (let v = 0; v < remap.length; v++) {
    const id = cell > 0
      ? `${Math.round(positions[v * 3] / cell)},${Math.round(positions[v * 3 + 1] / cell)},${Math.round(positions[v * 3 + 2] / cell)}`
      : `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`;
    let at = seen.get(id);
    if (at === undefined) { at = v; seen.set(id, v); }
    remap[v] = at;
  }
  const out = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]], b = remap[indices[t + 1]], c = remap[indices[t + 2]];
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  return Uint32Array.from(out);
}

/** Triangles every simplified primitive keeps: a hundredth of its own, at least
 * four, so no bound part ever vanishes and no empty accessor is written. */
const floorTriangles = triangles => Math.min(triangles, Math.max(4, Math.ceil(triangles / 100)));

function simplifyAt(candidate, error) {
  if (error <= 0) return candidate.indices;
  const local = error / candidate.scale, floor = candidate.floor * 3;
  let [indices] = MeshoptSimplifier.simplify(candidate.indices, candidate.positions, 3, floor, local, candidate.flags);
  // Edge collapse stalls on disconnected soup (foliage cards, clipped terrain
  // cells). Clustering also keeps source vertices; use it when it does better.
  if (candidate.sloppy && indices.length > candidate.indices.length / 2) {
    const [clustered] = MeshoptSimplifier.simplifySloppy(candidate.indices, candidate.positions, 3, null, floor, local / candidate.extent);
    if (clustered.length >= floor && clustered.length < indices.length) indices = clustered;
  }
  // Pruning can still remove every component of a small part; keep its shape instead.
  if (indices.length < floor) [indices] = MeshoptSimplifier.simplify(candidate.indices, candidate.positions, 3, floor, local, ['ErrorAbsolute']);
  return indices.length > 0 ? indices : candidate.indices;
}

/** Collapses each candidate at the smallest global error that meets the budget. */
function search(candidates, fixedTriangles, options, cap) {
  const total = error => candidates.reduce((sum, c) => sum + simplifyAt(c, error * c.weight).length / 3 * c.instances, fixedTriangles);
  const authored = candidates.reduce((sum, c) => sum + c.original.length / 3 * c.instances, fixedTriangles);
  if (authored <= options.triangles) return { error: 0, triangles: authored };
  if (cap <= 0) throw new Error(`--weld ${options.weld} m can move vertices up to ${options.maxError - cap} m, which leaves no room under --max-error ${options.maxError} m`);
  const atCap = total(cap);
  if (atCap > options.triangles)
    throw new Error(`Cannot reach ${options.triangles} triangles within ${options.maxError} m (${atCap} remain); lower detail in the source or raise --max-error`);
  let low = 0, high = cap;
  // 20 halvings resolve the error to about 0.05 mm at a 5 cm cap.
  for (let step = 0; step < 20; step++) {
    const mid = (low + high) / 2;
    if (total(mid) > options.triangles) low = mid; else high = mid;
  }
  return { error: high, triangles: total(high) };
}

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

const bounds = values => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i++) { min[i % 3] = Math.min(min[i % 3], values[i]); max[i % 3] = Math.max(max[i % 3], values[i]); }
  return { min, max };
};

/**
 * @param {Uint8Array} masterBytes detailed GLB
 * @param {object|null} companion atlas-scene.json, or null for a model without bindings
 * @param {Partial<typeof BAKE_DEFAULTS>} [overrides]
 */
/** The Full tier: the master with the overview's compaction and nothing
 * simplified. It keeps the overview's node, mesh and primitive slots, so the
 * overview's companion binds both; the returned companion differs from it
 * only in `original`, which pins this GLB instead. */
export async function bakeDetail(masterBytes, companion) {
  const { glb, companion: baked, report } = await bakeOverview(masterBytes, companion, { triangles: Infinity, textureSize: Infinity });
  return { glb, companion: baked, drawnTriangles: report.overview.drawnTriangles, report };
}

export async function bakeOverview(masterBytes, companion, overrides = {}) {
  const options = { ...BAKE_DEFAULTS, ...overrides };
  if (companion && companion.original?.sha256 !== sha256(masterBytes))
    throw new Error('The companion does not pin this master GLB');
  const { json: source, bin } = readGlb(masterBytes);
  for (const name of source.extensionsUsed ?? []) throw new Error(`The master uses glTF extension ${name}; the overview profile admits none`);
  for (const accessor of source.accessors ?? []) if (accessor.sparse) throw new Error('Sparse accessors are not supported');
  const instances = meshInstances(source), { roles, onLevel } = primitiveRoles(source, companion, instances);
  await MeshoptSimplifier.ready;

  // Meshes no drawn node uses are left out; the viewer and backend refuse unused declarations.
  const meshMap = new Map(), unusedMeshes = [];
  (source.meshes ?? []).forEach((_, at) => { if (instances.has(at)) meshMap.set(at, meshMap.size); else unusedMeshes.push(at); });
  for (const binding of companion?.meshBindings ?? [])
    if (!meshMap.has(binding.meshIndex)) throw new Error(`Companion binds mesh ${binding.meshIndex}, which no node draws`);

  const candidates = [], report = [];
  let fixedTriangles = 0, weldedAny = false;
  for (const [meshIndex] of meshMap) source.meshes[meshIndex].primitives.forEach((primitive, primitiveIndex) => {
    const uses = instances.get(meshIndex), slot = key(meshIndex, primitiveIndex);
    const role = roles.get(slot) ?? (companion ? null : 'context');
    if (role === null) throw new Error(`Primitive ${slot} has no companion binding`);
    const positions = Float32Array.from(readAccessor(source, bin, primitive.attributes.POSITION));
    const indices = primitive.indices === undefined ? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i)
      : Uint32Array.from(readAccessor(source, bin, primitive.indices));
    const triangles = indices.length / 3, hasTextures = textured(source, primitive.material);
    const site = role === 'context' && !onLevel.has(slot);
    const entry = { mesh: meshIndex, bakedMesh: meshMap.get(meshIndex), primitive: primitiveIndex, name: source.meshes[meshIndex].name ?? null, role, site, instances: uses.length,
      textured: hasTextures, triangles, bakedTriangles: triangles, changed: false };
    report.push(entry);
    // Textured primitives are kept as authored: a flat surface can lose the
    // vertices that carry a non-affine UV mapping at zero position error, and
    // the texture drift that causes is not bounded by the error in metres.
    if (LOCKED_ROLES.includes(role) || hasTextures || triangles < 4) { fixedTriangles += triangles * uses.length; return; }
    const scale = Math.max(...uses.map(use => maxScale(use.world)), 1e-9);
    // A part thinner than the weld distance can weld away entirely; it then stays unwelded.
    let welded = weld(positions, indices, options.weld / scale);
    if (welded.length < floorTriangles(triangles) * 3) welded = indices;
    else weldedAny = true;
    // The simplifier sees only referenced vertices: unreferenced ones (left by
    // welding or the exporter) stall edge collapse. `vertexIds` maps back to source.
    const vertexIds = [...new Set(welded)].sort((a, b) => a - b), local = new Map(vertexIds.map((v, i) => [v, i]));
    const compact = new Float32Array(vertexIds.length * 3);
    vertexIds.forEach((v, i) => compact.set(positions.subarray(v * 3, v * 3 + 3), i * 3));
    candidates.push({ entry, positions: compact, vertexIds: Uint32Array.from(vertexIds), original: indices, instances: uses.length, scale,
      indices: welded.map(v => local.get(v)),
      extent: MeshoptSimplifier.getScale(compact, 3),
      weight: role !== 'context' ? options.structureWeight : site ? options.siteWeight : 1,
      // The floor follows the authored count: welding may already have dropped degenerate triangles.
      floor: floorTriangles(triangles),
      // Pruning and clustering are for site context only. House context may still
      // collapse parts smaller than the error, but never below the floor.
      sloppy: site,
      flags: site ? ['ErrorAbsolute', 'Prune'] : ['ErrorAbsolute'] });
  });

  // Welding moves a vertex by at most one weld cell diagonal before simplifying,
  // so --max-error bounds the context error plus that displacement.
  const weldDisplacement = weldedAny ? options.weld * Math.sqrt(3) : 0;
  const result = search(candidates, fixedTriangles, options, options.maxError - weldDisplacement);
  const displaced = result.error > 0 ? weldDisplacement : 0;
  const baked = new Map();
  // A master that already fits keeps every primitive as authored.
  for (const c of result.error === 0 ? [] : candidates) {
    const indices = simplifyAt(c, result.error * c.weight).map(v => c.vertexIds[v]);
    if (indices.length === c.original.length && indices.every((v, i) => v === c.original[i])) continue;
    baked.set(key(c.entry.mesh, c.entry.primitive), indices);
    c.entry.bakedTriangles = indices.length / 3; c.entry.changed = true;
  }

  // Rebuild every buffer tightly: untouched accessors keep their exact values,
  // baked primitives (never textured) get compact positions only.
  const json = structuredClone(source), writer = new BinWriter(), accessors = [], views = [];
  const addView = (bytes, extra = {}) => { views.push({ buffer: 0, byteOffset: writer.add(bytes), byteLength: bytes.byteLength, ...extra }); return views.length - 1; };
  const addAccessor = (array, from, extra = {}) => {
    const bufferView = addView(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), from.target ? { target: from.target } : {});
    accessors.push({ bufferView, componentType: from.componentType, count: array.length / COMPONENTS[from.type], type: from.type,
      ...(from.normalized ? { normalized: true } : {}), ...extra });
    return accessors.length - 1;
  };
  const copied = new Map(), copy = at => {
    if (!copied.has(at)) {
      const accessor = source.accessors[at], values = readAccessor(source, bin, at);
      const extra = { ...(accessor.min ? { min: accessor.min } : {}), ...(accessor.max ? { max: accessor.max } : {}), ...(accessor.name ? { name: accessor.name } : {}) };
      copied.set(at, addAccessor(values, { ...accessor, target: source.bufferViews[accessor.bufferView].target }, extra));
    }
    return copied.get(at);
  };
  // One material per source material and folded vertex colour, appended after the source materials.
  const folded = new Map(), replaced = new Set(), foldMaterial = (materialIndex, colour) => {
    if (materialIndex !== undefined) replaced.add(materialIndex);
    const id = `${materialIndex ?? ''}|${colour.map(v => v.toFixed(4)).join(',')}`;
    if (!folded.has(id)) {
      const material = structuredClone(materialIndex === undefined ? {} : source.materials[materialIndex]);
      const pbr = material.pbrMetallicRoughness ??= {}, base = pbr.baseColorFactor ?? [1, 1, 1, 1];
      pbr.baseColorFactor = [...colour.map((v, k) => Number((base[k] * v).toFixed(4))), base[3]];
      (json.materials ??= []).push(material);
      folded.set(id, json.materials.length - 1);
    }
    return folded.get(id);
  };
  json.meshes = [...meshMap.keys()].map(meshIndex => {
    const mesh = json.meshes[meshIndex];
    mesh.primitives = mesh.primitives.map((sourcePrimitive, primitiveIndex) => {
      const indices = baked.get(key(meshIndex, primitiveIndex)), from = source.meshes[meshIndex].primitives[primitiveIndex];
      const entry = report.find(row => row.mesh === meshIndex && row.primitive === primitiveIndex);
      const colour = meanVertexColour(source, bin, from);
      if (colour) entry.foldedVertexColour = colour;
      const primitive = colour ? { ...sourcePrimitive, material: foldMaterial(from.material, colour) } : sourcePrimitive;
      if (!indices) {
        const admitted = admittedAttributes(source, from.material);
        const dropped = Object.keys(from.attributes).filter(name => !admitted.includes(name));
        if (dropped.length > 0) entry.droppedAttributes = dropped;
        const attributes = Object.fromEntries(Object.entries(from.attributes).filter(([name]) => admitted.includes(name)).map(([name, at]) => [name, copy(at)]));
        return { ...primitive, attributes, ...(from.indices === undefined ? {} : { indices: copy(from.indices) }) };
      }
      // Compact to the vertices still referenced, keeping their source order.
      const vertexCount = source.accessors[from.attributes.POSITION].count, used = new Int32Array(vertexCount).fill(-1);
      for (const v of indices) used[v] = 0;
      let count = 0;
      for (let v = 0; v < vertexCount; v++) if (used[v] === 0) used[v] = count++;
      const names = ['POSITION'];
      const attributes = {};
      for (const name of names) {
        const accessor = source.accessors[from.attributes[name]], width = COMPONENTS[accessor.type];
        const values = readAccessor(source, bin, from.attributes[name]), out = new values.constructor(count * width);
        for (let v = 0; v < vertexCount; v++) if (used[v] >= 0) out.set(values.subarray(v * width, v * width + width), used[v] * width);
        attributes[name] = addAccessor(out, { ...accessor, target: 34962 }, name === 'POSITION' ? bounds(out) : {});
      }
      const wide = count > 0xffff, remapped = indices.map(v => used[v]);
      const index = addAccessor(wide ? Uint32Array.from(remapped) : Uint16Array.from(remapped),
        { componentType: wide ? 5125 : 5123, type: 'SCALAR', target: 34963 });
      entry.droppedAttributes = Object.keys(from.attributes).filter(name => !names.includes(name));
      return { ...primitive, attributes, indices: index };
    });
    return mesh;
  });
  for (const node of json.nodes ?? []) if (node.mesh !== undefined) node.mesh = meshMap.get(node.mesh);
  // Drop originals that folding left unreferenced, so they never count against
  // the server's material limit. Their textures stay referenced by the folded
  // copies; materials the master already left unused are kept as authored.
  if (replaced.size > 0) {
    const used = new Set(json.meshes.flatMap(mesh => mesh.primitives.map(p => p.material)));
    const kept = json.materials.map((_, at) => at).filter(at => used.has(at) || !replaced.has(at));
    const index = new Map(kept.map((at, i) => [at, i])), materials = json.materials;
    for (const mesh of json.meshes) for (const primitive of mesh.primitives)
      if (primitive.material !== undefined) primitive.material = index.get(primitive.material);
    json.materials = kept.map(at => materials[at]);
  }
  // How each image is sampled, for averaging it: normal map, colour (sRGB) or data.
  // An overview image to be halved that is read in more than one role gets a copy
  // per further role (and its textures one too), so each is averaged the way it
  // is sampled. Images that already fit stay shared.
  const decodedViews = new Map(), decoded = image => {
    if (!Number.isFinite(options.textureSize) || image.bufferView === undefined || image.mimeType !== 'image/png') return null;
    if (!decodedViews.has(image.bufferView)) {
      const view = source.bufferViews[image.bufferView], start = view.byteOffset ?? 0;
      decodedViews.set(image.bufferView, decodePng(bin.subarray(start, start + view.byteLength)));
    }
    return decodedViews.get(image.bufferView);
  };
  const shrinks = image => { const pixels = decoded(image); return pixels !== null && Math.max(pixels.width, pixels.height) > options.textureSize; };
  const slots = (json.materials ?? []).flatMap(material => [[material.normalTexture, 'normal'], [material.pbrMetallicRoughness?.baseColorTexture, 'srgb'],
    [material.emissiveTexture, 'srgb'], [material.pbrMetallicRoughness?.metallicRoughnessTexture, 'data'], [material.occlusionTexture, 'data']])
    .filter(([info]) => json.textures?.[info?.index]?.source !== undefined);
  const imageRoles = new Map(), copies = new Map();
  for (const [info, role] of slots) {
    const texture = json.textures[info.index], at = texture.source;
    if (!imageRoles.has(at)) imageRoles.set(at, role);
    if (imageRoles.get(at) === role || !shrinks(json.images[at])) continue;
    if (!copies.has(`${info.index}:${role}`)) {
      let image = copies.get(`image ${at}:${role}`);
      if (image === undefined) { image = json.images.push({ ...json.images[at] }) - 1; imageRoles.set(image, role); copies.set(`image ${at}:${role}`, image); }
      copies.set(`${info.index}:${role}`, json.textures.push({ ...texture, source: image }) - 1);
    }
    info.index = copies.get(`${info.index}:${role}`);
  }
  const textures = [];
  (json.images ?? []).forEach((image, at) => {
    if (image.bufferView === undefined) return;
    const view = source.bufferViews[image.bufferView], start = view.byteOffset ?? 0;
    let bytes = bin.subarray(start, start + view.byteLength);
    const pixels = decoded(image);
    if (shrinks(image)) {
      const shrunk = shrinkImage(pixels, options.textureSize, imageRoles.get(at) ?? 'data');
      textures.push({ image: at, role: imageRoles.get(at) ?? 'data', from: [pixels.width, pixels.height], to: [shrunk.width, shrunk.height], bytes: bytes.byteLength });
      bytes = encodePng(shrunk); textures.at(-1).bakedBytes = bytes.byteLength;
    } else if (Number.isFinite(options.textureSize) && !pixels) textures.push({ image: at, kept: 'not an opaque 8-bit RGB, non-interlaced, well-formed PNG; left for the viewer to judge' });
    image.bufferView = addView(bytes);
  });
  json.accessors = accessors; json.bufferViews = views;
  const outBin = writer.bytes();
  if (views.length === 0) { delete json.accessors; delete json.bufferViews; delete json.buffers; }
  else json.buffers = [{ byteLength: outBin.byteLength }];
  const outBytes = writeGlb(json, views.length === 0 ? null : outBin);

  const bakedCompanion = companion ? { ...companion, original: { sha256: sha256(outBytes), bytes: outBytes.byteLength },
    meshBindings: companion.meshBindings.map(binding => ({ ...binding, meshIndex: meshMap.get(binding.meshIndex) })) } : null;
  const drawn = rows => rows.reduce((sum, row) => sum + row.bakedTriangles * row.instances, 0);
  return {
    glb: outBytes, companion: bakedCompanion,
    report: {
      profile: 'houseatlas.overview-bake-report.v2',
      master: { sha256: sha256(masterBytes), bytes: masterBytes.byteLength, binBytes: bin?.byteLength ?? 0, drawnTriangles: drawn(report.map(r => ({ ...r, bakedTriangles: r.triangles }))) },
      overview: { sha256: sha256(outBytes), bytes: outBytes.byteLength, binBytes: outBin.byteLength, drawnTriangles: drawn(report) },
      budget: { triangles: options.triangles, maxError: options.maxError, structureWeight: options.structureWeight, siteWeight: options.siteWeight, weld: options.weld,
        textureSize: options.textureSize },
      // Images halved to fit textureSize (and any this bake could not read, kept as authored).
      textures,
      rolesFrom: companion ? 'companion' : 'node-extras',
      // Upper bounds on how far baked geometry departs from the master: simplification plus welding.
      weldDisplacementMetres: displaced,
      contextErrorMetres: result.error + displaced, structureErrorMetres: result.error * options.structureWeight + displaced,
      siteErrorMetres: result.error * options.siteWeight + displaced,
      lockedRoles: LOCKED_ROLES, unusedMeshesDropped: unusedMeshes,
      primitives: report,
    },
  };
}
