import type { HouseData, Pt, Space } from '../data/types';

// Derives walls, openings and slab edges from reviewed room shapes. All room
// edges are axis-aligned and snapped to a 0.5 m grid in the demo plans.

export type RunType = 'exterior' | 'interior' | 'rail' | 'window' | 'glazed' | 'door' | 'open';

export interface Run {
  a: Pt;
  b: Pt;
  type: RunType;
  horizontal: boolean;
  /** Outward normal for edges on the building envelope. */
  normal?: Pt | undefined;
  /** True when the edge is on the floor's outer perimeter. */
  envelope: boolean;
}

export interface FloorGeom {
  floorId: string;
  spaces: Space[];
  runs: Run[];
  perimeter: Run[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const STEP = 0.5;
const k = (n: number) => n.toFixed(2);

export function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    const intersect = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function centroid(poly: Pt[]): Pt {
  // Area-weighted centroid, falls back to the vertex average.
  if (poly.length === 0) return [NaN, NaN];
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]!;
    const [x1, y1] = poly[(i + 1) % poly.length]!;
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-6) {
    const n = poly.length;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  a *= 0.5;
  const c: Pt = [cx / (6 * a), cy / (6 * a)];
  // Concave shapes (like the landing) can have a centroid outside; nudge to a vertex mean of the largest rectangle-ish part.
  return pointInPolygon(c, poly) ? c : labelPoint(poly);
}

function labelPoint(poly: Pt[]): Pt {
  if (poly.length === 0) return [NaN, NaN];
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  let best: Pt = poly[0]!;
  let bestScore = -1;
  for (let x = Math.min(...xs) + 0.25; x < Math.max(...xs); x += 0.25) {
    for (let y = Math.min(...ys) + 0.25; y < Math.max(...ys); y += 0.25) {
      if (!pointInPolygon([x, y], poly)) continue;
      // Distance to nearest edge as a crude "pole of inaccessibility".
      let d = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i]!;
        const [bx, by] = poly[(i + 1) % poly.length]!;
        const dd = ax === bx ? (y >= Math.min(ay, by) && y <= Math.max(ay, by) ? Math.abs(x - ax) : Infinity) : x >= Math.min(ax, bx) && x <= Math.max(ax, bx) ? Math.abs(y - ay) : Infinity;
        d = Math.min(d, dd);
      }
      if (d > bestScore) {
        bestScore = d;
        best = [x, y];
      }
    }
  }
  return best;
}

interface Unit {
  key: string;
  line: string;
  start: number;
  a: Pt;
  b: Pt;
  horizontal: boolean;
  spaces: string[];
}

