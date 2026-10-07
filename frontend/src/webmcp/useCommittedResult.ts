import { useLayoutEffect, useMemo, useRef, useState } from "react";

interface CommitTicket<T> {
  readonly activation: symbol;
  readonly value: T;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
  readonly signal: AbortSignal;
  readonly abort: () => void;
}

/** Shared React layout acknowledgement for stock and gateway transports.
 * Each effect activation receives a separate lease. Removing registration does
 * not cancel domain execution, but an earlier mount cannot commit in a later view. */
export function useCommittedResult<T>() {
  const [value, setValue] = useState<T | null>(null);
  const tickets = useRef(new Set<CommitTicket<T>>());
  const activation = useRef<symbol | null>(null);
  const activate = useMemo(() => {
    const invalidate = () => {
      activation.current = null;
      for (const ticket of tickets.current) {
        ticket.signal.removeEventListener("abort", ticket.abort);
        ticket.reject(new DOMException("Result view is unmounted", "InvalidStateError"));
      }
      tickets.current.clear();
      setValue(null);
    };
    return () => {
      invalidate();
      const lease = Symbol("result activation");
      activation.current = lease;
      return {
        clear() { if (activation.current === lease) setValue(null); },
        deactivate() { if (activation.current === lease) invalidate(); },
        commit(next: T, signal: AbortSignal): Promise<void> {
          signal.throwIfAborted();
          if (activation.current !== lease)
            return Promise.reject(new DOMException("Result view activation is no longer current", "InvalidStateError"));
          return new Promise<void>((resolve, reject) => {
            const ticket: CommitTicket<T> = { activation: lease, value: next, resolve, reject, signal,
              abort: () => {
                tickets.current.delete(ticket);
                if (activation.current === lease) setValue(current => current === ticket.value
                  ? tickets.current.values().next().value?.value ?? null : current);
                reject(signal.reason);
              } };
            tickets.current.add(ticket);
            signal.addEventListener("abort", ticket.abort, { once: true });
            if (tickets.current.size === 1) setValue(next);
          });
        },
      };
    };
  }, []);
  useLayoutEffect(() => {
    for (const ticket of tickets.current) {
      if (ticket.value !== value) continue;
      tickets.current.delete(ticket);
      ticket.signal.removeEventListener("abort", ticket.abort);
      if (ticket.activation !== activation.current)
        ticket.reject(new DOMException("Result view activation is no longer current", "InvalidStateError"));
      else if (ticket.signal.aborted) ticket.reject(ticket.signal.reason);
      else ticket.resolve();
      const next = tickets.current.values().next().value;
      if (next) setValue(next.value);
    }
  }, [value]);
  return { value, activate };
}
