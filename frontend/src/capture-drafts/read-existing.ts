/** Reads every row of one object store of an EXISTING IndexedDB database, for display only.
 * It never creates, upgrades or deletes a database: any upgrade request (including first creation)
 * is aborted, and a block, version change or timeout returns null ("nothing held"). Every
 * connection and transaction it acquires is closed or aborted before this resolves, and a
 * late-completing open is closed at once. An empty version-0 database an aborted creation might
 * leave is harmless: the draft store requests version 1 and creates its store on upgrade.
 * No imports, so generated checks can load it directly. */
export async function readExistingStore(factory: IDBFactory, name: string, storeName: string, version: number,
  deadlineMs = 10_000): Promise<unknown[] | null> {
  // A snapshot only: absence skips the open, presence is re-checked by the open itself.
  try { if (factory.databases && !(await factory.databases()).some(row => row.name === name)) return null; }
  catch { /* no enumeration: the guarded open below decides */ }
  return new Promise<unknown[] | null>((resolve, reject) => {
    let settled = false, upgraded = false;
    let db: IDBDatabase | null = null, active: IDBTransaction | null = null;
    const done = (value: unknown[] | null, error?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      // Release everything held, whichever way this ends (including the deadline).
      if (active) { try { active.abort(); } catch { /* already finished */ } active = null; }
      db?.close(); db = null;
      if (error === undefined) resolve(value); else reject(error);
    };
    const timer = setTimeout(() => done(null), deadlineMs);
    let request: IDBOpenDBRequest;
    try { request = factory.open(name); } catch (error) { done(null, error); return; }
    request.onupgradeneeded = () => {
      upgraded = true;
      try { request.transaction?.abort(); } catch { /* the open then fails or is closed below */ }
    };
    request.onblocked = () => done(null);
    request.onerror = () => done(null, upgraded ? undefined : request.error ?? new Error('Local draft storage is unavailable'));
    request.onsuccess = () => {
      const opened = request.result;
      if (settled || upgraded) { opened.close(); done(null); return; }
      db = opened;
      opened.onversionchange = () => done(null);
      if (opened.version !== version || !opened.objectStoreNames.contains(storeName)) { done(null); return; }
      let transaction: IDBTransaction;
      try { transaction = opened.transaction(storeName, 'readonly'); } catch (error) { done(null, error); return; }
      active = transaction;
      const all = transaction.objectStore(storeName).getAll();
      transaction.oncomplete = () => { active = null; done(all.result as unknown[]); };
      transaction.onabort = transaction.onerror = () => {
        active = null; done(null, transaction.error ?? new Error('Local draft rows could not be read'));
      };
    };
  });
}
