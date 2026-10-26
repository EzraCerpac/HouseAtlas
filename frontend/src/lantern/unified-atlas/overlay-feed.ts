import type { UnifiedAtlasOverlayAvailableFrame } from '../../../integration/unified-atlas-overlay-source';
import type { AtlasModel } from './scene';
import type { AtlasBuilding, LiveAtlasPresentationPort, LiveAtlasSelection } from './types';
import { documentaryRoomRecords, matchesOverlayScene, mergeRuntimeRecords, type PropertyRecords, type RuntimeRecords } from './runtime-overlays';
import type { StoredBuildingOverlays } from './stored-overlays';
import { modelUpdatesAllowed } from './model-updates';

type Handle = NonNullable<Awaited<ReturnType<NonNullable<LiveAtlasPresentationPort['createOverlays']>>>>;

/** What the Atlas shows for its documentary layers right now. */
export interface OverlayFeedSnapshot {
  readonly records: PropertyRecords | null;
  readonly reason: string;
  readonly buildings: PropertyRecords['buildings'];
  /** The oldest stored copy on screen, when a building shows one instead of a current frame. */
  readonly stored: { readonly storedAt: string; readonly refreshing: boolean } | null;
}
export interface OverlayFeed {
  /** The layers are on (true) or off. Sources open on the first true and stay
   * open after it, so turning a layer off and on again reads nothing. */
  setActive(active: boolean): void;
  subscribe(changed: () => void): () => void;
  snapshot(): OverlayFeedSnapshot;
  dispose(): void;
}
/** Timers, the browser's online event and the download preference, injectable for checks. */
export interface OverlayFeedEnvironment {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
  /** Calls back when the browser reports the network is back. */
  subscribeOnline(changed: () => void): () => void;
  now(): number;
  /** Whether a read the user did not ask for may start (Settings → Room map downloads). */
  mayReadUnasked(): boolean;
}
const browser: OverlayFeedEnvironment = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: timer => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
  subscribeOnline(changed) {
    if (typeof window === 'undefined') return () => undefined;
    window.addEventListener('online', changed);
    return () => window.removeEventListener('online', changed);
  },
  now: () => Date.now(),
  mayReadUnasked: modelUpdatesAllowed,
};
/** With nothing stored yet, and downloads not held back, the sources are read
 * once in the background after the model has had this long to draw, so the
 * layers work offline later. */
export const OVERLAY_PREFETCH_DELAY_MS = 4_000;
/** A frame that stops being current while a layer is on is read again after this. */
export const OVERLAY_REOPEN_DELAY_MS = 15_000;

/** Every building with floors opens its own source frame, lease and release:
 * layers are property-wide whatever the selection, while native qualification
 * stays building-scoped in the source owner. A building without a current
 * frame shows the records last projected for it on this device, labelled as
 * stored, or else its own reason; the others still show. */
