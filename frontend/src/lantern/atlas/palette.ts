import type { Overlay, SpaceKind } from '../data/types';

export const INK = '#1E2638';
export const CARD = '#FBF9F4';
export const BIRCH = '#D8BE8E';
export const BIRCH_DARK = '#A9864F';
export const LANTERN = '#FFE39A';
export const LANTERN_EDGE = '#E9A400';

export const LAYER: Record<Overlay, { color: string; label: string; short: string }> = {
  spaces: { color: '#8C6A3C', label: 'Rooms only', short: 'Rooms' },
  belongings: { color: '#9C3F8F', label: 'Belongings', short: 'Belongings' },
  electrical: { color: '#2F56E0', label: 'Electrical', short: 'Electrical' },
  water: { color: '#0B8F83', label: 'Water and valves', short: 'Water' },
  network: { color: '#B97A00', label: 'Network', short: 'Network' },
  upkeep: { color: '#D93D2E', label: 'Upkeep', short: 'Upkeep' },
};

export const ROOM_TINT: Record<SpaceKind, string> = {
  living: '#F2DDBE',
  kitchen: '#F4E6AE',
  wet: '#CBE6E2',
  sleep: '#E2DCF2',
  circulation: '#ECE6DB',
  work: '#D9E5CB',
  service: '#E5DBCF',
  stair: '#E3DDD2',
  outdoor: '#D7C29C',
};

export const ROOM_KIND_LABEL: Record<SpaceKind, string> = {
  living: 'Living',
  kitchen: 'Kitchen',
  wet: 'Bath and utility',
  sleep: 'Bedroom',
  circulation: 'Hall and landing',
  work: 'Work and hobby',
  service: 'Service and storage',
  stair: 'Stair',
  outdoor: 'Outdoor',
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i]! - v) * Math.min(1, Math.max(0, t))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Light comes from the south-west of the house, fixed to the model. */
const L: [number, number] = [-0.6, 0.8];

/** 0 = fully lit, 1 = in shadow, for a vertical face with this world normal. */
export function shadeFor(nx: number, ny: number): number {
  const d = nx * L[0] + ny * L[1];
  return (1 - d) / 2;
}
