import type { AtlasModel } from './scene';
import type { AtlasExclusion, AtlasPlanFeature, AtlasPolygon } from './types';

/** Display names and projected control layout only. Source identities stay unchanged. */
export function floorLabel(source: string): string {
  const names: Record<string, string> = { ground: 'Ground Floor', intermediate: 'Tussenfloor', upper: 'Upper Floor', attic: 'Attic' };
  return names[source.toLowerCase()] ?? source;
}

export interface CountMarker { readonly key: string; readonly occurrenceId: string; readonly count: number; readonly x: number; readonly y: number }
export interface ScreenBox { readonly l: number; readonly t: number; readonly r: number; readonly b: number }
export const countMarkerWidth = (count: number) => Math.max(28, String(count).length * 8 + 18);
/** Includes the marker's nine-pixel CSS pseudo-element on every side. */
export const countMarkerTarget = (row: CountMarker): ScreenBox => ({ l: row.x - countMarkerWidth(row.count) / 2 - 9,
  r: row.x + countMarkerWidth(row.count) / 2 + 9, t: row.y - 23, b: row.y + 23 });
const intersects = (a: ScreenBox, b: ScreenBox) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

export const LABEL_TAG_RISE = 49;
export const labelHitWidth = (text: string) => Math.max(44, Math.min(320, text.length * 7 + 12));
export interface RoomLabel { readonly id: string; readonly text: string; readonly x: number; readonly y: number; readonly rise: number; readonly tier: 'selected' | 'context' | 'plain'; readonly plan?: PlanLabelPose }
export const labelHitTarget = (row: RoomLabel): ScreenBox => row.plan?.box ?? ({ l: row.x - labelHitWidth(row.text) / 2,
  r: row.x + labelHitWidth(row.text) / 2, t: row.y - LABEL_TAG_RISE * row.rise - 16, b: row.y - LABEL_TAG_RISE * row.rise + 16 });

