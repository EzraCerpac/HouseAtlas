import type { UnifiedAtlasOverlayAvailableFrame, UnifiedAtlasOverlaySource } from './unified-atlas-overlay-source';
import type { UnifiedAtlasRoomLinksRead } from './unified-atlas-room-links-reader';

export const ROOM_LINKS_FRESHNESS = Object.freeze({ intervalMs: 10_000, readMs: 8_000, maxAgeMs: 20_000 });

/** One host handle combines the native documentary owner with bounded map
 * read-point freshness. An unchanged digest refreshes time, never the original
 * review allocation. Replacement/withdrawal retires the handle; no auto-reopen. */
export function createReviewedRoomLinksOverlayOwner(options: {
  readonly initialReview: UnifiedAtlasRoomLinksRead;
  readonly createSource: (reviewIsCurrent: () => boolean) => UnifiedAtlasOverlaySource;
  readonly readReview: (signal: AbortSignal) => Promise<UnifiedAtlasRoomLinksRead | null>;
  readonly isContextCurrent: () => boolean;
  readonly subscribeContext: (changed: () => void) => () => void;
  readonly signal: AbortSignal;
  /** The initial/readReview timestamps must use the same monotonic clock. */
  readonly now?: () => number;
}): UnifiedAtlasOverlaySource {
  type Attempt = { controller: AbortController; checkedAt: number; frame: UnifiedAtlasOverlayAvailableFrame | null;
    next: ReturnType<typeof setTimeout> | null; expiry: ReturnType<typeof setTimeout> | null;
    offContext: (() => void) | null; offBase: (() => void) | null; offCaller: (() => void) | null;
    listeners: Set<() => void> };
  const now = options.now ?? (() => performance.now());
  let terminal = false, opened = false, active: Attempt | null = null;
  const reviewIsCurrent = () => {
    try {
      const attempt = active, age = attempt ? now() - attempt.checkedAt : Infinity;
      return !terminal && attempt !== null && !attempt.controller.signal.aborted && !options.signal.aborted
        && options.isContextCurrent() && age >= 0 && age <= ROOM_LINKS_FRESHNESS.maxAgeMs;
    } catch { return false; }
  };
  const base = options.createSource(reviewIsCurrent);
  const retire = () => {
    if (terminal) return;
    terminal = true;
    const attempt = active; active = null;
    options.signal.removeEventListener('abort', retire);
    if (attempt) {
      if (attempt.next !== null) clearTimeout(attempt.next);
      if (attempt.expiry !== null) clearTimeout(attempt.expiry);
      attempt.controller.abort(); attempt.offCaller?.(); attempt.offContext?.(); attempt.offBase?.();
    }
    // Native disposal retires its exact original-document owners and polling.
    base.dispose();
    if (attempt) for (const changed of attempt.listeners) { try { changed(); } catch { /* notify all */ } }
    attempt?.listeners.clear();
  };
  options.signal.addEventListener('abort', retire, { once: true });
  if (options.signal.aborted) retire();
  const unavailable = () => Object.freeze({ status: 'unavailable', reason: 'selection-changed' } as const);

  const open: UnifiedAtlasOverlaySource['open'] = async (input, signal) => {
    signal.throwIfAborted();
    if (terminal || opened) return unavailable();
    opened = true;
    const attempt: Attempt = { controller: new AbortController(), checkedAt: options.initialReview.checkedAt, frame: null,
      next: null, expiry: null, offContext: null, offBase: null, offCaller: null, listeners: new Set() };
    active = attempt;
    const callerAbort = () => retire();
    signal.addEventListener('abort', callerAbort, { once: true });
    attempt.offCaller = () => signal.removeEventListener('abort', callerAbort);
    if (signal.aborted) retire();
    const offContext = options.subscribeContext(retire);
    if (terminal) offContext(); else attempt.offContext = offContext;
    if (!reviewIsCurrent()) { retire(); return unavailable(); }
    const expire = () => {
      if (attempt.expiry !== null) clearTimeout(attempt.expiry);
      const remaining = attempt.checkedAt + ROOM_LINKS_FRESHNESS.maxAgeMs - now();
      if (remaining <= 0) { retire(); return; }
      attempt.expiry = setTimeout(retire, remaining);
    };
    const checkReview = async () => {
      attempt.next = null;
      if (!reviewIsCurrent() || active !== attempt) { retire(); return; }
      const read = new AbortController(), forward = () => read.abort();
      attempt.controller.signal.addEventListener('abort', forward, { once: true });
      const deadline = setTimeout(() => { read.abort(); retire(); }, ROOM_LINKS_FRESHNESS.readMs);
      try {
        const observed = await options.readReview(read.signal);
        if (terminal || active !== attempt) return;
        read.signal.throwIfAborted();
        if (!reviewIsCurrent() || !observed || observed.sha256 !== options.initialReview.sha256
          || !Number.isFinite(observed.checkedAt) || observed.checkedAt < attempt.checkedAt
          || observed.checkedAt > now() || now() - observed.checkedAt > ROOM_LINKS_FRESHNESS.maxAgeMs) {
          retire(); return;
        }
        attempt.checkedAt = observed.checkedAt; expire();
        if (reviewIsCurrent()) attempt.next = setTimeout(() => { void checkReview(); }, ROOM_LINKS_FRESHNESS.intervalMs);
        else retire();
      } catch { retire(); }
      finally { clearTimeout(deadline); attempt.controller.signal.removeEventListener('abort', forward); read.abort(); }
    };
    expire();
    if (terminal) return unavailable();
    attempt.next = setTimeout(() => { void checkReview(); }, Math.max(0,
      attempt.checkedAt + ROOM_LINKS_FRESHNESS.intervalMs - now()));
    try {
      // Start map monitoring before the native/document open can outlive its
      // initial proof. Both operations are cancelled by this same attempt.
      const frame = await base.open(input, AbortSignal.any([signal, options.signal, attempt.controller.signal]));
      if (frame.status !== 'available') { retire(); return frame; }
      if (!reviewIsCurrent() || active !== attempt || !base.isCurrent(frame)) {
        base.release(frame); retire(); return unavailable();
      }
      attempt.frame = frame;
      const offBase = base.subscribeInvalidation(frame, retire);
      if (terminal) offBase(); else attempt.offBase = offBase;
      if (!reviewIsCurrent() || active !== attempt || !base.isCurrent(frame)) {
        base.release(frame); retire(); return unavailable();
      }
      return frame;
    } catch (error) {
      retire();
      if (signal.aborted || options.signal.aborted) throw error;
      return unavailable();
    }
  };
  const isCurrent = (frame: UnifiedAtlasOverlayAvailableFrame) => reviewIsCurrent() && active?.frame === frame && base.isCurrent(frame);
  return Object.freeze({ open, isCurrent,
    subscribeInvalidation(frame: UnifiedAtlasOverlayAvailableFrame, changed: () => void) {
      if (!isCurrent(frame)) { changed(); return () => {}; }
      const listeners = active!.listeners; listeners.add(changed); return () => { listeners.delete(changed); };
    },
    release(frame: UnifiedAtlasOverlayAvailableFrame) { if (active?.frame === frame) retire(); },
    dispose: retire,
  });
}
