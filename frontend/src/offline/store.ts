/** Explicitly downloaded documents, separate from live session/read owners,
 * scan acceleration and unsent captures. No transport or authentication here. */
export interface SavedResource {
  readonly id: string; readonly role: string; readonly label: string;
  readonly sha256: string; readonly bytes: number; readonly contentType: string;
  /** Canonical first descriptor only; other references can share these bytes. */
  readonly record?: Readonly<{ recordType: string; recordId: string; revision: string }> | null;
}
export interface SavedHouse {
  readonly version: 1; readonly localRevision: string;
  readonly key: string; readonly snapshotId: string;
  readonly scope: Readonly<{ workspaceId: string; homeId: string }>;
  readonly label: string; readonly capturedAt: string; readonly shellBuildId: string;
  readonly resources: readonly SavedResource[];
  /** Local manifest without transport hrefs; original numeric tokens retained. */
  readonly manifest: ArrayBuffer;
}
interface Stage extends SavedHouse { readonly token: string; readonly epoch: string }
interface Bytes { readonly id: string; readonly data: ArrayBuffer }
export const SAVED_HOUSE_DATABASE = 'houseatlas-explicit-saved-houses-v1';
export const SAVED_HOUSE_LIMITS = Object.freeze({ houses: 4, resources: 2048, resourceBytes: 128 * 1024 * 1024,
  houseBytes: 512 * 1024 * 1024, manifestBytes: 16 * 1024 * 1024 });
