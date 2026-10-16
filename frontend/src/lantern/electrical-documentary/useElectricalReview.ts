import { useEffect, useLayoutEffect, useState } from 'react';
import { createLocalSourceReader, type LocalSourceReaderStore } from './local-source-reader';
import { createRendererOwner, type RendererOwnerHandle } from './renderer-owner';
import { createSeenLedger, type SeenLedger } from './seen-ledger';
import type { CreateElectricalBridge, ElectricalBridge, RendererFiles, ReviewSessionOwner } from './types';

export type ElectricalBridgeState =
  | { readonly status: 'absent' }
  | { readonly status: 'incomplete' }
  | { readonly status: 'retired' }
  | { readonly status: 'connecting' }
  | { readonly status: 'failed' }
  /** `seen` is this bridge's review-wide union; it outlives target changes. */
  | { readonly status: 'ready'; readonly bridge: ElectricalBridge; readonly seen: SeenLedger };

export interface ElectricalReview {
  readonly store: LocalSourceReaderStore;
  readonly handle: RendererOwnerHandle | null;
  readonly bridge: ElectricalBridgeState;
}

/** Owns one renderer's selection owner, the optional bridge and the local
 * source reader. Replacement or unmount clears the reader, retires the owner
 * and closes the bridge; a late bridge is closed instead of attached. The
 * factory and session owner must be stable for one renderer. */
export function useElectricalReview(files: RendererFiles | null, factory: CreateElectricalBridge | undefined,
  session: ReviewSessionOwner | undefined): ElectricalReview {
  const [store] = useState(createLocalSourceReader);
  const [handle, setHandle] = useState<RendererOwnerHandle | null>(null);
  const [retired, setRetired] = useState<RendererFiles | null>(null);
  const [state, setState] = useState<{ readonly handle: RendererOwnerHandle; readonly bridge: ElectricalBridgeState } | null>(null);
  useLayoutEffect(() => {
    if (!files) { setHandle(null); return; }
    const made = createRendererOwner(files, session);
    const stop = made.owner.subscribe(made.context, () => {
      store.clear();
      setHandle(current => current === made ? null : current); setRetired(files);
    });
    if (made.isLive()) { setHandle(made); setRetired(null); }
    return () => { stop(); store.clear(); made.retire(); };
  }, [files, session, store]);
  useEffect(() => {
    if (!handle || !factory) return;
    const controller = new AbortController();
    let made: ElectricalBridge | null = null, live = true;
    setState({ handle, bridge: { status: 'connecting' } });
    factory({ ...handle.context, selectionOwner: handle.owner, reader: store.reader, signal: controller.signal }).then(bridge => {
      if (!live || !handle.isLive()) { bridge.close(); return; }
      made = bridge; setState({ handle, bridge: { status: 'ready', bridge, seen: createSeenLedger() } });
    }, () => { if (live) setState({ handle, bridge: { status: 'failed' } }); });
    return () => { live = false; controller.abort(); store.clear(); made?.close(); };
  }, [handle, factory, store]);
  const bridge: ElectricalBridgeState = !factory ? { status: 'absent' } : !files ? { status: 'incomplete' }
    : !handle ? { status: retired === files ? 'retired' : 'connecting' }
    : state?.handle === handle ? state.bridge : { status: 'connecting' };
  return { store, handle, bridge };
}
