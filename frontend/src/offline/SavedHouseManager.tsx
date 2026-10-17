import { useEffect, useState } from 'react';
import type { SavedHouse, SavedHouseStore } from './store';

export function SavedHouseManager({ store, selected, onOpen, onClose }: { readonly store: SavedHouseStore;
  readonly selected: SavedHouse | null; readonly onOpen: (house: SavedHouse) => void; readonly onClose: () => void }) {
  const [houses, setHouses] = useState<readonly SavedHouse[]>([]), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let closed = false, generation = 0;
    const refresh = () => {
      const current = ++generation;
      void store.list().then(rows => { if (!closed && current === generation) { setHouses(rows); setError(null); } }, () => {
        if (!closed && current === generation) { setHouses([]); setError('Saved copies could not be read.'); }
      });
    };
    const stop = store.subscribe(refresh); refresh();
    return () => { closed = true; stop(); };
  }, [store]);
  const remove = async (house: SavedHouse) => {
    if (house.localRevision === selected?.localRevision) onClose();
    try { await store.remove(house.key); } catch { setError('The saved copy could not be removed.'); }
  };
  return <section className="saved-manager" aria-label="Saved copies">
    {error && <p role="alert">{error}</p>}
    {!error && houses.length === 0 && <p role="status">No saved copy on this browser.</p>}
    {houses.map(house => <div className="saved-copy" key={house.localRevision}>
      <div><strong>{house.label}</strong><span>Captured <time dateTime={house.capturedAt}>{house.capturedAt}</time></span></div>
      <button type="button" onClick={() => onOpen(house)} aria-pressed={house.localRevision === selected?.localRevision}>Open saved Atlas</button>
      <button type="button" onClick={() => void remove(house)}>Remove <span className="sr-only">{house.label}</span></button>
    </div>)}
  </section>;
}
