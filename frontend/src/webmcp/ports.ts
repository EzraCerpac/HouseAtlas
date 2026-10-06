/** Browser transport values. Domain DTOs and schemas remain shared-owner inputs. */
export type JsonValue = null | boolean | number | string | JsonObject | readonly JsonValue[];
export interface JsonObject { readonly [key: string]: JsonValue }

/** Non-secret identity of the current login + selected workspace/home context.
 * Change revision on login, logout, rotation or scope change. This is NOT a principal.
 */
export type SessionSnapshot =
  | { readonly state: "signed-out"; readonly revision: string }
  | { readonly state: "authenticated"; readonly revision: string };
export type AuthenticatedSession = Extract<SessionSnapshot, { state: "authenticated" }>;

export interface SessionPort {
  getSnapshot(): SessionSnapshot;
  subscribe(onChange: () => void): () => void;
}

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly untrustedContentHint: boolean;
  readonly consequentialHint: boolean;
}

/** Metadata and parsing must come from the shared catalog, not this transport. */
export interface CatalogTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly annotations: ToolAnnotations;
  parseInput(input: unknown): JsonObject;
}

export interface ToolCatalogPort {
  toolsFor(session: AuthenticatedSession): readonly CatalogTool[];
}

export interface InvocationContext {
  readonly session: AuthenticatedSession;
  readonly signal: AbortSignal;
}

/** The application service verifies current server session/scope, applies shared
 * validation and preserves Origin/CSRF/revision/audit/receipt rules. Browser
 * metadata, annotations and session revisions confer no authority.
 */
export interface ApplicationServicePort {
  execute(toolName: string, input: JsonObject, context: InvocationContext): Promise<JsonValue>;
}

/** Resolve after the matching UI state is committed; preserve DTO fields/order. */
export interface VisibleResultPort {
  apply(toolName: string, result: JsonValue, context: InvocationContext): Promise<void>;
}

export interface RegisteredBrowserTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly annotations: ToolAnnotations;
  execute(input: unknown, options?: { readonly signal?: AbortSignal }): Promise<JsonValue>;
}

/** Small structural subset; avoid global DOM declarations while the draft evolves. */
export interface ModelContextPort {
  registerTool(tool: RegisteredBrowserTool, options: { readonly signal: AbortSignal }): void | Promise<void>;
}

export type RegistrationStatus =
  | { readonly state: "unsupported" | "inactive" | "disposed" }
  | { readonly state: "registering" | "registered"; readonly toolNames: readonly string[] }
  | { readonly state: "failed"; readonly phase: "session" | "catalog" | "registration"; readonly toolName?: string };

export interface WebMcpOptions {
  readonly modelContext: ModelContextPort | undefined;
  readonly sessions: SessionPort;
  readonly catalog: ToolCatalogPort;
  readonly service: ApplicationServicePort;
  readonly visible: VisibleResultPort;
}

export interface WebMcpHandle {
  getStatus(): RegistrationStatus;
  /** Observers must not throw; unsubscribe before their owning view unmounts. */
  subscribeStatus(onChange: () => void): () => void;
  /** Wait for the currently queued registration work; never an execution API. */
  whenSettled(): Promise<RegistrationStatus>;
  dispose(): void;
}
