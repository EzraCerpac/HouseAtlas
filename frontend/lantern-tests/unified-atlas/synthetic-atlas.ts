/** SYNTHETIC unified Atlas publication: one generated GLB, its producer
 * companion (`houseatlas.unified-atlas-publication.v1`), the host-composed read
 * envelope and an in-page HTTPS transport. Every label, identifier, coordinate
 * and date is fictional and generated here; no real building, room, place,
 * account or source is represented.
 *
 * Shape on purpose: nested translated nodes (the loader must apply them once),
 * multi-primitive meshes, one mesh reused by two nodes, split-level floors, a
 * floor slab shared by two levels, a level-free roof, two rooms both labelled
 * "Bedroom", one room with parts on two floors, a preliminary pick area, an
 * unselectable occurrence, a context-only group listed before the buildings, a
 * ring-shaped room whose hole has the same winding as its outer edge and that
 * overlaps another room in plan, plan feature IDs listed in a different order
 * from the features, and qualified overlay bindings that all join. */

export type Vec3 = readonly [number, number, number];
type Point = readonly [number, number];
interface Primitive { readonly positions: readonly number[]; readonly indices: readonly number[] }
interface GlbNode { readonly name: string; readonly mesh?: number; readonly children?: readonly number[]; readonly translation?: Vec3 }

// ---------------------------------------------------------------------------
// Geometry

function box(min: Vec3, max: Vec3): Primitive {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const corners = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
  return { positions: corners.flat(), indices: faces.flatMap(([a, b, c, d]) => [a!, b!, c!, a!, c!, d!]) };
}
function merge(...parts: readonly Primitive[]): Primitive {
  const positions: number[] = [], indices: number[] = [];
  for (const part of parts) { const base = positions.length / 3; positions.push(...part.positions); indices.push(...part.indices.map(index => index + base)); }
  return { positions, indices };
}
/** Four wall slabs just inside a footprint. */
function walls(min: Vec3, max: Vec3, t = 0.15): Primitive {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  return merge(box([x0, y0, z0], [x1, y1, z0 + t]), box([x0, y0, z1 - t], [x1, y1, z1]),
    box([x0, y0, z0 + t], [x0 + t, y1, z1 - t]), box([x1 - t, y0, z0 + t], [x1, y1, z1 - t]));
}
/** World-frame geometry moved into the local frame of a node at `offset`. */
const local = (primitive: Primitive, offset: Vec3): Primitive =>
  ({ positions: primitive.positions.map((value, at) => value - offset[at % 3]!), indices: primitive.indices });

