import type { Scope } from "../api/generated/contracts.js";
import type { AtlasSessionInfo } from "../app/session.js";
import { startWebMcp } from "./adapter.js";
import { stockCatalog, stockFamilies, stockInputSchema } from "./stock-schema.js";
import type {
  AuthenticatedSession, CatalogTool, InvocationContext, JsonObject,
  ModelContextPort, SessionPort, WebMcpHandle,
} from "./ports.js";

/** Transport views of AT51 stock wire3 envelopes; full arm constraints remain
 * in the imported schema. Shared generated Scope and AT10 session DTO are reused.
 */
export type StockRequestEnvelope = JsonObject & {
  readonly schemaVersion: 3;
  readonly commandId: string;
  readonly requestId: string;
  readonly context: Scope & JsonObject;
  readonly target: JsonObject;
  readonly payload: JsonObject;
};
export type StockResultEnvelope = JsonObject & {
  readonly schemaVersion: 3;
  readonly requestId: string;
};
export interface StockHostContext {
  readonly session: AtlasSessionInfo;
  readonly scope: Scope;
  /** Exact current admitted arms from the host; catalog dispositions are not grants. */
  readonly commandIds: readonly string[];
}
export interface StockSessionPort extends SessionPort {
  /** Same revision/scope as getSnapshot. Never expose this through browser tools. */
  getContext(session: AuthenticatedSession): StockHostContext;
}
export interface StockSchemaPort {
  /** Compile/validate the unchanged stock schema + frozen Atlas resource offline. */
  validate(schemaRef: string, value: unknown): void;
}
export interface StockDispatchPort {
  /** Preserve the entire envelope/requestId. Host verifies actual cookie/session,
   * Origin/CSRF and application authorization; actorId here confers no authority.
   */
  dispatch(request: StockRequestEnvelope, context: InvocationContext & {
    readonly applicationSession: AtlasSessionInfo;
  }): Promise<unknown>;
}
export interface StockCompletion {
  readonly toolName: string;
  readonly request: StockRequestEnvelope;
  readonly result: StockResultEnvelope;
  readonly sessionRevision: string;
}
export interface StockVisiblePort {
  commit(completion: StockCompletion, signal: AbortSignal): Promise<void>;
}
export interface StockMountOptions {
  readonly modelContext: ModelContextPort | undefined;
  readonly sessions: StockSessionPort;
  readonly schemas: StockSchemaPort;
  readonly service: StockDispatchPort;
  readonly visible: StockVisiblePort;
}

const clone = <T>(value: T): T => structuredClone(value);
const sameScope = (a: Scope, b: Scope): boolean =>
  a.workspaceId === b.workspaceId && a.homeId === b.homeId;

/** Concrete stock family mount. No unagreed HTTP endpoint or default capability. */
export function mountStockWebMcp(options: StockMountOptions): WebMcpHandle {
  const { sessions, schemas, service, visible } = options;
  const parse = (toolName: string, input: unknown, session: AuthenticatedSession): StockRequestEnvelope => {
    const family = stockFamilies.families.find(item => item.toolName === toolName);
    if (!family) throw new TypeError("Unknown stock tool family");
    schemas.validate(family.inputSchema, input);
    const request = input as StockRequestEnvelope;
    const current = sessions.getContext(session);
    if (!family.commandIds.includes(request.commandId) || !current.commandIds.includes(request.commandId))
      throw new TypeError("Command is not in the current host tool catalog");
    if (!sameScope(request.context, current.scope)) throw new TypeError("Stock request context differs from selected scope");
    return clone(request);
  };
  return startWebMcp({
    modelContext: options.modelContext,
    sessions,
    catalog: {
      toolsFor(session) {
        const current = sessions.getContext(session);
        const tools: CatalogTool[] = [];
        for (const family of stockFamilies.families) {
          const commands = stockCatalog.commands.filter(command =>
            family.commandIds.includes(command.commandId) && current.commandIds.includes(command.commandId));
          if (commands.length === 0) continue;
          tools.push({
            name: family.toolName,
            description: `Execute current host-admitted ${family.toolName} stock commands. Return wire3 status after the visible result is committed.`,
            inputSchema: stockInputSchema(commands.map(command => command.inputSchema)),
            annotations: {
              readOnlyHint: commands.every(command => command.effect === "read"),
              untrustedContentHint: true,
              consequentialHint: commands.some(command => command.confirmation !== "none"),
            },
            parseInput: input => parse(family.toolName, input, session),
          });
        }
        return tools;
      },
    },
    service: {
      async execute(name, input, context) {
        const request = parse(name, input, context.session);
        const applicationSession = sessions.getContext(context.session).session;
        const value = await service.dispatch(request, { ...context, applicationSession });
        const operation = stockCatalog.commands.find(command => command.commandId === request.commandId);
        if (!operation) throw new TypeError("Unknown stock command");
        const isError = typeof value === "object" && value !== null && Object.hasOwn(value, "code") && !Object.hasOwn(value, "commandId");
        schemas.validate(isError ? "#/$defs/stockError" : operation.outputSchema, value);
        const result = value as StockResultEnvelope;
        // Wire correlation only, never target/source or business authorization.
        if (result.requestId !== request.requestId || (!isError && result["commandId"] !== request.commandId))
          throw new TypeError("Stock result correlation differs from request");
        if (!isError && !sameScope(result["resolvedScope"] as Scope & JsonObject, request.context))
          throw new TypeError("Stock result scope differs from request");
        return clone(result);
      },
    },
    visible: {
      async apply(toolName, result, context, input) {
        await visible.commit({ toolName, request: clone(input as StockRequestEnvelope),
          result: clone(result as StockResultEnvelope), sessionRevision: context.session.revision }, context.signal);
      },
    },
  });
}
