import { useLayoutEffect, useMemo, useRef, useState } from "react";

interface CommitTicket<T> {
  readonly value: T;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
  readonly signal: AbortSignal;
  readonly abort: () => void;
}

/** Shared React layout acknowledgement for stock and gateway transports. The
 * owner renders value inside this subtree and activates only while mounted. */
export function useCommittedResult<T>() {
  const [value, setValue] = useState<T | null>(null);
  const tickets = useRef(new Set<CommitTicket<T>>());
  const mounted = useRef(false);
  const port = useMemo(() => ({
    activate() { mounted.current = true; },
    clear() { setValue(null); },
    deactivate() {
      mounted.current = false;
      for (const ticket of tickets.current) {
        ticket.signal.removeEventListener("abort", ticket.abort);
        ticket.reject(new DOMException("Result view is unmounted", "InvalidStateError"));
      }
      tickets.current.clear();
    },
    commit(next: T, signal: AbortSignal): Promise<void> {
      signal.throwIfAborted();
      if (!mounted.current) return Promise.reject(new DOMException("Result view is unmounted", "InvalidStateError"));
      return new Promise<void>((resolve, reject) => {
        const ticket: CommitTicket<T> = { value: next, resolve, reject, signal,
          abort: () => {
            tickets.current.delete(ticket);
            setValue(current => current === ticket.value
              ? tickets.current.values().next().value?.value ?? null : current);
            reject(signal.reason);
          } };
        tickets.current.add(ticket);
        signal.addEventListener("abort", ticket.abort, { once: true });
        if (tickets.current.size === 1) setValue(next);
      });
    },
  }), []);
  useLayoutEffect(() => {
    for (const ticket of tickets.current) {
      if (ticket.value !== value) continue;
      tickets.current.delete(ticket);
      ticket.signal.removeEventListener("abort", ticket.abort);
      if (ticket.signal.aborted) ticket.reject(ticket.signal.reason);
      else ticket.resolve();
      const next = tickets.current.values().next().value;
      if (next) setValue(next.value);
    }
  }, [value]);
  return { value, port };
}
