/** Reads every row of one object store of an EXISTING IndexedDB database, for display only.
 * It never creates or upgrades the database: any upgrade request (including first creation) is
 * aborted, and a block, version change or timeout returns null ("nothing held"). The connection
 * is closed before this resolves. No imports, so generated checks can load it directly. */
export async function readExistingStore(factory: IDBFactory, name: string, storeName: string, version: number,
  deadlineMs = 10_000): Promise<unknown[] | null> {
  const listed = async () => {
    try { return factory.databases ? (await factory.databases()).find(row => row.name === name) ?? null : undefined; }
    catch { return undefined; }
  };
  // A snapshot only: absence skips the open, presence is re-checked by the open itself.
  if ((await listed()) === null) return null;
  let created = false;
  const rows = await new Promise<unknown[] | null>((resolve, reject) => {
    let settled = false, upgraded = false;
    const done = (value: unknown[] | null, error?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error === undefined) resolve(value); else reject(error);
    };
    const timer = setTimeout(() => done(null), deadlineMs);
    let request: IDBOpenDBRequest;
    try { request = factory.open(name); } catch (error) { done(null, error); return; }
    request.onupgradeneeded = event => {
      upgraded = true; created ||= event.oldVersion === 0;
      try { request.transaction?.abort(); } catch { /* the open then fails or is closed below */ }
    };
    request.onblocked = () => done(null);
    request.onerror = () => done(null, upgraded ? undefined : request.error ?? new Error('Local draft storage is unavailable'));
    request.onsuccess = () => {
      const db = request.result;
      if (settled || upgraded) { db.close(); done(null); return; }
      db.onversionchange = () => { db.close(); done(null); };
      if (db.version !== version || !db.objectStoreNames.contains(storeName)) { db.close(); done(null); return; }
      let transaction: IDBTransaction;
      try { transaction = db.transaction(storeName, 'readonly'); } catch (error) { db.close(); done(null, error); return; }
      const all = transaction.objectStore(storeName).getAll();
      transaction.oncomplete = () => { db.close(); done(all.result as unknown[]); };
      transaction.onabort = transaction.onerror = () => {
        db.close(); done(null, transaction.error ?? new Error('Local draft rows could not be read'));
      };
    };
  });
  // An aborted creation should leave nothing; if a version-0 database remains, remove it. A real
  // database has version 1 or more and is never deleted here.
  if (created) {
    const left = await listed();
    if (left && !left.version) await new Promise<void>(resolve => {
      const removal = factory.deleteDatabase(name);
      removal.onsuccess = removal.onerror = removal.onblocked = () => resolve();
    });
  }
  return rows;
}
