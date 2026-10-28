import type { PlanRing } from '../canonical-ifc/model';
import { occurrenceArea, type AtlasModel } from './scene';

/** Approximate model dimensions from the admitted model frame (metres) and
 * the publication's own room polygons, unless the model carries the owner's
 * measured value for that room part or wall: that value is shown as given,
 * without "≈". Estimated pick proxies are never measured from their outline.
 * Names and room types never produce a size. */

export const MEASUREMENT_BASIS = 'Approximate model dimensions from the room outlines, not measured on site.';
export const MEASURED_BASIS = 'Values marked Measured were measured on site and come with the model; the others are approximate, from the room outlines.';
/** Shorter runs are left unlabelled: they are mostly wall returns and reveals. */
export const MIN_SPAN_M = .8;

export interface RoomArea {
  readonly occurrenceId: string;
  readonly squareMetres: number;
  readonly text: string;
  /** The room has other parts; this area is this part only. */
  readonly partial: boolean;
  /** The owner's measured value, carried by the model. */
  readonly measured: boolean;
}
export interface EdgeSpan {
  readonly key: string;
  readonly occurrenceId: string;
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
  readonly metres: number;
  readonly text: string;
  /** Unit normal toward the room's inside, in scene X/Z. */
  readonly inward: readonly [number, number];
  readonly measured: boolean;
  /** One straight outline run, so it can be drawn along the wall. A measured
   * wall that is not one run is listed only: its ends' chord is not the wall. */
  readonly drawn: boolean;
}

/** One decimal below 10 m², whole metres above: the outline supports no more. */
export function areaText(squareMetres: number): string {
  const value = squareMetres < 10 ? Math.round(squareMetres * 10) / 10 : Math.round(squareMetres);
  return `≈ ${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} m²`;
}
/** Tenths of a metre. */
export function lengthText(metres: number): string {
  return `≈ ${(Math.round(metres * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`;
}
/** A measured value as the owner gave it: significant digits, not decimals,
 * so however small an admitted value is it is never shown as zero. */
export const measuredText = (value: number, unit: 'm' | 'm²') =>
  `${value.toLocaleString(undefined, { maximumSignificantDigits: 15 })} ${unit}`;

/** The model carries at least one of the owner's measured values for this room part. */
export function carriesMeasurements(model: AtlasModel, occurrenceId: string): boolean {
  const measured = model.occurrencesById.get(occurrenceId)?.measured;
  return !!measured && (measured.area !== null || measured.lengths.length > 0);
}

export const measurable = (model: AtlasModel, occurrenceId: string) =>
  model.selectable.has(occurrenceId) && model.occurrencesById.get(occurrenceId)?.geometryBasis.kind === 'source-model';

export function roomArea(model: AtlasModel, occurrenceId: string): RoomArea | null {
  const occurrence = model.occurrencesById.get(occurrenceId);
  if (!occurrence || !model.selectable.has(occurrenceId)) return null;
  const partial = model.roomsById.get(occurrence.roomId)!.occurrenceIds.length > 1, given = occurrence.measured?.area ?? null;
  if (given !== null) return { occurrenceId, squareMetres: given, text: measuredText(given, 'm²'), partial, measured: true };
  if (!measurable(model, occurrenceId)) return null;
  const squareMetres = occurrenceArea(model, occurrenceId);
  if (!(squareMetres > 0)) return null;
  return { occurrenceId, squareMetres, text: areaText(squareMetres), partial, measured: false };
}

const signedArea = (ring: PlanRing) => {
  let area = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; area += a[0] * b[1] - b[0] * a[1]; }
  return area / 2;
};

/** Straight runs of one outer ring: consecutive collinear segments merge, so a
 * split vertex on a straight wall never halves its span. */
export function ringRuns(ring: PlanRing): readonly { readonly a: readonly [number, number]; readonly b: readonly [number, number] }[] {
  const maxCoordinate = ring.reduce((maximum, point) => Math.max(maximum, Math.abs(point[0]), Math.abs(point[1])), 1);
  const tolerance = Math.max(1e-9, 64 * Number.EPSILON * maxCoordinate);
  const points = ring.filter((point, at) => { const next = ring[(at + 1) % ring.length]!; return Math.hypot(next[0] - point[0], next[1] - point[1]) > tolerance; });
  const n = points.length; if (n < 3) return [];
  const onRun = (a: readonly number[], b: readonly number[], point: readonly number[]) => {
    const dx = b[0]! - a[0]!, dz = b[1]! - a[1]!, length = Math.hypot(dx, dz);
    if (length <= tolerance) return false;
    const px = point[0]! - a[0]!, pz = point[1]! - a[1]!;
    const along = (px * dx + pz * dz) / length;
    return Math.abs(px * dz - pz * dx) / length <= tolerance && along >= -tolerance && along <= length + tolerance;
  };
  const corners = [...Array(n).keys()].filter(at => !onRun(points[(at + n - 1) % n]!, points[(at + 1) % n]!, points[at]!));
  if (corners.length < 2) return points.map((a, at) => ({ a, b: points[(at + 1) % n]! }));
  return corners.flatMap((start, at) => {
    const end = corners[(at + 1) % corners.length]!, indices = [start];
    for (let i = (start + 1) % n; i !== end; i = (i + 1) % n) indices.push(i);
    indices.push(end);
    const a = points[start]!, b = points[end]!;
    // Validate the complete run against one line, not consecutive small turns.
    if (indices.every(i => onRun(a, b, points[i]!))) return [{ a, b }];
    return indices.slice(0, -1).map((i, j) => ({ a: points[i]!, b: points[indices[j + 1]!]! }));
  });
}

