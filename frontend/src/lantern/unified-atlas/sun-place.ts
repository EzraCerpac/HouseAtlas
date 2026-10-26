import { useSyncExternalStore } from 'react';
import type { SunPlace } from './daylight';

/** Where the 3D view's sun is computed for: a per-device preference, like
 * Model quality. Until the house's own values are set it is the Greenwich
 * meridian and an unturned model, a neutral reference rather than a guess.
 * A few hundred kilometres barely move the sun's path; the model's north
 * turns every shadow. */
export const DEFAULT_SUN_PLACE: SunPlace = Object.freeze({ latitude: 51.48, longitude: 0, northDeg: 0 });
const KEY = 'houseatlas.sun-place.v1';
const listeners = new Set<() => void>();

const finite = (value: unknown, low: number, high: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
/** The stored place, or the default where it is missing or out of range. */
export function readSunPlace(): SunPlace {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (value && typeof value === 'object') {
      const { latitude, longitude, northDeg } = value as Record<string, unknown>;
      if (finite(latitude, -90, 90) && finite(longitude, -180, 180) && finite(northDeg, -360, 360)) return { latitude, longitude, northDeg };
    }
  } catch { /* Unavailable or unreadable storage keeps the default. */ }
  return DEFAULT_SUN_PLACE;
}
/** Merges `patch` into the place as it stands now, so edits made while a
 * location lookup is pending are kept. */
export function updateSunPlace(patch: Partial<SunPlace>): void {
  const value = { ...current(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* The choice lasts for this page only. */ }
  memory = value;
  for (const changed of listeners) changed();
}
let memory: SunPlace | null = null;
const current = () => memory ??= readSunPlace();
function subscribe(changed: () => void) { listeners.add(changed); return () => { listeners.delete(changed); }; }
export function useSunPlace(): SunPlace { return useSyncExternalStore(subscribe, current, () => DEFAULT_SUN_PLACE); }
