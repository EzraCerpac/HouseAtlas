import { AtlasReadError, type LiveAtlasPresentationPort, type LiveAtlasSelection, type StoredAtlasRead } from '../src/lantern/unified-atlas/types';
import type { LastAtlasCopy } from '../src/offline/SavedAtlasHost';
import { openUnifiedAtlasStore, readLastAtlas } from './unified-atlas-cache';
import { readCachedUnifiedAtlas } from './unified-atlas-reader';

/** The Atlas the live app last read fresh on this device, opened from the
 * live Atlas cache alone for the Saved entry while the server is out of
 * reach. The scene is admitted and the model hashed exactly as the live app's
 * stored copy is; nothing is fetched. Its selection carries no live authority
 * (it expired at the epoch), so the fresh read always reports the server
 * unavailable and the Atlas shows the copy marked as not updated. Sign-out
 * empties the cache, and with it this copy. */
export async function openLastAtlasCopy(factory: IDBFactory | undefined, signal: AbortSignal): Promise<LastAtlasCopy | null> {
  const store = openUnifiedAtlasStore(factory);
  try {
    await store.ready(); signal.throwIfAborted();
    const last = await readLastAtlas(store); signal.throwIfAborted();
    if (!last) { await store.close(); return null; }
    const { pointer, cache } = last;
    const selection: LiveAtlasSelection = Object.freeze({ kind: 'live', overview: Object.freeze({ owner: Object.freeze({}),
      scope: Object.freeze({ workspaceId: pointer.workspaceId, homeId: pointer.homeId }), expiresAt: new Date(0).toISOString(),
      publicationId: pointer.publicationId, manifestSha256: pointer.manifestSha256 }) });
    const read: StoredAtlasRead | null = await readCachedUnifiedAtlas({ selection: selection.overview, signal, cache });
    signal.throwIfAborted();
    if (!read) { await store.close(); return null; }
    const port: LiveAtlasPresentationPort = Object.freeze({
      kind: 'live' as const,
      current: () => selection,
      subscribe: () => () => undefined,
      async stored(selected: LiveAtlasSelection) { return selected === selection ? read : null; },
      async read(): Promise<never> { throw new AtlasReadError('unavailable', 'The server is out of reach'); },
    });
    return { port, storedAt: read.storedAt, close: () => store.close() };
  } catch (error) {
    await store.close().catch(() => undefined);
    if (signal.aborted) throw error;
    return null;
  }
}
