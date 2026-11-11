import { useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AtlasModel } from './scene';
import type { AtlasPresentationPort, AtlasPresentationSelection } from './types';
import { createOverlayFeed, type OverlayFeed, type OverlayFeedSnapshot } from './overlay-feed';
import { OverlayFeedEnvironmentContext } from './OverlayFeedEnvironmentContext';

const OFF: OverlayFeedSnapshot = { records: null, reason: 'not-loaded', buildings: [], stored: null };
const idle = () => () => undefined, off = () => OFF;

/** The documentary layers for the Atlas stage. A live Atlas keeps one feed per
 * selection and model: it shows the stored copy at once and keeps its sources
 * open across toggles (see createOverlayFeed). A saved Atlas shows its snapshot. */
export function useDocumentaryOverlays(port: AtlasPresentationPort, selection: AtlasPresentationSelection, model: AtlasModel, active: boolean) {
  const environment = useContext(OverlayFeedEnvironmentContext);
  const saved = useMemo(() => port.savedDocumentary?.records(model.scene, model.selectable) ?? null, [port, model]);
  const [owned, setOwned] = useState<{ readonly feed: OverlayFeed; readonly port: AtlasPresentationPort; readonly selection: AtlasPresentationSelection; readonly model: AtlasModel; readonly environment: typeof environment } | null>(null);
  useEffect(() => {
    if (port.kind === 'saved' || selection.kind === 'saved' || saved) return;
    const feed = createOverlayFeed(port, selection, model, environment);
    setOwned({ feed, port, selection, model, environment });
    return () => { feed.dispose(); setOwned(value => value?.feed === feed ? null : value); };
  }, [port, selection, model, saved, environment]);
  const feed = owned && owned.port === port && owned.selection === selection && owned.model === model && owned.environment === environment ? owned.feed : null;
  useEffect(() => { feed?.setActive(active); }, [feed, active]);
  const shown = useSyncExternalStore(feed ? feed.subscribe : idle, feed ? feed.snapshot : off, off);
  if (saved) return { records: active ? saved : null, reason: active ? 'saved-documentary-snapshot' : 'not-loaded', buildings: saved.buildings, stored: null };
  // Between turning a layer on and the feed hearing of it, the layer is loading, not unavailable.
  return !active ? { ...OFF, buildings: shown.buildings } : shown.reason === 'not-loaded' ? { ...shown, reason: 'loading' } : shown;
}
