import { decodeAtlasView } from "../app/decode";
import type { AtlasClient, AtlasView, Scope } from "../app/types";
import {
  decodeSessionInfo,
  type AtlasSessionClient,
  type AtlasSessionInfo,
} from "../app/session";

export interface AtlasEndpoints {
  /** Local authorized saved-view routes supplied by the integration owner. */
  bootstrap: string;
  home: (scope: Scope) => string;
}
export class AtlasReadError extends Error {
  constructor(readonly status: number) {
    super("Saved information could not be loaded");
  }
}
function localReadUrl(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new TypeError("Expected same-origin read route");
  const url = new URL(path, "https://atlas.invalid");
  if (
    url.origin !== "https://atlas.invalid" ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new TypeError("Expected same-origin read route");
  return url.pathname + url.search;
}
/** Passive reads only. No browser source transports, credentials, mutation
 * queue, local storage or source-refresh/collector calls. */
export function createAtlasClient(
  endpoints: AtlasEndpoints,
  transport: typeof fetch = globalThis.fetch,
): AtlasClient {
  const read = async (
    path: string,
    signal: AbortSignal,
  ): Promise<AtlasView> => {
    const response = await transport(localReadUrl(path), {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
      signal,
    });
    if (response.status === 401) return { status: "expired" };
    if (response.status === 403) return { status: "denied" };
    if (!response.ok) throw new AtlasReadError(response.status);
    const payload: unknown = await response.json();
    return decodeAtlasView(payload);
  };
  return {
    load: (signal) => read(endpoints.bootstrap, signal),
    loadHome: (scope, signal) => read(endpoints.home(scope), signal),
  };
}

export interface AtlasSessionEndpoints {
  /** Canonical published paths: /api/atlas/auth/session and /api/atlas/auth/login.
   * The host explicitly supplies mounted routes; no route is enabled by default. */
  session: string;
  login: string;
  /** Published logout acknowledgement: {schemaVersion:1,signedOut:true}. */
  logout?: string;
}
/** Only application session operations, never account/source provisioning or
 * provider authentication. Cookies stay HttpOnly; CSRF remains transient. */
export function createAtlasSessionClient(
  endpoints: AtlasSessionEndpoints,
  transport: typeof fetch = globalThis.fetch,
): AtlasSessionClient {
  const request = (
    path: string,
    signal: AbortSignal,
    options: Pick<RequestInit, "method" | "headers" | "body">,
  ) =>
    transport(localReadUrl(path), {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
      ...options,
    });
  const session = async (
    signal: AbortSignal,
  ): Promise<AtlasSessionInfo | null> => {
    const response = await request(endpoints.session, signal, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new AtlasReadError(response.status);
    const value: unknown = await response.json();
    return decodeSessionInfo(value);
  };
  const client: AtlasSessionClient = {
    session,
    signIn: async (credentials, signal) => {
      const response = await request(endpoints.login, signal, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: credentials.username,
          password: credentials.password,
        }),
      });
      if (!response.ok) throw new AtlasReadError(response.status);
      const value: unknown = await response.json();
      return decodeSessionInfo(value);
    },
  };
  const logout = endpoints.logout;
  if (logout)
    client.signOut = async (signal) => {
      // Session GET rotates the nonce in the published boundary. Get the current
      // nonce immediately before this action instead of retaining a stale one.
      const info = await session(signal);
      if (!info) throw new AtlasReadError(401);
      const response = await request(logout, signal, {
        method: "POST",
        headers: { Accept: "application/json", "X-Atlas-CSRF": info.csrfToken },
      });
      if (!response.ok) throw new AtlasReadError(response.status);
      const value: unknown = await response.json();
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !("schemaVersion" in value) ||
        value.schemaVersion !== 1 ||
        !("signedOut" in value) ||
        value.signedOut !== true
      )
        throw new TypeError("Invalid sign-out acknowledgement");
    };
  return client;
}
