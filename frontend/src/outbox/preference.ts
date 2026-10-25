import { useSyncExternalStore } from 'react';

/** Whether queued changes go out on their own once the server is reachable,
 * or only when the person presses Send. A per-device preference; storage
 * that is unavailable leaves the default. */
export type SyncMode = 'automatic' | 'ask';
const KEY = 'houseatlas.sync-mode.v1';
const listeners = new Set<() => void>();
let memory: SyncMode | null = null;

export function readSyncMode(): SyncMode {
  try { return localStorage.getItem(KEY) === 'ask' ? 'ask' : 'automatic'; } catch { return 'automatic'; }
}
export function setSyncMode(value: SyncMode): void {
  try { localStorage.setItem(KEY, value); } catch { /* The choice lasts for this page only. */ }
  memory = value;
  for (const changed of listeners) changed();
}
export const syncMode = (): SyncMode => memory ??= readSyncMode();
export function subscribeSyncMode(changed: () => void): () => void {
  listeners.add(changed);
  return () => { listeners.delete(changed); };
}
// The choice is per device: another tab changing it changes it here too,
// before this tab's next reconnect or retry.
if (typeof addEventListener === 'function') addEventListener('storage', event => {
  if (event.key !== KEY && event.key !== null) return;
  memory = readSyncMode();
  for (const changed of listeners) changed();
});
export function useSyncMode(): SyncMode { return useSyncExternalStore(subscribeSyncMode, syncMode, () => 'automatic'); }
