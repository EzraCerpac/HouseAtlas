import { Component, useId, useMemo, useState, type ReactNode } from "react";
import { StockWebMcpBoundary, type StockWebMcpBoundaryProps } from "../StockWebMcpBoundary.js";
import type { StockCompletion, StockSessionPort } from "../stock.js";
import type { RenderIdentity } from "../useCommittedResult.js";
import { SavedReceipt } from "./SavedReceipt.js";
import { bindCommandFamilies, type CommandFamilyBinding } from "./families.js";
import { IssuedDownloadLink } from "../gateway/GatewayWebMcpBoundary.js";

/** Render the full canonical envelope as text. Never infer a successful receipt,
 * freshness, provider availability or completion from the requested action. */
export function CanonicalCommandResult({ completion, sessions, renderIdentity }: {
  readonly completion: StockCompletion | null;
  readonly sessions?: StockSessionPort;
  readonly renderIdentity?: RenderIdentity;
}) {
  const bodyId = useId();
  const [hiddenCompletion, setHiddenCompletion] = useState<StockCompletion | null>(null);
  if (!completion) return null;
  const hidden = hiddenCompletion === completion;
  return <section className="stock-completion" aria-label="Command result" data-tool-family={completion.toolName}>
    <div className="stock-completion-header">
      <h2>{completion.request.commandId}</h2>
      <button type="button" aria-controls={bodyId} aria-expanded={!hidden}
        onClick={() => setHiddenCompletion(hidden ? null : completion)}>
        {hidden ? "Show result" : "Hide result"}
      </button>
    </div>
    <div id={bodyId} hidden={hidden}>
      <pre role="status" aria-live="polite">{JSON.stringify(completion.result, null, 2)}</pre>
      <IssuedDownloadLink download={completion.download ?? null} deadline={completion.downloadDeadline ?? null} />
      {sessions && <SavedReceipt completion={completion} sessions={sessions} {...(renderIdentity !== undefined ? { renderIdentity } : {})} />}
    </div>
  </section>;
}

class CommandRenderBoundary extends Component<{ readonly children: ReactNode; readonly fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export type CommandCoverageBoundaryProps = Omit<StockWebMcpBoundaryProps, "service" | "children"> & {
  readonly bindings: readonly CommandFamilyBinding[];
  readonly children?: ReactNode;
};

/** One document owner only: use in place of the owner's stock boundary. The
 * canonical renderer stays inside its acknowledged subtree. Imports do not
 * register anything; absent browser support uses the existing fallback. */
export function CommandCoverageBoundary(props: CommandCoverageBoundaryProps) {
  const { sessions, schemas, bindings, children } = props;
  const ports = useMemo(() => bindCommandFamilies(sessions, bindings), [sessions, bindings]);
  return <CommandRenderBoundary fallback={<><p role="alert">Command result could not be displayed.</p>{children}</>}>
    <StockWebMcpBoundary sessions={ports.sessions} schemas={schemas} service={ports.service}
      {...(props.downloads ? { downloads: props.downloads } : {})}
      {...(Object.hasOwn(props, "renderIdentity") ? { renderIdentity: props.renderIdentity } : {})}
      {...(Object.hasOwn(props, "modelContext") ? { modelContext: props.modelContext } : {})}>
      {({ completion }) => <>{children}<CanonicalCommandResult completion={completion} sessions={ports.sessions}
        {...(props.renderIdentity !== undefined ? { renderIdentity: props.renderIdentity } : {})} /></>}
    </StockWebMcpBoundary>
  </CommandRenderBoundary>;
}
