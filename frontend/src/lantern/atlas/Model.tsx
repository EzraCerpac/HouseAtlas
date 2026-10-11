import type { KeyboardEvent, MutableRefObject, ReactNode } from 'react';
import type { HouseData, Overlay, Pt, Selection, Space } from '../data/types';
import { centroid, pointInPolygon, type FloorGeom, type Run } from './geometry';
import { depthSort, makeProjector, pts, type Footprint, type Projector, type SortItem } from './projection';
import { BIRCH, BIRCH_DARK, CARD, INK, LANTERN, LANTERN_EDGE, LAYER, ROOM_TINT, mix, shadeFor } from './palette';
import { GLYPH, FILLED_GLYPHS } from './glyphs';
import type { FurnitureSpec, PinSpec } from './pins';

export const S = 40;
export const FLOOR_H = 3;
export const GAP = 3.4;
const SLAB = 0.26;
const EXT_T = 0.24;
const INT_T = 0.12;
const EXT_CUT = 1.25;
const INT_CUT = 0.95;
const FULL = FLOOR_H - SLAB;
const LANTERN_H = 1.9;

// A type alias (not an interface) so it satisfies Record<string, number> in useEased.
export type ModelCam = {
  yaw: number;
  pitch: number;
  explode: number;
  top: number;
  zoom: number;
  fx: number;
  fy: number;
  fz: number;
};

export interface ModelProps {
  house: HouseData;
  geoms: Map<string, FloorGeom>;
  cam: ModelCam;
  mode: '3d' | '2d';
  exploded: boolean;
  floorId: string;
  overlay: Overlay;
  selection: Selection | null;
  pins: PinSpec[];
  furniture: FurnitureSpec[];
  hover: string | null;
  setHover: (id: string | null) => void;
  onPick: (id: string) => void;
  onFloor: (floorId: string) => void;
  dragMoved: MutableRefObject<boolean>;
  /** viewBox units per screen pixel, so UI marks keep a steady on-screen size. */
  ui: number;
  reduced: boolean;
}

