import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { UnifiedAtlasOverlayAvailableFrame } from '../../../integration/unified-atlas-overlay-source';
import type { ModelOverviewSelection } from '../source-models/overview-types';
import type { AtlasModel } from './scene';
import type { UnifiedAtlasPort } from './types';
import { documentaryRoomRecords, matchesOverlayScene } from './runtime-overlays';

type Handle = NonNullable<Awaited<ReturnType<NonNullable<UnifiedAtlasPort['createOverlays']>>>>;
type Owned = { handle: Handle; frame: UnifiedAtlasOverlayAvailableFrame; model: AtlasModel; buildingId: string };
export function useDocumentaryOverlays(port: UnifiedAtlasPort, selection: ModelOverviewSelection, model: AtlasModel,
  buildingId: string | null, active: boolean) {
  const [owned, setOwned] = useState<Owned | null>(null), [reason, setReason] = useState('not-loaded');
  useEffect(() => {
    if (!active) return;
    let closed = false, handle: Handle | null = null, frame: UnifiedAtlasOverlayAvailableFrame | null = null;
    const controller = new AbortController(); setOwned(null); setReason('loading');
    void (async () => {
      const building = buildingId === null ? null : model.buildingsById.get(buildingId);
      if (!building || !port.createOverlays) { if (!closed) setReason('source-unavailable'); return; }
      handle = await port.createOverlays(selection, model.scene, building, controller.signal);
      if (closed) { handle?.source.dispose(); return; }
      if (!handle) { setReason('no-native-building-link'); return; }
      const result = await handle.source.open(handle.request, controller.signal);
      if (result.status !== 'available') { if (!closed) setReason(result.reason); return; }
      frame = result;
      if (closed || port.current() !== selection || !handle.source.isCurrent(frame) || !matchesOverlayScene(frame, model.scene, building.buildingId)) {
        handle.source.release(frame); if (!closed) setReason('selection-changed'); return;
      }
      setOwned({ handle, frame, model, buildingId: building.buildingId }); setReason('available');
    })().catch(() => { if (!closed) { setOwned(null); setReason('source-unavailable'); } });
    return () => { closed = true; controller.abort(); if (frame) handle?.source.release(frame); handle?.source.dispose(); };
  }, [port, selection, model, buildingId, active]);
  const subscribe = useCallback((changed: () => void) => owned ? owned.handle.source.subscribeInvalidation(owned.frame, changed) : () => {}, [owned]);
  const snapshot = useCallback(() => active && owned?.model === model && owned.buildingId === buildingId
    && port.current() === selection && owned.handle.source.isCurrent(owned.frame)
    && matchesOverlayScene(owned.frame, model.scene, owned.buildingId) ? owned.frame : null,
  [active, owned, model, buildingId, port, selection]);
  const frame = useSyncExternalStore(subscribe, snapshot, () => null);
  const records = useMemo(() => frame ? documentaryRoomRecords(model.scene, frame, model.selectable) : null, [frame, model]);
  return { frame, records, reason: !active ? 'not-loaded' : frame ? 'available' : reason === 'available' ? 'selection-changed' : reason };
}