const pad = (length: number) => (4 - length % 4) % 4;
/** Embedded-BIN glTF 2.0 binary; every mesh may hold several primitives. */
export function buildAtlasGlb(nodes: readonly GlbNode[], meshes: readonly (readonly Primitive[])[], roots: readonly number[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [], bufferViews: object[] = [], accessors: object[] = [];
  let offset = 0;
  const push = (bytes: Uint8Array, target: number) => {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    parts.push(bytes, new Uint8Array(pad(bytes.byteLength))); offset += bytes.byteLength + pad(bytes.byteLength);
    return bufferViews.length - 1;
  };
  const gltfMeshes = meshes.map(primitives => ({ primitives: primitives.map(primitive => {
    const positions = Float32Array.from(primitive.positions), count = positions.length / 3;
    const min = [0, 1, 2].map(axis => Math.min(...positions.filter((_, i) => i % 3 === axis)));
    const max = [0, 1, 2].map(axis => Math.max(...positions.filter((_, i) => i % 3 === axis)));
    accessors.push({ bufferView: push(new Uint8Array(positions.buffer), 34962), componentType: 5126, count, type: 'VEC3', min, max });
    const position = accessors.length - 1;
    accessors.push({ bufferView: push(new Uint8Array(Uint16Array.from(primitive.indices).buffer), 34963), componentType: 5123,
      count: primitive.indices.length, type: 'SCALAR' });
    return { attributes: { POSITION: position }, indices: accessors.length - 1, mode: 4 };
  }) }));
  const json = {
    asset: { version: '2.0', generator: 'HouseAtlas synthetic unified Atlas generator', copyright: 'Synthetic; no real place' },
    scene: 0, scenes: [{ nodes: roots }], nodes, meshes: gltfMeshes, accessors, bufferViews, buffers: [{ byteLength: offset }],
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonChunk = new Uint8Array(text.byteLength + pad(text.byteLength)).fill(0x20); jsonChunk.set(text);
  const bin = new Uint8Array(offset); let at = 0; for (const part of parts) { bin.set(part, at); at += part.byteLength; }
  const total = 12 + 8 + jsonChunk.byteLength + 8 + offset;
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk.byteLength, true); view.setUint32(16, 0x4e4f534a, true); out.set(jsonChunk, 20);
  const binAt = 20 + jsonChunk.byteLength; view.setUint32(binAt, offset, true); view.setUint32(binAt + 4, 0x004e4942, true); out.set(bin, binAt + 8);
  return out;
}

// ---------------------------------------------------------------------------
// The generated publication

export const SYNTHETIC_ATLAS = Object.freeze({
  publicationId: '00000000-0000-4000-8000-0000000a7150',
  sourceRevisionId: 'syn-source-revision-1',
  revision: 'fixture-7',
  origin: 'https://atlas-fixture.invalid',
});
const PLACE = (n: number) => `00000000-0000-4000-8000-0000000a71${n.toString(16).padStart(2, '0')}`;
const RECEIPT = 'c'.repeat(64);

// World offsets: Site (100,0,50) > House (+2,0,+1) > Room picks (+1,0,+1); Site > Studio (+20,0,0).
// The reused lamp mesh lands at (100.5, 0, 50.5) and (119, 0, 56).
const HOUSE: Vec3 = [102, 0, 51], PICKS: Vec3 = [103, 0, 52], STUDIO: Vec3 = [120, 0, 50];
const ROOM_HEIGHT = 2.4;

interface OccurrenceSpec {
  readonly id: string; readonly roomId: string; readonly buildingId: string; readonly levelId: string;
  readonly min: Point; readonly max: Point; readonly floor: number;
  readonly estimated?: boolean; readonly selectable?: boolean;
  /** A plan hole, wound the same way as the outer edge. */
  readonly hole?: readonly [Point, Point];
  /** A plan point inside the room when its centre lies in its hole. */
  readonly probe?: Point;
}
/** Split levels: Ground at 0 m and Upper at 2.8 m over one half; Split at 1.4 m over the other. */
export const SYNTHETIC_OCCURRENCES: readonly OccurrenceSpec[] = [
  { id: 'syn-occ-hall', roomId: 'syn-room-hall', buildingId: 'syn-building-house', levelId: 'syn-level-ground', min: [102, 51], max: [104.5, 59], floor: 0 },
  { id: 'syn-occ-living', roomId: 'syn-room-living', buildingId: 'syn-building-house', levelId: 'syn-level-ground', min: [104.5, 51], max: [107, 55], floor: 0 },
  { id: 'syn-occ-stairs-ground', roomId: 'syn-room-stairs', buildingId: 'syn-building-house', levelId: 'syn-level-ground', min: [104.5, 55], max: [107, 59], floor: 0 },
  { id: 'syn-occ-bedroom-split', roomId: 'syn-room-bedroom-a', buildingId: 'syn-building-house', levelId: 'syn-level-split', min: [107, 51], max: [112, 55], floor: 1.4 },
  { id: 'syn-occ-study', roomId: 'syn-room-study', buildingId: 'syn-building-house', levelId: 'syn-level-split', min: [107, 55], max: [112, 59], floor: 1.4, estimated: true },
  { id: 'syn-occ-bedroom-upper', roomId: 'syn-room-bedroom-b', buildingId: 'syn-building-house', levelId: 'syn-level-upper', min: [102, 51], max: [104.5, 59], floor: 2.8 },
  { id: 'syn-occ-bath', roomId: 'syn-room-bath', buildingId: 'syn-building-house', levelId: 'syn-level-upper', min: [104.5, 51], max: [107, 55], floor: 2.8 },
  { id: 'syn-occ-stairs-upper', roomId: 'syn-room-stairs', buildingId: 'syn-building-house', levelId: 'syn-level-upper', min: [104.5, 55], max: [107, 59], floor: 2.8 },
  { id: 'syn-occ-void', roomId: 'syn-room-void', buildingId: 'syn-building-house', levelId: 'syn-level-upper', min: [104.5, 55], max: [107, 59], floor: 5.2, selectable: false },
  { id: 'syn-occ-studio', roomId: 'syn-room-studio', buildingId: 'syn-building-studio', levelId: 'syn-level-studio', min: [120, 50], max: [126, 55], floor: 0 },
  // 30 m² outer less a 12 m² hole: 18 m², inside the studio's 30 m² outline in plan.
  { id: 'syn-occ-gallery', roomId: 'syn-room-gallery', buildingId: 'syn-building-studio', levelId: 'syn-level-studio', min: [120, 50], max: [126, 55], floor: 0,
    hole: [[121, 51], [125, 54]], probe: [120.5, 52.5] },
];
const PICKED = SYNTHETIC_OCCURRENCES.filter(row => row.selectable !== false && row.buildingId === 'syn-building-house');
const pickBox = (row: OccurrenceSpec) => box([row.min[0] + 0.1, row.floor + 0.02, row.min[1] + 0.1], [row.max[0] - 0.1, row.floor + ROOM_HEIGHT, row.max[1] - 0.1]);
/** A low ring pick that follows a holed room's band. */
const ringPick = (row: OccurrenceSpec) => walls([row.min[0] + 0.1, row.floor + 0.02, row.min[1] + 0.1], [row.max[0] - 0.1, row.floor + 0.3, row.max[1] - 0.1],
  row.hole![0][0] - row.min[0] - 0.1);
const occurrence = (id: string) => SYNTHETIC_OCCURRENCES.find(row => row.id === id)!;
const SITE: Vec3 = [100, 0, 50];

const NODES: readonly GlbNode[] = [
  { name: 'Site', translation: [100, 0, 50], children: [1, 6, 10] },
  { name: 'House', translation: [2, 0, 1], children: [2, 3, 4, 5] },
  { name: 'House structure', mesh: 0 },
  { name: 'House roof', mesh: 1 },
  { name: 'House rooms', mesh: 2, translation: [1, 0, 1] },
  { name: 'Lamp', mesh: 3, translation: [-1.5, 0, -0.5] },
  { name: 'Studio', translation: [20, 0, 0], children: [7, 8, 9] },
  { name: 'Studio structure', mesh: 4 },
  { name: 'Studio room', mesh: 5 },
  { name: 'Lamp', mesh: 3, translation: [-1, 0, 6] },
  { name: 'Boundary wall', mesh: 6 },
];
const MESHES: readonly (readonly Primitive[])[] = [
  [
    walls([102, 0, 51], [107, 2.6, 59]), walls([107, 1.4, 51], [112, 4, 59]), walls([102, 2.8, 51], [107, 5.4, 59]),
    box([102, -0.2, 51], [107, 0, 59]), box([102, 2.6, 51], [107, 2.8, 59]), box([107, 1.2, 51], [112, 1.4, 59]),
  ].map(primitive => local(primitive, HOUSE)),
  [local(box([101.8, 5.4, 50.8], [112.2, 5.7, 59.2]), HOUSE)],
  PICKED.map(row => local(pickBox(row), PICKS)),
  // Reused by two nodes; each use is a separate drawn primitive.
  [box([-0.1, 0, -0.1], [0.1, 1, 0.1])],
  [walls([120, 0, 50], [126, 3, 55]), box([120, -0.2, 50], [126, 0, 55])].map(primitive => local(primitive, STUDIO)),
  [local(pickBox(occurrence('syn-occ-studio')), STUDIO), local(ringPick(occurrence('syn-occ-gallery')), STUDIO)],
  // A context-only group with no floors: drawn, never navigated.
  [local(box([96, 0, 46], [130, 1.2, 46.3]), SITE)],
];
export const SYNTHETIC_ATLAS_DRAWN_PRIMITIVES = MESHES[0]!.length + MESHES[1]!.length + MESHES[2]!.length + 2 + MESHES[4]!.length + MESHES[5]!.length
  + MESHES[6]!.length;

const rect = (min: Point, max: Point): Point[] => [[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]];
const inset = (min: Point, max: Point, t: number): Point[] => rect([min[0] + t, min[1] + t], [max[0] - t, max[1] - t]);
const bounds = (min: Vec3, max: Vec3) => ({ min, max });

function plan(levelId: string, buildingId: string, outline: readonly [Point, Point], extra: readonly object[], reordered = false) {
  const rooms = SYNTHETIC_OCCURRENCES.filter(row => row.levelId === levelId && row.selectable !== false).map(row => ({
    featureId: `syn-feature-${row.id.slice(8)}`, roomId: row.roomId, spaceOccurrenceId: row.id, role: 'room',
    polygons: [{ outer: rect(row.min, row.max), holes: row.hole ? [rect(row.hole[0], row.hole[1])] : [] }],
  }));
  // The outer wall is one polygon with the interior as its hole.
  const wall = { featureId: `syn-feature-walls-${levelId.slice(10)}`, roomId: null, spaceOccurrenceId: null, role: 'wall',
    polygons: [{ outer: rect(outline[0], outline[1]), holes: [inset(outline[0], outline[1], 0.15)] }] };
  const features = [...rooms, wall, ...extra];
  const featureIds = features.map(feature => (feature as { featureId: string }).featureId);
  // The same set in another order is equally valid.
  return { planId: `syn-plan-${levelId.slice(10)}`, buildingId, levelId, coordinates: 'scene-XZ-metres',
    featureIds: reordered ? featureIds.reverse() : featureIds, features };
}
const stair = (id: string) => ({ featureId: id, roomId: null, spaceOccurrenceId: null, role: 'stair', polygons: [{ outer: rect([104.8, 55.3], [106.7, 58.7]), holes: [] }] });

const occurrenceIds = (levelId: string) => SYNTHETIC_OCCURRENCES.filter(row => row.levelId === levelId).map(row => row.id);
const roomOccurrences = (roomId: string) => SYNTHETIC_OCCURRENCES.filter(row => row.roomId === roomId).map(row => row.id);
const room = (roomId: string, buildingId: string, label: string, status: 'reviewed' | 'historical' | 'unmapped', place: number | null) =>
  ({ roomId, buildingId, label, nativePlaceId: place === null ? null : PLACE(place),
    nativeBinding: { status, receiptSha256: status === 'unmapped' ? null : RECEIPT }, occurrenceIds: roomOccurrences(roomId) });
const overlay = (kind: 'electrical' | 'network', roomId: string, place: number | null, recordIds: readonly string[], extra: Readonly<Record<string, unknown>> = {}) => ({
  publicationId: SYNTHETIC_ATLAS.publicationId, kind, sourceRevision: kind === 'electrical' ? 'syn-electrical-3' : 'syn-network-12',
  sourceUpdatedAt: '2026-01-02T09:00:00Z', retrievedAt: '2026-01-03T10:15:00Z', roomId, spaceOccurrenceId: null,
  nativePlaceId: place === null ? null : PLACE(place), recordIds, anchor: { kind: 'room-summary' }, ...extra,
});

/** Producer companion for one scope; `original` pins the generated GLB. */
export async function buildSyntheticAtlas(scope: Readonly<{ workspaceId: string; homeId: string }>) {
  const glb = buildAtlasGlb(NODES, MESHES, [0]);
  const house = 'syn-building-house', studio = 'syn-building-studio', boundary = 'syn-building-boundary';
  const meshBindings = [
    ...[['syn-level-ground'], ['syn-level-split'], ['syn-level-upper']].map((levelIds, at) =>
      ({ artifactId: 'model', nodeIndex: 2, meshIndex: 0, primitiveIndices: [at], buildingId: house, levelIds, spaceOccurrenceId: null, role: 'structure' })),
    { artifactId: 'model', nodeIndex: 2, meshIndex: 0, primitiveIndices: [3], buildingId: house, levelIds: ['syn-level-ground'], spaceOccurrenceId: null, role: 'slab' },
    // One slab carries the ground ceiling and the upper floor: shared, never lifted.
    { artifactId: 'model', nodeIndex: 2, meshIndex: 0, primitiveIndices: [4], buildingId: house, levelIds: ['syn-level-ground', 'syn-level-upper'], spaceOccurrenceId: null, role: 'slab' },
    { artifactId: 'model', nodeIndex: 2, meshIndex: 0, primitiveIndices: [5], buildingId: house, levelIds: ['syn-level-split'], spaceOccurrenceId: null, role: 'slab' },
    { artifactId: 'model', nodeIndex: 3, meshIndex: 1, primitiveIndices: [0], buildingId: house, levelIds: [], spaceOccurrenceId: null, role: 'roof' },
    ...PICKED.map((row, at) => ({ artifactId: 'model', nodeIndex: 4, meshIndex: 2, primitiveIndices: [at], buildingId: house,
      levelIds: [row.levelId], spaceOccurrenceId: row.id, role: 'room-pick' })),
    { artifactId: 'model', nodeIndex: 5, meshIndex: 3, primitiveIndices: [0], buildingId: house, levelIds: [], spaceOccurrenceId: null, role: 'context' },
    { artifactId: 'model', nodeIndex: 7, meshIndex: 4, primitiveIndices: [0], buildingId: studio, levelIds: ['syn-level-studio'], spaceOccurrenceId: null, role: 'structure' },
    { artifactId: 'model', nodeIndex: 7, meshIndex: 4, primitiveIndices: [1], buildingId: studio, levelIds: ['syn-level-studio'], spaceOccurrenceId: null, role: 'slab' },
    { artifactId: 'model', nodeIndex: 8, meshIndex: 5, primitiveIndices: [0], buildingId: studio, levelIds: ['syn-level-studio'], spaceOccurrenceId: 'syn-occ-studio', role: 'room-pick' },
    { artifactId: 'model', nodeIndex: 8, meshIndex: 5, primitiveIndices: [1], buildingId: studio, levelIds: ['syn-level-studio'], spaceOccurrenceId: 'syn-occ-gallery', role: 'room-pick' },
    { artifactId: 'model', nodeIndex: 9, meshIndex: 3, primitiveIndices: [0], buildingId: studio, levelIds: [], spaceOccurrenceId: null, role: 'context' },
    { artifactId: 'model', nodeIndex: 10, meshIndex: 6, primitiveIndices: [0], buildingId: boundary, levelIds: [], spaceOccurrenceId: null, role: 'context' },
  ];
  const companion = {
    profile: 'houseatlas.unified-atlas-publication.v1', scope,
    publicationId: SYNTHETIC_ATLAS.publicationId, sourceRevisionId: SYNTHETIC_ATLAS.sourceRevisionId, sourceSha256: 'd'.repeat(64),
    original: { sha256: await sha256Hex(glb), bytes: glb.byteLength },
    frame: { units: 'm', upAxis: 'Y', horizontalAxes: ['X', 'Z'], geometryPlacement: 'gltf-world-after-node-transforms-once', physicalRegistration: null },
    buildings: [
      // Listed first and without floors: context around the buildings, never a floor stop.
      { buildingId: boundary, label: 'Synthetic boundary wall', nativePlaceId: null, bounds: bounds([96, 0, 46], [130, 1.2, 46.3]), levelIds: [] },
      { buildingId: house, label: 'Synthetic house', nativePlaceId: PLACE(1), bounds: bounds([100.4, -0.2, 50.4], [112.2, 5.7, 59.2]),
        levelIds: ['syn-level-ground', 'syn-level-split', 'syn-level-upper'] },
      { buildingId: studio, label: 'Synthetic studio', nativePlaceId: null, bounds: bounds([118.9, -0.2, 50], [126, 3, 56.1]), levelIds: ['syn-level-studio'] },
    ],
    levels: [
      // Listed out of height order: order comes from the scene heights.
      { levelId: 'syn-level-upper', buildingId: house, label: 'Upper floor', nativePlaceId: PLACE(4), sourceElevationM: 2.8,
        elevationBasis: 'Generated storey elevation', occurrenceIds: occurrenceIds('syn-level-upper'), bounds: bounds([102, 2.6, 51], [107, 5.4, 59]) },
      { levelId: 'syn-level-ground', buildingId: house, label: 'Ground floor', nativePlaceId: PLACE(2), sourceElevationM: 0,
        elevationBasis: 'Generated storey elevation', occurrenceIds: occurrenceIds('syn-level-ground'), bounds: bounds([102, -0.2, 51], [107, 2.8, 59]) },
      { levelId: 'syn-level-split', buildingId: house, label: 'Split level', nativePlaceId: null, sourceElevationM: 1.4,
        elevationBasis: 'Generated storey elevation', occurrenceIds: occurrenceIds('syn-level-split'), bounds: bounds([107, 1.2, 51], [112, 4, 59]) },
      { levelId: 'syn-level-studio', buildingId: studio, label: 'Studio floor', nativePlaceId: null, sourceElevationM: null,
        elevationBasis: null, occurrenceIds: occurrenceIds('syn-level-studio'), bounds: bounds([120, -0.2, 50], [126, 3, 55]) },
    ],
    rooms: [
      room('syn-room-hall', house, 'Hall', 'reviewed', 10), room('syn-room-living', house, 'Living room', 'reviewed', 11),
      room('syn-room-stairs', house, 'Stairs', 'reviewed', 12), room('syn-room-bedroom-a', house, 'Bedroom', 'historical', 13),
      room('syn-room-study', house, 'Study', 'unmapped', null), room('syn-room-bedroom-b', house, 'Bedroom', 'reviewed', 14),
      room('syn-room-bath', house, 'Bathroom', 'reviewed', 15), room('syn-room-void', house, 'Loft void', 'unmapped', null),
      room('syn-room-studio', studio, 'Studio', 'unmapped', null), room('syn-room-gallery', studio, 'Gallery', 'unmapped', null),
    ],
    occurrences: SYNTHETIC_OCCURRENCES.map(row => ({
      spaceOccurrenceId: row.id, roomId: row.roomId, buildingId: row.buildingId, levelId: row.levelId,
      bounds: bounds([row.min[0], row.floor, row.min[1]], [row.max[0], row.floor + (row.selectable === false ? 0.2 : ROOM_HEIGHT), row.max[1]]),
      planFeatureIds: row.selectable === false ? [] : [`syn-feature-${row.id.slice(8)}`],
      geometryBasis: row.estimated
        ? { kind: 'owner-estimated-pick-proxy', sourceRef: null, note: 'Synthetic preliminary pick area; no outline in the generated source.' }
        : { kind: 'source-model', sourceRef: `syn-space-${row.id.slice(8)}`, note: null },
    })),
    meshBindings,
    plans: [
      plan('syn-level-ground', house, [[102, 51], [107, 59]], [stair('syn-feature-stair-ground'),
        { featureId: 'syn-feature-door-ground', roomId: null, spaceOccurrenceId: null, role: 'opening', polygons: [{ outer: rect([103, 50.95], [104, 51.2]), holes: [] }] }]),
      plan('syn-level-split', house, [[107, 51], [112, 59]], [], true),
      plan('syn-level-upper', house, [[102, 51], [107, 59]], [stair('syn-feature-stair-upper')]),
      plan('syn-level-studio', studio, [[120, 50], [126, 55]], [
        { featureId: 'syn-feature-terrace', roomId: null, spaceOccurrenceId: null, role: 'context', polygons: [{ outer: rect([120, 55], [126, 57]), holes: [] }] }]),
    ],
    // Qualified bindings only: this publication, a reviewed room and its own native place.
    // Rooms without a reviewed link simply carry no binding here.
    overlayBindings: [
      overlay('electrical', 'syn-room-hall', 10, ['syn-circuit-1', 'syn-outlet-1', 'syn-outlet-2']),
      overlay('electrical', 'syn-room-living', 11, ['syn-outlet-3'], { spaceOccurrenceId: 'syn-occ-living',
        anchor: { kind: 'source-position', position: [105.6, 0.3, 52.2], basis: 'Generated outlet position' } }),
      // Joined on both parts of the two-floor room; its source update date is unknown.
      overlay('network', 'syn-room-stairs', 12, ['syn-access-point-1'], { sourceUpdatedAt: null }),
    ],
    coverage: {
      selectableOccurrences: SYNTHETIC_OCCURRENCES.filter(row => row.selectable !== false).map(row => row.id),
      unselectableOccurrences: ['syn-occ-void'],
      exclusions: [{ spaceOccurrenceId: 'syn-occ-void', reason: 'No floor outline in the generated source.' }],
    },
  };
  return { glb, companion, companionBytes: new TextEncoder().encode(JSON.stringify(companion)) };
}

// ---------------------------------------------------------------------------
// Host composition and in-page transport (fixture stand-ins for the backend)

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const base64 = (bytes: Uint8Array) => { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text); };
export const atlasScenePath = (scope: Readonly<{ workspaceId: string; homeId: string }>) =>
  `/api/atlas/models/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/atlas`;

