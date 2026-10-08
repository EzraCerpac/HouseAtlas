import type { Scope } from "../../api/generated/contracts.js";
import type { AtlasSessionInfo } from "../../app/session.js";
import type { AuthenticatedSession, CatalogTool, InvocationContext, JsonObject, JsonValue, ModelContextPort, SessionPort } from "../ports.js";

/** Host-owned admission, not browser authority. Revise the session snapshot on
 * scope, login or capability changes; keep credentials out of catalog/results. */
export interface GatewaySessionPort extends SessionPort {
  getContext(session: AuthenticatedSession): {
    readonly applicationSession: AtlasSessionInfo;
    readonly scope: Scope;
    readonly toolNames: readonly string[];
  };
}
export interface GatewayInvocation extends InvocationContext {
  readonly applicationSession: AtlasSessionInfo;
  readonly scope: Scope;
}
export interface GatewayServicePort {
  /** Complete the task using the actual application service and current server
   * authority. Preserve caller identifiers, receipts and pending/error states. */
  execute(input: JsonObject, context: GatewayInvocation): Promise<JsonValue>;
}
export interface GatewayToolBinding {
  /** Definition/parser supplied by the shared catalog owner. No local tool list. */
  readonly tool: CatalogTool;
  readonly service: GatewayServicePort;
  /** Shared output validation and request/result correlation stay with owner. */
  validateResult(result: JsonValue, input: JsonObject): void;
}
export interface GatewayDownload {
  /** Host-issued same-origin path, with no URL construction in this lane. */
  readonly href: string;
  /** Null leaves naming to the owner's Content-Disposition/browser behavior. */
  readonly filename: string | null;
  readonly mediaType: string;
  readonly label: string;
  /** Actual available Media owner's floored remaining monotonic budget after
   * final authenticated checks. Never infer this from a token, URL or clock. */
  readonly lifetime: { readonly remainingMs: number };
}
export interface GatewayDownloadPort {
  /** Resolve only an actually available download under current authority.
   * Null preserves pending, unavailable and non-download outcomes. Never fetch
   * bytes or claim that rendering a link completed a download. Only the owner's
   * available status supplies its lifetime; unavailable/unbound resolve null. */
  resolve(toolName: string, input: JsonObject, result: JsonValue,
    context: GatewayInvocation): Promise<GatewayDownload | null>;
}
export interface GatewayCompletion {
  readonly toolName: string;
  readonly input: JsonObject;
  readonly result: JsonValue;
  readonly download: GatewayDownload | null;
  /** Local presentation cutoff in performance.now() units, anchored before
   * resolving availability. Not an owner DTO, renewal or authority evidence. */
  readonly downloadDeadline: number | null;
  readonly sessionRevision: string;
}
export interface GatewayVisiblePort {
  commit(completion: GatewayCompletion, signal: AbortSignal): Promise<void>;
}
export interface GatewayMountOptions {
  readonly modelContext: ModelContextPort | undefined;
  readonly sessions: GatewaySessionPort;
  readonly bindings: readonly GatewayToolBinding[];
  readonly downloads?: GatewayDownloadPort;
  readonly visible: GatewayVisiblePort;
}
