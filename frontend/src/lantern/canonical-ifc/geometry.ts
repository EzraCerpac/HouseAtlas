import type { AdmittedPresentation, PlanRing, PlanShape } from './model';

/** One orthographic camera over the shared renderer frame. Plan and 3D are
 * poses of this camera; SVG, WebGL and picking all use it. */
export interface Bounds { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }
export interface CameraPose { readonly yaw: number; readonly pitch: number; readonly zoom: number; readonly panX: number; readonly panY: number }
export interface Viewport { readonly width: number; readonly height: number }

export interface Projection {
  readonly ct: number; readonly st: number; readonly sf: number; readonly cf: number;
  /** Pixels per metre. */
  readonly k: number;
  readonly ox: number; readonly oy: number;
  readonly center: readonly [number, number, number];
  readonly depthRadius: number;
  readonly viewport: Viewport;
  /** Pixel position and depth (larger is nearer the viewer). */
  project(x: number, y: number, z: number): readonly [number, number, number];
  /** Full-precision SVG matrix for plan coordinates RELATIVE to `center`
   * (see relativePath) at height y. Small relative values keep SVG float
   * transforms exact for far-from-origin models. */
  planMatrix(y: number): string;
}

const DEG = Math.PI / 180;

/** Core glTF baseColorFactor, in linear RGB. Presentation metadata only;
 * alpha is retained, but this preview does not implement source transparency. */
export type SourceBaseColor = readonly [number, number, number, number];

/** Read only an explicit bounded factor through the exact drawn primitive.
 * Names and extras never supply appearance or binding. Absent factors retain
 * the existing viewer palette; no loader-default white is manufactured. */
export function primitiveBaseColor(json: Record<string, unknown>, meshIndex: number | null, primitiveIndex: number | null): SourceBaseColor | undefined {
  if (meshIndex === null || primitiveIndex === null || !Array.isArray(json.meshes) || !Array.isArray(json.materials)) return;
  const materialIndex: unknown = json.meshes[meshIndex]?.primitives?.[primitiveIndex]?.material;
  if (!Number.isInteger(materialIndex) || (materialIndex as number) < 0) return;
  const factor: unknown = json.materials[materialIndex as number]?.pbrMetallicRoughness?.baseColorFactor;
  if (!Array.isArray(factor) || factor.length !== 4 || !factor.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)) return;
  return Object.freeze([...factor]) as unknown as SourceBaseColor;
}

/** Source appearance never displaces an explicit selection, reference or
 * relation highlight. Other viewers opt out and keep their existing tones. */
export function sourceMeshColor(mesh: Pick<PreparedMesh, 'sourceBaseColor' | 'occurrenceId'>, state: {
  readonly enabled: boolean | undefined; readonly selected: boolean; readonly reference: boolean;
  readonly selectedOccurrenceId: string | null; readonly contextOccurrenceIds: readonly string[]; readonly tints: ReadonlyMap<string, string>;
}): SourceBaseColor | undefined {
  if (!state.enabled || state.selected || state.reference) return;
  const id = mesh.occurrenceId;
  if (id !== null && (id === state.selectedOccurrenceId || state.contextOccurrenceIds.includes(id) || state.tints.has(id))) return;
  return mesh.sourceBaseColor;
}

/** Mesh input common to canonical and local-preview geometry. */
export interface MeshInput {
  readonly meshKey: string;
  readonly floorId: string | null;
  readonly occurrenceId: string | null;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly sourceBaseColor?: SourceBaseColor;
}

/** Non-indexed triangles with flat normals; only index-referenced vertices exist here. */
export interface PreparedMesh {
  readonly meshKey: string;
  readonly floorId: string | null;
  readonly occurrenceId: string | null;
  /** Interleaved position(3) + normal(3). */
  readonly vertices: Float32Array;
  readonly triangles: number;
  readonly yRange: readonly [number, number];
  readonly bounds: Bounds;
  readonly sourceBaseColor?: SourceBaseColor;
}

