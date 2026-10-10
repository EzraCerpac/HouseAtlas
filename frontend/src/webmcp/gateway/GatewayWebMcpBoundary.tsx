import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { detectModelContext } from "../browser.js";
import type { RegistrationStatus } from "../ports.js";
import { useCommittedResult, useSessionViewToken, type RenderIdentity } from "../useCommittedResult.js";
import { mountGatewayWebMcp } from "./mount.js";
import type { GatewayCompletion, GatewayDownload, GatewayMountOptions } from "./ports.js";

export type GatewayWebMcpBoundaryProps = Omit<GatewayMountOptions, "visible" | "modelContext"> & {
  readonly modelContext?: GatewayMountOptions["modelContext"];
  readonly renderIdentity?: RenderIdentity;
  readonly children?: ReactNode;
};

/** A link is an available download action, never a transfer receipt. */
export function IssuedDownloadLink({ download, deadline }: {
  readonly download: GatewayDownload | null; readonly deadline: number | null;
}) {
  const identity = useMemo(() => ({}), [download, deadline]);
  const [ended, setEnded] = useState<object | null>(null);
  useLayoutEffect(() => {
    if (!download || deadline === null || !Number.isFinite(deadline)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observe = () => {
      const remaining = deadline - performance.now();
      if (remaining <= 0) setEnded(identity);
      else timer = setTimeout(observe, Math.min(remaining, 2_147_483_647));
    };
    observe();
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [download, deadline, identity]);
  const available = download !== null && deadline !== null
    && Number.isFinite(deadline) && performance.now() < deadline && ended !== identity;
  return available && download ? <a href={download.href} download={download.filename ?? ""}
    type={download.mediaType}>{download.label}</a> : null;
}

export function GatewayResult({ completion }: { readonly completion: GatewayCompletion | null }) {
  if (!completion) return null;
  return <section aria-label="Gateway result" data-gateway-tool={completion.toolName}>
    <h2>{completion.toolName}</h2>
    <pre role="status" aria-live="polite">{JSON.stringify(completion.result, null, 2)}</pre>
    <IssuedDownloadLink download={completion.download} deadline={completion.downloadDeadline} />
  </section>;
}

/** Keep bindings/ports stable. This boundary acknowledges its own canonical
 * result/link after React commits; it does not wait for the user to download. */
export function GatewayWebMcpBoundary(props: GatewayWebMcpBoundaryProps) {
  const { sessions, bindings, downloads, children } = props;
  const explicitContext = Object.hasOwn(props, "modelContext");
  const suppliedContext = props.modelContext;
  const sessionToken = useSessionViewToken(sessions);
  const view = useMemo(() => ({}), [sessions, sessionToken, props.renderIdentity, bindings, downloads, explicitContext, suppliedContext]);
  const { value: completion, activate } = useCommittedResult<GatewayCompletion>(view);
  const [observed, setObserved] = useState<{ readonly view: object; readonly status: RegistrationStatus }>(
    () => ({ view, status: { state: "inactive" } }));
  const registration: RegistrationStatus = observed.view === view ? observed.status : { state: "inactive" };
  // Retire the prior registration in layout cleanup, before new child layouts
  // can observe/use that availability. Domain work keeps its own cancellation.
  useLayoutEffect(() => {
    const port = activate();
    const modelContext = explicitContext ? suppliedContext
      : detectModelContext(typeof document === "undefined" ? undefined : document);
    const handle = mountGatewayWebMcp({ modelContext, sessions, bindings, visible: port,
      ...(downloads ? { downloads } : {}) });
    const onStatus = () => {
      const status = handle.getStatus();
      setObserved({ view, status });
      // Registration cleanup does not cancel domain execution. Preserve its
      // queued/completed result when only later tool registration failed.
      if (status.state !== "registered" && !(status.state === "failed" && status.phase === "registration"))
        port.clear();
    };
    const unsubscribe = handle.subscribeStatus(onStatus);
    onStatus();
    return () => {
      unsubscribe();
      handle.dispose();
      port.deactivate();
    };
  }, [explicitContext, suppliedContext, sessions, bindings, downloads, activate, view]);
  return <>{children}<output aria-label="Gateway tools">{registration.state}</output>
    <GatewayResult completion={completion} /></>;
}
