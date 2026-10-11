import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SessionPort } from "./ports.js";

/** An opaque, non-secret host identity known before rendering a changed view.
 * Required when the host publishes its committed SessionPort context later in
 * a layout effect. It grants no authority and must never contain credentials. */
export type RenderIdentity = object | string | number | null;

/** Session peers may return a fresh object on every read. Subscribe to a stable
 * primitive containing only the existing non-secret state/revision contract.
 * Adapter session failures retain their own status handling. */
export function useSessionViewToken(sessions: SessionPort): string {
  const subscribe = useCallback((listener: () => void) => {
    try { return sessions.subscribe(listener); }
    catch { return () => {}; } // startWebMcp reports the session failure status.
  }, [sessions]);
  const read = useCallback(() => {
    try {
      const snapshot = sessions.getSnapshot();
      return JSON.stringify([snapshot.state, snapshot.revision]);
    } catch {
      return "unavailable";
    }
  }, [sessions]);
  return useSyncExternalStore(subscribe, read, read);
}

interface CommitTicket<T> {
  readonly activation: symbol;
  readonly view: object;
  readonly value: T;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
  readonly signal: AbortSignal;
  readonly abort: () => void;
}

/** Shared React layout acknowledgement for stock and gateway transports.
 * Each effect activation receives a separate lease. Removing registration does
 * not cancel domain execution, but an earlier mount cannot commit in a later view. */
export function useCommittedResult<T>(view: object) {
  const [entry, setEntry] = useState<CommitTicket<T> | null>(null);
  const tickets = useRef(new Set<CommitTicket<T>>());
  const activation = useRef<symbol | null>(null);
  const currentView = useRef(view);
  const activate = useMemo(() => {
    const clearPending = (reason: DOMException) => {
      for (const ticket of tickets.current) {
        ticket.signal.removeEventListener("abort", ticket.abort);
        ticket.reject(reason);
      }
      tickets.current.clear();
      setEntry(null);
    };
    const invalidate = () => {
      activation.current = null;
      clearPending(new DOMException("Result view is unmounted", "InvalidStateError"));
    };
    return () => {
      invalidate();
      const lease = Symbol("result activation");
      activation.current = lease;
      return {
        clear() {
          if (activation.current === lease && currentView.current === view)
            clearPending(new DOMException("Result view was cleared before acknowledgement", "InvalidStateError"));
        },
        deactivate() { if (activation.current === lease) invalidate(); },
        commit(next: T, signal: AbortSignal): Promise<void> {
          signal.throwIfAborted();
          if (activation.current !== lease || currentView.current !== view)
            return Promise.reject(new DOMException("Result view activation is no longer current", "InvalidStateError"));
          return new Promise<void>((resolve, reject) => {
            const ticket: CommitTicket<T> = { activation: lease, view, value: next, resolve, reject, signal,
              abort: () => {
                tickets.current.delete(ticket);
                if (activation.current === lease && currentView.current === view)
                  setEntry(current => current === ticket
                    ? tickets.current.values().next().value ?? null : current);
                reject(signal.reason);
              } };
            tickets.current.add(ticket);
            signal.addEventListener("abort", ticket.abort, { once: true });
            if (tickets.current.size === 1) setEntry(ticket);
          });
        },
      };
    };
  }, [view]);
  useLayoutEffect(() => {
    currentView.current = view;
    for (const ticket of tickets.current) {
      // Rendering already masks a prior view's state. Its tickets must never
      // acknowledge that masked value as if it committed in the new subtree.
      if (ticket.view === view && ticket !== entry) continue;
      tickets.current.delete(ticket);
      ticket.signal.removeEventListener("abort", ticket.abort);
      if (ticket.view !== view || ticket.activation !== activation.current)
        ticket.reject(new DOMException("Result view activation is no longer current", "InvalidStateError"));
      else if (ticket.signal.aborted) ticket.reject(ticket.signal.reason);
      else ticket.resolve();
      const next = tickets.current.values().next().value;
      if (next) setEntry(next);
    }
  }, [entry, view]);
  // Scope/port replacement suppresses old data during render, before children
  // run layout effects and before the replacement passive activation starts.
  return { value: entry?.view === view ? entry.value : null, activate };
}
