import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { UnifiedAtlasOverlayAvailableFrame } from '../../../integration/unified-atlas-overlay-source';
import type { ModelOverviewSelection } from '../source-models/overview-types';
import type { AtlasModel } from './scene';
import type { UnifiedAtlasPort } from './types';
import { documentaryRoomRecords, matchesOverlayScene, mergeRuntimeRecords } from './runtime-overlays';

type Handle = NonNullable<Awaited<ReturnType<NonNullable<UnifiedAtlasPort['createOverlays']>>>>;
type Owned = { readonly handle: Handle; readonly frame: UnifiedAtlasOverlayAvailableFrame };
type Frames = ReadonlyMap<string, UnifiedAtlasOverlayAvailableFrame>;
const NO_FRAMES: Frames = new Map();

/** Every building with floors opens its own source frame, lease and release:
 * layers are property-wide whatever the selection, while native qualification
 * stays building-scoped in the source owner. A building without a frame keeps
 * its own reason; the others still show. */
export function useDocumentaryOverlays(port: UnifiedAtlasPort, selection: ModelOverviewSelection, model: AtlasModel, active: boolean) {
  const [owned, setOwned] = useState<{ readonly model: AtlasModel; readonly rows: ReadonlyMap<string, Owned> } | null>(null);
  const [reasons, setReasons] = useState<ReadonlyMap<string, string>>(new Map());
  const saved = useMemo(() => port.savedDocumentary?.records(model.scene, model.selectable) ?? null, [port, model]);
  useEffect(() => {
    if (!active || saved) return;
    let closed = false;
    const controller = new AbortController(), rows = new Map<string, Owned>(), handles: Handle[] = [];
    const note = (buildingId: string, reason: string) => { if (!closed) setReasons(value => new Map(value).set(buildingId, reason)); };
    setOwned(null); setReasons(new Map(model.floorBuildings.map(building => [building.buildingId, 'loading'])));
    for (const building of model.floorBuildings) void (async () => {
      if (!port.createOverlays) { note(building.buildingId, 'source-unavailable'); return; }
      const handle = await port.createOverlays(selection, model.scene, building, controller.signal);
      if (closed) { handle?.source.dispose(); return; }
      if (!handle) { note(building.buildingId, 'no-native-building-link'); return; }
      handles.push(handle);
      const result = await handle.source.open(handle.request, controller.signal);
      if (result.status !== 'available') { note(building.buildingId, result.reason); return; }
      if (closed || port.current() !== selection || !handle.source.isCurrent(result) || !matchesOverlayScene(result, model.scene, building.buildingId)) {
        handle.source.release(result); note(building.buildingId, 'selection-changed'); return;
      }
      rows.set(building.buildingId, { handle, frame: result });
      setOwned({ model, rows: new Map(rows) }); note(building.buildingId, 'available');
    })().catch(() => note(building.buildingId, 'source-unavailable'));
    return () => {
      closed = true; controller.abort();
      for (const row of rows.values()) row.handle.source.release(row.frame);
      for (const handle of handles) handle.source.dispose();
    };
  }, [port, selection, model, active, saved]);
  const subscribe = useCallback((changed: () => void) => {
    const stops = [...(owned?.rows.values() ?? [])].map(row => row.handle.source.subscribeInvalidation(row.frame, changed));
    return () => { for (const stop of stops) stop(); };
  }, [owned]);
  // The same frames return the same map, so an unchanged source never re-renders.
  const last = useRef<Frames>(NO_FRAMES);
  const snapshot = useCallback(() => {
    const frames = new Map<string, UnifiedAtlasOverlayAvailableFrame>();
    if (active && owned?.model === model && port.current() === selection) for (const [buildingId, row] of owned.rows)
      if (row.handle.source.isCurrent(row.frame) && matchesOverlayScene(row.frame, model.scene, buildingId)) frames.set(buildingId, row.frame);
    const previous = last.current;
    if (previous.size === frames.size && [...frames].every(([buildingId, frame]) => previous.get(buildingId) === frame)) return previous;
    last.current = frames.size === 0 ? NO_FRAMES : frames; return last.current;
  }, [active, owned, model, port, selection]);
  const frames = useSyncExternalStore(subscribe, snapshot, () => NO_FRAMES);
  const aggregate = useMemo(() => mergeRuntimeRecords(model, model.floorBuildings.map(building => {
    const frame = frames.get(building.buildingId);
    const reason = reasons.get(building.buildingId);
    return { buildingId: building.buildingId, reason: frame ? 'available' : reason === 'available' ? 'selection-changed' : reason ?? 'not-loaded',
      records: frame ? documentaryRoomRecords(model.scene, frame, model.selectable) : null };
  })), [frames, model, reasons]);
  const records = !active ? null : saved ?? (frames.size === 0 ? null : aggregate);
  const pending = [...reasons.values()].some(reason => reason === 'loading');
  const reason = !active ? 'not-loaded' : saved ? 'saved-documentary-snapshot' : frames.size > 0 ? 'available' : pending ? 'loading'
    : [...new Set([...reasons.values()].map(value => value === 'available' ? 'selection-changed' : value))].join(', ') || 'source-unavailable';
  return { records, reason, buildings: saved?.buildings ?? aggregate.buildings };
}
