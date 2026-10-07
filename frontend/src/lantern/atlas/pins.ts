import type { HouseData, Illustration, Overlay, Pt, Selection } from '../data/types';
import { dueState, findSpace, latestObservation, locate } from '../data/query';
import { centroid } from './geometry';
import { LAYER, mix } from './palette';
import type { GlyphName } from './glyphs';

export interface PinSpec {
  id: string;
  floorId: string;
  x: number;
  y: number;
  /** Height above the floor where the stem starts (top of furniture, wall socket...). */
  base: number;
  stem: number;
  color: string;
  glyph: GlyphName;
  shape: 'circle' | 'square' | 'diamond';
  ring: 'none' | 'solid' | 'dashed';
  size: number;
  label: string;
  sub?: string;
  faded?: boolean;
  hollow?: boolean;
  count?: number;
}

export interface FurnitureSpec {
  id: string;
  floorId: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  h: number;
}

const FURN: Partial<Record<Illustration, [number, number, number]>> = {
  dishwasher: [0.6, 0.6, 0.85],
  fridge: [0.7, 0.7, 1.2],
  oven: [0.6, 0.6, 0.9],
  washer: [0.6, 0.6, 0.85],
  sofa: [2.4, 0.95, 0.45],
  tv: [1.2, 0.3, 0.7],
  piano: [1.5, 0.6, 1.15],
  desk: [1.5, 0.75, 0.74],
  freezer: [1.1, 0.65, 0.85],
  boiler: [0.5, 0.42, 0.85],
  dehumidifier: [0.4, 0.3, 0.6],
};

export function buildFurniture(h: HouseData): FurnitureSpec[] {
  const out: FurnitureSpec[] = [];
  for (const it of h.items) {
    const size = FURN[it.illustration];
    if (!size || !it.pos || it.containerId) continue;
    const sp = findSpace(h, it.spaceId);
    if (!sp?.shape) continue;
    const xs = sp.shape.map((p) => p[0]);
    const ys = sp.shape.map((p) => p[1]);
    const [x, y] = it.pos;
    const dx = Math.min(x - Math.min(...xs), Math.max(...xs) - x);
    const dy = Math.min(y - Math.min(...ys), Math.max(...ys) - y);
    // Long side runs along the nearest wall.
    const [w, d, hh] = size;
    const [fx, fy] = dx < dy ? [d, w] : [w, d];
    out.push({ id: it.id, floorId: sp.floorId, minX: x - fx / 2, maxX: x + fx / 2, minY: y - fy / 2, maxY: y + fy / 2, h: hh });
  }
  return out;
}

function spacePoint(h: HouseData, spaceId?: string): Pt | undefined {
  const sp = findSpace(h, spaceId);
  return sp?.shape ? centroid(sp.shape) : undefined;
}

const OUTLET_NONE = '#8A8F9C';

