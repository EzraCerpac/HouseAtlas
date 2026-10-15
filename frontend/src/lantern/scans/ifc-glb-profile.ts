import { ExactDecimal, isExactDecimal } from '../../numeric/decimal';

/** A deliberately small, closed GLB 2.0 presentation profile. GLB coordinates
 * have already been converted to Y-up metres; this reader never rotates them
 * into house coordinates or infers a physical registration. */
export const IFC_GLB_PROFILE = 'houseatlas.ifc-derived-glb.v1';
export const IFC_GLB_MIME = 'model/gltf-binary';
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_MESHES = 512;
const MAX_VERTICES = 150_000;
const MAX_TRIANGLES = 50_000;
const SHA = /^[a-f0-9]{64}$/;
type Json = null | boolean | string | ExactDecimal | Json[] | { [key: string]: Json };
type Row = { [key: string]: Json };
function need(ok: unknown, why: string): asserts ok { if (!ok) throw new TypeError(`IFC GLB: ${why}`); }
function row(value: Json | undefined, keys: readonly string[]): Row {
  need(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value), 'object required');
  need(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'unsupported object fields');
  return value;
}
function list(value: Json | undefined, max: number): Json[] { need(Array.isArray(value) && value.length <= max, 'array bound'); return value; }
function number(value: Json | undefined, max: number, min = 0): number {
  need(isExactDecimal(value) && value.isInteger, 'integer required');
  const result = value.toSafeInteger(); need(result !== undefined && result >= min && result <= max, 'integer bound'); return result;
}
function name(value: Json | undefined): string { need(typeof value === 'string' && value.length > 0 && value.length <= 256, 'name required'); return value; }
function digest(value: Json | undefined): string { need(typeof value === 'string' && SHA.test(value), 'SHA256 required'); return value; }
function freezeProfile(value: object): void {
  for (const child of Object.values(value))
    if (child !== null && typeof child === 'object' && !isExactDecimal(child)) freezeProfile(child);
  Object.freeze(value);
}

export interface IfcGlbProfile {
  readonly profile: typeof IFC_GLB_PROFILE;
  readonly source: { readonly originalSHA256: string; readonly originalBytes: ExactDecimal; readonly floorLabel: string;
    readonly sourceUnits: 'mm'; readonly sourceUpAxis: 'Z'; readonly glbUnits: 'm'; readonly glbUpAxis: 'Y';
    readonly sourceToGlb: { readonly axisMap: readonly ['x', 'z', '-y']; readonly scale: 0.001 };
    readonly converter: { readonly name: string; readonly version: string; readonly configSha256: string } };
  readonly authoredCoordinates: { readonly upAxis: 'Y'; readonly metersPerUnitToken: '1' };
  readonly counts: { readonly meshes: number; readonly vertices: number; readonly triangles: number };
  readonly meshes: readonly {
    readonly sourceObjectId: string; readonly sourceName: string;
    readonly positionsLocalTokens: readonly string[]; readonly triangleIndicesTokens: readonly string[];
    readonly composedLocalToStageMatrixTokens: readonly string[];
  }[];
}