type Point = readonly [number, number];
const samePoint = (p: Point, q: Point) => p[0] === q[0] && p[1] === q[1];

/** The occurrence's measured walls with their end points, each on the room
 * polygon it names, so a straight run with the same ends takes its value. */
function measuredWalls(model: AtlasModel, occurrenceId: string) {
  const occurrence = model.occurrencesById.get(occurrenceId)!;
  if (!occurrence.measured) return [];
  const features = new Map((model.plansByLevel.get(occurrence.levelId) ?? []).flatMap(plan => plan.features.map(f => [f.featureId, f] as const)));
  return occurrence.measured.lengths.map(({ edge, metres }) => {
    const outer = features.get(edge.featureId)!.polygons[edge.polygon]!.outer;
    return { outer, a: outer[edge.from]! as Point, b: outer[edge.to]! as Point, metres, key: `${edge.featureId}/${edge.polygon}/${edge.from}/${edge.to}` };
  });
}

export function edgeSpans(model: AtlasModel, occurrenceId: string): readonly EdgeSpan[] {
  if (!model.selectable.has(occurrenceId) || !model.occurrencesById.has(occurrenceId)) return [];
  const walls = measuredWalls(model, occurrenceId), used = new Set<string>();
  const span = (key: string, a: Point, b: Point, turn: number, given: number | null, drawn = true): EdgeSpan => {
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1, metres = given ?? length;
    return { key, occurrenceId, a, b, metres, text: given === null ? lengthText(metres) : measuredText(given, 'm'),
      inward: [-dz / length * turn, dx / length * turn] as const, measured: given !== null, drawn };
  };
  // Outline runs only where the outline itself is the model's (not an estimate).
  const runs = (measurable(model, occurrenceId) ? model.roomPolygons.get(occurrenceId) ?? [] : []).flatMap((polygon, part) => {
    const turn = Math.sign(signedArea(polygon.outer)) || 1;
    return ringRuns(polygon.outer).flatMap((run, at) => {
      // Runs walk the ring in order, as `from` → `to` does; reversed ends name
      // the rest of the ring, not this wall.
      const wall = walls.find(w => w.outer === polygon.outer && samePoint(w.a, run.a) && samePoint(w.b, run.b));
      if (wall) { used.add(wall.key); return [span(`${occurrenceId}/${part}/${at}`, run.a, run.b, turn, wall.metres)]; }
      return Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]) < MIN_SPAN_M ? [] : [span(`${occurrenceId}/${part}/${at}`, run.a, run.b, turn, null)];
    });
  });
  // A measured wall that is not one straight run is still listed, never drawn.
  const rest = walls.filter(wall => !used.has(wall.key))
    .map(wall => span(`${occurrenceId}/measured/${wall.key}`, wall.a, wall.b, Math.sign(signedArea(wall.outer)) || 1, wall.metres, false));
  return [...runs, ...rest];
}

/** Rooms left out because the publication marks their outline as estimated. */
export const estimatedOccurrences = (model: AtlasModel, occurrenceIds: Iterable<string>): readonly string[] =>
  [...occurrenceIds].filter(key => model.selectable.has(key) && !measurable(model, key));

export interface LabelBox { readonly l: number; readonly t: number; readonly r: number; readonly b: number }
/** Greedy placement in the given order: a label overlapping a placed label or
 * a blocked region, or leaving the stage, is dropped rather than overprinted. */
export function placeLabels<T extends { readonly x: number; readonly y: number; readonly w: number; readonly h: number }>(rows: readonly T[],
  blocked: readonly LabelBox[], size: { readonly width: number; readonly height: number }): T[] {
  const placed: LabelBox[] = [...blocked];
  return rows.filter(row => {
    const box = { l: row.x - row.w / 2, r: row.x + row.w / 2, t: row.y - row.h / 2, b: row.y + row.h / 2 };
    if (box.l < 2 || box.t < 2 || box.r > size.width - 2 || box.b > size.height - 2) return false;
    if (placed.some(o => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)) return false;
    placed.push(box); return true;
  });
}
