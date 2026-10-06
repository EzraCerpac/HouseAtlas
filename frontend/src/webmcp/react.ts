import { useEffect, useState } from "react";
import { startWebMcp } from "./adapter.js";
import { detectModelContext } from "./browser.js";
import type { RegistrationStatus, WebMcpOptions } from "./ports.js";

export type ReactWebMcpOptions = Omit<WebMcpOptions, "modelContext"> & {
  /** Omit for client Document detection; pass undefined to explicitly disable. */
  readonly modelContext?: WebMcpOptions["modelContext"];
};

/** Host opts in by calling this hook. Keep injected ports referentially stable.
 * The effect cleans up registration on unmount/React development effect replay.
 */
export function useHouseAtlasWebMcp(options: ReactWebMcpOptions): RegistrationStatus {
  const { sessions, catalog, service, visible } = options;
  const [status, setStatus] = useState<RegistrationStatus>({ state: "inactive" });
  const explicitContext = Object.hasOwn(options, "modelContext");
  const suppliedContext = options.modelContext;
  useEffect(() => {
    const modelContext = explicitContext ? suppliedContext
      : detectModelContext(typeof document === "undefined" ? undefined : document);
    const handle = startWebMcp({ modelContext, sessions, catalog, service, visible });
    const unsubscribe = handle.subscribeStatus(() => setStatus(handle.getStatus()));
    setStatus(handle.getStatus());
    return () => { unsubscribe(); handle.dispose(); };
  }, [explicitContext, suppliedContext, sessions, catalog, service, visible]);
  return status;
}
