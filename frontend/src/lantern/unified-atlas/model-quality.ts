import { useSyncExternalStore } from 'react';

/** How much of the house model this device draws: Light is the baked overview
 * every device loads; Full adds the publication's unsimplified detail model,
 * loaded after Light is on screen. Auto chooses Full only where the device
 * looks able to carry it. A per-device preference; storage that is
 * unavailable leaves the default. */
export type ModelQuality = 'auto' | 'light' | 'full';
const KEY = 'houseatlas.model-quality.v1';
const VALUES: readonly ModelQuality[] = ['auto', 'light', 'full'];
const listeners = new Set<() => void>();

export function readModelQuality(): ModelQuality {
  try { const value = localStorage.getItem(KEY); return VALUES.includes(value as ModelQuality) ? value as ModelQuality : 'auto'; } catch { return 'auto'; }
}
export function setModelQuality(value: ModelQuality): void {
  try { localStorage.setItem(KEY, value); } catch { /* The choice lasts for this page only. */ }
  memory = value;
  for (const changed of listeners) changed();
}
let memory: ModelQuality | null = null;
const current = () => memory ??= readModelQuality();
function subscribe(changed: () => void) { listeners.add(changed); return () => { listeners.delete(changed); }; }
export function useModelQuality(): ModelQuality { return useSyncExternalStore(subscribe, current, () => 'auto'); }

interface DeviceHints { readonly deviceMemory?: number; readonly connection?: { readonly type?: string; readonly saveData?: boolean } }
/** Whether Auto loads the detail model here: WebGPU, a mouse or trackpad and
 * no touch screen, at least 8 GB where the browser reports memory (Safari does
 * not), and neither mobile data nor Data Saver where it reports those. Phones
 * and tablets stay on Light; anyone can still choose Full. */
export function autoPrefersFull(): boolean {
  const hints = navigator as Navigator & DeviceHints;
  const fine = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches && !matchMedia('(any-pointer: coarse)').matches;
  return 'gpu' in navigator && fine && (hints.deviceMemory === undefined || hints.deviceMemory >= 8)
    && hints.connection?.type !== 'cellular' && hints.connection?.saveData !== true;
}
export function fullModelWanted(quality: ModelQuality): boolean {
  return quality === 'full' || quality === 'auto' && autoPrefersFull();
}
