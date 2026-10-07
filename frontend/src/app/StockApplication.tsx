import {
  Component,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Scope } from "../api/generated/contracts.js";
import { StockWebMcpBoundary } from "../webmcp/StockWebMcpBoundary.js";
import type {
  StockCompletion,
  StockHostContext,
  StockMountOptions,
  StockSessionPort,
} from "../webmcp/stock.js";
import type { SessionSnapshot } from "../webmcp/ports.js";
import type { AtlasSessionInfo } from "./session";

/** Controlled host metadata, never inferred from a browser catalog or role. */
export interface StockAdmission {
  readonly scope: Scope;
  readonly commandIds: readonly string[];
  readonly revision: string;
}
export type StockApplicationPorts = Pick<
  StockMountOptions,
  "schemas" | "service"
> & {
  readonly admission: StockAdmission | null;
  readonly modelContext?: StockMountOptions["modelContext"];
};
const sameScope = (a: Scope, b: Scope) =>
  a.workspaceId === b.workspaceId && a.homeId === b.homeId;

/** A derived committed-context facade, not an authentication or authority store. */
function createContextFacade() {
  let context: StockHostContext | null = null;
  let sequence = 0;
  let snapshot: SessionSnapshot = {
    state: "signed-out",
    revision: "atlas-ui:0",
  };
  const listeners = new Set<() => void>();
  const sessions: StockSessionPort = {
    getSnapshot: () => ({ ...snapshot }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getContext: (session) => {
      if (
        !context ||
        snapshot.state !== "authenticated" ||
        session.revision !== snapshot.revision
      )
        throw new TypeError("Application context is not current");
      return {
        session: { ...context.session },
        scope: { ...context.scope },
        commandIds: [...context.commandIds],
      };
    },
  };
  return {
    sessions,
    publish(next: StockHostContext | null) {
      if (!context && !next) return;
      context = next
        ? {
            session: { ...next.session },
            scope: { ...next.scope },
            commandIds: [...next.commandIds],
          }
        : null;
      snapshot = {
        state: context ? "authenticated" : "signed-out",
        revision: `atlas-ui:${++sequence}`,
      };
      for (const listener of listeners) listener();
    },
  };
}

export function StockCompletionView({
  completion,
}: {
  readonly completion: StockCompletion | null;
}) {
  if (!completion) return null;
  return (
    <section className="stock-completion" aria-label="Command result">
      <h2>{completion.request.commandId}</h2>
      <pre role="status" aria-live="polite">
        {JSON.stringify(completion.result, null, 2)}
      </pre>
    </section>
  );
}

/** A render failure must unmount the peer mount before it can acknowledge. */
class StockRenderBoundary extends Component<
  {
    readonly children: ReactNode;
    readonly fallback: ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Mount only when root supplies shared validation, dispatch and admissions.
 * The canonical result is rendered inside PR21's own commit-ack boundary. */
export function StockApplication({
  session,
  ports,
  children,
}: {
  readonly session: AtlasSessionInfo;
  readonly ports: StockApplicationPorts;
  readonly children: (
    onScopeCommit: (scope: Scope | null) => void,
  ) => ReactNode;
}) {
  const [scope, setScope] = useState<Scope | null>(null);
  const facade = useMemo(createContextFacade, []);
  const onScopeCommit = useCallback((next: Scope | null) => {
    setScope((current) =>
      current && next && sameScope(current, next) ? current : next,
    );
  }, []);
  const { admission } = ports;
  const context = useMemo<StockHostContext | null>(
    () =>
      scope && admission && sameScope(scope, admission.scope)
        ? { session, scope, commandIds: admission.commandIds }
        : null,
    [session, scope, admission],
  );
  useLayoutEffect(() => {
    facade.publish(context);
  }, [facade, context, admission?.revision]);
  useLayoutEffect(() => () => facade.publish(null), [facade]);
  return (
    <StockRenderBoundary
      fallback={
        <>
          <p className="warning" role="alert">
            Command result could not be displayed.
          </p>
          {children(onScopeCommit)}
        </>
      }
    >
      <StockWebMcpBoundary
        sessions={facade.sessions}
        schemas={ports.schemas}
        service={ports.service}
        {...(Object.hasOwn(ports, "modelContext")
          ? { modelContext: ports.modelContext }
          : {})}
      >
        {({ completion }) => (
          <>
            {children(onScopeCommit)}
            <StockCompletionView completion={context ? completion : null} />
          </>
        )}
      </StockWebMcpBoundary>
    </StockRenderBoundary>
  );
}
