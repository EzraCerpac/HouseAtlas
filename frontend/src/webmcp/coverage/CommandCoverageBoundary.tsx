import { Component, useMemo, type ReactNode } from "react";
import { StockWebMcpBoundary, type StockWebMcpBoundaryProps } from "../StockWebMcpBoundary.js";
import type { StockCompletion } from "../stock.js";
import { bindCommandFamilies, type CommandFamilyBinding } from "./families.js";

/** Render the full canonical envelope as text. Never infer a successful receipt,
 * freshness, provider availability or completion from the requested action. */
export function CanonicalCommandResult({ completion }: { readonly completion: StockCompletion | null }) {
  if (!completion) return null;
  return <section className="stock-completion" aria-label="Command result" data-tool-family={completion.toolName}>
    <h2>{completion.request.commandId}</h2>
    <pre role="status" aria-live="polite">{JSON.stringify(completion.result, null, 2)}</pre>
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
      {...(Object.hasOwn(props, "modelContext") ? { modelContext: props.modelContext } : {})}>
      {({ completion }) => <>{children}<CanonicalCommandResult completion={completion} /></>}
    </StockWebMcpBoundary>
  </CommandRenderBoundary>;
}