/** SVG names remain visible independently; only safe action targets enter the tab order. */
export function visibleLabelHits<T extends RoomLabel>(rows: readonly T[], size: { width: number; height: number },
  cover: readonly ScreenBox[], counts: readonly CountMarker[]): readonly T[] {
  const rank = { selected: 0, context: 1, plain: 2 };
  const ordered = [...rows].sort((a, b) => rank[a.tier] - rank[b.tier] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return nonOverlappingTargets(rows, ordered, labelHitTarget, size, cover, counts.map(countMarkerTarget));
}

const levelNames = new WeakMap<AtlasModel, ReadonlyMap<string, string>>();
/** Source labels stay first. Duplicate display names use source elevations,
 * with a source-order discriminator where known/unknown elevations still tie. */
export function atlasLevelNames(model: AtlasModel): ReadonlyMap<string, string> {
  const cached = levelNames.get(model); if (cached) return cached;
  const names = new Map<string, string>();
  for (const building of model.scene.buildings) {
    const levels = building.levelIds.map(id => model.levelsById.get(id)!);
    const groups = new Map<string, typeof levels>();
    for (const level of levels) { const key = floorLabel(level.label); const own = groups.get(key) ?? []; own.push(level); groups.set(key, own); }
    for (const [name, group] of groups) {
      const qualified = group.map(level => group.length === 1 ? name : `${name} · ${level.sourceElevationM === null ? 'source elevation unknown' : `source ${level.sourceElevationM} m`}`);
      group.forEach((level, at) => {
        const text = qualified[at]!;
        names.set(level.levelId, qualified.filter(other => other === text).length > 1
          ? `${text} · source level ${building.levelIds.indexOf(level.levelId) + 1}` : text);
      });
    }
    // Source labels may themselves contain qualifier-like text. If the final
    // display strings collide, a unique suffix on every source level closes it.
    if (new Set(levels.map(level => names.get(level.levelId))).size !== levels.length)
      levels.forEach((level, at) => names.set(level.levelId, `${names.get(level.levelId)} · source level ${at + 1}`));
  }
  levelNames.set(model, names); return names;
}
export function atlasLevelName(model: AtlasModel, id: string, scope = false): string {
  const level = model.levelsById.get(id)!;
  return `${atlasLevelNames(model).get(id)!}${scope ? `, ${atlasBuildingName(model, level.buildingId)}` : ''}`;
}

/** Final display strings that still collide get a source-order suffix on every member. */
function distinguish(names: Map<string, string>, keys: readonly string[], suffix: (at: number) => string) {
  if (new Set(keys.map(key => names.get(key))).size !== keys.length)
    keys.forEach((key, at) => names.set(key, `${names.get(key)} · ${suffix(at)}`));
}

const buildingNames = new WeakMap<AtlasModel, ReadonlyMap<string, string>>();
/** Source labels stay first; buildings sharing one add their source position. */
export function atlasBuildingName(model: AtlasModel, id: string): string {
  let names = buildingNames.get(model);
  if (!names) {
    const own = new Map<string, string>(), rows = model.scene.buildings;
    rows.forEach((row, at) => own.set(row.buildingId, rows.filter(other => other.label === row.label).length > 1
      ? `${row.label} · source building ${at + 1}` : row.label));
    distinguish(own, rows.map(row => row.buildingId), at => `source building ${at + 1}`);
    buildingNames.set(model, names = own);
  }
  return names.get(id) ?? model.buildingsById.get(id)!.label;
}

const occurrenceNames = new WeakMap<AtlasModel, ReadonlyMap<string, string>>();
/** One floor's room controls never share a name. Distinct rooms sharing a
 * label add their source room position; the parts of one room count off in
 * source order. Identity stays the occurrence ID, never the label. */
export function atlasOccurrenceName(model: AtlasModel, occurrenceId: string): string {
  let names = occurrenceNames.get(model);
  if (!names) {
    const own = new Map<string, string>();
    const roomAt = new Map(model.scene.rooms.map((room, at) => [room.roomId, at + 1]));
    for (const level of model.scene.levels) {
      const rows = level.occurrenceIds.map(id => ({ id, room: model.roomsById.get(model.occurrencesById.get(id)!.roomId)! }));
      for (const { id, room } of rows) {
        const namesakes = new Set(rows.filter(row => row.room.label === room.label).map(row => row.room.roomId));
        const parts = rows.filter(row => row.room.roomId === room.roomId);
        own.set(id, `${room.label}${namesakes.size > 1 ? ` · source room ${roomAt.get(room.roomId)}` : ''}${parts.length > 1
          ? ` · part ${parts.findIndex(row => row.id === id) + 1} of ${parts.length}` : ''}`);
      }
      distinguish(own, level.occurrenceIds, at => `source part ${at + 1}`);
    }
    occurrenceNames.set(model, names = own);
  }
  return names.get(occurrenceId) ?? model.roomsById.get(model.occurrencesById.get(occurrenceId)!.roomId)!.label;
}

/** A known occurrence by its control name, another source ID as given, then
 * the source reason. A row with neither ID nor reason says so; no name is invented. */
export function atlasExclusionText(model: AtlasModel, row: AtlasExclusion): string {
  const name = row.id !== null && model.occurrencesById.has(row.id) ? atlasOccurrenceName(model, row.id) : row.id;
  return [name, row.reason].filter(part => part !== null && part !== '').join(': ') || 'No source ID or reason given.';
}

/** Greedy, source-honest suppression: never move anchors or merge room counts.
 * A spatial grid bounds collision work; survivors keep their original DOM order. */
export function visibleCountMarkers<T extends CountMarker>(rows: readonly T[], size: { width: number; height: number },
  cover: readonly ScreenBox[], selected: string | null, context: readonly string[]): readonly T[] {
  const contexts = new Set(context), rank = (row: T) => row.occurrenceId === selected ? 0 : contexts.has(row.occurrenceId) ? 1 : 2;
  const ordered = [...rows].sort((a, b) => rank(a) - rank(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return nonOverlappingTargets(rows, ordered, countMarkerTarget, size, cover);
}

function nonOverlappingTargets<T>(rows: readonly T[], ordered: readonly T[], target: (row: T) => ScreenBox,
  size: { width: number; height: number }, cover: readonly ScreenBox[], reserved: readonly ScreenBox[] = []): readonly T[] {
  const cells = new Map<string, ScreenBox[]>(), kept = new Set<T>(), cell = 64;
  const keysOf = (box: ScreenBox) => {
    const keys: string[] = [];
    for (let x = Math.floor(box.l / cell); x <= Math.floor(box.r / cell); x++)
      for (let y = Math.floor(box.t / cell); y <= Math.floor(box.b / cell); y++) keys.push(`${x}:${y}`);
    return keys;
  };
  const reserve = (box: ScreenBox, keys: readonly string[]) => {
    for (const key of keys) { let bucket = cells.get(key); if (!bucket) { bucket = []; cells.set(key, bucket); } bucket.push(box); }
  };
  for (const box of reserved) reserve(box, keysOf(box));
  for (const row of ordered) {
    const box = target(row);
    if (!Number.isFinite(box.l + box.r + box.t + box.b) || box.l < 0 || box.t < 0 || box.r > size.width || box.b > size.height
      || cover.some(panel => intersects(box, panel))) continue;
    const keys = keysOf(box);
    if (keys.some(key => cells.get(key)?.some(placed => intersects(box, placed)))) continue;
    kept.add(row);
    reserve(box, keys);
  }
  return rows.filter(row => kept.has(row));
}

// Settled Plan presentation only. Source polygons and anchors are never changed.
type Point = readonly [number, number];
export interface PlanLabelFrame { readonly origin: Point; readonly x: Point; readonly z: Point; readonly scale: number }
export function planLabelFrame(project: (x: number, y: number, z: number) => readonly [number, number, ...number[]], y: number): PlanLabelFrame {
  const origin = project(0, y, 0), x = project(1, y, 0), z = project(0, y, 1);
  return { origin: [origin[0], origin[1]], x: [x[0] - origin[0], x[1] - origin[1]], z: [z[0] - origin[0], z[1] - origin[1]],
    scale: Math.hypot(x[0] - origin[0], x[1] - origin[1]) };
}
function sourcePoint(frame: PlanLabelFrame, p: Point): Point {
  const x = p[0] - frame.origin[0], y = p[1] - frame.origin[1], d = frame.x[0] * frame.z[1] - frame.x[1] * frame.z[0];
  return [(x * frame.z[1] - y * frame.z[0]) / d, (y * frame.x[0] - x * frame.x[1]) / d];
}
const pointBounds = (points: readonly Point[]): ScreenBox => {
  let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
  for (const p of points) { l = Math.min(l, p[0]); r = Math.max(r, p[0]); t = Math.min(t, p[1]); b = Math.max(b, p[1]); }
  return { l, r, t, b };
};
const boxCorners = (box: ScreenBox): readonly Point[] => [[box.l, box.t], [box.r, box.t], [box.r, box.b], [box.l, box.b]];
const expanded = (box: ScreenBox, gap: number): ScreenBox => ({ l: box.l - gap, r: box.r + gap, t: box.t - gap, b: box.b + gap });
const withinStage = (box: ScreenBox, size: { width: number; height: number }) =>
  Number.isFinite(box.l + box.t + box.r + box.b) && box.l >= 4 && box.t >= 4 && box.r <= size.width - 4 && box.b <= size.height - 4;
interface EdgeBudget { remaining: number; exhausted: boolean }
const edgeVisit = (budget: EdgeBudget) => { if (--budget.remaining < 0) budget.exhausted = true; return !budget.exhausted; };
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function onSegment(a: Point, b: Point, p: Point): boolean {
  return Math.abs(cross(a, b, p)) < 1e-8 && p[0] >= Math.min(a[0], b[0]) - 1e-8 && p[0] <= Math.max(a[0], b[0]) + 1e-8
    && p[1] >= Math.min(a[1], b[1]) - 1e-8 && p[1] <= Math.max(a[1], b[1]) + 1e-8;
}
function segmentHits(a: Point, b: Point, c: Point, d: Point): boolean {
  const ac = cross(a, b, c), ad = cross(a, b, d), ca = cross(c, d, a), cb = cross(c, d, b);
  return (ac * ad < 0 && ca * cb < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
function inRing(p: Point, ring: readonly Point[], budget: EdgeBudget): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (!edgeVisit(budget)) return false;
    const a = ring[j]!, b = ring[i]!;
    if (onSegment(a, b, p)) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const inPolygon = (p: Point, polygon: AtlasPolygon, budget: EdgeBudget) =>
  inRing(p, polygon.outer, budget) && !polygon.holes.some(hole => inRing(p, hole, budget));
function boundaryHitsQuad(polygon: AtlasPolygon, quad: readonly Point[], budget: EdgeBudget): boolean {
  for (const ring of [polygon.outer, ...polygon.holes]) for (let i = 0; i < ring.length; i++) {
    if (!edgeVisit(budget)) return true;
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    for (let k = 0; k < 4; k++) if (segmentHits(a, b, quad[k]!, quad[(k + 1) % 4]!)) return true;
  }
  return false;
}

export interface PlanLabelShape {
  readonly polygons: readonly AtlasPolygon[];
  readonly axis: Point;
  readonly long: number;
  readonly short: number;
  readonly complete: boolean;
}
const shapeCache = new WeakMap<readonly AtlasPolygon[], PlanLabelShape>();
/** One linear PCA pass and one extent pass, cached by immutable source polygons. */
export function preparePlanLabelShape(polygons: readonly AtlasPolygon[]): PlanLabelShape {
  const cached = shapeCache.get(polygons); if (cached) return cached;
  let count = 0, mx = 0, my = 0, xx = 0, xy = 0, yy = 0;
  const points: Point[] = [];
  for (const polygon of polygons) for (const p of polygon.outer) {
    if (count >= 100_000) {
      const result: PlanLabelShape = { polygons, axis: [1, 0], long: 0, short: 0, complete: false };
      shapeCache.set(polygons, result); return result;
    }
    points.push(p); count++;
    const dx = p[0] - mx, dy = p[1] - my;
    mx += dx / count; my += dy / count;
    xx += dx * (p[0] - mx); xy += dx * (p[1] - my); yy += dy * (p[1] - my);
  }
  const angle = .5 * Math.atan2(2 * xy, xx - yy), axis: Point = [Math.cos(angle), Math.sin(angle)];
  let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
  for (const p of points) {
    const u = p[0] * axis[0] + p[1] * axis[1], v = -p[0] * axis[1] + p[1] * axis[0];
    l = Math.min(l, u); r = Math.max(r, u); t = Math.min(t, v); b = Math.max(b, v);
  }
  const result = { polygons, axis, long: r - l, short: b - t, complete: count > 2 };
  shapeCache.set(polygons, result); return result;
}
interface PaperFeature { readonly box: ScreenBox; readonly polygons: readonly AtlasPolygon[] }
export interface PlanLabelPaper { readonly cells: ReadonlyMap<string, readonly PaperFeature[]>; readonly large: readonly PaperFeature[]; readonly cell: number; readonly complete: boolean }
/** Source-space index: no per-camera polygon rebuild or candidate × floor scan. */
export function preparePlanLabelPaper(features: readonly Pick<AtlasPlanFeature, 'role' | 'polygons'>[]): PlanLabelPaper {
  const entries: PaperFeature[] = [];
  let remaining = 200_000;
  for (const feature of features) if (feature.role !== 'context') {
    let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
    for (const polygon of feature.polygons) for (const ring of [polygon.outer, ...polygon.holes]) for (const p of ring) {
      if (--remaining < 0) return { cells: new Map(), large: [], cell: 1, complete: false };
      l = Math.min(l, p[0]); r = Math.max(r, p[0]); t = Math.min(t, p[1]); b = Math.max(b, p[1]);
    }
    if (Number.isFinite(l + r + t + b)) entries.push({ box: { l, r, t, b }, polygons: feature.polygons });
  }
  const whole = pointBounds(entries.flatMap(row => [[row.box.l, row.box.t], [row.box.r, row.box.b]] as Point[]));
  const cell = Math.max(.5, Math.max(whole.r - whole.l, whole.b - whole.t) / 32), cells = new Map<string, PaperFeature[]>(), large: PaperFeature[] = [];
  for (const entry of entries) {
    const x0 = Math.floor(entry.box.l / cell), x1 = Math.floor(entry.box.r / cell), y0 = Math.floor(entry.box.t / cell), y1 = Math.floor(entry.box.b / cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 128) { large.push(entry); continue; }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const key = `${x}:${y}`, own = cells.get(key) ?? []; own.push(entry); cells.set(key, own);
    }
  }
  return { cells, large, cell, complete: true };
}
function clearPaper(box: ScreenBox, frame: PlanLabelFrame, paper: PlanLabelPaper, budget: EdgeBudget): boolean {
  if (!paper.complete || budget.exhausted) return false;
  const quad = boxCorners(expanded(box, 12)).map(p => sourcePoint(frame, p)), bounds = pointBounds(quad);
  const x0 = Math.floor(bounds.l / paper.cell), x1 = Math.floor(bounds.r / paper.cell), y0 = Math.floor(bounds.t / paper.cell), y1 = Math.floor(bounds.b / paper.cell);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) return false;
  const entries = new Set(paper.large);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (const entry of paper.cells.get(`${x}:${y}`) ?? []) {
    if (!edgeVisit(budget)) return false;
    entries.add(entry);
  }
  for (const entry of entries) {
    if (!edgeVisit(budget)) return false;
    if (!intersects(bounds, entry.box)) continue;
    for (const polygon of entry.polygons) {
      if (quad.some(p => inPolygon(p, polygon, budget)) || boundaryHitsQuad(polygon, quad, budget)
        || (polygon.outer[0] && inRing(polygon.outer[0], quad, budget))) return false;
    }
  }
  return !budget.exhausted;
}

export interface PlanTextMetrics { readonly width: number; readonly height: number; readonly advance?: number }
export interface PlanLabelInput extends RoomLabel {
  readonly clearance: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly shape: PlanLabelShape;
  /** Includes the painted halo, measured with the actual tier's font. */
  readonly metrics: PlanTextMetrics;
}
export interface PlanLabelLeader { readonly points: readonly Point[]; readonly dot: boolean }
export interface PlanLabelPose {
  readonly mode: 'horizontal' | 'rotated' | 'callout' | 'standing';
  readonly x: number; readonly y: number; readonly angle: number;
  readonly width: number; readonly height: number; readonly box: ScreenBox;
  readonly textAnchor: 'middle' | 'start' | 'end'; readonly textX: number;
  readonly leader: PlanLabelLeader | null;
  readonly direction: number | null;
}
/** A name clears its own surviving badge's complete target, including its
 * nine-pixel halo. Only presentation moves; the source anchor and badge do not. */
export function countClearedLabelY(row: Pick<PlanLabelInput, 'id' | 'x' | 'y' | 'metrics'>, counts: readonly CountMarker[]): number {
  const width = Math.max(44, row.metrics.width), halfHeight = Math.max(32, row.metrics.height) / 2;
  let y = row.y;
  for (const marker of counts) if (marker.occurrenceId === row.id) {
    const box = countMarkerTarget(marker);
    if (row.x - width / 2 < box.r && row.x + width / 2 > box.l) y = Math.min(y, box.t - halfHeight - 2);
  }
  return y;
}
function poseAt(row: PlanLabelInput, x: number, y: number, angle: number, mode: PlanLabelPose['mode']): PlanLabelPose {
  const width = Math.max(44, row.metrics.width), height = Math.max(32, row.metrics.height), a = angle * Math.PI / 180;
  const w = Math.abs(Math.cos(a)) * width + Math.abs(Math.sin(a)) * height, h = Math.abs(Math.sin(a)) * width + Math.abs(Math.cos(a)) * height;
  return { x, y, angle, width, height, mode, box: { l: x - w / 2, r: x + w / 2, t: y - h / 2, b: y + h / 2 },
    textAnchor: 'middle', textX: 0, leader: null, direction: null };
}
function visualCorners(row: PlanLabelInput, pose: PlanLabelPose): readonly Point[] {
  const a = pose.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), w = row.metrics.width / 2, h = row.metrics.height / 2;
  return ([[-w, -h], [w, -h], [w, h], [-w, h]] as Point[]).map(([x, y]) => [pose.x + x * c - y * s, pose.y + x * s + y * c]);
}
function contained(row: PlanLabelInput, pose: PlanLabelPose, frame: PlanLabelFrame, budget: EdgeBudget): boolean {
  if (!row.shape.complete) return false;
  const quad = visualCorners(row, pose).map(p => sourcePoint(frame, p));
  // A box may not bridge a concavity or cover a hole even when its corners fit.
  for (const polygon of row.shape.polygons) {
    if (!quad.every(p => inPolygon(p, polygon, budget))) continue;
    if (boundaryHitsQuad(polygon, quad, budget)) continue;
    if (polygon.holes.some(hole => hole[0] && inRing(hole[0], quad, budget))) continue;
    if (!budget.exhausted) return true;
  }
  return false;
}
function rotatedPose(row: PlanLabelInput, frame: PlanLabelFrame, budget: EdgeBudget): PlanLabelPose | null {
  if (!row.shape.complete || row.shape.short * frame.scale < 18 || row.shape.long * frame.scale < row.metrics.width + 8) return null;
  const axis = row.shape.axis, dx = frame.x[0] * axis[0] + frame.z[0] * axis[1], dy = frame.x[1] * axis[0] + frame.z[1] * axis[1];
  let angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (angle > 90) angle -= 180; if (angle < -90) angle += 180;
  if (Math.abs(angle) < 8) angle = 0; else if (Math.abs(angle) > 82) angle = -90;
  const pose = poseAt(row, row.anchorX, row.anchorY, angle, 'rotated');
  return contained(row, pose, frame, budget) ? pose : null;
}
/** Used before the camera settles to keep an unfit selected tag standing smoothly. */
export function planRoomLabelFits(input: PlanLabelInput, frame: PlanLabelFrame, counts: readonly CountMarker[] = []): boolean {
  const row = { ...input, y: countClearedLabelY(input, counts) };
  const budget = { remaining: 20_000, exhausted: false };
  if (row.clearance * frame.scale >= 18 && contained(row, poseAt(row, row.x, row.y, 0, 'horizontal'), frame, budget)) return true;
  const along = rotatedPose(row, frame, budget);
  return along !== null && !counts.some(marker => marker.occurrenceId === row.id && intersects(along.box, countMarkerTarget(marker)));
}
function lineHitsBox(a: Point, b: Point, box: ScreenBox): boolean {
  const inside = (p: Point) => p[0] >= box.l && p[0] <= box.r && p[1] >= box.t && p[1] <= box.b;
  const corners = boxCorners(box);
  return inside(a) || inside(b) || corners.some((p, i) => segmentHits(a, b, p, corners[(i + 1) % 4]!));
}
function leadersCross(a: PlanLabelLeader, b: PlanLabelLeader): boolean {
  return a.points.slice(1).some((p, i) => b.points.slice(1).some((q, j) => segmentHits(a.points[i]!, p, b.points[j]!, q)));
}
function trimLeader(anchor: Point, points: readonly Point[], own: readonly ScreenBox[]): PlanLabelLeader {
  const toward = points[0]!, vx = toward[0] - anchor[0], vy = toward[1] - anchor[1];
  let leave = 0;
  for (const box of own) if (lineHitsBox(anchor, toward, box)) {
    const tx = vx > 0 ? (box.r - anchor[0]) / vx : vx < 0 ? (box.l - anchor[0]) / vx : -Infinity;
    const ty = vy > 0 ? (box.b - anchor[1]) / vy : vy < 0 ? (box.t - anchor[1]) / vy : -Infinity;
    const exit = Math.min(tx > 0 ? tx : Infinity, ty > 0 ? ty : Infinity);
    if (exit >= 0 && exit < 1) leave = Math.max(leave, exit);
  }
  return { points: [[anchor[0] + vx * leave, anchor[1] + vy * leave], ...points], dot: leave === 0 };
}
function leaderFor(row: PlanLabelInput, pose: PlanLabelPose, own: readonly ScreenBox[]): PlanLabelLeader {
  const dx = pose.x - row.anchorX, dy = pose.y - row.anchorY, sideways = Math.abs(dx) >= Math.abs(dy);
  const end: Point = sideways ? [dx > 0 ? pose.box.l - 4 : pose.box.r + 4, pose.y]
    : [pose.x, dy > 0 ? pose.box.t - 4 : pose.box.b + 4];
  const shoulder: Point = sideways ? [end[0] - Math.sign(dx) * 8, end[1]] : end;
  return trimLeader([row.anchorX, row.anchorY], sideways ? [shoulder, end] : [end], own);
}
/** Small rectangles cover the complete stroke, including its halo, for measurements. */
export function planLabelObstacles(row: RoomLabel): readonly ScreenBox[] {
  const result = [labelHitTarget(row)], points = row.plan?.leader?.points ?? [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8);
    for (let j = 0; j <= steps; j++) {
      const at = steps === 0 ? 0 : j / steps, x = a[0] + (b[0] - a[0]) * at, y = a[1] + (b[1] - a[1]) * at;
      result.push({ l: x - 6, r: x + 6, t: y - 6, b: y + 6 });
    }
  }
  return result;
}

function labelReservations(initial: readonly ScreenBox[]) {
  const cells = new Map<string, ScreenBox[]>(), large: ScreenBox[] = [], cell = 64;
  const keys = (box: ScreenBox): string[] | null => {
    const x0 = Math.floor(box.l / cell), x1 = Math.floor(box.r / cell), y0 = Math.floor(box.t / cell), y1 = Math.floor(box.b / cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) return null;
    const result: string[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) result.push(`${x}:${y}`);
    return result;
  };
  const add = (box: ScreenBox) => {
    const own = keys(box); if (!own) { large.push(box); return; }
    for (const key of own) { const bucket = cells.get(key) ?? []; bucket.push(box); cells.set(key, bucket); }
  };
  initial.forEach(add);
  const query = (box: ScreenBox): readonly ScreenBox[] | null => {
    const own = keys(box); if (!own) return null;
    const result = new Set(large);
    for (const key of own) for (const candidate of cells.get(key) ?? []) result.add(candidate);
    return [...result];
  };
  return { add, query };
}

/** Fixed 8 directions × 7 distances; at most 4 callouts and 80k edge/index visits.
 * Text that has no safe full target is left to the unchanged room list. */
export function placePlanRoomLabels<T extends PlanLabelInput>(rows: readonly T[], size: { width: number; height: number },
  cover: readonly ScreenBox[], counts: readonly CountMarker[], frame: PlanLabelFrame, paper: PlanLabelPaper,
  previous: ReadonlyMap<string, number> = new Map()): readonly (T & { readonly plan: PlanLabelPose })[] {
  const rank = { selected: 0, context: 1, plain: 2 }, budget = { remaining: 80_000, exhausted: false };
  const ordered = [...rows].sort((a, b) => rank[a.tier] - rank[b.tier] || b.clearance - a.clearance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const countGroups = new Map<string, { markers: CountMarker[]; boxes: ScreenBox[] }>(), countBoxes: ScreenBox[] = [];
  for (const marker of counts) {
    const group = countGroups.get(marker.occurrenceId) ?? { markers: [], boxes: [] }, box = countMarkerTarget(marker);
    group.markers.push(marker); group.boxes.push(box); countBoxes.push(box); countGroups.set(marker.occurrenceId, group);
  }
  const blocked = labelReservations([...cover, ...countBoxes]), leaders: PlanLabelLeader[] = [];
  const result: (T & { plan: PlanLabelPose })[] = [], rotated: { row: T; pose: PlanLabelPose }[] = [], outside: T[] = [];
  const safe = (pose: PlanLabelPose) => {
    const nearby = blocked.query(pose.box);
    return nearby !== null && withinStage(pose.box, size) && !nearby.some(box => intersects(pose.box, box))
      && !leaders.some(line => line.points.slice(1).some((p, i) => lineHitsBox(line.points[i]!, p, expanded(pose.box, 2))));
  };
  const safeLeader = (line: PlanLabelLeader, own: readonly ScreenBox[]) => line.points.slice(1).every((p, i) => {
    const a = line.points[i]!, nearby = blocked.query(expanded(pointBounds([a, p]), 2));
    return nearby !== null && !nearby.some(box => !own.includes(box) && lineHitsBox(a, p, expanded(box, 2)));
  }) && !leaders.some(other => leadersCross(line, other));
  const accept = (row: T, pose: PlanLabelPose) => { result.push({ ...row, plan: pose }); blocked.add(pose.box); if (pose.leader) leaders.push(pose.leader); };
  for (const input of ordered) {
    const row = { ...input, y: countClearedLabelY(input, countGroups.get(input.id)?.markers ?? []) };
    if (!Number.isFinite(row.metrics.width + row.metrics.height) || row.metrics.width <= 0 || row.metrics.height <= 0) continue;
    const horizontal = poseAt(row, row.x, row.y - LABEL_TAG_RISE * row.rise, 0, 'horizontal');
    if (row.tier === 'selected') {
      const fitting = row.clearance * frame.scale >= 18 && contained(row, poseAt(row, row.x, row.y, 0, 'horizontal'), frame, budget);
      const own = countGroups.get(row.id)?.boxes ?? [];
      const rotated = fitting ? null : rotatedPose(row, frame, budget);
      const along = rotated && !own.some(box => intersects(rotated.box, box)) ? rotated : null;
      let pose = fitting ? horizontal : along ?? { ...horizontal, mode: 'standing' as const };
      if (row.rise > .02 && !along) pose = { ...pose, leader: trimLeader([row.anchorX, row.anchorY],
        [[pose.x, pose.y + 15 * row.rise]], own) };
      if (safe(pose) && (!pose.leader || safeLeader(pose.leader, own))) accept(row, pose);
    } else if (row.clearance * frame.scale >= 18) {
      // Shape-fitting fallback is not used to evade an existing label collision.
      if (safe(horizontal)) accept(row, horizontal);
    } else {
      const along = rotatedPose(row, frame, budget);
      if (along) {
        if (row.tier === 'context') { if (safe(along)) accept(row, along); }
        else rotated.push({ row, pose: along });
      } else outside.push(row);
    }
  }
  for (const { row, pose } of rotated) if (safe(pose)) accept(row, pose);
  if (size.width <= 720 || !paper.complete) return result;
  let callouts = 0;
  for (const row of outside) {
    if (callouts >= 4 || budget.exhausted) break;
    const axis = row.shape.axis, ax = frame.x[0] * axis[0] + frame.z[0] * axis[1], ay = frame.x[1] * axis[0] + frame.z[1] * axis[1], length = Math.hypot(ax, ay);
    const u: Point = length > 0 ? [ax / length, ay / length] : [1, 0], v: Point = [-u[1], u[0]];
    const directions: readonly Point[] = [v, [-v[0], -v[1]], u, [-u[0], -u[1]], [u[0] + v[0], u[1] + v[1]], [u[0] - v[0], u[1] - v[1]], [-u[0] + v[0], -u[1] + v[1]], [-u[0] - v[0], -u[1] - v[1]]];
    const own = countGroups.get(row.id)?.boxes ?? [];
    const candidates: { pose: PlanLabelPose; length: number }[] = [];
    for (let direction = 0; direction < directions.length && !budget.exhausted; direction++) {
      const d = directions[direction]!, norm = Math.hypot(d[0], d[1]);
      const ux = d[0] / norm, uy = d[1] / norm;
      // The bound is on the connector, not on a long name's centre. Start
      // outside the target's own half-extent, then try fixed outward steps.
      const half = Math.min(Math.abs(ux) > 1e-8 ? Math.max(44, row.metrics.width) / (2 * Math.abs(ux)) : Infinity,
        Math.abs(uy) > 1e-8 ? Math.max(32, row.metrics.height) / (2 * Math.abs(uy)) : Infinity);
      for (const distance of [24, 40, 64, 88, 112, 136, 160]) {
        const pose = poseAt(row, row.anchorX + ux * (half + distance), row.anchorY + uy * (half + distance), 0, 'callout');
        if (!safe(pose)) continue;
        const leader = leaderFor(row, pose, own), points = leader.points;
        const actual = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i]![0], p[1] - points[i]![1]), 0);
        if (actual > 160 || actual < 4 || !safeLeader(leader, own) || !clearPaper(pose.box, frame, paper, budget)) continue;
        const sideways = Math.abs(pose.x - row.anchorX) >= Math.abs(pose.y - row.anchorY), right = pose.x > row.anchorX;
        candidates.push({ pose: { ...pose, leader, direction, textAnchor: sideways ? (right ? 'start' : 'end') : 'middle',
          textX: sideways ? (right ? -1 : 1) * (row.metrics.advance ?? row.metrics.width) / 2 : 0 }, length: actual });
        break;
      }
    }
    candidates.sort((a, b) => a.length - b.length || a.pose.direction! - b.pose.direction!);
    const shortest = candidates[0];
    if (!shortest) continue;
    const stable = candidates.find(candidate => candidate.pose.direction === previous.get(row.id) && candidate.length <= shortest.length + 24);
    accept(row, (stable ?? shortest).pose); callouts++;
  }
  return result;
}
