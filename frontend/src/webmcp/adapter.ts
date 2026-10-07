import type {
  AuthenticatedSession, CatalogTool, JsonValue, RegistrationStatus,
  SessionSnapshot, WebMcpHandle, WebMcpOptions,
} from "./ports.js";

function sessionMatches(a: SessionSnapshot, b: SessionSnapshot): boolean {
  return a.state === b.state && a.revision === b.revision;
}

function unavailable(): DOMException {
  return new DOMException("Tool session is no longer current", "InvalidStateError");
}

/** Clone transport output without changing shape/order or leaking live references. */
function jsonSnapshot(value: JsonValue): JsonValue {
  // JSON values are guaranteed by the shared service port. Verify serializability
  // at this transport seam without duplicating domain output validation.
  const seen = new Set<object>();
  const visit = (item: JsonValue): void => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new TypeError("Non-JSON tool result");
    if (item === null || typeof item === "string" || typeof item === "boolean" || typeof item === "number") return;
    if (typeof item !== "object" || seen.has(item)) throw new TypeError("Non-JSON tool result");
    seen.add(item);
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
    } else {
      const prototype: unknown = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Non-JSON tool result");
      for (const child of Object.values(item)) visit(child);
    }
    seen.delete(item);
  };
  visit(value);
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/** Start explicitly from the host's client lifecycle. All domain work is delegated. */
export function startWebMcp(options: WebMcpOptions): WebMcpHandle {
  const { modelContext, sessions, catalog, service, visible } = options;
  let status: RegistrationStatus = { state: modelContext ? "inactive" : "unsupported" };
  let disposed = false;
  let version = 0;
  let observed: SessionSnapshot | undefined;
  let registration: AbortController | undefined;
  let sessionLifetime: AbortController | undefined;
  let unsubscribe: (() => void) | undefined;
  let pending: Promise<void> = Promise.resolve();
  const statusListeners = new Set<() => void>();
  const publish = (next: RegistrationStatus): void => {
    status = next;
    for (const listener of statusListeners) listener();
  };

  const handle: WebMcpHandle = {
    getStatus: () => status,
    subscribeStatus: listener => {
      statusListeners.add(listener);
      return () => { statusListeners.delete(listener); };
    },
    whenSettled: async () => { await pending; return status; },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      version += 1;
      publish({ state: "disposed" });
      statusListeners.clear();
      // Unmount removes availability. As in WebMCP, it does not cancel a service
      // call already underway; cancellation is not a rollback of committed work.
      registration?.abort();
      unsubscribe?.();
    },
  };
  if (!modelContext) return handle;

  const execute = async (
    tool: CatalogTool, session: AuthenticatedSession,
    registrations: AbortSignal, lifetime: AbortSignal,
    input: unknown, invocationSignal?: AbortSignal,
  ): Promise<JsonValue> => {
    if (disposed || registrations.aborted || !sessionMatches(session, sessions.getSnapshot())) throw unavailable();
    const signal = invocationSignal ? AbortSignal.any([lifetime, invocationSignal]) : lifetime;
    signal.throwIfAborted();
    const parsed = tool.parseInput(input);
    const context = { session, signal };
    // Recheck after parsing; the shared service also verifies current authority.
    if (!sessionMatches(session, sessions.getSnapshot())) throw unavailable();
    signal.throwIfAborted();
    const result = jsonSnapshot(await service.execute(tool.name, parsed, context));
    signal.throwIfAborted();
    if (!sessionMatches(session, sessions.getSnapshot())) throw unavailable();
    // Give the view its own copy so display transformations cannot alter the wire.
    await visible.apply(tool.name, jsonSnapshot(result), context, parsed);
    signal.throwIfAborted();
    if (!sessionMatches(session, sessions.getSnapshot())) throw unavailable();
    return result;
  };

  const refresh = (): void => {
    if (disposed) return;
    let session: SessionSnapshot;
    try { session = { ...sessions.getSnapshot() }; }
    catch {
      version += 1;
      registration?.abort();
      sessionLifetime?.abort();
      observed = undefined;
      publish({ state: "failed", phase: "session" });
      return;
    }
    if (observed && sessionMatches(observed, session)) return;
    observed = session;
    const currentVersion = ++version;
    registration?.abort();
    // Session change is a separate cancellation scope from registration cleanup.
    sessionLifetime?.abort();
    const controller = new AbortController();
    const lifetime = new AbortController();
    registration = controller;
    sessionLifetime = lifetime;
    publish(session.state === "signed-out" ? { state: "inactive" } : { state: "registering", toolNames: [] });
    pending = pending.then(async () => {
      if (disposed || currentVersion !== version || session.state !== "authenticated") return;
      let tools: readonly CatalogTool[];
      try { tools = [...catalog.toolsFor(session)]; }
      catch {
        if (currentVersion === version && !disposed) publish({ state: "failed", phase: "catalog" });
        return;
      }
      const names: string[] = [];
      for (const tool of tools) {
        if (disposed || currentVersion !== version) return;
        try {
          await modelContext.registerTool({
            name: tool.name,
            ...(tool.title === undefined ? {} : { title: tool.title }),
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
            execute: (input, executionOptions) => execute(
              tool, session, controller.signal, lifetime.signal, input, executionOptions?.signal,
            ),
          }, { signal: controller.signal });
        } catch {
          controller.abort();
          if (currentVersion === version && !disposed) publish({ state: "failed", phase: "registration", toolName: tool.name });
          return;
        }
        names.push(tool.name);
      }
      if (currentVersion === version && !disposed) publish({ state: "registered", toolNames: names });
    });
  };

  try {
    unsubscribe = sessions.subscribe(refresh);
    refresh();
  } catch {
    registration?.abort();
    sessionLifetime?.abort();
    publish({ state: "failed", phase: "session" });
  }
  return handle;
}
