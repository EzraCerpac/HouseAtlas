import { getPosition } from 'suncalc';
import type { SceneDaylight } from '../canonical-ifc/mesh-appearance';
import { skyLight } from '../canonical-ifc/sky-light';

type Rgb = readonly [number, number, number];

/** Where the house stands and how the model is turned: true north, in degrees
 * clockwise seen from above, from the model's -Z axis (Blender's +Y). */
export interface SunPlace { readonly latitude: number; readonly longitude: number; readonly northDeg: number }
export type SunLocation = Pick<SunPlace, 'latitude' | 'longitude'>;
export type SunPlaceSource = 'device' | 'model' | 'default';
export interface ResolvedSunPlace extends SunPlace { readonly source: SunPlaceSource }
export const DEFAULT_SUN_LOCATION: SunLocation = Object.freeze({ latitude: 51.48, longitude: 0 });

/** Where the sun is computed for. The model release may say where the house
 * stands and where north is (`frame.geographic`); a device may set its own
 * location over the release's; otherwise the location is the Greenwich
 * meridian, a neutral reference rather than a guess. North comes only from the
 * release, else it is the model's -Z. */
export function resolveSunPlace(device: SunLocation | null, model: SunPlace | null): ResolvedSunPlace {
  const northDeg = model?.northDeg ?? 0;
  if (device) return { latitude: device.latitude, longitude: device.longitude, northDeg, source: 'device' };
  if (model) return { latitude: model.latitude, longitude: model.longitude, northDeg, source: 'model' };
  return { ...DEFAULT_SUN_LOCATION, northDeg, source: 'default' };
}

/** The house's light at one moment, from the real sun's position. */
export interface Daylight extends SceneDaylight {
  /** Sun altitude above the horizon, in degrees (refraction included). */
  readonly altitude: number;
  /** Unit direction toward the sun in the model frame; the zenith once it has set. */
  readonly toward: Rgb;
  /** 0 by day to 1 at night, for the stage around the model. */
  readonly dusk: number;
}

/** Sky light by sun altitude (degrees, highest first): daylight as drawn until
 * the sun is low, cooler toward sunset, then a blue that never falls below a
 * readable share of the drawn tones. */
const SKY: readonly (readonly [number, Rgb])[] = [
  [15, [1, 1, 1]], [5, [.95, .93, .96]], [0, [.8, .78, .88]], [-4, [.64, .63, .77]], [-10, [.52, .56, .7]],
];
/** Direct sun: white by day, golden as it sets. */
const SUN: readonly (readonly [number, Rgb])[] = [[15, [1, 1, 1]], [5, [1.05, .93, .8]], [0, [1.08, .82, .62]]];
/** Lamp light indoors after dusk: the tones as drawn by day, warmed. */
const LAMP: Rgb = [1.04, .86, .62];

const smooth = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};
function tintAt(keys: readonly (readonly [number, Rgb])[], altitude: number): Rgb {
  if (altitude >= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [high, a] = keys[i - 1]!, [low, b] = keys[i]!;
    if (altitude >= low) { const t = (high - altitude) / (high - low); return a.map((v, c) => v + (b[c]! - v) * t) as unknown as Rgb; }
  }
  return keys[keys.length - 1]![1];
}

/** Model-frame direction for a compass bearing (degrees clockwise from true
 * north) and an altitude: X east and -Z north when the model is unturned. */
export function modelDirection(azimuth: number, altitude: number, northDeg: number): Rgb {
  const rad = Math.PI / 180, h = Math.cos(altitude * rad), a = azimuth * rad, q = northDeg * rad;
  const east = Math.sin(a) * h, north = Math.cos(a) * h;
  return [east * Math.cos(q) + north * Math.sin(q), Math.sin(altitude * rad), east * Math.sin(q) - north * Math.cos(q)];
}

export function daylightAt(at: Date, place: SunPlace): Daylight {
  const { azimuth, altitude } = getPosition(at, place.latitude, place.longitude);
  const night = altitude < 0;
  return {
    altitude, night,
    toward: night ? [0, 1, 0] : modelDirection(azimuth, altitude, place.northDeg),
    // The sun's direct share fades in over its first degrees, so it never pops on at sunrise.
    direct: smooth(0, 6, altitude),
    lamp: smooth(0, -5, altitude),
    tint: tintAt(SKY, altitude), sunTint: tintAt(SUN, altitude), lampTint: LAMP,
    dusk: smooth(3, -8, altitude),
    sky: skyLight(altitude, modelDirection(azimuth, altitude, place.northDeg)),
  };
}

/** Stage colours around the model, as CSS custom properties: the paper and
 * birch board by day, a dim slate board under a blue night. */
const STAGE_DAY = { glow: '#fffaf0', skyTop: '#f1e9da', skyBottom: '#ddd0b7', boardLit: '#ecdbb4', boardShade: '#d4b988', boardEdge: '#8f7046' };
const STAGE_NIGHT = { glow: '#5d6478', skyTop: '#3a4152', skyBottom: '#232835', boardLit: '#7a766f', boardShade: '#5f5a52', boardEdge: '#3b342b' };
const mixHex = (a: string, b: string, t: number) => `#${[1, 3, 5].map(i => {
  const x = parseInt(a.slice(i, i + 2), 16), y = parseInt(b.slice(i, i + 2), 16);
  return Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
}).join('')}`;
export function stageColors(dusk: number): Record<`--ua-${string}`, string> {
  const out: Record<`--ua-${string}`, string> = {};
  for (const key of Object.keys(STAGE_DAY) as (keyof typeof STAGE_DAY)[])
    out[`--ua-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`] = mixHex(STAGE_DAY[key], STAGE_NIGHT[key], dusk);
  return out;
}
