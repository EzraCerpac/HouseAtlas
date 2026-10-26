import { useSyncExternalStore } from 'react';
import { resolveSunPlace, type ResolvedSunPlace, type SunLocation } from './daylight';
import type { ModelOverviewSelection } from '../source-models/overview-types';
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

/** The home and publication a shown release belongs to. */
export interface ModelPlaceOwner { readonly workspaceId: string; readonly homeId: string; readonly publicationId: string }
interface ShownModel { readonly owner: ModelPlaceOwner; readonly geographic: AtlasGeographic | null }
interface State { readonly device: SunLocation | null; readonly model: ShownModel | null }
let state: State | null = null;
const listeners = new Set<() => void>();
const current = () => state ??= { device: readSunLocation(), model: null };
function publish(next: State) { state = next; for (const changed of listeners) changed(); }
function subscribe(changed: () => void) { listeners.add(changed); return () => { listeners.delete(changed); }; }
const SERVER: State = { device: null, model: null };

/** Merges `patch` into this device's location as it stands now, or into `model`'s
 * when it has none, so a field edited while a location lookup is pending is kept;
 * null returns to the release's. */
export function updateSunLocation(patch: Partial<SunLocation> | null, model: AtlasGeographic | null): void {
  const device = patch && { ...(current().device ?? resolveSunPlace(null, model)), ...patch };
  const location = device && { latitude: device.latitude, longitude: device.longitude };
  try { if (location) localStorage.setItem(KEY, JSON.stringify(location)); else localStorage.removeItem(KEY); }
  catch { /* The choice lasts for this page only. */ }
  publish({ ...current(), device: location });
}
/** The shown release's geographic frame, so Settings can say where the sun is from.
 * It stays after the 3D view unmounts, and counts only while `owner` is still selected. */
export function showModelGeographic(owner: ModelPlaceOwner, geographic: AtlasGeographic | null): void {
  const shown = current().model;
  if (shown?.geographic === geographic && sameOwner(shown.owner, owner)) return;
  publish({ ...current(), model: { owner, geographic } });
}
const sameOwner = (a: ModelPlaceOwner, b: ModelPlaceOwner) => a.workspaceId === b.workspaceId && a.homeId === b.homeId && a.publicationId === b.publicationId;
/** The device's own location, or null when it follows the release. */
export function useSunLocation(): SunLocation | null { return useSyncExternalStore(subscribe, () => current().device, () => SERVER.device); }
/** The place in effect for `selection`, and its release's own. A release shown
 * for another home or publication, or none yet, has no location here. */
export function useSunPlace(selection: ModelOverviewSelection | null): ResolvedSunPlace & { readonly model: AtlasGeographic | null } {
  const { device, model: shown } = useSyncExternalStore(subscribe, current, () => SERVER);
  const model = shownFor(shown, selection);
  return { ...resolveSunPlace(device, model), model };
}
/** The release location Settings would show for `selection`, outside React. */
export const modelGeographicFor = (selection: ModelOverviewSelection | null) => shownFor(current().model, selection);
const shownFor = (shown: ShownModel | null, selection: ModelOverviewSelection | null) =>
  shown && selection && sameOwner(shown.owner, { ...selection.scope, publicationId: selection.publicationId }) ? shown.geographic : null;