export function buildPins(
  h: HouseData,
  overlay: Overlay,
  focusCircuit: string | undefined,
  selection: Selection | null,
  furniture: FurnitureSpec[],
): PinSpec[] {
  const pins: PinSpec[] = [];
  const furnH = new Map(furniture.map((f) => [f.id, f.h]));
  const floorOf = (spaceId?: string) => findSpace(h, spaceId)?.floorId;

  const addItem = (id: string) => {
    const it = h.items.find((i) => i.id === id);
    if (!it || !it.pos || it.containerId) return;
    const fl = floorOf(it.spaceId);
    if (!fl) return;
    pins.push({
      id: it.id,
      floorId: fl,
      x: it.pos[0],
      y: it.pos[1],
      base: furnH.get(it.id) ?? 0,
      stem: 1.25,
      color: LAYER.belongings.color,
      glyph: 'item',
      shape: 'circle',
      ring: it.locationClaim === 'confirmed' ? 'none' : it.locationClaim === 'disputed' || it.locationClaim === 'unknown' ? 'dashed' : 'solid',
      size: 1,
      label: it.name,
      sub: it.category,
    });
  };
  const addContainer = (id: string) => {
    const c = h.containers.find((x) => x.id === id);
    if (!c?.pos) return;
    const fl = floorOf(c.spaceId);
    if (!fl) return;
    const count = h.items.filter((i) => i.containerId === c.id).length;
    pins.push({
      id: c.id,
      floorId: fl,
      x: c.pos[0],
      y: c.pos[1],
      base: 0.9,
      stem: 0.8,
      color: mix(LAYER.belongings.color, '#1E2638', 0.25),
      glyph: 'container',
      shape: 'square',
      ring: 'none',
      size: 0.95,
      label: c.name,
      sub: `${count} ${count === 1 ? 'thing' : 'things'} inside`,
      count,
    });
  };
  const addPanel = (id: string) => {
    const p = h.panels.find((x) => x.id === id);
    if (!p?.pos) return;
    const fl = floorOf(p.spaceId);
    if (!fl) return;
    pins.push({ id: p.id, floorId: fl, x: p.pos[0], y: p.pos[1], base: 0.9, stem: 1.1, color: LAYER.electrical.color, glyph: 'panel', shape: 'square', ring: 'none', size: 1.3, label: p.name, sub: `${h.circuits.filter((c) => c.panelId === p.id).length} circuits documented` });
  };
  const addOutlet = (id: string) => {
    const o = h.outlets.find((x) => x.id === id);
    if (!o?.pos) return;
    const fl = floorOf(o.spaceId);
    if (!fl) return;
    const c = h.circuits.find((x) => x.id === o.circuitId);
    pins.push({
      id: o.id,
      floorId: fl,
      x: o.pos[0],
      y: o.pos[1],
      base: 0.3,
      stem: 0.75,
      color: c?.color ?? OUTLET_NONE,
      glyph: 'outlet',
      shape: 'circle',
      ring: o.claim === 'confirmed' ? 'none' : o.claim === 'unknown' || o.claim === 'disputed' ? 'dashed' : 'solid',
      size: 0.78,
      label: `Outlet ${o.label}`,
      sub: c ? `${c.ref} ${c.label}` : 'Circuit not documented',
      faded: !!focusCircuit && o.circuitId !== focusCircuit,
    });
  };
  const addValve = (id: string) => {
    const v = h.valves.find((x) => x.id === id);
    if (!v?.pos) return;
    const fl = floorOf(v.spaceId);
    if (!fl) return;
    pins.push({ id: v.id, floorId: fl, x: v.pos[0], y: v.pos[1], base: 0.15, stem: 1.05, color: LAYER.water.color, glyph: 'valve', shape: 'diamond', ring: v.locationClaim === 'confirmed' ? 'none' : 'dashed', size: 1.05, label: v.name, sub: `Documented: ${v.documentedState.toLowerCase()}` });
  };
  const addDevice = (id: string) => {
    const d = h.devices.find((x) => x.id === id);
    if (!d?.pos) return;
    const fl = floorOf(d.spaceId);
    if (!fl) return;
    const ob = latestObservation(h, d.id);
    // Not in the latest export. This never means removed or switched off.
    const stale = !ob || ob.observedAt < h.sources.networkObservedAt;
    pins.push({
      id: d.id,
      floorId: fl,
      x: d.pos[0],
      y: d.pos[1],
      base: furnH.get(d.itemId ?? '') ?? 0.75,
      stem: 1.2,
      color: LAYER.network.color,
      glyph: 'device',
      shape: 'circle',
      ring: d.locationClaim === 'confirmed' ? 'none' : 'dashed',
      size: 1,
      label: d.name,
      sub: ob ? `Last observed ${ob.observedAt.slice(11, 16)}${stale ? ', not in latest list' : ''}` : 'No observations',
      hollow: stale,
    });
  };
  const addTask = (id: string) => {
    const t = h.tasks.find((x) => x.id === id);
    if (!t || t.status === 'done') return;
    const loc = locate(h, t.targetId);
    const fl = loc.floorId;
    const pt = loc.pos ?? spacePoint(h, loc.spaceId);
    if (!fl || !pt) return;
    const st = dueState(t, h.displayNow);
    pins.push({
      id: t.id,
      floorId: fl,
      x: pt[0] + 0.001,
      y: pt[1] + 0.001,
      base: furnH.get(t.targetId) ?? 0.2,
      stem: 1.45,
      color: st === 'later' ? mix(LAYER.upkeep.color, '#FFFFFF', 0.35) : LAYER.upkeep.color,
      glyph: st === 'overdue' ? 'task' : 'taskSoon',
      shape: 'circle',
      ring: st === 'overdue' ? 'solid' : 'none',
      size: st === 'overdue' ? 1.1 : 0.95,
      label: t.title,
      sub: st === 'overdue' ? 'Overdue' : st === 'soon' ? 'Due soon' : 'Scheduled',
    });
  };

  switch (overlay) {
    case 'belongings':
      h.items.forEach((i) => addItem(i.id));
      h.containers.forEach((c) => addContainer(c.id));
      break;
    case 'electrical':
      h.panels.forEach((p) => addPanel(p.id));
      h.outlets.forEach((o) => addOutlet(o.id));
      break;
    case 'water':
      h.valves.forEach((v) => addValve(v.id));
      break;
    case 'network':
      h.devices.forEach((d) => addDevice(d.id));
      break;
    case 'upkeep':
      h.tasks.forEach((t) => addTask(t.id));
      break;
    default:
      break;
  }

  // The selected record always gets its pin, whatever the overlay.
  if (selection && !pins.some((p) => p.id === selection.id)) {
    const id = selection.id;
    const adders: Partial<Record<Selection['kind'], (id: string) => void>> = {
      item: addItem,
      container: addContainer,
      panel: addPanel,
      outlet: addOutlet,
      valve: addValve,
      device: addDevice,
      task: addTask,
    };
    adders[selection.kind]?.(id);
    if (selection.kind === 'item') {
      const it = h.items.find((i) => i.id === id);
      if (it?.containerId) addContainer(it.containerId);
    }
  }
  return pins;
}
