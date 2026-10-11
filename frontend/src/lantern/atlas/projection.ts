import type { Pt } from '../data/types';

/** Orthographic camera. Yaw spins the model on the base plate, pitch tilts it (90 = plan view). */
export interface Cam {
  yaw: number;
  pitch: number;
  explode: number;
}

export interface Projector {
  S: number;
  st: number;
  ct: number;
  sf: number;
  cf: number;
  p: (x: number, y: number, z: number) => Pt;
  depth: (x: number, y: number, z: number) => number;
  /** > 0 when a vertical face with this world normal faces the viewer. */
  facing: (nx: number, ny: number) => number;
  /** SVG matrix() that maps plane coordinates (metres) at height z onto the screen. */
  planeMatrix: (z: number) => string;
  /** Unit screen direction of a world direction lying in the ground plane. */
  dir: (dx: number, dy: number) => Pt;
}

export const DEG = Math.PI / 180;

export function makeProjector(cam: Cam, center: Pt, S = 40): Projector {
  const t = cam.yaw * DEG;
  const f = cam.pitch * DEG;
  const ct = Math.cos(t);
  const st = Math.sin(t);
  const sf = Math.sin(f);
  const cf = Math.max(0, Math.cos(f));
  const [cx, cy] = center;
  const p = (x: number, y: number, z: number): Pt => {
    const X = x - cx;
    const Y = y - cy;
    const rx = X * ct - Y * st;
    const ry = X * st + Y * ct;
    return [rx * S, (ry * sf - z * cf) * S];
  };
  return {
    S,
    st,
    ct,
    sf,
    cf,
    p,
    depth: (x, y, z) => {
      const X = x - cx;
      const Y = y - cy;
      return (X * st + Y * ct) * cf + z * sf;
    },
    facing: (nx, ny) => nx * st + ny * ct,
    planeMatrix: (z) => {
      const o = p(0, 0, z);
      // d/dx and d/dy of the projection.
      const ax = ct * S;
      const ay = st * sf * S;
      const bx = -st * S;
      const by = ct * sf * S;
      return `matrix(${ax.toFixed(4)} ${ay.toFixed(4)} ${bx.toFixed(4)} ${by.toFixed(4)} ${o[0].toFixed(2)} ${o[1].toFixed(2)})`;
    },
    dir: (dx, dy) => {
      const sx = (dx * ct - dy * st) * S;
      const sy = (dx * st + dy * ct) * sf * S;
      const len = Math.hypot(sx, sy) || 1;
      return [sx / len, sy / len];
    },
  };
}

export const pts = (list: Pt[]) => list.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');

export interface Footprint {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface SortItem extends Footprint {
  key: string;
  depth: number;
  /** Screen-space bounding box, used to only order things that can overlap. */
  sMinX: number;
  sMaxX: number;
  sMinY: number;
  sMaxY: number;
}

/**
 * Painter's ordering for axis-aligned plan boxes: builds "behind" edges only for
 * pairs whose screen boxes overlap, then a depth-prioritised topological sort.
 */
export function depthSort<T extends SortItem>(items: T[], st: number, ct: number): T[] {
  const n = items.length;
  const eps = 1e-3;
  const tiny = 1e-6;
  const behind = (A: SortItem, B: SortItem): boolean => {
    if (A.maxX <= B.minX + eps && Math.abs(st) > tiny) return st > 0;
    if (B.maxX <= A.minX + eps && Math.abs(st) > tiny) return st < 0;
    if (A.maxY <= B.minY + eps && Math.abs(ct) > tiny) return ct > 0;
    if (B.maxY <= A.minY + eps && Math.abs(ct) > tiny) return ct < 0;
    return A.depth < B.depth;
  };
  const indeg = new Array(n).fill(0);
  const out: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const A = items[i]!;
    for (let j = i + 1; j < n; j++) {
      const B = items[j]!;
      if (A.sMaxX < B.sMinX || B.sMaxX < A.sMinX || A.sMaxY < B.sMinY || B.sMaxY < A.sMinY) continue;
      if (behind(A, B)) {
        out[i]!.push(j);
        indeg[j]!++;
      } else {
        out[j]!.push(i);
        indeg[i]!++;
      }
    }
  }
  const done = new Array(n).fill(false);
  const result: T[] = [];
  for (let step = 0; step < n; step++) {
    let pick = -1;
    for (let i = 0; i < n; i++) {
      if (done[i] || indeg[i]! > 0) continue;
      if (pick < 0 || items[i]!.depth < items[pick]!.depth) pick = i;
    }
    if (pick < 0) {
      // Cycle: break it with the farthest remaining item.
      for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || items[i]!.depth < items[pick]!.depth)) pick = i;
    }
    done[pick] = true;
    result.push(items[pick]!);
    for (const j of out[pick]!) indeg[j]!--;
  }
  return result;
}