const SHA = /^[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const text = (value: unknown, cap: number): value is string => typeof value === 'string' && value.length > 0
  && value.length <= cap && !/[\u0000-\u001f\u007f]/.test(value);
const need = (value: unknown) => { if (!value) throw new Error('The saved house is unavailable'); };
export const savedHouseKey = (scope: SavedHouse['scope']) => `${scope.workspaceId}/${scope.homeId}`;
const assetKey = (key: string, sha: string) => key + '/' + sha;
export const SAVED_RANGE_BYTES = 4194304;
const rangeKey = (key: string, sha: string, start: number) => assetKey(key, sha) + '@' + start;
function deleteRanges(transaction: IDBTransaction, key: string, resource: SavedResource): void {
  for (let start = 0; start < resource.bytes; start += SAVED_RANGE_BYTES)
    transaction.objectStore('assets').delete(rangeKey(key, resource.sha256, start));
}
export async function savedDigest(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
export function validateSavedHouse(house: SavedHouse): void {
  need(house && house.version === 1 && uuid.test(house.localRevision) && uuid.test(house.scope?.workspaceId)
    && uuid.test(house.scope?.homeId) && house.key === savedHouseKey(house.scope));
  need(text(house.snapshotId, 256) && text(house.label, 256) && text(house.capturedAt, 64)
    && Number.isFinite(Date.parse(house.capturedAt)) && SHA.test(house.shellBuildId));
  need(house.manifest instanceof ArrayBuffer && house.manifest.byteLength <= SAVED_HOUSE_LIMITS.manifestBytes);
  need(Array.isArray(house.resources) && house.resources.length <= SAVED_HOUSE_LIMITS.resources);
  const ids = new Set<string>(), pins = new Map<string, number>(); let total = 0;
  for (const resource of house.resources) {
    need(text(resource.id, 256) && !ids.has(resource.id) && text(resource.role, 128) && text(resource.label, 256));
    ids.add(resource.id);
    need(SHA.test(resource.sha256) && Number.isSafeInteger(resource.bytes) && resource.bytes > 0
      && resource.bytes <= SAVED_HOUSE_LIMITS.resourceBytes && text(resource.contentType, 128));
    need(!pins.has(resource.sha256) || pins.get(resource.sha256) === resource.bytes);
    if (resource.record != null) need(text(resource.record.recordType, 256) && text(resource.record.recordId, 256)
      && typeof resource.record.revision === 'string' && /^[1-9][0-9]*$/.test(resource.record.revision));
    if (!pins.has(resource.sha256)) total += resource.bytes;
    pins.set(resource.sha256, resource.bytes);
  }
  need(total <= SAVED_HOUSE_LIMITS.houseBytes);
}
function completed<T>(database: IDBDatabase, stores: string[], mode: IDBTransactionMode,
  body: (transaction: IDBTransaction, answer: (value: T) => void) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const transaction = database.transaction(stores, mode); let result: T, timeoutReason: Error | null = null;
    const abort = () => { try { transaction.abort(); } catch { /* already committed */ } };
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    // Request an abort, then let the transaction report its actual outcome.
    // If it is already committed, oncomplete must still return that success.
    const timer = setTimeout(() => { timeoutReason = new Error('Local storage did not finish'); abort(); }, 10000);
    transaction.oncomplete = () => { cleanup(); resolve(result); };
    transaction.onabort = transaction.onerror = () => { cleanup(); reject(signal?.aborted ? signal.reason : timeoutReason ?? transaction.error ?? new Error('Local storage is unavailable')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { body(transaction, value => { result = value; }); }
    catch (error) { cleanup(); abort(); reject(error); }
  });
}
export function createSavedHouseStore(factory: IDBFactory = indexedDB) {
  let opening: Promise<IDBDatabase> | null = null;
  const listeners = new Set<() => void>();
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SAVED_HOUSE_DATABASE);
  const changed = () => { for (const listener of listeners) listener(); };
  if (channel) channel.onmessage = changed;
  const announce = () => { changed(); channel?.postMessage('changed'); };
  function database(): Promise<IDBDatabase> {
    if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(SAVED_HOUSE_DATABASE, 1); let settled = false;
      const timer = setTimeout(() => { settled = true; reject(new Error('Local storage is blocked')); }, 10000);
      request.onupgradeneeded = () => { for (const name of ['houses', 'stages', 'assets', 'control'])
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' }); };
      request.onerror = request.onblocked = () => { clearTimeout(timer); settled = true; reject(new Error('Local storage is unavailable')); };
      request.onsuccess = () => {
        clearTimeout(timer); const db = request.result;
        if (settled) { db.close(); return; }
        db.onversionchange = () => { db.close(); opening = null; changed(); }; resolve(db);
      };
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  const read = async <T>(store: string, id: string): Promise<T | undefined> => completed(await database(), [store], 'readonly', (tx, answer) => {
    const request = tx.objectStore(store).get(id); request.onsuccess = () => answer(request.result as T | undefined);
  });
  async function list(): Promise<readonly SavedHouse[]> {
    const values = await completed<SavedHouse[]>(await database(), ['houses'], 'readonly', (tx, answer) => {
      const request = tx.objectStore('houses').getAll(); request.onsuccess = () => answer(request.result as SavedHouse[]);
    });
    need(values.length <= SAVED_HOUSE_LIMITS.houses); values.forEach(validateSavedHouse); return values;
  }
  return {
    list,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async begin(input: Omit<SavedHouse, 'localRevision'>): Promise<Stage> {
      const token = crypto.randomUUID(), house = structuredClone({ ...input, localRevision: token }); validateSavedHouse(house);
      return completed<Stage>(await database(), ['houses', 'stages', 'assets', 'control'], 'readwrite', (tx, answer) => {
        const houses = tx.objectStore('houses').getAll();
        houses.onsuccess = () => {
          const saved = houses.result as SavedHouse[];
          if (saved.length >= SAVED_HOUSE_LIMITS.houses && !saved.some(item => item.key === house.key)) { tx.abort(); return; }
          const prior = saved.find(item => item.key === house.key), request = tx.objectStore('stages').get(house.key);
          request.onsuccess = () => {
            const previous = request.result as Stage | undefined;
            for (const resource of previous?.resources ?? []) if (!prior?.resources.some(item => item.sha256 === resource.sha256)
              && !house.resources.some(item => item.sha256 === resource.sha256))
              { tx.objectStore('assets').delete(assetKey(house.key, resource.sha256)); deleteRanges(tx, house.key, resource); }
            const control = tx.objectStore('control').get('epoch/' + house.key);
            control.onsuccess = () => {
              const epoch = (control.result as { value: string } | undefined)?.value ?? crypto.randomUUID();
              tx.objectStore('control').put({ id: 'epoch/' + house.key, value: epoch });
              const stage = { ...house, token, epoch }; tx.objectStore('stages').put({ ...stage, id: house.key }); answer(stage);
            };
          };
        };
      });
    },
    async discardStage(stage: { readonly key: string; readonly token: string; readonly epoch: string }): Promise<void> {
      const selected = { key: stage.key, token: stage.token, epoch: stage.epoch };
      await completed<void>(await database(), ['houses', 'stages', 'assets', 'control'], 'readwrite', (tx, answer) => {
        const control = tx.objectStore('control').get('epoch/' + selected.key);
        control.onsuccess = () => {
          if ((control.result as { value: string } | undefined)?.value !== selected.epoch) { answer(undefined); return; }
          const current = tx.objectStore('stages').get(selected.key);
          current.onsuccess = () => {
            const pending = current.result as Stage | undefined;
            if (pending?.token !== selected.token || pending.epoch !== selected.epoch) { answer(undefined); return; }
            const active = tx.objectStore('houses').get(selected.key);
            active.onsuccess = () => {
              const house = active.result as SavedHouse | undefined;
              for (const resource of pending.resources) {
                if (!house?.resources.some(item => item.sha256 === resource.sha256))
                  tx.objectStore('assets').delete(assetKey(selected.key, resource.sha256));
                deleteRanges(tx, selected.key, resource);
              }
              tx.objectStore('stages').delete(selected.key); answer(undefined);
            };
          };
        };
      });
    },
    async retained(stage: Stage, resource: SavedResource): Promise<ArrayBuffer | null> {
      const current = await read<Stage>('stages', stage.key);
      need(current?.token === stage.token);
      const control = await read<{ value: string }>('control', 'epoch/' + stage.key); need(control?.value === stage.epoch);
      const held = await read<Bytes>('assets', assetKey(stage.key, resource.sha256));
      if (!held) return null;
      need(held.data instanceof ArrayBuffer && held.data.byteLength === resource.bytes && await savedDigest(held.data) === resource.sha256);
      return held.data;
    },
    async range(stage: Stage, resource: SavedResource, start: number): Promise<ArrayBuffer | null> {
      need(Number.isSafeInteger(start) && start >= 0 && start % SAVED_RANGE_BYTES === 0 && start < resource.bytes);
      const current = await read<Stage>('stages', stage.key); need(current?.token === stage.token);
      const control = await read<{ value: string }>('control', 'epoch/' + stage.key); need(control?.value === stage.epoch);
      const held = await read<Bytes>('assets', rangeKey(stage.key, resource.sha256, start));
      if (!held) return null;
      need(held.data instanceof ArrayBuffer && held.data.byteLength === Math.min(SAVED_RANGE_BYTES, resource.bytes - start));
      // Only the assembled resource's full hash admits these bytes for viewing.
      return held.data;
    },
    async putRange(stage: Stage, resource: SavedResource, start: number, data: ArrayBuffer): Promise<void> {
      const selected = { key: stage.key, token: stage.token, epoch: stage.epoch }, pin = structuredClone(resource), bytes = data.slice(0);
      need(Number.isSafeInteger(start) && start >= 0 && start % SAVED_RANGE_BYTES === 0 && start < pin.bytes
        && bytes.byteLength === Math.min(SAVED_RANGE_BYTES, pin.bytes - start));
      await completed<void>(await database(), ['stages', 'assets', 'control'], 'readwrite', (tx, answer) => {
        const control = tx.objectStore('control').get('epoch/' + selected.key);
        control.onsuccess = () => {
          if ((control.result as { value: string } | undefined)?.value !== selected.epoch) { tx.abort(); return; }
          const current = tx.objectStore('stages').get(selected.key);
          current.onsuccess = () => {
            const durable = current.result as Stage | undefined;
            if (durable?.token !== selected.token || !durable.resources.some(item => item.id === pin.id
              && item.sha256 === pin.sha256 && item.bytes === pin.bytes && item.contentType === pin.contentType)) { tx.abort(); return; }
            tx.objectStore('assets').put({ id: rangeKey(selected.key, pin.sha256, start), data: bytes }); answer(undefined);
          };
        };
      });
    },
    async put(stage: Stage, resource: SavedResource, data: ArrayBuffer): Promise<void> {
      const selected = { key: stage.key, token: stage.token, epoch: stage.epoch }, pin = structuredClone(resource), bytes = data.slice(0);
      need(bytes.byteLength === pin.bytes && await savedDigest(bytes) === pin.sha256);
      await completed<void>(await database(), ['stages', 'assets', 'control'], 'readwrite', (tx, answer) => {
        const control = tx.objectStore('control').get('epoch/' + selected.key);
        control.onsuccess = () => {
          if ((control.result as { value: string } | undefined)?.value !== selected.epoch) { tx.abort(); return; }
          const current = tx.objectStore('stages').get(selected.key);
          current.onsuccess = () => {
            const durable = current.result as Stage | undefined;
            if (durable?.token !== selected.token || !durable.resources.some(item => item.id === pin.id
              && item.sha256 === pin.sha256 && item.bytes === pin.bytes && item.contentType === pin.contentType)) { tx.abort(); return; }
            tx.objectStore('assets').put({ id: assetKey(selected.key, pin.sha256), data: bytes }); deleteRanges(tx, selected.key, pin); answer(undefined);
          };
        };
      });
    },
    async activate(selected: Stage, options: { readonly signal?: AbortSignal; readonly current?: () => boolean } = {}): Promise<SavedHouse> {
      const selection = { key: selected.key, token: selected.token, epoch: selected.epoch };
      const databaseOwner = await database(); options.signal?.throwIfAborted(); need(options.current?.() ?? true);
      const saved = await completed<SavedHouse>(databaseOwner, ['houses', 'stages', 'assets', 'control'], 'readwrite', (tx, answer) => {
        const currentOwner = () => {
          try { options.signal?.throwIfAborted(); need(options.current?.() ?? true); return true; }
          catch { tx.abort(); return false; }
        };
        const control = tx.objectStore('control').get('epoch/' + selection.key);
        control.onsuccess = () => {
          if (!currentOwner()) return;
          if ((control.result as { value: string } | undefined)?.value !== selection.epoch) { tx.abort(); return; }
          const current = tx.objectStore('stages').get(selection.key);
          current.onsuccess = () => {
            if (!currentOwner()) return;
            const stage = current.result as Stage | undefined;
            if (stage?.token !== selection.token) { tx.abort(); return; }
            let remaining = stage.resources.length;
            const publish = () => {
              const previous = tx.objectStore('houses').getAll();
              previous.onsuccess = () => {
                if (!currentOwner()) return;
                const houses = previous.result as SavedHouse[], prior = houses.find(item => item.key === stage.key);
                if (houses.length >= SAVED_HOUSE_LIMITS.houses && !prior) { tx.abort(); return; }
                for (const resource of prior?.resources ?? [])
                  if (!stage.resources.some(item => item.sha256 === resource.sha256)) {
                    tx.objectStore('assets').delete(assetKey(stage.key, resource.sha256)); deleteRanges(tx, stage.key, resource);
                  }
                const { token: _token, epoch: _epoch, ...house } = stage;
                tx.objectStore('houses').put({ ...house, id: house.key }); tx.objectStore('stages').delete(stage.key); answer(house);
              };
            };
            if (!remaining) publish();
            for (const resource of stage.resources) {
              const request = tx.objectStore('assets').get(assetKey(stage.key, resource.sha256));
              request.onsuccess = () => {
                const found = request.result as Bytes | undefined;
                if (!(found?.data instanceof ArrayBuffer) || found.data.byteLength !== resource.bytes) { tx.abort(); return; }
                if (--remaining === 0) publish();
              };
            }
          };
        };
      }, options.signal);
      // oncomplete is the publication boundary. Later cancellation cannot
      // turn this committed replacement into a failed download result.
      try { announce(); } catch { /* notification errors cannot undo a committed copy */ }
      return saved;
    },
    async asset(house: SavedHouse, id: string): Promise<Blob> {
      validateSavedHouse(house); const key = house.key, revision = house.localRevision;
      const active = await read<SavedHouse>('houses', key); need(active?.localRevision === revision);
      validateSavedHouse(active!);
      const resource = active!.resources.find(item => item.id === id); need(resource);
      const bytes = await read<Bytes>('assets', assetKey(key, resource!.sha256));
      need(bytes?.data instanceof ArrayBuffer && bytes.data.byteLength === resource!.bytes && await savedDigest(bytes.data) === resource!.sha256);
      const still = await read<SavedHouse>('houses', key); need(still?.localRevision === revision);
      return new Blob([bytes!.data], { type: resource!.contentType });
    },
    async remove(key: string): Promise<void> {
      await completed<void>(await database(), ['houses', 'stages', 'assets', 'control'], 'readwrite', (tx, answer) => {
        tx.objectStore('control').put({ id: 'epoch/' + key, value: crypto.randomUUID() });
        for (const name of ['houses', 'stages']) {
          const request = tx.objectStore(name).get(key);
          request.onsuccess = () => {
            for (const resource of (request.result as SavedHouse | undefined)?.resources ?? []) {
              tx.objectStore('assets').delete(assetKey(key, resource.sha256)); deleteRanges(tx, key, resource);
            }
            tx.objectStore(name).delete(key);
          };
        }
        answer(undefined);
      }); announce();
    },
    async clear(): Promise<void> {
      await completed<void>(await database(), ['houses', 'stages', 'assets', 'control'], 'readwrite', (tx, answer) => {
        for (const name of ['houses', 'stages', 'assets', 'control']) tx.objectStore(name).clear(); answer(undefined);
      }); announce();
    },
    async close() { const pending = opening; opening = null; (await pending)?.close(); channel?.close(); listeners.clear(); },
  };
}
export type SavedHouseStore = ReturnType<typeof createSavedHouseStore>;
