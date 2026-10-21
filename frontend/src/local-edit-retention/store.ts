import type {
  LocalEditBytes, LocalEditContext, LocalEditDraft, LocalEditInput,
  LocalEditResourcePin, LocalEditRetentionStore, LocalEditSelection,
} from './types.ts';

export const LOCAL_EDIT_RETENTION_DATABASE = 'houseatlas-local-edit-retention-v1';
export const LOCAL_EDIT_RETENTION_LIMITS = Object.freeze({
  drafts: 32, recordBytes: 1024 * 1024, manifestBytes: 16 * 1024 * 1024,
  metadataBytes: 64 * 1024, totalBytes: 64 * 1024 * 1024,
});
const STORE = 'drafts', SHA = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
interface Row { readonly id: string; readonly draft: LocalEditDraft }
function need(value: unknown): asserts value {
  if (!value) throw new Error('Local edit retention is unavailable or exceeds its bounds');
}
function text(value: unknown): asserts value is string {
  need(typeof value === 'string' && value.length > 0 && value.length <= LOCAL_EDIT_RETENTION_LIMITS.metadataBytes
    && !/[\u0000-\u001f\u007f]/.test(value));
}
function object(value: unknown, required: readonly string[], optional: readonly string[] = []): void {
  need(value !== null && typeof value === 'object' && !Array.isArray(value));
  need(required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
}
function context(value: LocalEditContext): void {
  need(value); object(value.scope, ['workspaceId', 'homeId']);
  text(value.scope.workspaceId); text(value.scope.homeId); text(value.savedKey);
  text(value.snapshotId); text(value.localRevision);
}
function pin(value: LocalEditResourcePin): void {
  object(value, ['id', 'role', 'label', 'sha256', 'bytes', 'contentType'], ['record']);
  text(value.id); text(value.role); text(value.label); text(value.contentType);
  need(typeof value.sha256 === 'string' && SHA.test(value.sha256)
    && Number.isSafeInteger(value.bytes) && value.bytes > 0);
  if (value.record != null) {
    object(value.record, ['recordType', 'recordId', 'revision']);
    text(value.record.recordType); text(value.record.recordId); text(value.record.revision);
  }
}
function selection(value: LocalEditSelection): void {
  context(value); pin(value.selectedResource);
  object(value.recordIdentity, ['recordType', 'recordId']);
  text(value.recordIdentity.recordType); text(value.recordIdentity.recordId);
}
function bytes(value: ArrayBuffer, cap: number): void {
  need(value instanceof ArrayBuffer && !('resizable' in value && value.resizable) && value.byteLength <= cap);
}
function supplied(value: LocalEditBytes, cap: number): void {
  object(value, ['bytes', 'sha256']); bytes(value.bytes, cap);
  need(typeof value.sha256 === 'string' && SHA.test(value.sha256));
}
async function digest(value: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function sameContext(a: LocalEditContext, b: LocalEditContext): boolean {
  return a.scope.workspaceId === b.scope.workspaceId && a.scope.homeId === b.scope.homeId
    && a.savedKey === b.savedKey && a.snapshotId === b.snapshotId && a.localRevision === b.localRevision;
}
/** Tuple encoding avoids delimiter collisions. Full descriptor participates in
 * selection so another resource pin cannot address this retained original. */
function key(partition: string, value: LocalEditSelection): string {
  const p = value.selectedResource;
  return JSON.stringify([partition, value.scope.workspaceId, value.scope.homeId, value.savedKey,
    value.snapshotId, value.localRevision, p.id, p.role, p.label, p.sha256, p.bytes, p.contentType,
    p.record === undefined ? [] : p.record === null ? null : [p.record.recordType, p.record.recordId, p.record.revision],
    value.recordIdentity.recordType, value.recordIdentity.recordId]);
}
/** Engineering accounting includes UTF-8 metadata and each retained byte copy;
 * it is not an estimate of a browser's physical storage allocation or quota. */
function size(value: LocalEditDraft): number {
  object(value, ['scope', 'savedKey', 'snapshotId', 'localRevision', 'selectedResource', 'recordIdentity',
    'manifest', 'original', 'localPartitionId', 'nativeAuthority', 'currentBase', 'proposal']);
  text(value.localPartitionId); selection(value);
  need(value.nativeAuthority === 'not-established' && value.currentBase === 'not-checked');
  supplied(value.manifest, LOCAL_EDIT_RETENTION_LIMITS.manifestBytes);
  object(value.original, ['bytes', 'sha256', 'revision']);
  if (value.original.bytes !== null) {
    bytes(value.original.bytes, LOCAL_EDIT_RETENTION_LIMITS.recordBytes);
    need(typeof value.original.sha256 === 'string' && SHA.test(value.original.sha256));
  }
  need(value.original.sha256 === null || typeof value.original.sha256 === 'string' && SHA.test(value.original.sha256));
  if (value.original.revision !== null) text(value.original.revision);
  if (value.proposal !== null) supplied(value.proposal, LOCAL_EDIT_RETENTION_LIMITS.recordBytes);
  const metadata = { ...value,
    manifest: { sha256: value.manifest.sha256, byteLength: value.manifest.bytes.byteLength },
    original: { sha256: value.original.sha256, revision: value.original.revision,
      byteLength: value.original.bytes?.byteLength ?? null },
    proposal: value.proposal === null ? null : { sha256: value.proposal.sha256, byteLength: value.proposal.bytes.byteLength },
  };
  // Include the persisted tuple key as well as the documentary fields.
  const metadataBytes = encoder.encode(JSON.stringify({ id: key(value.localPartitionId, value), draft: metadata })).byteLength;
  need(metadataBytes <= LOCAL_EDIT_RETENTION_LIMITS.metadataBytes);
  return metadataBytes + value.manifest.bytes.byteLength
    + (value.original.bytes?.byteLength ?? 0) + (value.proposal?.bytes.byteLength ?? 0);
}
function bounded(rows: readonly Row[]): void {
  need(rows.length <= LOCAL_EDIT_RETENTION_LIMITS.drafts);
  let total = 0;
  for (const row of rows) {
    object(row, ['id', 'draft']); total += size(row.draft);
    need(row.id === key(row.draft.localPartitionId, row.draft));
  }
  need(total <= LOCAL_EDIT_RETENTION_LIMITS.totalBytes);
}
async function verify(value: LocalEditDraft): Promise<void> {
  need(await digest(value.manifest.bytes) === value.manifest.sha256);
  if (value.original.bytes !== null) need(await digest(value.original.bytes) === value.original.sha256);
  if (value.proposal !== null) need(await digest(value.proposal.bytes) === value.proposal.sha256);
}

/** A separate fixed database; no transport, SavedHouse lookup, migration,
 * eviction, expiry or automatic cleanup. Each handle's explicit partition is
 * data isolation only and cannot establish live identity or authorization. */
export function createLocalEditRetentionStore(
  localPartitionId: string, factory: IDBFactory = globalThis.indexedDB,
): LocalEditRetentionStore {
  text(localPartitionId);
  let opening: Promise<IDBDatabase> | null = null, closed = false;
  function database(): Promise<IDBDatabase> {
    need(!closed && factory);
    if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(LOCAL_EDIT_RETENTION_DATABASE, 1);
      let settled = false;
      const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
      request.onerror = () => fail(request.error ?? new Error('Local edit storage is unavailable'));
      request.onblocked = () => fail(new Error('Local edit storage is blocked'));
      request.onupgradeneeded = event => {
        // Only initialize a new database. No migration or repair of existing data.
        if (settled || closed || event.oldVersion !== 0) { request.transaction?.abort(); return; }
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled || closed) { db.close(); fail(new Error('Local edit storage is closed')); return; }
        db.onversionchange = () => { db.close(); closed = true; };
        settled = true; resolve(db);
      };
    });
    return opening;
  }
  function transaction<T>(db: IDBDatabase, mode: IDBTransactionMode,
    edit: (rows: Row[], store: IDBObjectStore) => T): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE], mode);
      let result: T, failure: unknown;
      tx.oncomplete = () => resolve(structuredClone(result));
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('Local edit retention did not complete'));
      // Request errors abort the transaction by default; only its outcome settles.
      const store = tx.objectStore(STORE), request = store.getAll();
      request.onsuccess = () => {
        try {
          const rows = request.result as Row[]; bounded(rows);
          result = edit(rows, store);
        } catch (error) { failure = error; tx.abort(); }
      };
    });
  }
  const select = (value: LocalEditSelection) => {
    const copy = structuredClone(value); selection(copy);
    return { value: copy, id: key(localPartitionId, copy) };
  };
  async function changeProposal(value: LocalEditSelection, proposal: LocalEditBytes | null): Promise<LocalEditDraft> {
    const selected = select(value);
    return transaction(await database(), 'readwrite', (rows, store) => {
      const row = rows.find(item => item.id === selected.id); need(row);
      const draft: LocalEditDraft = { ...row.draft, proposal };
      bounded(rows.map(item => item.id === selected.id ? { id: selected.id, draft } : item));
      store.put({ id: selected.id, draft }); return draft;
    });
  }
  return {
    async retain(input: LocalEditInput): Promise<LocalEditDraft> {
      // Snapshot before the first await; caller mutations cannot change evidence.
      const copy = structuredClone(input);
      object(copy, ['scope', 'savedKey', 'snapshotId', 'localRevision', 'selectedResource', 'recordIdentity', 'manifest', 'original']);
      const draft: LocalEditDraft = { ...copy, localPartitionId,
        nativeAuthority: 'not-established', currentBase: 'not-checked', proposal: null };
      size(draft); await verify(draft);
      const id = key(localPartitionId, draft);
      return transaction(await database(), 'readwrite', (rows, store) => {
        need(!rows.some(row => row.id === id)); // Retain is create-only, never a base replacement.
        bounded([...rows, { id, draft }]); store.put({ id, draft }); return draft;
      });
    },
    async get(value: LocalEditSelection): Promise<LocalEditDraft | null> {
      const selected = select(value);
      const draft = await transaction(await database(), 'readonly', rows => rows.find(row => row.id === selected.id)?.draft ?? null);
      if (draft) await verify(draft); return draft;
    },
    async list(value: LocalEditContext): Promise<readonly LocalEditDraft[]> {
      const selected = structuredClone(value); context(selected);
      const drafts = await transaction(await database(), 'readonly', rows => rows.map(row => row.draft)
        .filter(draft => draft.localPartitionId === localPartitionId && sameContext(draft, selected)));
      for (const draft of drafts) await verify(draft);
      return drafts;
    },
    async setProposal(value: LocalEditSelection, data: ArrayBuffer): Promise<LocalEditDraft> {
      // Capture both selection and bytes before hashing outside the IDB transaction.
      const selected = select(value).value;
      bytes(data, LOCAL_EDIT_RETENTION_LIMITS.recordBytes);
      const copy = data.slice(0), sha256 = await digest(copy);
      return changeProposal(selected, { bytes: copy, sha256 });
    },
    resetProposal: value => changeProposal(value, null),
    async discard(value: LocalEditSelection): Promise<boolean> {
      const selected = select(value);
      return transaction(await database(), 'readwrite', (rows, store) => {
        const exists = rows.some(row => row.id === selected.id);
        if (exists) store.delete(selected.id);
        return exists;
      });
    },
    async close(): Promise<void> {
      closed = true;
      if (opening) (await opening).close();
    },
  };
}