/** Adds the host's selection revision, pins and read href to companion bytes.
 * The GLB must be the companion's pinned original. */
export async function composeAtlasEnvelope(companionBytes: Uint8Array<ArrayBuffer>, glb: Uint8Array<ArrayBuffer>, revision: string) {
  const companion = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(companionBytes)) as Record<string, unknown> & {
    profile: string; scope: { workspaceId: string; homeId: string }; publicationId: string; sourceRevisionId: string; sourceSha256: string;
    original: { sha256: string; bytes: number };
  };
  if (companion.profile !== 'houseatlas.unified-atlas-publication.v1') throw new Error('Not a unified Atlas companion');
  const sha256 = await sha256Hex(glb);
  if (companion.original.sha256 !== sha256 || companion.original.bytes !== glb.byteLength) throw new Error('The model file is not the companion original');
  const { publicationId, scope } = companion;
  const href = `${atlasScenePath(scope)}/${publicationId}/artifacts/model?expectedSha256=${sha256}&expectedSelectionRevision=${encodeURIComponent(revision)}`;
  const envelope = {
    profile: 'houseatlas.unified-atlas-scene.v1', scope, selection: { revision, publicationId },
    publication: { publicationId, sourceRevisionId: companion.sourceRevisionId, sourceSha256: companion.sourceSha256,
      semanticsSha256: await sha256Hex(companionBytes) },
    frame: companion.frame, artifacts: [{ artifactId: 'model', role: 'model', contentType: 'model/gltf-binary', bytes: glb.byteLength, sha256, href }],
    buildings: companion.buildings, levels: companion.levels, rooms: companion.rooms, occurrences: companion.occurrences,
    meshBindings: companion.meshBindings, plans: companion.plans, overlayBindings: companion.overlayBindings, coverage: companion.coverage,
  };
  return { envelope, envelopeBytes: new TextEncoder().encode(JSON.stringify(envelope)), href, sha256, scope, publicationId };
}