export function buildFloorGeom(h: HouseData, floorId: string): FloorGeom {
  const spaces = h.spaces.filter((s) => s.floorId === floorId && s.shape && s.geometry === 'reviewed');
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const units = new Map<string, Unit>();

  for (const s of spaces) {
    const poly = s.shape!;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const horizontal = p[1] === q[1];
      const fixed = horizontal ? p[1] : p[0];
      const from = Math.min(horizontal ? p[0] : p[1], horizontal ? q[0] : q[1]);
      const to = Math.max(horizontal ? p[0] : p[1], horizontal ? q[0] : q[1]);
      for (let t = from; t < to - 1e-6; t += STEP) {
        const line = `${horizontal ? 'h' : 'v'}:${k(fixed)}`;
        const key = `${line}:${k(t)}`;
        const a: Pt = horizontal ? [t, fixed] : [fixed, t];
        const b: Pt = horizontal ? [t + STEP, fixed] : [fixed, t + STEP];
        const u = units.get(key) ?? { key, line, start: t, a, b, horizontal, spaces: [] };
        if (!u.spaces.includes(s.id)) u.spaces.push(s.id);
        units.set(key, u);
      }
    }
  }

  const openings = h.openings.filter((o) => o.floorId === floorId);

  interface Classified extends Unit {
    type: RunType;
    normal?: Pt | undefined;
    envelope: boolean;
  }

  const outward = (u: Unit, s: Space): Pt => {
    const mx = (u.a[0] + u.b[0]) / 2;
    const my = (u.a[1] + u.b[1]) / 2;
    const test: Pt = u.horizontal ? [mx, my + 0.05] : [mx + 0.05, my];
    const inside = pointInPolygon(test, s.shape!);
    return u.horizontal ? (inside ? [0, -1] : [0, 1]) : inside ? [-1, 0] : [1, 0];
  };

  const classified: Classified[] = [];
  for (const u of units.values()) {
    const sp = u.spaces.map((id) => byId.get(id)!);
    let type: RunType;
    let normal: Pt | undefined;
    let envelope = false;
    if (sp.length === 1) {
      envelope = true;
      type = sp[0]!.kind === 'outdoor' ? 'rail' : 'exterior';
      normal = outward(u, sp[0]!);
    } else {
      const outdoor = sp.find((s) => s.kind === 'outdoor');
      const indoor = sp.find((s) => s.kind !== 'outdoor');
      if (outdoor && indoor) {
        type = 'exterior';
        normal = outward(u, indoor);
      } else if (sp.some((s) => s.kind === 'stair') && sp.some((s) => s.kind === 'circulation')) {
        type = 'open';
      } else {
        type = 'interior';
      }
    }
    for (const o of openings) {
      const oh = o.a[1] === o.b[1];
      if (oh !== u.horizontal) continue;
      if (oh) {
        if (Math.abs(o.a[1] - u.a[1]) > 1e-6) continue;
        const lo = Math.min(o.a[0], o.b[0]);
        const hi = Math.max(o.a[0], o.b[0]);
        if (u.a[0] >= lo - 1e-6 && u.b[0] <= hi + 1e-6) type = o.type;
      } else {
        if (Math.abs(o.a[0] - u.a[0]) > 1e-6) continue;
        const lo = Math.min(o.a[1], o.b[1]);
        const hi = Math.max(o.a[1], o.b[1]);
        if (u.a[1] >= lo - 1e-6 && u.b[1] <= hi + 1e-6) type = o.type;
      }
    }
    classified.push({ ...u, type, normal, envelope });
  }

  const merge = (list: Classified[], same: (x: Classified, y: Classified) => boolean): Run[] => {
    const lines = new Map<string, Classified[]>();
    for (const c of list) {
      const arr = lines.get(c.line) ?? [];
      arr.push(c);
      lines.set(c.line, arr);
    }
    const out: Run[] = [];
    for (const arr of lines.values()) {
      arr.sort((x, y) => x.start - y.start);
      let cur: Run | null = null;
      let prev: Classified | null = null;
      for (const c of arr) {
        const contiguous = prev && Math.abs(prev.start + STEP - c.start) < 1e-6;
        if (cur && prev && contiguous && same(prev, c)) {
          cur.b = c.b;
        } else {
          if (cur) out.push(cur);
          cur = { a: c.a, b: c.b, type: c.type, horizontal: c.horizontal, normal: c.normal, envelope: c.envelope };
        }
        prev = c;
      }
      if (cur) out.push(cur);
    }
    return out;
  };

  const nkey = (n?: Pt) => (n ? `${n[0]},${n[1]}` : '-');
  const runs = merge(classified, (x, y) => x.type === y.type && nkey(x.normal) === nkey(y.normal) && x.envelope === y.envelope);
  const perimeter = merge(
    classified.filter((c) => c.envelope),
    (x, y) => nkey(x.normal) === nkey(y.normal),
  ).map((r) => ({ ...r, type: 'exterior' as RunType }));

  const pts = spaces.flatMap((s) => s.shape!);
  const bounds = pts.length
    ? {
        minX: Math.min(...pts.map((p) => p[0])),
        minY: Math.min(...pts.map((p) => p[1])),
        maxX: Math.max(...pts.map((p) => p[0])),
        maxY: Math.max(...pts.map((p) => p[1])),
      }
    : { minX: 0, minY: 0, maxX: 1, maxY: 1 };

  return { floorId, spaces, runs, perimeter, bounds };
}

export function buildHouseGeom(h: HouseData): Map<string, FloorGeom> {
  const m = new Map<string, FloorGeom>();
  for (const f of h.floors) if (f.hasPlan) m.set(f.id, buildFloorGeom(h, f.id));
  return m;
}
