import type { ModelOverviewSelection } from '../lantern/source-models/overview-types';
import type { UnifiedAtlasPort } from '../lantern/unified-atlas/types';
import { needPack } from './manifest';
import { createSavedAtlasDataAdapter, type SavedAtlasRead } from './saved-atlas-port';
import type { SavedHouse, SavedHouseStore } from './store';

export interface LiveAtlasSelection {
  readonly kind: 'live';
  readonly overview: ModelOverviewSelection;
}
export interface SavedAtlasSelection {
  readonly kind: 'saved';
  /** Identity of this local allocation only; no native authority. */
  readonly owner: object;
  readonly scope: SavedHouse['scope'];
  readonly publicationId: string;
  readonly overviewManifestSha256: string;
  readonly semanticsSha256: string;
  readonly selectionRevision: string;
  readonly snapshotId: string;
  readonly localRevision: string;
  readonly capturedAt: string;
}
export type AtlasPresentationSelection = LiveAtlasSelection | SavedAtlasSelection;

/** Preserve native contracts behind an explicit live branch. In particular,
 * only this wrapper can acquire the native documentary overlay owner. */
export function createLiveAtlasPresentationPort(native: UnifiedAtlasPort) {
  function overview(selection: LiveAtlasSelection): ModelOverviewSelection {
    needPack(selection.kind === 'live'); return selection.overview;
  }
  return {
    current(): LiveAtlasSelection | null {
      const selected = native.current();
      return selected === null ? null : { kind: 'live', overview: selected };
    },
    subscribe(changed: () => void) { return native.subscribe(changed); },
    read(selection: LiveAtlasSelection, signal: AbortSignal) { return native.read(overview(selection), signal); },
    createOverlays(selection: LiveAtlasSelection, ...args: Parameters<NonNullable<UnifiedAtlasPort['createOverlays']>> extends
      [ModelOverviewSelection, ...infer Rest] ? Rest : never) {
      const selected = overview(selection);
      return native.createOverlays?.(selected, ...args) ?? Promise.resolve(null);
    },
  };
}

export interface SavedAtlasPresentationRead extends SavedAtlasRead {
  readonly selection: SavedAtlasSelection;
  readonly overlays: Readonly<{ state: 'unavailable'; reason: 'saved-overlay-projections-not-included' }>;
}
type LocalOwner = Pick<SavedHouseStore, 'list' | 'asset' | 'subscribe'>;

/** Open an explicit local allocation. The consumer remains the only resource
 * reader. No native port, fetch, expiry, derived overview pin or overlay lease.
 * Store notifications retire this allocation; the host must open it again. */
export async function openSavedAtlasPresentation(store: LocalOwner, input: SavedHouse, signal: AbortSignal) {
  const house = structuredClone(input), adapter = createSavedAtlasDataAdapter(store);
  const listeners = new Set<() => void>();
  let active = true;
  const unsubscribe = store.subscribe(() => {
    active = false;
    for (const changed of listeners) changed();
  });
  const guard = () => { signal.throwIfAborted(); needPack(active); };
  try {
    const initial = await adapter.read(house, signal); guard();
    if (initial === null) { unsubscribe(); return null; }
    const descriptor = initial.saved.descriptor, unified = descriptor.unified;
    needPack(unified);
    const selection: SavedAtlasSelection = Object.freeze({ kind: 'saved', owner: Object.freeze({}),
      scope: Object.freeze({ ...house.scope }), publicationId: descriptor.publicationId,
      overviewManifestSha256: descriptor.overviewManifestSha256, semanticsSha256: unified.semanticsSha256,
      selectionRevision: unified.selectionRevision, snapshotId: initial.saved.snapshotId,
      localRevision: initial.saved.localRevision, capturedAt: initial.saved.capturedAt });
    return {
      current(): SavedAtlasSelection | null { return active ? selection : null; },
      subscribe(changed: () => void) { listeners.add(changed); return () => { listeners.delete(changed); }; },
      async read(selected: SavedAtlasSelection, readSignal: AbortSignal): Promise<SavedAtlasPresentationRead> {
        readSignal.throwIfAborted(); needPack(active && selected === selection);
        // Do not cache bytes from open: each presentation read rechecks the
        // exact local revision and all consumed digest/MIME/size pins.
        const result = await adapter.read(house, readSignal);
        readSignal.throwIfAborted(); needPack(active && result);
        return { ...result, selection, overlays: { state: 'unavailable', reason: 'saved-overlay-projections-not-included' } };
      },
      dispose() {
        if (active) { active = false; for (const changed of listeners) changed(); }
        unsubscribe(); listeners.clear();
      },
    };
  } catch (error) { active = false; unsubscribe(); throw error; }
}