export function prepareMeshes(meshes: readonly MeshInput[], binding: (mesh: MeshInput) => string | null = mesh => mesh.occurrenceId): readonly PreparedMesh[] {
  return meshes.map(mesh => {
    const triangles = mesh.indices.length / 3, vertices = new Float32Array(triangles * 18);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const p = mesh.positions, at = (t: number, corner: number) => mesh.indices[t * 3 + corner]! * 3;
    for (let t = 0; t < triangles; t++) {
      const a = at(t, 0), b = at(t, 1), c = at(t, 2);
      const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
      const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (length > 0) { nx /= length; ny /= length; nz /= length; } else { nx = 0; ny = 1; nz = 0; }
      for (const [corner, index] of [a, b, c].entries()) {
        const o = (t * 3 + corner) * 6;
        vertices[o] = p[index]!; vertices[o + 1] = p[index + 1]!; vertices[o + 2] = p[index + 2]!;
        vertices[o + 3] = nx; vertices[o + 4] = ny; vertices[o + 5] = nz;
        for (let axis = 0; axis < 3; axis++) { const v = p[index + axis]!; if (v < min[axis]!) min[axis] = v; if (v > max[axis]!) max[axis] = v; }
      }
    }
    return { meshKey: mesh.meshKey, floorId: mesh.floorId, occurrenceId: binding(mesh), vertices, triangles,
      ...(mesh.sourceBaseColor ? { sourceBaseColor: mesh.sourceBaseColor } : {}),
      yRange: [min[1]!, max[1]!], bounds: { min: [min[0]!, min[1]!, min[2]!], max: [max[0]!, max[1]!, max[2]!] } };
  });
}

/** Drawn-geometry bounds (prepared meshes plus plan rings) for one floor, or all when floorId is null. */
export function drawnBounds(meshes: readonly PreparedMesh[], shapes: readonly (readonly PlanRing[])[], floorId: string | null): Bounds | null {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    if (floorId !== null && mesh.floorId !== floorId) continue;
    for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis]!, mesh.bounds.min[axis]!); max[axis] = Math.max(max[axis]!, mesh.bounds.max[axis]!); }
  }
  for (const rings of shapes) for (const ring of rings) for (const [x, z] of ring) {
    min[0] = Math.min(min[0]!, x); max[0] = Math.max(max[0]!, x); min[2] = Math.min(min[2]!, z); max[2] = Math.max(max[2]!, z);
  }
  if (!Number.isFinite(min[0]!) || !Number.isFinite(min[2]!)) return null;
  if (!Number.isFinite(min[1]!)) { min[1] = 0; max[1] = 0; }
  return { min: [min[0]!, min[1]!, min[2]!], max: [max[0]!, max[1]!, max[2]!] };
}

/** Plan feature rings of a floor (all roles), for bounds. */
export function floorPlanRings(model: AdmittedPresentation, floorId: string | null): readonly (readonly PlanRing[])[] {
  return model.source.floors.filter(floor => floorId === null || floor.floorId === floorId)
    .flatMap(floor => (floor.plan?.features ?? []).map(feature => feature.rings));
}

/** planBlend 0 = 3D fit (rotation-invariant sphere), 1 = plan fit (x/z extent). */
export function makeProjection(pose: CameraPose, bounds: Bounds, viewport: Viewport, planBlend: number): Projection {
  const ct = Math.cos(pose.yaw * DEG), st = Math.sin(pose.yaw * DEG);
  const sf = Math.sin(pose.pitch * DEG), cf = Math.max(0, Math.cos(pose.pitch * DEG));
  const center = [0, 1, 2].map(axis => (bounds.min[axis]! + bounds.max[axis]!) / 2) as unknown as readonly [number, number, number];
  const span = [0, 1, 2].map(axis => Math.max(bounds.max[axis]! - bounds.min[axis]!, 1e-3));
  const radius = Math.max(Math.hypot(span[0]!, span[1]!, span[2]!) / 2, .5);
  const w = Math.max(1, viewport.width), h = Math.max(1, viewport.height);
  const margin = Math.min(w, h) < 420 ? 18 : 40;
  const fit3d = Math.max(.01, (Math.min(w, h) - margin * 2) / (radius * 2));
  const hx = span[0]! / 2, hz = span[2]! / 2;
  const sx = Math.abs(hx * ct) + Math.abs(hz * st), sy = Math.abs(hx * st) + Math.abs(hz * ct);
  const fitPlan = Math.max(.01, Math.min((w - margin * 2) / Math.max(2 * sx, 1e-3), (h - margin * 2) / Math.max(2 * sy, 1e-3)));
  const blend = Math.min(1, Math.max(0, planBlend));
  const k = (fit3d + (fitPlan - fit3d) * blend) * pose.zoom;
  const ox = w / 2 + pose.panX, oy = h / 2 + pose.panY;
  const [cx, cy, cz] = center;
  return {
    ct, st, sf, cf, k, ox, oy, center, depthRadius: radius * 1.05, viewport: { width: w, height: h },
    project(x, y, z) {
      const X = x - cx, Z = z - cz, H = y - cy;
      const rx = X * ct - Z * st, rz = X * st + Z * ct;
      return [ox + k * rx, oy + k * (rz * sf - H * cf), rz * cf + H * sf];
    },
    planMatrix(y) {
      return `matrix(${k * ct} ${k * st * sf} ${-k * st} ${k * ct * sf} ${ox} ${oy - k * (y - cy) * cf})`;
    },
  };
}

