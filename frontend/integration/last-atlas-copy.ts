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
 * empties the cache, and with it this copy: when the page comes back into
 * view (`events`, usually the window) and the pointer is gone or names
 * another copy, the selection is withdrawn and the held bytes released. */
export async function openLastAtlasCopy(factory: IDBFactory | undefined, signal: AbortSignal,
  events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>): Promise<LastAtlasCopy | null> {
  const store = openUnifiedAtlasStore(factory);
  try {
    await store.ready(); signal.throwIfAborted();
    const last = await readLastAtlas(store); signal.throwIfAborted();
    if (!last) { await store.close(); return null; }
    const { pointer, cache } = last;
    const selection: LiveAtlasSelection = Object.freeze({ kind: 'live', overview: Object.freeze({ owner: Object.freeze({}),
      scope: Object.freeze({ workspaceId: pointer.workspaceId, homeId: pointer.homeId }), expiresAt: new Date(0).toISOString(),
      publicationId: pointer.publicationId, manifestSha256: pointer.manifestSha256 }) });
    let read: StoredAtlasRead | null = await readCachedUnifiedAtlas({ selection: selection.overview, signal, cache });
    signal.throwIfAborted();
    if (!read) { await store.close(); return null; }
    const named = JSON.stringify(pointer);
    // Scene/model admission and hashing awaited storage and crypto. A canonical
    // account change during that work must not publish the previous account's
    // copy even briefly while waiting for a later focus/visibility notice.
    const current = await readLastAtlas(store); signal.throwIfAborted();
    if (!current || JSON.stringify(current.pointer) !== named) { read = null; await store.close(); return null; }
    const storedAt = read.storedAt, listeners = new Set<() => void>();
    let closed = false;
    const withdraw = () => {
      if (read === null) return;
      read = null; events?.removeEventListener('focus', recheck); events?.removeEventListener('visibilitychange', recheck);
      for (const changed of [...listeners]) changed();
    };
    // Sign-out in another tab clears the store; this tab learns of it when it is looked at again.
    function recheck() {
      if (read === null || closed) return;
      void readLastAtlas(store).then(last => { if (!last || JSON.stringify(last.pointer) !== named) withdraw(); }, withdraw);
    }
    events?.addEventListener('focus', recheck); events?.addEventListener('visibilitychange', recheck);
    const port: LiveAtlasPresentationPort = Object.freeze({
      kind: 'live' as const,
      current: () => read === null ? null : selection,
      subscribe(changed: () => void) { listeners.add(changed); return () => { listeners.delete(changed); }; },
      async stored(selected: LiveAtlasSelection) { return selected === selection ? read : null; },
      async read(): Promise<never> { throw new AtlasReadError('unavailable', 'The server is out of reach'); },
    });
    return { port, storedAt, recheck, close: async () => { if (closed) return; closed = true; listeners.clear(); withdraw(); await store.close(); } };
  } catch (error) {
    await store.close().catch(() => undefined);
    if (signal.aborted) throw error;
    return null;
  }
}
