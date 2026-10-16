/** SYNTHETIC IndexedDB model for Node checks. It is not a browser and proves
 * nothing about Safari, Chrome or an installed PWA. It implements only the
 * subset the scan cache uses: versioned open with upgrade, keyPath object
 * stores, serialized transactions with copy-on-write commit, structured-clone
 * values, request success/error events, abort, and an optional origin quota
 * enforced at commit with a QuotaExceededError abort, as browsers report it.
 * A `disk` outlives every factory made from it, standing in for storage that
 * survives a closed page and process. */

export function createSyntheticDisk({ quota = Infinity } = {}) {
  return { databases: new Map(), quota, commits: 0, quotaAborts: 0, transactions: Promise.resolve(), pause: Promise.resolve() };
}

const later = callback => setTimeout(callback, 0);
const domError = (name, message) => new DOMException(message, name);
function sizeOf(disk) {
  let total = 0;
  for (const database of disk.databases.values())
    for (const store of database.stores.values())
      for (const value of store.records.values()) if (value?.data instanceof ArrayBuffer) total += value.data.byteLength;
  return total;
}
/** Plain stored values of one object store, for inspection by checks. */
export function syntheticRecords(disk, databaseName, storeName) {
  const store = disk.databases.get(databaseName)?.stores.get(storeName);
  return store ? [...store.records.values()].map(value => structuredClone(value)) : [];
}

export function createSyntheticIndexedDB(disk) {
  function request(owner) {
    return { result: undefined, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null, source: owner };
  }
  function database(name, record) {
    let closed = false;
    const db = {
      name, onversionchange: null,
      get version() { return record.version; },
      objectStoreNames: { contains: storeName => record.stores.has(storeName) },
      createObjectStore(storeName, { keyPath }) {
        if (!db.upgrading) throw domError('InvalidStateError', 'Not in a version change');
        if (record.stores.has(storeName)) throw domError('ConstraintError', 'Store exists');
        record.stores.set(storeName, { keyPath, records: new Map() });
      },
      close() { closed = true; },
      transaction(names, mode = 'readonly') {
        if (closed) throw domError('InvalidStateError', 'Connection closed');
        const list = typeof names === 'string' ? [names] : [...names];
        for (const storeName of list) if (!record.stores.has(storeName)) throw domError('NotFoundError', `No store ${storeName}`);
        return transaction(record, list, mode);
      },
    };
    return db;
  }
  function transaction(record, names, mode) {
    // Snapshot only when this transaction starts, after preceding connections'
    // transactions commit. A factory-local queue would conceal cross-page bugs.
    const staged = new Map();
    let pending = 0, finished = false, started = false;
    const operations = [];
    const tx = { mode, error: null, oncomplete: null, onabort: null, onerror: null,
      objectStore(storeName) {
        if (!names.includes(storeName)) throw domError('NotFoundError', `No store ${storeName} in transaction`);
        const keyPath = record.stores.get(storeName).keyPath, rows = () => staged.get(storeName);
        const issue = (write, run) => {
          if (finished) throw domError('TransactionInactiveError', 'Transaction finished');
          if (write && mode !== 'readwrite') throw domError('ReadOnlyError', 'Read-only transaction');
          const req = request(tx); pending++;
          operations.push(() => {
            if (finished) return;
            try { req.result = run(); later(() => { pending--; if (finished) return; req.onsuccess?.({ target: req }); settle(); }); }
            catch (error) { req.error = error; later(() => { pending--; if (finished) return; req.onerror?.({ target: req }); abort(error); }); }
          });
          if (started) drain();
          return req;
        };
        const key = value => { if (typeof value !== 'string') throw domError('DataError', 'Invalid key'); return value; };
        return {
          get: id => issue(false, () => { const value = rows().get(key(id)); return value === undefined ? undefined : structuredClone(value); }),
          getAll: () => issue(false, () => [...rows().keys()].sort().map(id => structuredClone(rows().get(id)))),
          put: value => { const id = key(value?.[keyPath]), copy = structuredClone(value); return issue(true, () => { rows().set(id, copy); return id; }); },
          delete: id => { const target = key(id); return issue(true, () => { rows().delete(target); }); },
          clear: () => issue(true, () => { rows().clear(); }),
        };
      },
      abort() { if (finished) throw domError('InvalidStateError', 'Transaction finished'); abort(null); },
    };
    function drain() { while (operations.length) operations.shift()(); }
    function settle() {
      later(() => {
        if (finished || pending > 0 || operations.length) return;
        if (mode === 'readwrite') {
          const previousBytes = sizeOf(disk);
          const previous = new Map(names.map(storeName => [storeName, record.stores.get(storeName).records]));
          for (const [storeName, rows] of staged) record.stores.get(storeName).records = rows;
          if (sizeOf(disk) > disk.quota && sizeOf(disk) > previousBytes) {
            for (const [storeName, rows] of previous) record.stores.get(storeName).records = rows;
            disk.quotaAborts++;
            abort(domError('QuotaExceededError', 'Synthetic origin quota exceeded'));
            return;
          }
          disk.commits++;
        }
        finished = true; done(); tx.oncomplete?.({ target: tx });
      });
    }
    function abort(error) {
      if (finished) return;
      finished = true; tx.error = error; operations.length = 0;
      later(() => { done?.(); tx.onabort?.({ target: tx }); });
    }
    let done;
    // Transactions run one at a time across every connection to this disk.
    disk.transactions = disk.transactions.then(async () => { await disk.pause; return new Promise(resolve => {
      done = resolve; started = true;
      if (finished) { resolve(); return; }
      for (const storeName of names) staged.set(storeName, new Map(record.stores.get(storeName).records));
      drain(); settle();
    }); });
    return tx;
  }
  return {
    open(name, version = 1) {
      const req = request(null);
      later(() => {
        let record = disk.databases.get(name);
        if (record && version < record.version) { req.error = domError('VersionError', 'Lower version'); req.onerror?.({ target: req }); return; }
        const upgrade = !record || version > record.version;
        if (!record) { record = { version: 0, stores: new Map() }; disk.databases.set(name, record); }
        const db = database(name, record);
        req.result = db;
        if (upgrade) {
          record.version = version; db.upgrading = true;
          try { req.onupgradeneeded?.({ target: req, oldVersion: 0, newVersion: version }); }
          finally { db.upgrading = false; }
        }
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
}
