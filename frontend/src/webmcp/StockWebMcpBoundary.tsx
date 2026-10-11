import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { detectModelContext } from "./browser.js";
import { mountStockWebMcp, type StockCompletion, type StockMountOptions } from "./stock.js";
import type { RegistrationStatus } from "./ports.js";
import { useCommittedResult, useSessionViewToken, type RenderIdentity } from "./useCommittedResult.js";

export interface StockBoundaryState {
  readonly registration: RegistrationStatus;
  readonly completion: StockCompletion | null;
}
export type StockWebMcpBoundaryProps = Omit<StockMountOptions, "visible" | "modelContext"> & {
  readonly modelContext?: StockMountOptions["modelContext"];
  readonly renderIdentity?: RenderIdentity;
  /** UI owner renders the complete canonical result in this committed subtree. */
  readonly children: (state: StockBoundaryState) => ReactNode;
};
/** Exact mount for an existing React host, with a real layout-commit acknowledgement.
 * The parent owns application session/scope and the domain result presentation.
 */
export function StockWebMcpBoundary(props: StockWebMcpBoundaryProps): ReactNode {
  const { sessions, schemas, service, downloads, children } = props;
  const explicitContext = Object.hasOwn(props, "modelContext");
  const suppliedContext = props.modelContext;
  const sessionToken = useSessionViewToken(sessions);
  const view = useMemo(() => ({}), [sessions, sessionToken, props.renderIdentity, schemas, service, downloads, explicitContext, suppliedContext]);
  const { value: completion, activate } = useCommittedResult<StockCompletion>(view);
  const [observed, setObserved] = useState<{ readonly view: object; readonly status: RegistrationStatus }>(
    () => ({ view, status: { state: "inactive" } }));
  const registration: RegistrationStatus = observed.view === view ? observed.status : { state: "inactive" };
  // Layout cleanup retires the prior browser registrations before replacement
  // child layouts/paint; unregistering still does not reverse domain execution.
  useLayoutEffect(() => {
    const visible = activate();
    const modelContext = explicitContext ? suppliedContext
      : detectModelContext(typeof document === "undefined" ? undefined : document);
    const handle = mountStockWebMcp({ modelContext, sessions, schemas, service, visible,
      ...(downloads ? { downloads } : {}) });
    const onStatus = (): void => {
      const status = handle.getStatus();
      setObserved({ view, status });
      // A partial registration failure removes tool availability, while calls
      // already underway still need their canonical result to reach the view.
      if (status.state !== "registered" && !(status.state === "failed" && status.phase === "registration"))
        visible.clear();
    };
    const unsubscribe = handle.subscribeStatus(onStatus);
    onStatus();
    return () => {
      unsubscribe();
      handle.dispose();
      visible.deactivate();
    };
  }, [explicitContext, suppliedContext, sessions, schemas, service, downloads, activate, view]);
  return children({ registration, completion });
}
