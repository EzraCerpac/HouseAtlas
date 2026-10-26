/** Rows left by the removed Local drafts tab of the Saved viewer. They were
 * never sent anywhere; they stay on the device untouched and can be
 * downloaded as JSON. Nothing here writes to or deletes that database. */
const DATABASE = 'houseatlas-local-edit-retention-v1';

interface LegacyRow {
  readonly draft: {
    readonly recordIdentity: { readonly recordType: string; readonly recordId: string };
    readonly original: { readonly bytes: ArrayBuffer | null; readonly revision: string | null };
    readonly proposal: { readonly bytes: ArrayBuffer } | null;
    readonly scope: { readonly workspaceId: string; readonly homeId: string };
  };
}

async function readRows(factory: IDBFactory): Promise<readonly LegacyRow[]> {
  // databases() avoids creating the old database where it never existed.
  if (!(await factory.databases()).some(row => row.name === DATABASE)) return [];
  return new Promise((resolve, reject) => {
    const open = factory.open(DATABASE, 1);
    open.onupgradeneeded = () => open.transaction?.abort();
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('drafts')) { db.close(); resolve([]); return; }
      const read = db.transaction('drafts').objectStore('drafts').getAll();
      read.onerror = () => { db.close(); reject(read.error); };
      read.onsuccess = () => { db.close(); resolve(read.result as LegacyRow[]); };
    };
  });
}

export async function countLegacyDrafts(factory: IDBFactory = indexedDB): Promise<number> {
  try { return (await readRows(factory)).length; } catch { return 0; }
}

export async function exportLegacyDrafts(factory: IDBFactory = indexedDB): Promise<Blob> {
  const text = (bytes: ArrayBuffer | null | undefined) => bytes ? new TextDecoder().decode(bytes) : null;
  const rows = (await readRows(factory)).map(({ draft }) => ({
    scope: draft.scope, recordType: draft.recordIdentity.recordType, recordId: draft.recordIdentity.recordId,
    revision: draft.original.revision, original: text(draft.original.bytes), proposal: text(draft.proposal?.bytes),
  }));
  return new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
}
