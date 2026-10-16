import type { RendererFiles, RendererSelectionContext, ReviewSessionOwner, SelectionOwner } from './types';

export interface RendererOwnerHandle {
  readonly owner: SelectionOwner;
  readonly context: RendererSelectionContext;
  isLive(): boolean;
  /** Permanent and synchronous; notifies every subscriber once. */
  retire(): void;
}

/** One renderer's selection owner over the exact File objects it consumed.
 * `capture()` always returns the same frozen context; nothing reconstructs it
 * from names, sizes or hashes. */
export function createRendererOwner(files: RendererFiles, session?: ReviewSessionOwner): RendererOwnerHandle {
  const context: RendererSelectionContext = Object.freeze({ modelFile: files.modelFile, manifestFile: files.manifestFile, referenceFile: files.referenceFile });
  const token = session ? session.current() : null;
  const listeners = new Set<() => void>();
  let retired = session !== undefined && token === null, stopSession: (() => void) | null = null;
  const isLive = () => {
    if (retired) return false;
    if (session && session.current() !== token) { retire(); return false; }
    return true;
  };
  function retire() {
    if (retired && listeners.size === 0 && stopSession === null) return;
    retired = true;
    const notify = [...listeners]; listeners.clear();
    const stop = stopSession; stopSession = null;
    for (const changed of notify) { try { changed(); } catch { /* independent subscribers */ } }
    try { stop?.(); } catch { /* retired regardless */ }
  }
  if (session && !retired) {
    stopSession = session.subscribe(() => { isLive(); });
    if (retired) { const stop = stopSession; stopSession = null; stop(); }
  }
  const owner: SelectionOwner = {
    capture: () => context,
    isCurrent: candidate => candidate === context && isLive(),
    subscribe(candidate, changed) {
      if (candidate !== context || !isLive()) { changed(); return () => undefined; }
      listeners.add(changed);
      return () => { listeners.delete(changed); };
    },
  };
  return Object.freeze({ owner, context, isLive, retire });
}
