import { useSyncExternalStore } from 'react';
import { resolveSunPlace, type ResolvedSunPlace, type SunLocation } from './daylight';
import type { AtlasGeographic } from './types';

/** This device's own sun location, like Model quality, and the shown
 * release's geographic frame; resolveSunPlace says which one lights the view. */
// The key #367 stored a whole place under; only its latitude and longitude are read now.
const KEY = 'houseatlas.sun-place.v1';

const finite = (value: unknown, limit: number): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
/** The stored device location, or null where it is missing or out of range. */
export function readSunLocation(): SunLocation | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (value && typeof value === 'object') {
      const { latitude, longitude } = value as Record<string, unknown>;
      if (finite(latitude, 90) && finite(longitude, 180)) return { latitude, longitude };
    }
  } catch { /* Unavailable or unreadable storage keeps the release's location. */ }
  return null;
}

interface State { readonly device: SunLocation | null; readonly model: AtlasGeographic | null }
let state: State | null = null;
const listeners = new Set<() => void>();
const current = () => state ??= { device: readSunLocation(), model: null };
function publish(next: State) { state = next; for (const changed of listeners) changed(); }
function subscribe(changed: () => void) { listeners.add(changed); return () => { listeners.delete(changed); }; }
const SERVER: State = { device: null, model: null };

/** Merges `patch` into this device's location as it stands now, so a field
 * edited while a location lookup is pending is kept; null returns to the release's. */
export function updateSunLocation(patch: Partial<SunLocation> | null): void {
  const device = patch && { ...(current().device ?? resolveSunPlace(null, current().model)), ...patch };
  const location = device && { latitude: device.latitude, longitude: device.longitude };
  try { if (location) localStorage.setItem(KEY, JSON.stringify(location)); else localStorage.removeItem(KEY); }
  catch { /* The choice lasts for this page only. */ }
  publish({ ...current(), device: location });
}
/** The shown release's geographic frame, so Settings can say where the sun is from.
 * It stays after the 3D view unmounts, until another release is shown. */
export function showModelGeographic(model: AtlasGeographic | null): void {
  if (current().model !== model) publish({ ...current(), model });
}
/** The device's own location, or null when it follows the release. */
export function useSunLocation(): SunLocation | null { return useSyncExternalStore(subscribe, () => current().device, () => SERVER.device); }
/** The place in effect for the release last shown, and that release's own. */
export function useSunPlace(): ResolvedSunPlace & { readonly model: AtlasGeographic | null } {
  const { device, model } = useSyncExternalStore(subscribe, current, () => SERVER);
  return { ...resolveSunPlace(device, model), model };
}
