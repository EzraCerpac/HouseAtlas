import { initialAtlasState, type AtlasModel } from '../lantern/unified-atlas/scene';
import type { ModelOverviewSelection } from '../lantern/source-models/overview-types';
import type { UnifiedAtlasPort } from '../lantern/unified-atlas/types';
import { needPack } from './manifest';
import { createSavedAtlasDataAdapter, type SavedAtlasRead } from './saved-atlas-port';
import type { SavedHouse, SavedHouseStore } from './store';

import type { LiveAtlasSelection, SavedAtlasSelection, LiveAtlasPresentationPort } from '../lantern/unified-atlas/types';
export type { LiveAtlasSelection, SavedAtlasSelection, AtlasPresentationSelection, AtlasPresentationPort, SavedAtlasPresentationPort } from '../lantern/unified-atlas/types';
import { readSavedPackSections } from './saved-pack-sections';
import { projectSavedAtlasOverlays, readSavedHistoricalFacts, type SavedOverlayResult } from './saved-atlas-overlays';

const livePorts = new WeakMap<UnifiedAtlasPort, LiveAtlasPresentationPort>();

/** Preserve native contracts behind an explicit live branch. In particular,
 * only this wrapper can acquire the native documentary overlay owner. */
export function createLiveAtlasPresentationPort(native: UnifiedAtlasPort): LiveAtlasPresentationPort {
  const normalized = livePorts.get(native); if (normalized) return normalized;
  let lastNative: ModelOverviewSelection | null = null, lastSelection: LiveAtlasSelection | null = null;
  function overview(selection: LiveAtlasSelection): ModelOverviewSelection {
    needPack(selection.kind === 'live'); return selection.overview;
  }
  const port: LiveAtlasPresentationPort = {
    ...(native.savedDocumentary ? { savedDocumentary: native.savedDocumentary } : {}),
    kind: 'live' as const,
    ...(native.entryBuildingId ? { entryBuildingId: (scene: Parameters<NonNullable<UnifiedAtlasPort['entryBuildingId']>>[0]) => native.entryBuildingId!(scene) } : {}),
    current(): LiveAtlasSelection | null {
      const selected = native.current();
      if (selected !== lastNative) { lastNative = selected; lastSelection = selected === null ? null : Object.freeze({ kind: 'live', overview: selected }); }
      return lastSelection;
    },
    subscribe(changed: () => void) { return native.subscribe(changed); },
    read(selection: LiveAtlasSelection, signal: AbortSignal) { return native.read(overview(selection), signal); },
    ...(native.stored ? { stored(selection: LiveAtlasSelection, signal: AbortSignal) { return native.stored!(overview(selection), signal); } } : {}),
    ...(native.readDetail ? { readDetail(selection: LiveAtlasSelection, scene: Parameters<NonNullable<UnifiedAtlasPort['readDetail']>>[1], signal: AbortSignal) {
      return native.readDetail!(overview(selection), scene, signal);
    } } : {}),
    ...(native.createOverlays ? { createOverlays(selection: LiveAtlasSelection, ...args: Parameters<NonNullable<UnifiedAtlasPort['createOverlays']>> extends
      [ModelOverviewSelection, ...infer Rest] ? Rest : never) {
      const selected = overview(selection);
      return native.createOverlays!(selected, ...args);
    } } : {}),
    ...(native.storedOverlays ? { storedOverlays(selection: LiveAtlasSelection, ...args: Parameters<NonNullable<UnifiedAtlasPort['storedOverlays']>> extends
      [ModelOverviewSelection, ...infer Rest] ? Rest : never) {
      return native.storedOverlays!(overview(selection), ...args);
    } } : {}),
    ...(native.keepOverlays ? { keepOverlays(selection: LiveAtlasSelection, ...args: Parameters<NonNullable<UnifiedAtlasPort['keepOverlays']>> extends
      [ModelOverviewSelection, ...infer Rest] ? Rest : never) {
      native.keepOverlays!(overview(selection), ...args);
    } } : {}),
  };
  livePorts.set(native, port); return port;
}

export interface SavedAtlasPresentationRead extends SavedAtlasRead {
  readonly selection: SavedAtlasSelection;
  readonly overlays: SavedOverlayResult;
}
type LocalOwner = Pick<SavedHouseStore, 'list' | 'asset' | 'subscribe'>;

/** Open an explicit local allocation. The consumer remains the only resource
 * reader. No native port, fetch, expiry, derived overview pin or overlay lease.
 * Store notifications retire this allocation; the host must open it again. */
export async function openSavedAtlasPresentation(store: LocalOwner, input: SavedHouse, signal: AbortSignal) {
  const house = structuredClone(input), adapter = createSavedAtlasDataAdapter(store);
  const listeners = new Set<() => void>();
  let active = true;
  let released = false;
  const unsubscribe = store.subscribe(() => retire());
  const retire = () => {
    if (!active) return;
    active = false;
    if (!released) { released = true; unsubscribe(); }
    for (const changed of listeners) changed();
    listeners.clear();
  };
  const guard = () => { signal.throwIfAborted(); needPack(active); };
  try {
    const initial = await adapter.read(house, signal); guard();
    if (initial === null) { retire(); return null; }
    const descriptor = initial.saved.descriptor, unified = descriptor.unified;
    needPack(unified);
    const selection: SavedAtlasSelection = Object.freeze({ kind: 'saved', owner: Object.freeze({}),
      scope: Object.freeze({ ...house.scope }), publicationId: descriptor.publicationId,
      overviewManifestSha256: descriptor.overviewManifestSha256, semanticsSha256: unified.semanticsSha256,
      selectionRevision: unified.selectionRevision, snapshotId: initial.saved.snapshotId,
      localRevision: initial.saved.localRevision, capturedAt: initial.saved.capturedAt });
    const sections = await readSavedPackSections(store, house, signal); guard();
    const historical = await readSavedHistoricalFacts(sections, initial, signal); guard();
    const overlays = projectSavedAtlasOverlays(sections, initial.scene, historical);
    return {
      kind: 'saved' as const,
      coverage: overlays,
      saved: initial.saved,
      savedDocumentary: { observedAt: selection.capturedAt, records: (scene: SavedAtlasRead['scene'], selectable: ReadonlySet<string>) => projectSavedAtlasOverlays(sections, scene, historical, selectable).records },
      current(): SavedAtlasSelection | null { return active ? selection : null; },
      subscribe(changed: () => void) { listeners.add(changed); return () => { listeners.delete(changed); }; },
      async read(selected: SavedAtlasSelection, readSignal: AbortSignal): Promise<SavedAtlasPresentationRead> {
        readSignal.throwIfAborted(); needPack(active && selected === selection);
        // Do not cache bytes from open: each presentation read rechecks the
        // exact local revision and all consumed digest/MIME/size pins.
        const result = await adapter.read(house, readSignal);
        readSignal.throwIfAborted(); needPack(active && result);
        const checked = await readSavedPackSections(store, house, readSignal);
        readSignal.throwIfAborted(); needPack(active);
        const history = await readSavedHistoricalFacts(checked, result, readSignal);
        readSignal.throwIfAborted(); needPack(active);
        return { ...result, selection, overlays: projectSavedAtlasOverlays(checked, result.scene, history) };
      },
      dispose() {
        retire();
      },
    };
  } catch (error) { retire(); throw error; }
}

/** Model-v2 has no entry hint; override the native sole-building convenience. */
export function savedAtlasInitialState(model: AtlasModel) {
  return { ...initialAtlasState(model), buildingId: null };
}