export function createOverlayFeed(port: LiveAtlasPresentationPort, selection: LiveAtlasSelection, model: AtlasModel,
  clock: OverlayFeedEnvironment = browser): OverlayFeed {
  type Frame = UnifiedAtlasOverlayAvailableFrame;
  interface Slot { readonly controller: AbortController; handle: Handle | null; frame: Frame | null; records: RuntimeRecords | null; stop: (() => void) | null; done: boolean }
  const slots = new Map<string, Slot>(), reasons = new Map<string, string>(), listeners = new Set<() => void>();
  let kept = new Map<string, StoredBuildingOverlays>();
  let engaged: 'user' | 'prefetch' | null = null, active = false, disposed = false;
  let prefetchTimer: unknown = null, reopenTimer: unknown = null;
  const lookup = new AbortController();
  const emit = () => { for (const changed of [...listeners]) changed(); };
  const current = (buildingId: string, slot: Slot) => slot.frame !== null && !slot.done && port.current() === selection
    && slot.handle!.source.isCurrent(slot.frame) && matchesOverlayScene(slot.frame, model.scene, buildingId);

  const retire = (buildingId: string) => {
    const slot = slots.get(buildingId); if (!slot) return;
    slots.delete(buildingId); slot.done = true; slot.controller.abort(); slot.stop?.();
    if (slot.frame) slot.handle?.source.release(slot.frame);
    slot.handle?.source.dispose();
  };
  const remember = (buildingId: string, records: RuntimeRecords) => {
    kept = new Map(kept).set(buildingId, { storedAt: new Date(clock.now()).toISOString(), records });
    try { port.keepOverlays?.(selection, model.scene, kept); } catch { /* storage is best effort */ }
  };
  // A background read lets go of its sources once every building has answered.
  const settle = () => {
    if (engaged !== 'prefetch' || [...slots.values()].some(slot => !slot.frame)) return;
    engaged = null; for (const buildingId of [...slots.keys()]) retire(buildingId);
  };
  const open = (building: AtlasBuilding) => {
    const buildingId = building.buildingId;
    const slot: Slot = { controller: new AbortController(), handle: null, frame: null, records: null, stop: null, done: false };
    slots.set(buildingId, slot); reasons.set(buildingId, 'loading');
    const finish = (reason: string) => {
      if (slot.done) return;
      reasons.set(buildingId, reason);
      if (reason !== 'available') retire(buildingId);
      settle(); emit();
    };
    void (async () => {
      if (!port.createOverlays) { finish('source-unavailable'); return; }
      const handle = await port.createOverlays(selection, model.scene, building, slot.controller.signal);
      if (slot.done) { handle?.source.dispose(); return; }
      if (!handle) { finish('no-native-building-link'); return; }
      slot.handle = handle;
      const result = await handle.source.open(handle.request, slot.controller.signal);
      if (slot.done) return;
      if (result.status !== 'available') { finish(result.reason); return; }
      if (port.current() !== selection || !handle.source.isCurrent(result) || !matchesOverlayScene(result, model.scene, buildingId)) {
        handle.source.release(result); finish('selection-changed'); return;
      }
      slot.frame = result; slot.records = documentaryRoomRecords(model.scene, result, model.selectable);
      slot.stop = handle.source.subscribeInvalidation(result, () => invalidated(buildingId, slot));
      if (slot.done) return;
      remember(buildingId, slot.records); finish('available');
    })().catch(() => finish('source-unavailable'));
  };
  // Open every building that has neither a current frame nor a read in flight.
  const fill = () => {
    for (const building of model.floorBuildings) {
      const slot = slots.get(building.buildingId);
      if (slot && (!slot.frame || current(building.buildingId, slot))) continue;
      retire(building.buildingId); open(building);
    }
    emit();
  };
  const engage = (kind: 'user' | 'prefetch') => {
    if (disposed || kind === 'prefetch' && engaged !== null) return;
    if (prefetchTimer !== null) { clock.clearTimeout(prefetchTimer); prefetchTimer = null; }
    engaged = kind; fill();
  };
  const reopenSoon = () => {
    if (reopenTimer !== null) return;
    reopenTimer = clock.setTimeout(() => { reopenTimer = null; if (active) engage('user'); }, OVERLAY_REOPEN_DELAY_MS);
  };
  function invalidated(buildingId: string, slot: Slot) {
    if (slot.done) return;
    if (current(buildingId, slot)) { emit(); return; }
    retire(buildingId); reasons.set(buildingId, 'current-source-unavailable'); emit();
    if (active) reopenSoon();
  }
  const offOnline = clock.subscribeOnline(() => { if (active && !disposed) engage('user'); });

  if (port.storedOverlays) void port.storedOverlays(selection, model.scene, model.selectable, lookup.signal).then(found => {
    if (disposed) return;
    if (!found) {
      if (engaged === null && port.keepOverlays && clock.mayReadUnasked())
        prefetchTimer = clock.setTimeout(() => { prefetchTimer = null; if (clock.mayReadUnasked()) engage('prefetch'); }, OVERLAY_PREFETCH_DELAY_MS);
      return;
    }
    // Records projected during this page's own reads are newer than the stored copy.
    const merged = new Map(found);
    for (const [buildingId, row] of kept) merged.set(buildingId, row);
    kept = merged; emit();
  }, () => undefined);

  let last: { readonly key: readonly unknown[]; readonly snapshot: OverlayFeedSnapshot } | null = null;
  return {
    setActive(value: boolean) {
      active = value;
      if (value) engage('user');
    },
    subscribe(changed: () => void) { listeners.add(changed); return () => { listeners.delete(changed); }; },
    snapshot() {
      const rows = model.floorBuildings.map(building => {
        const buildingId = building.buildingId, slot = slots.get(buildingId), stored = kept.get(buildingId);
        if (slot && current(buildingId, slot)) return { buildingId, reason: 'available', records: slot.records, storedAt: null };
        if (stored) return { buildingId, reason: 'stored-copy', records: stored.records, storedAt: stored.storedAt };
        const reason = reasons.get(buildingId);
        return { buildingId, reason: reason === 'available' ? 'selection-changed' : reason ?? 'not-loaded', records: null, storedAt: null };
      });
      const refreshing = [...slots.values()].some(slot => !slot.frame);
      // The same rows return the same snapshot, so an unchanged source never re-renders.
      const key = [refreshing, ...rows.flatMap(row => [row.records, row.reason, row.storedAt])];
      if (last && last.key.length === key.length && key.every((value, at) => last!.key[at] === value)) return last.snapshot;
      const aggregate = mergeRuntimeRecords(model, rows);
      const storedAt = rows.map(row => row.storedAt).filter((value): value is string => value !== null).sort()[0] ?? null;
      const shown = rows.some(row => row.records);
      const reason = storedAt !== null ? 'stored-copy' : shown ? 'available' : rows.some(row => row.reason === 'loading') ? 'loading'
        : [...new Set(rows.map(row => row.reason))].join(', ') || 'source-unavailable';
      const snapshot: OverlayFeedSnapshot = { records: shown ? aggregate : null, reason, buildings: aggregate.buildings,
        stored: storedAt === null ? null : { storedAt, refreshing } };
      last = { key, snapshot }; return snapshot;
    },
    dispose() {
      if (disposed) return;
      disposed = true; lookup.abort(); offOnline(); listeners.clear();
      if (prefetchTimer !== null) clock.clearTimeout(prefetchTimer);
      if (reopenTimer !== null) clock.clearTimeout(reopenTimer);
      for (const buildingId of [...slots.keys()]) retire(buildingId);
    },
  };
}