/** Extend zoom-out to retain the ordinary full frame when a presentation fit
 * magnifies and recentres it. No geometry, fitted pose or maximum is changed. */
export function frameZoomMinimum(bounds: Bounds, viewport: Viewport, pose: CameraPose, planBlend: number,
  scale: number, shift: Readonly<{ x: number; z: number }>, minimum: number): number {
  const centered: Bounds = {
    min: [bounds.min[0] - Math.abs(shift.x), bounds.min[1], bounds.min[2] - Math.abs(shift.z)],
    max: [bounds.max[0] + Math.abs(shift.x), bounds.max[1], bounds.max[2] + Math.abs(shift.z)],
  };
  const plain = { ...pose, zoom: 1 };
  return minimum * (makeProjection(plain, centered, viewport, planBlend).k
    / makeProjection(plain, bounds, viewport, planBlend).k) / Math.max(1, scale);
}

/** SVG path for rings in coordinates relative to the projection centre. */
export const relativePath = (rings: readonly PlanRing[], center: readonly [number, number, number]) =>
  rings.map(ring => `M${ring.map(([x, z]) => `${x - center[0]} ${z - center[2]}`).join('L')}Z`).join('');

function ringArea(ring: PlanRing): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; area += a[0] * b[1] - b[0] * a[1]; }
  return area / 2;
}

/** Even-odd containment within one feature's rings (holes). */
export function pointInRings(x: number, z: number, rings: readonly PlanRing[]): boolean {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!, [xj, zj] = ring[j]!;
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Union across features: the same rule the SVG draws (one even-odd path per feature). */
export const pointInShape = (x: number, z: number, shape: PlanShape) => shape.some(rings => pointInRings(x, z, rings));
const shapeArea = (shape: PlanShape) => shape.reduce((sum, rings) => sum + Math.abs(rings.reduce((inner, ring) => inner + ringArea(ring), 0)), 0);

function edgeDistance(x: number, z: number, shape: PlanShape): number {
  let best = Infinity;
  for (const rings of shape) for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j]!, [bx, bz] = ring[i]!;
    const dx = bx - ax, dz = bz - az, len = dx * dx + dz * dz;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

/** Mutable edge-visit budget shared across label searches. */
export interface WorkBudget { remaining: number }
export const LABEL_WORK = 4_000_000;

/** Label point inside an occurrence's own explicit plan shape, by bounded
 * grid refinement. Returns null when the shared edge-visit budget cannot
 * cover even a coarse search; the room stays listed and selectable. */
export function labelPoint(shape: PlanShape, budget: WorkBudget): { readonly x: number; readonly z: number; readonly clearance: number } | null {
  const edges = shape.reduce((sum, rings) => sum + rings.reduce((inner, ring) => inner + ring.length, 0), 0);
  const largest = [...shape].sort((a, b) => Math.abs(b.reduce((s, r) => s + ringArea(r), 0)) - Math.abs(a.reduce((s, r) => s + ringArea(r), 0)))[0];
  if (!largest || edges === 0) return null;
  // Each sample costs at most two passes over every edge.
  const passes = 5, perSample = edges * 2;
  const side = Math.min(9, Math.floor(Math.sqrt(budget.remaining / (passes * perSample))));
  if (side < 3) return null;
  budget.remaining -= side * side * passes * perSample;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const ring of largest) for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  let best = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, clearance: -Infinity };
  let cell = Math.max(maxX - minX, maxZ - minZ) / (side - 1), cx = best.x, cz = best.z;
  const half = (side - 1) / 2;
  for (let pass = 0; pass < passes && cell > 1e-5; pass++) {
    for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) {
      const x = cx + (i - half) * cell, z = cz + (j - half) * cell;
      if (!pointInShape(x, z, shape)) continue;
      const clearance = edgeDistance(x, z, shape);
      if (clearance > best.clearance) best = { x, z, clearance };
    }
    cx = best.x; cz = best.z; cell /= 3;
  }
  return Number.isFinite(best.clearance) ? best : null;
}