interface Solid extends SortItem {
  node: ReactNode;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Where the camera is centred and how big the base plate is. */
export function plateOf(geoms: Map<string, FloorGeom>) {
  const all = [...geoms.values()];
  const minX = Math.min(...all.map((g) => g.bounds.minX)) - 1.8;
  const maxX = Math.max(...all.map((g) => g.bounds.maxX)) + 1.8;
  const minY = Math.min(...all.map((g) => g.bounds.minY)) - 1.8;
  const maxY = Math.max(...all.map((g) => g.bounds.maxY)) + 1.8;
  return { minX, maxX, minY, maxY, center: [(minX + maxX) / 2, (minY + maxY) / 2] as Pt };
}

export function plannedFloors(h: HouseData) {
  return h.floors.filter((f) => f.hasPlan).sort((a, b) => a.order - b.order);
}

/** Index of the floor that is "cut open", and whether a no-plan floor is selected. */
export function focusIndex(h: HouseData, floorId: string) {
  const planned = plannedFloors(h);
  const idx = planned.findIndex((f) => f.id === floorId);
  return idx >= 0 ? { idx, noPlan: false } : { idx: planned.length - 1, noPlan: true };
}

export function floorZ(i: number, explode: number) {
  return i * (FLOOR_H + explode * GAP);
}

export function computeViewBox(cam: ModelCam, geoms: Map<string, FloorGeom>, exploded3d: boolean) {
  const plate = plateOf(geoms);
  const P = makeProjector(cam, plate.center, S);
  const planT = clamp((cam.pitch - 62) / 24, 0, 1);
  const R = Math.hypot((plate.maxX - plate.minX) / 2, (plate.maxY - plate.minY) / 2);
  const zTop = floorZ(cam.top, cam.explode) + 2.1;
  const zBot = -SLAB - 0.34;
  // Radius bounds stay steady while spinning; corner bounds are tight for plan view.
  const rx0 = -R * S;
  const rx1 = R * S;
  const ry0 = -(R * P.sf + zTop * P.cf) * S;
  const ry1 = (R * P.sf - zBot * P.cf) * S;
  const corners: Pt[] = [];
  for (const x of [plate.minX, plate.maxX]) for (const y of [plate.minY, plate.maxY]) for (const z of [zBot, zTop]) corners.push(P.p(x, y, z));
  const cx0 = Math.min(...corners.map((c) => c[0]));
  const cx1 = Math.max(...corners.map((c) => c[0]));
  const cy0 = Math.min(...corners.map((c) => c[1]));
  const cy1 = Math.max(...corners.map((c) => c[1]));
  const padL = exploded3d ? lerp(24, 150, cam.explode) : 24;
  const x0 = lerp(rx0, cx0, planT) - padL;
  const x1 = lerp(rx1, cx1, planT) + 24;
  const y0 = lerp(ry0, cy0, planT) - 28;
  const y1 = lerp(ry1, cy1, planT) + 20;
  let w = x1 - x0;
  let h = y1 - y0;
  let vx = x0;
  let vy = y0;
  if (cam.zoom > 1.001) {
    const f = P.p(cam.fx, cam.fy, cam.fz);
    const nw = w / cam.zoom;
    const nh = h / cam.zoom;
    vx = clamp(f[0] - nw / 2, x0, x1 - nw);
    vy = clamp(f[1] - nh / 2, y0, y1 - nh);
    w = nw;
    h = nh;
  }
  return { x: vx, y: vy, w, h, plate, P, planT };
}

function screenBox(P: Projector, fp: Footprint, z0: number, z1: number, pad = 0) {
  let sMinX = Infinity;
  let sMaxX = -Infinity;
  let sMinY = Infinity;
  let sMaxY = -Infinity;
  for (const x of [fp.minX, fp.maxX])
    for (const y of [fp.minY, fp.maxY])
      for (const z of [z0, z1]) {
        const q = P.p(x, y, z);
        sMinX = Math.min(sMinX, q[0]);
        sMaxX = Math.max(sMaxX, q[0]);
        sMinY = Math.min(sMinY, q[1]);
        sMaxY = Math.max(sMaxY, q[1]);
      }
  return { sMinX: sMinX - pad, sMaxX: sMaxX + pad, sMinY: sMinY - pad, sMaxY: sMaxY + pad };
}

const FACES: { n: Pt; pick: (fp: Footprint) => [Pt, Pt] }[] = [
  { n: [0, -1], pick: (f) => [[f.minX, f.minY], [f.maxX, f.minY]] },
  { n: [1, 0], pick: (f) => [[f.maxX, f.minY], [f.maxX, f.maxY]] },
  { n: [0, 1], pick: (f) => [[f.maxX, f.maxY], [f.minX, f.maxY]] },
  { n: [-1, 0], pick: (f) => [[f.minX, f.maxY], [f.minX, f.minY]] },
];

interface Tone {
  top: string;
  side: string;
  stroke?: string | undefined;
}

function boxFaces(P: Projector, key: string, fp: Footprint, z0: number, z1: number, tone: Tone): ReactNode[] {
  const out: ReactNode[] = [];
  const stroke = tone.stroke ?? 'rgba(30,38,56,0.2)';
  if (P.cf > 0.01) {
    for (const f of FACES) {
      if (P.facing(f.n[0], f.n[1]) <= 0.001) continue;
      const [a, b] = f.pick(fp);
      const poly = [P.p(a[0], a[1], z0), P.p(b[0], b[1], z0), P.p(b[0], b[1], z1), P.p(a[0], a[1], z1)];
      out.push(<polygon key={`${key}-${f.n.join('')}`} points={pts(poly)} fill={mix(tone.side, '#9C8F78', shadeFor(f.n[0], f.n[1]) * 0.6)} stroke={stroke} strokeWidth={0.5} strokeLinejoin="round" />);
    }
  }
  const top = [P.p(fp.minX, fp.minY, z1), P.p(fp.maxX, fp.minY, z1), P.p(fp.maxX, fp.maxY, z1), P.p(fp.minX, fp.maxY, z1)];
  out.push(<polygon key={`${key}-top`} points={pts(top)} fill={tone.top} stroke={stroke} strokeWidth={0.5} strokeLinejoin="round" />);
  return out;
}

function runFootprint(r: Run, t: number, extend: boolean): Footprint {
  const e = extend ? t / 2 : 0;
  if (r.horizontal) {
    return { minX: Math.min(r.a[0], r.b[0]) - e, maxX: Math.max(r.a[0], r.b[0]) + e, minY: r.a[1] - t / 2, maxY: r.a[1] + t / 2 };
  }
  return { minX: r.a[0] - t / 2, maxX: r.a[0] + t / 2, minY: Math.min(r.a[1], r.b[1]) - e, maxY: Math.max(r.a[1], r.b[1]) + e };
}

function glassQuad(P: Projector, key: string, r: Run, z0: number, z1: number): ReactNode {
  const q = [P.p(r.a[0], r.a[1], z0), P.p(r.b[0], r.b[1], z0), P.p(r.b[0], r.b[1], z1), P.p(r.a[0], r.a[1], z1)];
  return <polygon key={key} points={pts(q)} fill="#CBE6F1" fillOpacity={0.55} stroke="#86B9CE" strokeWidth={0.8} strokeLinejoin="round" />;
}

function outwardOfEdge(poly: Pt[], a: Pt, b: Pt): Pt {
  const horizontal = a[1] === b[1];
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const test: Pt = horizontal ? [mx, my + 0.05] : [mx + 0.05, my];
  const inside = pointInPolygon(test, poly);
  return horizontal ? (inside ? [0, -1] : [0, 1]) : inside ? [-1, 0] : [1, 0];
}

function area(poly: Pt[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]!;
    const [x1, y1] = poly[(i + 1) % poly.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a / 2);
}

/** Pick the quarter-turn that keeps flat lettering reading left to right. */
function readableAngle(P: Projector) {
  let best = 0;
  let bestX = -Infinity;
  for (const a of [0, 90, 180, 270]) {
    const rad = (a * Math.PI) / 180;
    const d = P.dir(Math.cos(rad), Math.sin(rad));
    if (d[0] > bestX + 1e-6) {
      bestX = d[0];
      best = a;
    }
  }
  return best;
}

function activate(e: KeyboardEvent, fn: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
}

export function Model(props: ModelProps) {
  const { house, geoms, cam, mode, exploded, floorId, overlay, selection, pins, furniture, hover, setHover, onPick, onFloor, dragMoved, ui } = props;
  const planned = plannedFloors(house);
  const { idx: selIdx, noPlan } = focusIndex(house, floorId);
  const vb = computeViewBox(cam, geoms, mode === '3d' && exploded);
  const { P, plate, planT } = vb;
  const textAngle = readableAngle(P);
  const pick = (id: string) => () => {
    if (!dragMoved.current) onPick(id);
  };

  const selectedSpaceId = selection?.kind === 'space' ? selection.id : undefined;
  const contextSpaceId = (() => {
    if (!selection || selection.kind === 'space') return undefined;
    const rec = house.items.find((i) => i.id === selection.id) ?? house.containers.find((c) => c.id === selection.id);
    if (rec && 'containerId' in rec && rec.containerId) return house.containers.find((c) => c.id === rec.containerId)?.spaceId;
    const any = [...house.items, ...house.containers, ...house.outlets, ...house.valves, ...house.devices, ...house.panels].find((x) => x.id === selection.id) as { spaceId?: string } | undefined;
    if (any?.spaceId) return any.spaceId;
    const task = house.tasks.find((t) => t.id === selection.id);
    if (task?.targetId.startsWith('sp-')) return task.targetId;
    return undefined;
  })();
  const selectedItemContainer = selection?.kind === 'item' ? house.items.find((i) => i.id === selection.id)?.containerId : undefined;

  const pinR = 7.5 * ui;
  const floorsOut: ReactNode[] = [];
  const tagLayer: ReactNode[] = [];

  // ---------- Base plate ----------
  const plateZ = -SLAB;
  const plateZb = plateZ - 0.32;
  const plateFp = { minX: plate.minX, maxX: plate.maxX, minY: plate.minY, maxY: plate.maxY };
  const plateNodes: ReactNode[] = [];
  if (P.cf > 0.01) {
    for (const f of FACES) {
      if (P.facing(f.n[0], f.n[1]) <= 0.001) continue;
      const [a, b] = f.pick(plateFp);
      const poly = [P.p(a[0], a[1], plateZb), P.p(b[0], b[1], plateZb), P.p(b[0], b[1], plateZ), P.p(a[0], a[1], plateZ)];
      plateNodes.push(<polygon key={`plate-${f.n.join('')}`} points={pts(poly)} fill={mix(BIRCH, BIRCH_DARK, 0.25 + shadeFor(f.n[0], f.n[1]) * 0.6)} />);
    }
  }
  const plateTop = [P.p(plate.minX, plate.minY, plateZ), P.p(plate.maxX, plate.minY, plateZ), P.p(plate.maxX, plate.maxY, plateZ), P.p(plate.minX, plate.maxY, plateZ)];
  plateNodes.push(<polygon key="plate-top" points={pts(plateTop)} fill={mix('#E9D7B3', '#F4ECDD', planT)} />);
  const gridLines: ReactNode[] = [];
  for (let x = Math.ceil(plate.minX); x <= plate.maxX; x++) gridLines.push(<line key={`gx${x}`} x1={x} y1={plate.minY} x2={x} y2={plate.maxY} />);
  for (let y = Math.ceil(plate.minY); y <= plate.maxY; y++) gridLines.push(<line key={`gy${y}`} x1={plate.minX} y1={y} x2={plate.maxX} y2={y} />);
  const pcx = plate.center[0];
  plateNodes.push(
    <g key="plate-grid" transform={P.planeMatrix(plateZ)} className="plate-grid">
      {gridLines}
    </g>,
  );
  {
    // Engraved north arrow and caption on the base plate.
    const nx = plate.minX + 1.0;
    const ny = plate.minY + 1.1;
    plateNodes.push(
      <g key="plate-engrave" transform={`${P.planeMatrix(plateZ)} scale(0.01)`} className="plate-engrave">
        <circle cx={nx * 100} cy={ny * 100} r={55} />
        <path d={`M${nx * 100} ${ny * 100 - 48} L${nx * 100 + 18} ${ny * 100 + 22} L${nx * 100} ${ny * 100 + 10} L${nx * 100 - 18} ${ny * 100 + 22} Z`} className="fill" />
        <text x={nx * 100} y={ny * 100 - 70} transform={`rotate(${textAngle} ${nx * 100} ${ny * 100 - 70})`} textAnchor="middle" fontSize={34}>
          N
        </text>
        <text x={pcx * 100} y={(plate.maxY - 0.6) * 100} transform={`rotate(${textAngle} ${pcx * 100} ${(plate.maxY - 0.6) * 100})`} textAnchor="middle" fontSize={34}>
          {house.name}, fictional demo model, grid 1 m
        </text>
      </g>,
    );
  }

  // ---------- Floors ----------
  planned.forEach((floor, i) => {
    const g = geoms.get(floor.id);
    if (!g) return;
    const z = floorZ(i, cam.explode);
    const visible = mode === '2d' ? i === selIdx && !noPlan : exploded ? true : i <= selIdx;
    const focused = noPlan ? i === selIdx : i === selIdx;
    const dim = mode === '3d' && exploded && !focused && !noPlan;
    const m = i < selIdx ? 1 - cam.explode : 0; // 1 = closed massing below the cut floor
    const showInside = m < 0.6;
    const extH = lerp(EXT_CUT, FULL, m);
    const nodes: ReactNode[] = [];

    // Slab edges, with ply laminations.
    if (P.cf > 0.01) {
      const faces = g.perimeter
        .filter((r) => r.normal && P.facing(r.normal[0], r.normal[1]) > 0.001)
        .map((r) => {
          const n = r.normal!;
          const off = EXT_T / 2;
          const s0 = r.horizontal ? Math.min(r.a[0], r.b[0]) : Math.min(r.a[1], r.b[1]);
          const s1 = r.horizontal ? Math.max(r.a[0], r.b[0]) : Math.max(r.a[1], r.b[1]);
          const a: Pt = r.horizontal ? [s0 - off, r.a[1] + n[1] * off] : [r.a[0] + n[0] * off, s0 - off];
          const b: Pt = r.horizontal ? [s1 + off, r.a[1] + n[1] * off] : [r.a[0] + n[0] * off, s1 + off];
          return { a, b, n, depth: P.depth((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z) };
        })
        .sort((x, y) => x.depth - y.depth);
      faces.forEach((f, k) => {
        const quad = [P.p(f.a[0], f.a[1], z), P.p(f.b[0], f.b[1], z), P.p(f.b[0], f.b[1], z - SLAB), P.p(f.a[0], f.a[1], z - SLAB)];
        const shade = shadeFor(f.n[0], f.n[1]);
        nodes.push(<polygon key={`slab-${k}`} points={pts(quad)} fill={mix('#E8CF9E', BIRCH_DARK, 0.15 + shade * 0.55)} />);
        for (const t of [0.34, 0.67]) {
          const l = [P.p(f.a[0], f.a[1], z - SLAB * t), P.p(f.b[0], f.b[1], z - SLAB * t)];
          nodes.push(<polyline key={`ply-${k}-${t}`} points={pts(l)} stroke={mix(BIRCH_DARK, INK, 0.2)} strokeOpacity={0.35} strokeWidth={0.6} fill="none" />);
        }
      });
    }

    // Room floors.
    for (const sp of g.spaces) {
      const poly = sp.shape!;
      const isSel = sp.id === selectedSpaceId;
      const isHover = hover === sp.id;
      let fill = ROOM_TINT[sp.kind];
      if (overlay !== 'spaces') fill = mix(fill, '#F3EFE8', 0.55);
      if (isHover) fill = mix(fill, '#FFFFFF', 0.4);
      if (isSel) fill = mix(fill, LANTERN, 0.75);
      const screen = poly.map(([x, y]) => P.p(x, y, z));
      nodes.push(
        <polygon
          key={`room-${sp.id}`}
          className="room"
          points={pts(screen)}
          fill={fill}
          stroke={sp.id === contextSpaceId ? INK : 'rgba(30,38,56,0.12)'}
          strokeWidth={sp.id === contextSpaceId ? 1.4 * ui : 0.6}
          strokeDasharray={sp.id === contextSpaceId ? `${4 * ui} ${3 * ui}` : undefined}
          role="button"
          tabIndex={visible && focused && showInside ? 0 : -1}
          aria-label={`${sp.name}, ${floor.name}`}
          aria-pressed={isSel}
          onClick={pick(sp.id)}
          onKeyDown={(e) => activate(e, () => onPick(sp.id))}
          onPointerEnter={() => setHover(sp.id)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(sp.id)}
          onBlur={() => setHover(null)}
        />,
      );
      nodes.push(...roomDecor(P, sp, z));
    }

    // Plan-view door swings and overall dimensions.
    if (planT > 0.05) {
      nodes.push(
        <g key="plan-marks" transform={P.planeMatrix(z)} opacity={planT} className="plan-marks">
          {g.runs
            .filter((r) => r.type === 'door')
            .map((r, k) => {
              const L = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
              const perp: Pt = r.normal ? [-r.normal[0], -r.normal[1]] : r.horizontal ? [0, 1] : [1, 0];
              const e: Pt = [r.a[0] + perp[0] * L, r.a[1] + perp[1] * L];
              const cross = (r.b[0] - r.a[0]) * (e[1] - r.a[1]) - (r.b[1] - r.a[1]) * (e[0] - r.a[0]);
              return (
                <g key={`door-${k}`}>
                  <line x1={r.a[0]} y1={r.a[1]} x2={e[0]} y2={e[1]} />
                  <path d={`M${r.b[0]} ${r.b[1]} A${L} ${L} 0 0 ${cross > 0 ? 1 : 0} ${e[0]} ${e[1]}`} strokeDasharray="3 3" />
                </g>
              );
            })}
          {focused && <Dimensions g={g} angle={textAngle} />}
        </g>,
      );
    }

    // Flat lettering on the floor.
    if (focused && showInside) {
      nodes.push(
        <g key="labels" transform={`${P.planeMatrix(z)} scale(0.01)`} className="room-labels" opacity={overlay === 'spaces' ? 1 : 0.7}>
          {g.spaces.map((sp) => {
            const c = centroid(sp.shape!);
            const small = sp.kind === 'stair' || area(sp.shape!) < 7;
            const cx = c[0] * 100;
            const cy = c[1] * 100;
            return (
              <g key={sp.id} transform={`rotate(${textAngle} ${cx} ${cy})`}>
                <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={small ? 22 : 30} className="room-name">
                  {sp.name}
                </text>
                {planT > 0.5 && sp.kind !== 'stair' && (
                  <text x={cx} y={cy + 30} textAnchor="middle" dominantBaseline="middle" fontSize={19} className="room-area">
                    {area(sp.shape!).toFixed(1)} m²
                  </text>
                )}
              </g>
            );
          })}
        </g>,
      );
    }

    // ---------- Solids: walls, furniture, storage, pins ----------
    const solids: Solid[] = [];
    const wallTone: Tone = { top: mix('#FFFFFF', INK, planT), side: CARD };
    const sillTone: Tone = { top: mix('#FFFFFF', '#9CCADB', planT), side: CARD };
    const push = (key: string, fp: Footprint, z0: number, z1: number, node: ReactNode, pad = 0) => {
      const c = { x: (fp.minX + fp.maxX) / 2, y: (fp.minY + fp.maxY) / 2 };
      solids.push({ key, ...fp, depth: P.depth(c.x, c.y, (z0 + z1) / 2), ...screenBox(P, fp, z0, z1, pad), node });
    };

    g.runs.forEach((r, k) => {
      const key = `w${k}`;
      const exterior = r.envelope || r.type === 'exterior' || ((r.type === 'window' || r.type === 'glazed' || r.type === 'door') && !!r.normal);
      if (!exterior && !showInside) return;
      const t = exterior ? EXT_T : INT_T;
      const h = exterior ? extH : INT_CUT;
      switch (r.type) {
        case 'exterior':
        case 'interior': {
          const fp = runFootprint(r, t, true);
          push(key, fp, z, z + h, <g key={key}>{boxFaces(P, key, fp, z, z + h, wallTone)}</g>);
          break;
        }
        case 'window': {
          const fp = runFootprint(r, t, false);
          const sill = h > 2 ? 0.9 : 0.42;
          const head = h > 2 ? 2.15 : h;
          push(
            key,
            fp,
            z,
            z + h,
            <g key={key}>
              {boxFaces(P, `${key}s`, fp, z, z + sill, sillTone)}
              {P.cf > 0.01 && glassQuad(P, `${key}g`, r, z + sill, z + head)}
              {head < h && boxFaces(P, `${key}h`, fp, z + head, z + h, wallTone)}
            </g>,
          );
          break;
        }
        case 'glazed': {
          const fp = runFootprint(r, t, false);
          const head = Math.min(h, 2.15);
          push(
            key,
            fp,
            z,
            z + h,
            <g key={key}>
              {boxFaces(P, `${key}c`, fp, z, z + 0.04, sillTone)}
              {P.cf > 0.01 && glassQuad(P, `${key}g`, r, z + 0.04, z + head)}
              {head < h - 0.01 && boxFaces(P, `${key}h`, fp, z + head, z + h, wallTone)}
            </g>,
          );
          break;
        }
        case 'door': {
          if (h > 2.15) {
            const fp = runFootprint(r, t, false);
            push(key, fp, z + 2.1, z + h, <g key={key}>{boxFaces(P, key, fp, z + 2.1, z + h, wallTone)}</g>);
          }
          break;
        }
        case 'rail': {
          const fp = runFootprint(r, EXT_T * 0.6, true);
          const railTop = [P.p(r.a[0], r.a[1], z + 0.95), P.p(r.b[0], r.b[1], z + 0.95)];
          push(
            key,
            fp,
            z,
            z + 0.95,
            <g key={key}>
              {boxFaces(P, `${key}c`, fp, z, z + 0.12, wallTone)}
              {P.cf > 0.01 && glassQuad(P, `${key}g`, r, z + 0.12, z + 0.95)}
              {P.cf > 0.01 && <polyline points={pts(railTop)} stroke={INK} strokeOpacity={0.55} strokeWidth={1.1} fill="none" />}
            </g>,
          );
          break;
        }
        default:
          break;
      }
    });

    if (showInside) {
      for (const f of furniture) {
        if (f.floorId !== floor.id) continue;
        const isSel = selection?.id === f.id;
        const tone: Tone = {
          top: isSel ? mix(LANTERN, '#FFFFFF', 0.2) : overlay === 'belongings' ? mix('#F1E6CF', LAYER.belongings.color, 0.16) : mix('#F1E6CF', '#FFFFFF', planT * 0.3),
          side: isSel ? LANTERN : '#E8D9B9',
          stroke: isSel ? LANTERN_EDGE : undefined,
        };
        push(
          `f-${f.id}`,
          f,
          z,
          z + f.h,
          <g key={`f-${f.id}`} className="furniture" onClick={pick(f.id)} onPointerEnter={() => setHover(f.id)} onPointerLeave={() => setHover(null)}>
            {boxFaces(P, `f-${f.id}`, f, z, z + f.h, tone)}
          </g>,
        );
      }
      for (const c of house.containers) {
        if (!c.pos || !c.size) continue;
        const sp = house.spaces.find((s) => s.id === c.spaceId);
        if (sp?.floorId !== floor.id) continue;
        const fp = { minX: c.pos[0] - c.size[0] / 2, maxX: c.pos[0] + c.size[0] / 2, minY: c.pos[1] - c.size[1] / 2, maxY: c.pos[1] + c.size[1] / 2 };
        const isSel = selection?.id === c.id || selectedItemContainer === c.id;
        const tone: Tone = {
          top: isSel ? LANTERN : overlay === 'belongings' ? mix('#FFFFFF', LAYER.belongings.color, 0.22) : '#FFFFFF',
          side: isSel ? mix(LANTERN, CARD, 0.4) : '#F4EFF2',
          stroke: overlay === 'belongings' || isSel ? mix(LAYER.belongings.color, INK, 0.3) : undefined,
        };
        push(
          `c-${c.id}`,
          fp,
          z,
          z + 0.9,
          <g key={`c-${c.id}`} className="furniture" onClick={pick(c.id)} onPointerEnter={() => setHover(c.id)} onPointerLeave={() => setHover(null)}>
            {boxFaces(P, `c-${c.id}`, fp, z, z + 0.9, tone)}
          </g>,
        );
      }
      for (const pin of pins) {
        if (pin.floorId !== floor.id) continue;
        const isSel = selection?.id === pin.id || selectedItemContainer === pin.id;
        const R = pinR * pin.size * (isSel ? 1.25 : 1);
        const base = P.p(pin.x, pin.y, z + pin.base);
        const top = P.p(pin.x, pin.y, z + pin.base + pin.stem);
        const fp = { minX: pin.x - 0.04, maxX: pin.x + 0.04, minY: pin.y - 0.04, maxY: pin.y + 0.04 };
        const node = (
          <PinMark
            key={`p-${pin.id}`}
            spec={pin}
            base={base}
            top={top}
            floorPt={P.p(pin.x, pin.y, z)}
            R={R}
            sf={P.sf}
            ui={ui}
            selected={isSel}
            hovered={hover === pin.id}
            focusable={visible && focused}
            onPick={pick(pin.id)}
            onKey={(e) => activate(e, () => onPick(pin.id))}
            setHover={setHover}
          />
        );
        const sb = {
          sMinX: Math.min(base[0], top[0]) - R - 3 * ui,
          sMaxX: Math.max(base[0], top[0]) + R + 3 * ui,
          sMinY: Math.min(base[1], top[1]) - R - 3 * ui,
          sMaxY: Math.max(base[1], top[1]) + R,
        };
        solids.push({ key: `p-${pin.id}`, ...fp, depth: P.depth(pin.x, pin.y, z + pin.base), ...sb, node });
      }
    }

    const sorted = depthSort(solids, P.st, P.ct);
    for (const s of sorted) nodes.push(s.node);

    // The lantern: selected room glows as a volume of light.
    const selSpace = g.spaces.find((s) => s.id === selectedSpaceId);
    if (selSpace && visible) nodes.push(<Lantern key={`lantern-${selSpace.id}`} P={P} space={selSpace} z={z} ui={ui} reduced={props.reduced} />);

    floorsOut.push(
      <g
        key={floor.id}
        className={`floor${dim ? ' is-dim' : ''}`}
        style={{ opacity: visible ? (dim ? 0.4 : 1) : 0, pointerEvents: visible ? 'auto' : 'none' }}
        aria-hidden={!visible}
      >
        {nodes}
      </g>,
    );

    // Floor tags beside the exploded stack.
    if (mode === '3d' && cam.explode > 0.05 && visible) {
      const corners: Pt[] = [
        [g.bounds.minX, g.bounds.minY],
        [g.bounds.maxX, g.bounds.minY],
        [g.bounds.maxX, g.bounds.maxY],
        [g.bounds.minX, g.bounds.maxY],
      ];
      const proj = corners.map(([x, y]) => P.p(x, y, z - SLAB / 2));
      const anchor = proj.reduce((a, b) => (b[0] < a[0] ? b : a));
      const tx = vb.x + 14 * ui;
      const count = house.spaces.filter((s) => s.floorId === floor.id && s.kind !== 'stair').length;
      tagLayer.push(
        <g
          key={`tag-${floor.id}`}
          className={`floor-tag${focused ? ' is-current' : ''}`}
          opacity={cam.explode}
          role="button"
          tabIndex={-1}
          aria-label={`Show ${floor.name}`}
          onClick={() => !dragMoved.current && onFloor(floor.id)}
        >
          <line x1={tx + 96 * ui} y1={anchor[1]} x2={anchor[0] - 6 * ui} y2={anchor[1]} strokeWidth={ui} />
          <circle cx={anchor[0] - 4 * ui} cy={anchor[1]} r={2.4 * ui} />
          <g transform={`translate(${tx} ${anchor[1]}) scale(${ui})`}>
            <text x={0} y={-2} className="floor-tag-short">
              {floor.short}
            </text>
            <text x={0} y={15} className="floor-tag-name">
              {floor.name}, {count} rooms
            </text>
          </g>
        </g>,
      );
    }
  });

  // ---------- Callouts ----------
  const callout = (id: string, strong: boolean): ReactNode => {
    const pin = pins.find((p) => p.id === id);
    if (pin) {
      const i = planned.findIndex((f) => f.id === pin.floorId);
      if (i < 0) return null;
      const vis = mode === '2d' ? i === selIdx : exploded || i <= selIdx;
      if (!vis) return null;
      const top = P.p(pin.x, pin.y, floorZ(i, cam.explode) + pin.base + pin.stem);
      return <Tag key={`tag-${id}-${strong}`} x={top[0]} y={top[1] - pinR * pin.size * 1.6} title={pin.label} sub={pin.sub} ui={ui} strong={strong} />;
    }
    const sp = house.spaces.find((s) => s.id === id && s.shape);
    const fur = furniture.find((f) => f.id === id);
    if (sp) {
      const i = planned.findIndex((f) => f.id === sp.floorId);
      const vis = mode === '2d' ? i === selIdx : exploded || i <= selIdx;
      if (!vis) return null;
      const c = centroid(sp.shape!);
      const h = strong ? LANTERN_H : 0.4;
      const q = P.p(c[0], c[1], floorZ(i, cam.explode) + h);
      const n = house.items.filter((x) => x.spaceId === sp.id).length;
      return <Tag key={`tag-${id}-${strong}`} x={q[0]} y={q[1] - 6 * ui} title={sp.name} sub={sp.kind === 'stair' ? 'Stair' : `${n} ${n === 1 ? 'belonging' : 'belongings'} recorded`} ui={ui} strong={strong} />;
    }
    if (fur) {
      const i = planned.findIndex((f) => f.id === fur.floorId);
      const it = house.items.find((x) => x.id === id);
      const q = P.p((fur.minX + fur.maxX) / 2, (fur.minY + fur.maxY) / 2, floorZ(i, cam.explode) + fur.h);
      return <Tag key={`tag-${id}-${strong}`} x={q[0]} y={q[1] - 8 * ui} title={it?.name ?? ''} sub={it?.category} ui={ui} strong={strong} />;
    }
    const ct = house.containers.find((c) => c.id === id);
    if (ct?.pos) {
      const sp2 = house.spaces.find((s) => s.id === ct.spaceId);
      const i = planned.findIndex((f) => f.id === sp2?.floorId);
      const q = P.p(ct.pos[0], ct.pos[1], floorZ(i, cam.explode) + 0.9);
      const n = house.items.filter((x) => x.containerId === ct.id).length;
      return <Tag key={`tag-${id}-${strong}`} x={q[0]} y={q[1] - 8 * ui} title={ct.name} sub={`Storage, ${n} inside`} ui={ui} strong={strong} />;
    }
    return null;
  };

  if (selection && selection.id !== hover) tagLayer.push(callout(selection.id, true));
  if (hover) tagLayer.push(callout(hover, false));

  return (
    <svg
      className="model"
      viewBox={`${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label={`${house.name} model. Fictional demo geometry.`}
    >
      <defs>
        <linearGradient id="lantern-face" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={LANTERN} stopOpacity={0.7} />
          <stop offset="1" stopColor={LANTERN} stopOpacity={0.04} />
        </linearGradient>
        <filter id="lantern-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={10} />
        </filter>
        <filter id="plate-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={14} />
        </filter>
      </defs>
      <polygon points={pts(plateTop.map(([x, y]) => [x + 10, y + 26] as Pt))} fill="#6B5634" opacity={0.18 * (1 - planT)} filter="url(#plate-shadow)" />
      <g className="plate">{plateNodes}</g>
      {floorsOut}
      <g className="tags">{tagLayer}</g>
    </svg>
  );
}

function roomDecor(P: Projector, sp: Space, z: number): ReactNode[] {
  const poly = sp.shape!;
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  if (sp.kind === 'stair') {
    const lines: ReactNode[] = [];
    const alongY = y1 - y0 >= x1 - x0;
    const len = alongY ? y1 - y0 : x1 - x0;
    const n = Math.floor(len / 0.28);
    for (let k = 1; k < n; k++) {
      const t = (alongY ? y0 : x0) + k * 0.28;
      lines.push(alongY ? <line key={k} x1={x0 + 0.15} y1={t} x2={x1 - 0.15} y2={t} /> : <line key={k} x1={t} y1={y0 + 0.15} x2={t} y2={y1 - 0.15} />);
    }
    const mid = alongY ? (x0 + x1) / 2 : (y0 + y1) / 2;
    return [
      <g key={`stair-${sp.id}`} transform={P.planeMatrix(z)} className="stair-treads">
        {lines}
        {alongY ? <path className="stair-arrow" d={`M${mid} ${y1 - 0.3} V${y0 + 0.5} m-0.18 0.3 l0.18 -0.3 l0.18 0.3`} /> : null}
      </g>,
    ];
  }
  if (sp.kind === 'outdoor') {
    const lines: ReactNode[] = [];
    for (let y = y0 + 0.2; y < y1; y += 0.2) lines.push(<line key={y} x1={x0} y1={y} x2={x1} y2={y} />);
    return [
      <g key={`deck-${sp.id}`} transform={P.planeMatrix(z)} className="deck-boards">
        {lines}
      </g>,
    ];
  }
  return [];
}

function Dimensions({ g, angle }: { g: FloorGeom; angle: number }) {
  const { minX, maxX, minY, maxY } = g.bounds;
  const off = 0.9;
  const tick = 0.18;
  const w = (maxX - minX).toFixed(2);
  const d = (maxY - minY).toFixed(2);
  return (
    <g className="dims">
      <line x1={minX} y1={minY - off} x2={maxX} y2={minY - off} />
      <line x1={minX} y1={minY - off - tick} x2={minX} y2={minY - off + tick} />
      <line x1={maxX} y1={minY - off - tick} x2={maxX} y2={minY - off + tick} />
      <line x1={minX - off} y1={minY} x2={minX - off} y2={maxY} />
      <line x1={minX - off - tick} y1={minY} x2={minX - off + tick} y2={minY} />
      <line x1={minX - off - tick} y1={maxY} x2={minX - off + tick} y2={maxY} />
      <g transform="scale(0.01)">
        <text x={((minX + maxX) / 2) * 100} y={(minY - off - 0.22) * 100} transform={`rotate(${angle} ${((minX + maxX) / 2) * 100} ${(minY - off - 0.22) * 100})`} textAnchor="middle" fontSize={24}>
          {w} m
        </text>
        <text x={(minX - off - 0.3) * 100} y={((minY + maxY) / 2) * 100} transform={`rotate(${angle - 90} ${(minX - off - 0.3) * 100} ${((minY + maxY) / 2) * 100})`} textAnchor="middle" fontSize={24}>
          {d} m
        </text>
      </g>
    </g>
  );
}

function Lantern({ P, space, z, ui, reduced }: { P: Projector; space: Space; z: number; ui: number; reduced: boolean }) {
  const poly = space.shape!;
  const floor = poly.map(([x, y]) => P.p(x, y, z));
  const h = LANTERN_H * P.cf > 0.01 ? LANTERN_H : 0;
  const faces: ReactNode[] = [];
  if (h > 0) {
    const edges = poly
      .map((a, i) => {
        const b = poly[(i + 1) % poly.length]!;
        const n = outwardOfEdge(poly, a, b);
        return { a, b, n, d: P.depth((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z) };
      })
      .sort((x, y) => x.d - y.d);
    edges.forEach((e, k) => {
      const q = [P.p(e.a[0], e.a[1], z), P.p(e.b[0], e.b[1], z), P.p(e.b[0], e.b[1], z + h), P.p(e.a[0], e.a[1], z + h)];
      const front = P.facing(e.n[0], e.n[1]) > 0;
      faces.push(<polygon key={k} points={pts(q)} fill="url(#lantern-face)" opacity={front ? 0.9 : 0.55} />);
    });
  }
  const top = poly.map(([x, y]) => P.p(x, y, z + h));
  return (
    <g className={`lantern${reduced ? '' : ' is-animated'}`} pointerEvents="none">
      <polygon points={pts(floor)} fill={LANTERN} opacity={0.75} filter="url(#lantern-glow)" />
      {faces}
      <polygon points={pts(floor)} fill="none" stroke={LANTERN_EDGE} strokeWidth={1.8 * ui} strokeLinejoin="round" />
      {h > 0 && <polygon points={pts(top)} fill="none" stroke={LANTERN_EDGE} strokeOpacity={0.75} strokeWidth={1.1 * ui} strokeLinejoin="round" />}
    </g>
  );
}

interface PinMarkProps {
  spec: PinSpec;
  base: Pt;
  top: Pt;
  floorPt: Pt;
  R: number;
  sf: number;
  ui: number;
  selected: boolean;
  hovered: boolean;
  focusable: boolean;
  onPick: () => void;
  onKey: (e: KeyboardEvent) => void;
  setHover: (id: string | null) => void;
}

function PinMark({ spec, base, top, floorPt, R, sf, ui, selected, hovered, focusable, onPick, onKey, setHover }: PinMarkProps) {
  const color = spec.color;
  const [tx, ty] = top;
  const fill = spec.hollow ? '#FFFFFF' : color;
  const glyphStroke = spec.hollow ? color : '#FFFFFF';
  let head: ReactNode;
  if (spec.shape === 'square') head = <rect x={tx - R} y={ty - R} width={R * 2} height={R * 2} rx={R * 0.3} fill={fill} stroke={spec.hollow ? color : '#FFFFFF'} strokeWidth={1.4 * ui} />;
  else if (spec.shape === 'diamond')
    head = <polygon points={pts([[tx, ty - R * 1.2], [tx + R * 1.2, ty], [tx, ty + R * 1.2], [tx - R * 1.2, ty]])} fill={fill} stroke={spec.hollow ? color : '#FFFFFF'} strokeWidth={1.4 * ui} strokeLinejoin="round" />;
  else head = <circle cx={tx} cy={ty} r={R} fill={fill} stroke={spec.hollow ? color : '#FFFFFF'} strokeWidth={1.4 * ui} />;
  const filled = FILLED_GLYPHS.includes(spec.glyph);
  return (
    <g
      className={`pin${spec.faded ? ' is-faded' : ''}${selected ? ' is-selected' : ''}${hovered ? ' is-hover' : ''}`}
      role="button"
      tabIndex={focusable ? 0 : -1}
      aria-label={`${spec.label}${spec.sub ? `, ${spec.sub}` : ''}`}
      aria-pressed={selected}
      onClick={onPick}
      onKeyDown={onKey}
      onPointerEnter={() => setHover(spec.id)}
      onPointerLeave={() => setHover(null)}
      onFocus={() => setHover(spec.id)}
      onBlur={() => setHover(null)}
    >
      <ellipse cx={floorPt[0]} cy={floorPt[1]} rx={R * 0.75} ry={R * 0.75 * sf} fill="#1E2638" opacity={0.16} />
      <line x1={base[0]} y1={base[1]} x2={tx} y2={ty} stroke={color} strokeWidth={1.5 * ui} />
      {selected && <circle className="pin-halo" cx={tx} cy={ty} r={R * 1.9} fill="none" stroke={color} strokeWidth={1.4 * ui} />}
      {spec.ring !== 'none' && (
        <circle cx={tx} cy={ty} r={R + 3 * ui} fill="none" stroke={color} strokeWidth={1.2 * ui} strokeDasharray={spec.ring === 'dashed' ? `${2.6 * ui} ${2 * ui}` : undefined} />
      )}
      {head}
      <path
        d={GLYPH[spec.glyph]}
        transform={`translate(${tx - R * 0.62} ${ty - R * 0.62}) scale(${R * 0.124})`}
        fill={filled ? glyphStroke : 'none'}
        stroke={filled ? 'none' : glyphStroke}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {spec.count !== undefined && spec.count > 0 && (
        <g transform={`translate(${tx + R * 0.95} ${ty - R * 0.95}) scale(${ui})`}>
          <circle r={7} fill="#FFFFFF" stroke={color} strokeWidth={1.2} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={700} fill={color}>
            {spec.count}
          </text>
        </g>
      )}
      <circle cx={tx} cy={ty} r={R * 1.7} fill="transparent" className="pin-hit" />
    </g>
  );
}

function Tag({ x, y, title, sub, ui, strong }: { x: number; y: number; title: string; sub?: string | undefined; ui: number; strong: boolean }) {
  const w = Math.max(title.length * 7.4, (sub?.length ?? 0) * 5.9) + 22;
  const h = sub ? 40 : 26;
  return (
    <g transform={`translate(${x} ${y}) scale(${ui})`} className={`callout${strong ? ' is-strong' : ''}`} pointerEvents="none">
      <path d={`M${-w / 2} ${-h - 7} h${w} v${h} H6 l-6 7 l-6 -7 H${-w / 2} Z`} className="callout-box" />
      <text x={-w / 2 + 11} y={-h - 7 + 17} className="callout-title">
        {title}
      </text>
      {sub && (
        <text x={-w / 2 + 11} y={-h - 7 + 32} className="callout-sub">
          {sub}
        </text>
      )}
    </g>
  );
}
