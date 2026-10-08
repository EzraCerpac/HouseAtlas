import { startWebMcp } from "../adapter.js";
import type { AuthenticatedSession, InvocationContext, WebMcpHandle } from "../ports.js";
import type { GatewayInvocation, GatewayMountOptions, GatewayToolBinding } from "./ports.js";

/** Bind only the intersection of actual service bindings and current admission.
 * No HTTP route, provider support or operation schema is invented here. */
export function mountGatewayWebMcp(options: GatewayMountOptions): WebMcpHandle {
  const bindings = new Map<string, GatewayToolBinding>();
  for (const binding of options.bindings) {
    if (bindings.has(binding.tool.name)) throw new TypeError("Gateway tool has multiple service bindings");
    bindings.set(binding.tool.name, binding);
  }
  const admittedBinding = (name: string, session: AuthenticatedSession): GatewayToolBinding => {
    const binding = bindings.get(name);
    if (!binding || !options.sessions.getContext(session).toolNames.includes(name))
      throw new TypeError("Gateway service is not currently available");
    return binding;
  };
  const invocation = (context: InvocationContext): GatewayInvocation => {
    const current = options.sessions.getContext(context.session);
    return { ...context, applicationSession: current.applicationSession, scope: structuredClone(current.scope) };
  };
  return startWebMcp({
    modelContext: options.modelContext,
    sessions: options.sessions,
    catalog: {
      toolsFor(session) {
        const names = options.sessions.getContext(session).toolNames;
        return [...bindings.values()].filter(binding => names.includes(binding.tool.name))
          .map(binding => ({
            name: binding.tool.name,
            ...(binding.tool.title === undefined ? {} : { title: binding.tool.title }),
            description: binding.tool.description,
            inputSchema: binding.tool.inputSchema,
            annotations: binding.tool.annotations,
            parseInput(input: unknown) {
              admittedBinding(binding.tool.name, session);
              return structuredClone(binding.tool.parseInput(input));
            },
          }));
      },
    },
    service: {
      async execute(name, input, context) {
        const binding = admittedBinding(name, context.session);
        const result = await binding.service.execute(structuredClone(input), invocation(context));
        binding.validateResult(structuredClone(result), structuredClone(input));
        return result;
      },
    },
    visible: {
      async apply(toolName, result, context, input) {
        admittedBinding(toolName, context.session);
        // Start before resolving actual owner availability: transit/setup and
        // React acknowledgement consume its returned budget conservatively.
        const downloadStartedAt = performance.now();
        const resolvedDownload = options.downloads
          ? await options.downloads.resolve(toolName, structuredClone(input), structuredClone(result), invocation(context))
          : null;
        context.signal.throwIfAborted();
        // Download resolution is asynchronous: recheck snapshot/admission before
        // a result from an earlier login/scope can enter the current view.
        const current = options.sessions.getSnapshot();
        if (current.state !== "authenticated" || current.revision !== context.session.revision)
          throw new DOMException("Tool session is no longer current", "InvalidStateError");
        admittedBinding(toolName, context.session);
        if (resolvedDownload && (!resolvedDownload.href.startsWith("/") || resolvedDownload.href.startsWith("//") ||
          /[\\\u0000-\u0020\u007f]/u.test(resolvedDownload.href)))
          throw new TypeError("Download must use an issued same-origin path");
        const remainingMs = resolvedDownload?.lifetime?.remainingMs;
        const cutoff = remainingMs !== undefined && Number.isSafeInteger(remainingMs) && remainingMs > 0 && remainingMs <= 300_000
          ? downloadStartedAt + remainingMs : null;
        const download = cutoff !== null && Number.isFinite(cutoff) && performance.now() < cutoff
          ? resolvedDownload : null;
        await options.visible.commit({ toolName, input: structuredClone(input), result: structuredClone(result),
          download: download ? structuredClone(download) : null,
          downloadDeadline: download ? cutoff : null,
          sessionRevision: context.session.revision }, context.signal);
      },
    },
  });
}