/** Same-origin fake for the two GET routes, with the production headers. */
export function createAtlasTransport(options: {
  readonly origin: string; readonly scenePath: string; readonly envelopeBytes: Uint8Array<ArrayBuffer>;
  readonly href: string; readonly glb: Uint8Array<ArrayBuffer>; readonly sha256: string; readonly revision: string;
  readonly onRequest?: (url: string) => void;
}): typeof fetch {
  const common = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  const digest = `sha-256=:${base64(Uint8Array.from(options.sha256.match(/../g)!, pair => parseInt(pair, 16)))}:`;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    options.onRequest?.(url);
    if (init?.method !== 'GET' || init.credentials !== 'same-origin' || init.redirect !== 'error' || init.cache !== 'no-store')
      return new Response(null, { status: 400 });
    init.signal?.throwIfAborted();
    if (url === `${options.origin}${options.scenePath}`)
      return new Response(options.envelopeBytes.slice(), { headers: { ...common, 'content-type': 'application/json',
        'content-length': String(options.envelopeBytes.byteLength), 'x-atlas-selection-revision': options.revision } });
    if (url === `${options.origin}${options.href}`)
      return new Response(options.glb.slice(), { headers: { ...common, 'content-type': 'model/gltf-binary',
        'content-length': String(options.glb.byteLength), 'x-atlas-selection-revision': options.revision, 'content-digest': digest } });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}
