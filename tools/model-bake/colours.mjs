#!/usr/bin/env node
/** Colour-source report for a GLB: where each drawn primitive's colour comes
 * from (material baseColorFactor, base-colour texture, COLOR_0 vertex colours,
 * or nothing), per material and role, weighted by drawn triangles. The viewer
 * draws only the factor and admitted embedded textures, so any triangles whose
 * colour lives elsewhere fall back to presentation tones.
 *
 * Usage: colours.mjs model.glb [--json]
 * Standalone (node built-ins only), so it can run against any checkout's model. */
import { readFileSync } from 'node:fs';

const [file, flag] = process.argv.slice(2);
if (!file) { console.error('Usage: colours.mjs model.glb [--json]'); process.exit(2); }
const bytes = readFileSync(file), data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
if (data.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB');
const jsonLength = data.getUint32(12, true);
const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
const binAt = 20 + jsonLength, bin = binAt < bytes.length ? bytes.subarray(binAt + 8, binAt + 8 + data.getUint32(binAt, true)) : null;

const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const GET = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' };
const NORM = { 5121: 255, 5123: 65535 };
/** Mean RGB of a COLOR_0 accessor, linear as glTF stores it. */
function meanColour(index) {
  const a = json.accessors[index], view = json.bufferViews[a.bufferView], width = WIDTH[a.type], size = SIZE[a.componentType];
  const stride = view.byteStride ?? width * size, start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength), scale = a.normalized || NORM[a.componentType] ? NORM[a.componentType] ?? 1 : 1;
  const sum = [0, 0, 0];
  for (let i = 0; i < a.count; i++) for (let c = 0; c < 3; c++) sum[c] += dv[GET[a.componentType]](start + i * stride + c * size, true) / scale;
  return sum.map(v => v / Math.max(a.count, 1));
}
const hex = rgb => '#' + rgb.map(v => Math.min(1, Math.max(0, v))).map(v => Math.round(255 * (v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055)).toString(16).padStart(2, '0')).join('');

const roleOf = new Map(), visit = at => {
  const node = json.nodes[at];
  if (node.mesh !== undefined) roleOf.set(node.mesh, { role: node.extras?.semanticRole ?? 'none', levels: (node.extras?.levelIds ?? []).length > 0, uses: (roleOf.get(node.mesh)?.uses ?? 0) + 1 });
  for (const child of node.children ?? []) visit(child);
};
for (const root of (json.scenes ?? [])[json.scene ?? 0]?.nodes ?? []) visit(root);

const rows = new Map(), totals = {};
for (const [meshIndex, use] of roleOf) json.meshes[meshIndex].primitives.forEach(primitive => {
  const material = primitive.material === undefined ? null : json.materials[primitive.material];
  const pbr = material?.pbrMetallicRoughness ?? {};
  const triangles = (primitive.indices === undefined ? json.accessors[primitive.attributes.POSITION].count : json.accessors[primitive.indices].count) / 3 * use.uses;
  const source = pbr.baseColorTexture ? 'texture' : primitive.attributes.COLOR_0 !== undefined ? (pbr.baseColorFactor ? 'factor×COLOR_0' : 'COLOR_0') : pbr.baseColorFactor ? 'factor' : 'none';
  const group = `${use.role}${use.levels ? '' : ' (site)'}`;
  const id = `${group}|${primitive.material ?? '-'}|${source}`;
  const row = rows.get(id) ?? { group, material: material?.name ?? (primitive.material === undefined ? '(no material)' : `#${primitive.material}`), source,
    factor: pbr.baseColorFactor ? hex(pbr.baseColorFactor.slice(0, 3)) : null, extensions: Object.keys(material?.extensions ?? {}), triangles: 0, colour: [0, 0, 0], colourWeight: 0 };
  row.triangles += triangles;
  if (primitive.attributes.COLOR_0 !== undefined && bin) {
    const mean = meanColour(primitive.attributes.COLOR_0);
    row.colour = row.colour.map((v, c) => v + mean[c] * triangles); row.colourWeight += triangles;
  }
  rows.set(id, row);
  totals[group] ??= {}; totals[group][source] = (totals[group][source] ?? 0) + triangles;
});
const out = [...rows.values()].sort((a, b) => b.triangles - a.triangles)
  .map(({ colour, colourWeight, ...row }) => ({ ...row, vertexColour: colourWeight ? hex(colour.map(v => v / colourWeight)) : null }));
if (flag === '--json') console.log(JSON.stringify({ totals, rows: out }, null, 2));
else {
  console.log('Drawn triangles by role and colour source:'); console.table(totals);
  console.table(out.slice(0, 40).map(r => ({ ...r, extensions: r.extensions.join(',') })));
}
