import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { detectModelContext } from "./browser.js";
import { mountStockWebMcp, type StockCompletion, type StockMountOptions, type StockVisiblePort } from "./stock.js";
import type { RegistrationStatus } from "./ports.js";

export interface StockBoundaryState {
  readonly registration: RegistrationStatus;
  readonly completion: StockCompletion | null;
}
export type StockWebMcpBoundaryProps = Omit<StockMountOptions, "visible" | "modelContext"> & {
  readonly modelContext?: StockMountOptions["modelContext"];
  /** UI owner renders the complete canonical result in this committed subtree. */
  readonly children: (state: StockBoundaryState) => ReactNode;
};
interface CommitTicket {
  readonly completion: StockCompletion;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
  readonly signal: AbortSignal;
  readonly abort: () => void;
}

/** Exact mount for an existing React host, with a real layout-commit acknowledgement.
 * The parent owns application session/scope and the domain result presentation.
 */
export function StockWebMcpBoundary(props: StockWebMcpBoundaryProps): ReactNode {
  const { sessions, schemas, service, children } = props;
  const [registration, setRegistration] = useState<RegistrationStatus>({ state: "inactive" });
  const [completion, setCompletion] = useState<StockCompletion | null>(null);
  const tickets = useRef(new Set<CommitTicket>());
  const mounted = useRef(false);
  const explicitContext = Object.hasOwn(props, "modelContext");
  const suppliedContext = props.modelContext;
  const visible = useMemo<StockVisiblePort>(() => ({
    commit(next, signal) {
      signal.throwIfAborted();
      if (!mounted.current) return Promise.reject(new DOMException("Result view is unmounted", "InvalidStateError"));
      return new Promise<void>((resolve, reject) => {
        const ticket: CommitTicket = { completion: next, resolve, reject, signal,
          abort: () => {
            tickets.current.delete(ticket);
            setCompletion(current => current === ticket.completion
              ? tickets.current.values().next().value?.completion ?? null : current);
            reject(signal.reason);
          } };
        tickets.current.add(ticket);
        signal.addEventListener("abort", ticket.abort, { once: true });
        if (tickets.current.size === 1) setCompletion(next);
      });
    },
  }), []);
  useLayoutEffect(() => {
    for (const ticket of tickets.current) {
      if (ticket.completion !== completion) continue;
      tickets.current.delete(ticket);
      ticket.signal.removeEventListener("abort", ticket.abort);
      if (ticket.signal.aborted) ticket.reject(ticket.signal.reason);
      else ticket.resolve();
      const next = tickets.current.values().next().value;
      if (next) setCompletion(next.completion);
    }
  }, [completion]);
  useEffect(() => {
    mounted.current = true;
    const modelContext = explicitContext ? suppliedContext
      : detectModelContext(typeof document === "undefined" ? undefined : document);
    const handle = mountStockWebMcp({ modelContext, sessions, schemas, service, visible });
    const onStatus = (): void => {
      const status = handle.getStatus();
      setRegistration(status);
      if (status.state !== "registered") setCompletion(null);
    };
    const unsubscribe = handle.subscribeStatus(onStatus);
    onStatus();
    return () => {
      mounted.current = false;
      unsubscribe();
      handle.dispose();
      for (const ticket of tickets.current) {
        ticket.signal.removeEventListener("abort", ticket.abort);
        ticket.reject(new DOMException("Result view is unmounted", "InvalidStateError"));
      }
      tickets.current.clear();
    };
  }, [explicitContext, suppliedContext, sessions, schemas, service, visible]);
  return children({ registration, completion });
}
