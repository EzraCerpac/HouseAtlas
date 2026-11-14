import { createRoot } from 'react-dom/client';
import { SavedAtlasHost } from '../src/offline/SavedAtlasHost';
import { OfflineLanternHost } from '../src/offline/OfflineLanternHost';
import { createLiveCopyRetention } from './live-copy-retention';
import { savedEntryMarked } from '../src/offline/saved-entry';
import { DRAFT_DATABASE, openDraftStore } from '../src/capture-drafts/indexeddb';
// The live app's own last Atlas copy, shown while no saved copy is open.
const openLastCopy = (signal: AbortSignal) => import('./last-atlas-copy').then(module => module.openLastAtlasCopy(globalThis.indexedDB, signal, globalThis));
/** Read-only draft rows for the held-copy listing; never creates the draft database. */
async function readDraftRows(factory: IDBFactory) {
  if (!factory.databases || !(await factory.databases()).some(row => row.name === DRAFT_DATABASE)) return null;
  const store = openDraftStore(factory);
  try { return await store.read(); } finally { store.close(); }
}
const element = document.getElementById('root');
if (!element) throw new Error('Saved Atlas root missing');
if (savedEntryMarked()) createRoot(element).render(<SavedAtlasHost openLastCopy={openLastCopy} explicit />);
else {
  const owner = createLiveCopyRetention({ factory: globalThis.indexedDB,
    state: () => ({ session: null, view: null }),
    documents: () => { throw new Error('No live document authority in the retained shell'); },
    events: window,
    ...(typeof BroadcastChannel === 'undefined' ? {} : { channel: new BroadcastChannel('houseatlas-live-readonly-copy-v1') }),
    ...(navigator.storage ? { storage: navigator.storage } : {}),
    readDrafts: () => readDraftRows(globalThis.indexedDB),
  });
  const openAtlas = async (signal: AbortSignal, handle: import('../src/offline/live-copy-types').OfflineCopyHandle) => {
    const reference = await owner.read.atlasReference(handle, signal);
    if (reference.status !== 'ok' || !reference.value) return null;
    const module = await import('./last-atlas-copy'); signal.throwIfAborted();
    return module.openLastAtlasCopy(globalThis.indexedDB, signal, globalThis, reference.value);
  };
  createRoot(element).render(<OfflineLanternHost owner={owner} openAtlas={openAtlas} openLegacyAtlas={openLastCopy} />);
}
