import { createRoot } from 'react-dom/client';
import { SavedAtlasHost } from '../src/offline/SavedAtlasHost';
import { savedEntryMarked } from '../src/offline/saved-entry';
// The live app's own last Atlas copy, shown while no saved copy is open.
const openLastCopy = (signal: AbortSignal) => import('./last-atlas-copy').then(module => module.openLastAtlasCopy(globalThis.indexedDB, signal, globalThis));
const element = document.getElementById('root');
if (!element) throw new Error('Saved Atlas root missing');
createRoot(element).render(<SavedAtlasHost openLastCopy={openLastCopy} explicit={savedEntryMarked()} />);