/** Floors drawn in 3D. Isolated floors show only the current one; a shared
 * frame adds floors whose drawn geometry starts below it. */
export function visibleFloorIds(model: AdmittedPresentation, currentFloorId: string | null): ReadonlySet<string> {
  const visible = new Set<string>();
  if (currentFloorId === null) return visible;
  visible.add(currentFloorId);
  if (model.source.registration.kind !== 'shared-frame') return visible;
  const current = model.floorFacts.get(currentFloorId)?.yRange ?? null;
  if (!current) return visible;
  for (const [id, facts] of model.floorFacts) if (facts.yRange && facts.yRange[0] < current[0] - 1e-3) visible.add(id);
  return visible;
}

export interface DrawRules {
  /** Floors to draw, or 'all' for unbound whole-model preview. */
  readonly visibleFloors: ReadonlySet<string> | 'all';
  /** Section plane in the shared frame; null draws full height. */
  readonly clipY: number | null;
}
export const drawsFloor = (rules: DrawRules, floorId: string | null) => rules.visibleFloors === 'all' || (floorId !== null && rules.visibleFloors.has(floorId));

export type PickResult =
  | { readonly kind: 'occurrence'; readonly occurrenceId: string; readonly meshKey: string }
  | { readonly kind: 'display-only'; readonly meshKey: string }
  | { readonly kind: 'none' };

/** CPU ray pick through the same orthographic projection as the renderer. */
export function pick(meshes: readonly PreparedMesh[], projection: Projection, rules: DrawRules, px: number, py: number): PickResult {
  let best: PickResult = { kind: 'none' }, bestDepth = -Infinity;
  for (const mesh of meshes) {
    if (!drawsFloor(rules, mesh.floorId)) continue;
    if (rules.clipY !== null && mesh.yRange[0] > rules.clipY) continue;
    const data = mesh.vertices;
    for (let t = 0; t < mesh.triangles; t++) {
      const base = t * 18;
      const a = projection.project(data[base]!, data[base + 1]!, data[base + 2]!);
      const b = projection.project(data[base + 6]!, data[base + 7]!, data[base + 8]!);
      const c = projection.project(data[base + 12]!, data[base + 13]!, data[base + 14]!);
      const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(det) < 1e-9) continue;
      const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / det;
      const l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const worldY = l1 * data[base + 1]! + l2 * data[base + 7]! + l3 * data[base + 13]!;
      if (rules.clipY !== null && worldY > rules.clipY) continue;
      const depth = l1 * a[2] + l2 * b[2] + l3 * c[2] + (mesh.occurrenceId !== null ? 1e-3 : 0);
      if (depth > bestDepth) {
        bestDepth = depth;
        best = mesh.occurrenceId !== null ? { kind: 'occurrence', occurrenceId: mesh.occurrenceId, meshKey: mesh.meshKey } : { kind: 'display-only', meshKey: mesh.meshKey };
      }
    }
  }
  return best;
}

/** Plan pick: invert the pixel to shared (x, z) and test the floor's explicit
 * occurrence shapes, smallest first so nested spaces win. */
export function planPick(model: AdmittedPresentation, floorId: string, floorY: number, projection: Projection, px: number, py: number): string | null {
  const u = (px - projection.ox) / projection.k;
  const v = (py - projection.oy + projection.k * (floorY - projection.center[1]) * projection.cf) / (projection.k * Math.max(projection.sf, 1e-6));
  const x = projection.ct * u + projection.st * v + projection.center[0];
  const z = -projection.st * u + projection.ct * v + projection.center[2];
  const candidates = (model.floorFacts.get(floorId)?.occurrenceIds ?? []).flatMap(id => {
    const shape = model.planShapes.get(id); return shape && pointInShape(x, z, shape) ? [{ id, area: shapeArea(shape) }] : [];
  });
  return candidates.sort((a, b) => a.area - b.area)[0]?.id ?? null;
}

/** Highest drawn point of an occurrence's verified meshes; anchors its 3D label. */
export function occurrenceTops(meshes: readonly PreparedMesh[]): ReadonlyMap<string, number> {
  const tops = new Map<string, number>();
  for (const mesh of meshes) if (mesh.occurrenceId !== null) tops.set(mesh.occurrenceId, Math.max(tops.get(mesh.occurrenceId) ?? -Infinity, mesh.yRange[1]));
  return tops;
}
