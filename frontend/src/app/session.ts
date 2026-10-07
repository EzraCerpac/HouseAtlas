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
