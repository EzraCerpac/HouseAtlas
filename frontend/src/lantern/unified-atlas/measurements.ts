import type { PlanRing } from '../canonical-ifc/model';
import { occurrenceArea, type AtlasModel } from './scene';

/** Approximate model dimensions from the admitted model frame (metres) and
 * the publication's own room polygons. They are never measured or as-built
 * values: physical registration is unknown, and estimated pick proxies are
 * left out rather than measured. Names and room types never produce a size. */

export const MEASUREMENT_BASIS = 'Approximate model dimensions from the room outlines, not measured on site.';
/** Shorter runs are left unlabelled: they are mostly wall returns and reveals. */
export const MIN_SPAN_M = .8;
/** Directions within this sine are one straight run. */
const COLLINEAR = Math.sin(Math.PI / 180);

export interface RoomArea {
  readonly occurrenceId: string;
  readonly squareMetres: number;
  readonly text: string;
  /** The room has other parts; this area is this part only. */
  readonly partial: boolean;
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

export const measurable = (model: AtlasModel, occurrenceId: string) =>
  model.selectable.has(occurrenceId) && model.occurrencesById.get(occurrenceId)?.geometryBasis.kind === 'source-model';

export function roomArea(model: AtlasModel, occurrenceId: string): RoomArea | null {
  if (!measurable(model, occurrenceId)) return null;
  const squareMetres = occurrenceArea(model, occurrenceId);
  if (!(squareMetres > 0)) return null;
  const room = model.roomsById.get(model.occurrencesById.get(occurrenceId)!.roomId)!;
  return { occurrenceId, squareMetres, text: areaText(squareMetres),
    partial: room.occurrenceIds.filter(key => model.selectable.has(key)).length > 1 };
}

const signedArea = (ring: PlanRing) => {
  let area = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; area += a[0] * b[1] - b[0] * a[1]; }
  return area / 2;
};

/** Straight runs of one outer ring: consecutive collinear segments merge, so a
 * split vertex on a straight wall never halves its span. */
export function ringRuns(ring: PlanRing): readonly { readonly a: readonly [number, number]; readonly b: readonly [number, number] }[] {
  const points = ring.filter((point, at) => { const next = ring[(at + 1) % ring.length]!; return Math.hypot(next[0] - point[0], next[1] - point[1]) > 1e-9; });
  const n = points.length; if (n < 3) return [];
  const direction = (at: number) => {
    const a = points[at % n]!, b = points[(at + 1) % n]!, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as const;
  };
  const straight = (at: number) => {
    const d0 = direction((at + n - 1) % n), d1 = direction(at);
    return Math.abs(d0[0] * d1[1] - d0[1] * d1[0]) < COLLINEAR && d0[0] * d1[0] + d0[1] * d1[1] > 0;
  };
  const corners = [...Array(n).keys()].filter(at => !straight(at));
  if (corners.length < 2) return [];
  return corners.map((start, at) => ({ a: points[start]!, b: points[corners[(at + 1) % corners.length]!]! }));
}

export function edgeSpans(model: AtlasModel, occurrenceId: string): readonly EdgeSpan[] {
  if (!measurable(model, occurrenceId)) return [];
  return (model.roomPolygons.get(occurrenceId) ?? []).flatMap((polygon, part) => {
    const turn = Math.sign(signedArea(polygon.outer)) || 1;
    return ringRuns(polygon.outer).flatMap((run, at) => {
      const dx = run.b[0] - run.a[0], dz = run.b[1] - run.a[1], metres = Math.hypot(dx, dz);
      if (metres < MIN_SPAN_M) return [];
      return [{ key: `${occurrenceId}/${part}/${at}`, occurrenceId, a: run.a, b: run.b, metres, text: lengthText(metres),
        inward: [-dz / metres * turn, dx / metres * turn] as const }];
    });
  });
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