/** jsonDecoder is the existing duplicate-rejecting, bounded token parser. */
export async function parseIfcGlbProfile(bytes: Uint8Array, signal: AbortSignal,
  jsonDecoder: (bytes: Uint8Array, signal: AbortSignal) => Promise<Json>): Promise<IfcGlbProfile> {
  signal.throwIfAborted(); need(bytes.byteLength >= 28 && bytes.byteLength <= MAX_BYTES, 'byte bound');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  need(view.getUint32(0, true) === 0x46546c67 && view.getUint32(4, true) === 2 && view.getUint32(8, true) === bytes.byteLength, 'GLB header');
  const jsonLength = view.getUint32(12, true), jsonEnd = 20 + jsonLength;
  need(jsonLength > 0 && jsonLength % 4 === 0 && jsonEnd + 8 <= bytes.byteLength && view.getUint32(16, true) === 0x4e4f534a, 'JSON chunk');
  const binLength = view.getUint32(jsonEnd, true), binStart = jsonEnd + 8;
  need(binLength > 0 && binLength % 4 === 0 && view.getUint32(jsonEnd + 4, true) === 0x004e4942 && binStart + binLength === bytes.byteLength, 'BIN chunk');
  const root = row(await jsonDecoder(bytes.subarray(20, jsonEnd), signal),
    ['asset', 'scene', 'scenes', 'nodes', 'meshes', 'buffers', 'bufferViews', 'accessors']);
  const asset = row(root.asset, ['version', 'extras']); need(asset.version === '2.0', 'glTF version');
  const extras = row(asset.extras, ['houseatlasIfcDerivative']);
  const lineage = row(extras.houseatlasIfcDerivative, ['profile', 'originalSha256', 'originalBytes', 'floorLabel',
    'sourceUnits', 'sourceUpAxis', 'glbUnits', 'glbUpAxis', 'sourceToGlb', 'converter']);
  need(lineage.profile === IFC_GLB_PROFILE && lineage.sourceUnits === 'mm' && lineage.sourceUpAxis === 'Z'
    && lineage.glbUnits === 'm' && lineage.glbUpAxis === 'Y', 'lineage profile and axes');
  const transform = row(lineage.sourceToGlb, ['axisMap', 'scale']);
  const axisMap = list(transform.axisMap, 3);
  need(axisMap.length === 3 && axisMap[0] === 'x' && axisMap[1] === 'z' && axisMap[2] === '-y'
    && isExactDecimal(transform.scale) && transform.scale.compare(ExactDecimal.parse('0.001')) === 0, 'source to GLB map');
  const converter = row(lineage.converter, ['name', 'version', 'configSha256']);
  const source: IfcGlbProfile['source'] = {
    originalSHA256: digest(lineage.originalSha256), originalBytes: ExactDecimal.parse(String(number(lineage.originalBytes, 10 * 1024 * 1024, 1))),
    floorLabel: name(lineage.floorLabel), sourceUnits: 'mm', sourceUpAxis: 'Z', glbUnits: 'm', glbUpAxis: 'Y',
    sourceToGlb: { axisMap: ['x', 'z', '-y'], scale: 0.001 },
    converter: { name: name(converter.name), version: name(converter.version), configSha256: digest(converter.configSha256) },
  };
  need(number(root.scene, 0) === 0, 'single scene');
  const scenes = list(root.scenes, 1); need(scenes.length === 1, 'single scene');
  const nodes = list(root.nodes, MAX_MESHES), rawMeshes = list(root.meshes, MAX_MESHES);
  need(nodes.length === rawMeshes.length && nodes.length > 0, 'mesh/node count');
  const scene = row(scenes[0], ['nodes']); const sceneNodes = list(scene.nodes, MAX_MESHES);
  need(sceneNodes.length === nodes.length && sceneNodes.every((value, i) => number(value, MAX_MESHES - 1) === i), 'scene nodes');
  const buffers = list(root.buffers, 1); need(buffers.length === 1, 'single embedded buffer');
  const buffer = row(buffers[0], ['byteLength']); const declaredBin = number(buffer.byteLength, binLength, 1);
  need(binLength - declaredBin <= 3 && bytes.subarray(binStart + declaredBin).every(byte => byte === 0), 'BIN padding');
  const views = list(root.bufferViews, MAX_MESHES * 2).map(value => {
    const part = row(value, ['buffer', 'byteOffset', 'byteLength']);
    need(number(part.buffer, 0) === 0, 'buffer index');
    const offset = number(part.byteOffset, declaredBin), length = number(part.byteLength, declaredBin, 1);
    need(offset % 4 === 0 && offset + length <= declaredBin, 'buffer view bounds'); return { offset, length };
  });
  const orderedViews = [...views].sort((left, right) => left.offset - right.offset);
  let covered = 0;
  for (const part of orderedViews) {
    need(part.offset >= covered && part.offset - covered <= 3
      && bytes.subarray(binStart + covered, binStart + part.offset).every(byte => byte === 0), 'binary view coverage');
    covered = part.offset + part.length;
  }
  need(declaredBin - covered <= 3 && bytes.subarray(binStart + covered, binStart + declaredBin).every(byte => byte === 0), 'binary trailing padding');
  const accessors = list(root.accessors, MAX_MESHES * 2).map(value => {
    const part = row(value, ['bufferView', 'componentType', 'count', 'type']);
    const index = number(part.bufferView, views.length - 1), count = number(part.count, MAX_VERTICES, 1);
    const componentType = number(part.componentType, 5126, 5123);
    need(componentType === 5123 || componentType === 5125 || componentType === 5126, 'accessor component');
    need(part.type === 'VEC3' || part.type === 'SCALAR', 'accessor type');
    const width = part.type === 'VEC3' ? 12 : componentType === 5123 ? 2 : 4;
    need(views[index]!.length === count * width, 'accessor exact view');
    return { index, count, componentType, type: part.type };
  });
  let totalVertices = 0, totalTriangles = 0;
  const meshes: IfcGlbProfile['meshes'][number][] = [];
  const ids = new Set<string>(), usedAccessors = new Set<number>(), usedViews = new Set<number>();
  for (let i = 0; i < rawMeshes.length; i++) {
    signal.throwIfAborted();
    const node = row(nodes[i], ['mesh', 'name']); need(number(node.mesh, rawMeshes.length - 1) === i, 'node mesh');
    const mesh = row(rawMeshes[i], ['name', 'primitives']);
    const meshName = name(mesh.name); need(name(node.name) === meshName && !ids.has(meshName), 'mesh identity'); ids.add(meshName);
    const primitives = list(mesh.primitives, 1); need(primitives.length === 1, 'one primitive per mesh');
    const primitive = row(primitives[0], ['attributes', 'indices', 'mode']); need(number(primitive.mode, 4) === 4, 'triangles only');
    const attributes = row(primitive.attributes, ['POSITION']);
    const positionIndex = number(attributes.POSITION, accessors.length - 1);
    const indicesIndex = number(primitive.indices, accessors.length - 1);
    need(positionIndex !== indicesIndex && !usedAccessors.has(positionIndex) && !usedAccessors.has(indicesIndex), 'unique accessors');
    usedAccessors.add(positionIndex); usedAccessors.add(indicesIndex);
    const positionAccessor = accessors[positionIndex]!, indexAccessor = accessors[indicesIndex]!;
    need(positionAccessor.index !== indexAccessor.index && !usedViews.has(positionAccessor.index)
      && !usedViews.has(indexAccessor.index), 'unique buffer views');
    usedViews.add(positionAccessor.index); usedViews.add(indexAccessor.index);
    need(positionAccessor.type === 'VEC3' && positionAccessor.componentType === 5126
      && indexAccessor.type === 'SCALAR' && (indexAccessor.componentType === 5123 || indexAccessor.componentType === 5125)
      && indexAccessor.count % 3 === 0, 'position/index accessor');
    totalVertices += positionAccessor.count; totalTriangles += indexAccessor.count / 3;
    need(totalVertices <= MAX_VERTICES && totalTriangles <= MAX_TRIANGLES, 'geometry totals');
    const positionView = views[positionAccessor.index]!, indexView = views[indexAccessor.index]!;
    const positions: string[] = [], indices: string[] = [];
    for (let point = 0; point < positionAccessor.count * 3; point++) {
      const value = view.getFloat32(binStart + positionView.offset + point * 4, true);
      need(Number.isFinite(value) && Math.abs(value) <= 1e9, 'position finite and bounded'); positions.push(String(value));
    }
    for (let point = 0; point < indexAccessor.count; point++) {
      const offset = binStart + indexView.offset + point * (indexAccessor.componentType === 5123 ? 2 : 4);
      const value = indexAccessor.componentType === 5123 ? view.getUint16(offset, true) : view.getUint32(offset, true);
      need(value < positionAccessor.count, 'index in bounds'); indices.push(String(value));
    }
    meshes.push({ sourceObjectId: meshName, sourceName: meshName, positionsLocalTokens: positions,
      triangleIndicesTokens: indices, composedLocalToStageMatrixTokens: ['1','0','0','0','0','1','0','0','0','0','1','0','0','0','0','1'] });
  }
  need(accessors.length === usedAccessors.size && views.length === usedViews.size, 'unreferenced binary data');
  const result: IfcGlbProfile = { profile: IFC_GLB_PROFILE, source, authoredCoordinates: { upAxis: 'Y', metersPerUnitToken: '1' },
    counts: { meshes: meshes.length, vertices: totalVertices, triangles: totalTriangles }, meshes };
  freezeProfile(result); return result;
}
