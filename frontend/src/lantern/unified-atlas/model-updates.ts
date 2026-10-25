import { useSyncExternalStore } from 'react';

/** When the live Atlas downloads the room map and model: on every open, or
 * only when the user asks. A per-device preference; storage that is
 * unavailable leaves the default. */
export type ModelUpdates = 'automatic' | 'ask';
const KEY = 'houseatlas.model-updates.v1';
const listeners = new Set<() => void>();

export function readModelUpdates(): ModelUpdates {
  try { return localStorage.getItem(KEY) === 'ask' ? 'ask' : 'automatic'; } catch { return 'automatic'; }
}
export function setModelUpdates(value: ModelUpdates): void {
  try { localStorage.setItem(KEY, value); } catch { /* The choice lasts for this page only. */ }
  memory = value;
  for (const changed of listeners) changed();
}
let memory: ModelUpdates | null = null;
const current = () => memory ??= readModelUpdates();
function subscribe(changed: () => void) { listeners.add(changed); return () => { listeners.delete(changed); }; }
export function useModelUpdates(): ModelUpdates { return useSyncExternalStore(subscribe, current, () => 'automatic'); }

interface NetworkInformation { readonly type?: string; readonly saveData?: boolean }
/** Whether a fresh read may start without the user asking. Automatic mode
 * also holds off where the browser reports mobile data or Data Saver; Safari
 * reports neither, so on iPhone only "When I ask" holds downloads back. */
export function modelUpdatesAllowed(): boolean {
  if (current() === 'ask') return false;
  const network = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return !(network?.type === 'cellular' || network?.saveData === true);
}
