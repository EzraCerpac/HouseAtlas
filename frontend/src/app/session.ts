/** Published application-session DTO, shared by legacy auth routes and the
 * Rust session GET. This is application auth, separate from SIWC/AI owners. */
export interface AtlasSessionInfo {
  schemaVersion: 1;
  actorId: string;
  csrfToken: string;
  expiresAt: string;
}
export interface AtlasCredentials {
  username: string;
  password: string;
}
/** Informational sign-in method published by the host mode route. It does not
 * describe a session and never replaces the canonical session GET. */
export type AtlasAuthMode = "password" | "loopback-local" | "trusted-proxy";
/** Paired optional port: supplied only when the host mounts the mode route and
 * at least one sign-in action. Each action matches exactly one decoded mode:
 * signIn for loopback-local, proxySignIn for trusted-proxy. Neither sends
 * credentials, identity, actor or CSRF values. */
export interface AtlasLocalAccess {
  mode(signal: AbortSignal): Promise<AtlasAuthMode>;
  signIn?: (signal: AbortSignal) => Promise<AtlasSessionInfo>;
  proxySignIn?: (signal: AbortSignal) => Promise<AtlasSessionInfo>;
}
export interface AtlasSessionClient {
  /** Host rotation/change notification; re-read the canonical session route. */
  subscribe?: (changed: () => void) => () => void;
  session(signal: AbortSignal): Promise<AtlasSessionInfo | null>;
  signIn(
    credentials: AtlasCredentials,
    signal: AbortSignal,
  ): Promise<AtlasSessionInfo>;
  /** Only supplied when the host mounts the documented logout action. */
  signOut?: (signal: AbortSignal) => Promise<void>;
  /** Absent means the legacy password flow, unchanged. */
  localAccess?: AtlasLocalAccess;
}
export interface SessionSettings {
  expiresAt: string;
  signOut?: () => void;
}
export function decodeSessionInfo(value: unknown): AtlasSessionInfo {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Expected application session");
  const row = value as Record<string, unknown>;
  if (
    row.schemaVersion !== 1 ||
    typeof row.actorId !== "string" ||
    typeof row.csrfToken !== "string" ||
    !row.csrfToken ||
    typeof row.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(row.expiresAt))
  )
    throw new TypeError("Invalid application session");
  return {
    schemaVersion: 1,
    actorId: row.actorId,
    csrfToken: row.csrfToken,
    expiresAt: row.expiresAt,
  };
}
/** Strict bare mode object: exactly {schemaVersion:1,mode}. Unknown modes and
 * extra fields are failures, never a fallback to another sign-in method. */
export function decodeAuthMode(value: unknown): AtlasAuthMode {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Expected sign-in method");
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError("Expected sign-in method");
  const row = value as Record<string, unknown>;
  const own = (key: string) => Object.prototype.hasOwnProperty.call(row, key);
  if (
    Reflect.ownKeys(row).length !== 2 ||
    !own("schemaVersion") ||
    !own("mode") ||
    row.schemaVersion !== 1 ||
    (row.mode !== "password" &&
      row.mode !== "loopback-local" &&
      row.mode !== "trusted-proxy")
  )
    throw new TypeError("Invalid sign-in method");
  return row.mode;
}
