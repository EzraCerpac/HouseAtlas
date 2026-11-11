/** Imported first by the example page, before any application module runs.
 * These are realm-local replacements, not a browser sandbox: the page shares
 * the app's origin, and the browser still sends that origin's cookies with
 * its own asset requests. Application reads never reach the network: every
 * fetch is refused locally. Browser storage, cross-tab channels and locks are
 * replaced so the app modules on this page neither read nor change the real
 * app's outbox, Atlas caches or preferences, and changes made here are kept
 * only in memory. */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
  };
}
const replace = (owner: object, name: string, value: unknown) =>
  Object.defineProperty(owner, name, { value, configurable: true, writable: false });
replace(globalThis, 'fetch', async () => new Response(null, { status: 404 }));
replace(globalThis, 'localStorage', memoryStorage());
replace(globalThis, 'sessionStorage', memoryStorage());
// Stores using IndexedDB or Cache Storage report themselves unavailable.
replace(globalThis, 'indexedDB', undefined);
replace(globalThis, 'caches', undefined);
// The outbox and saved-copy stores coordinate tabs through these; without
// them this page neither hears nor announces the real app's changes.
replace(globalThis, 'BroadcastChannel', undefined);
replace(navigator, 'locks', undefined);
// Script on this page can neither read nor set the origin's cookies.
Object.defineProperty(document, 'cookie', { configurable: true, get: () => '', set: () => {} });
