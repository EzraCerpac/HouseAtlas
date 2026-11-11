/** Imported first by the example page, before any application module runs.
 * The example keeps nothing and reaches no service: every fetch is refused
 * locally, and browser storage is replaced so the real app's outbox, Atlas
 * caches and preferences on this origin are neither read nor changed. */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: key => { values.delete(key); },
    clear: () => { values.clear(); },
  };
}
const replace = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: false });
replace('fetch', async () => new Response(null, { status: 404 }));
replace('localStorage', memoryStorage());
replace('sessionStorage', memoryStorage());
// Stores that use IndexedDB or Cache Storage report themselves unavailable.
replace('indexedDB', undefined);
replace('caches', undefined);
