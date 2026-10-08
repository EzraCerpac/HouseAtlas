import { decodeAtlasView } from "../app/decode";
import type { AtlasClient, AtlasView, Scope } from "../app/types";
import {
  decodeAuthMode,
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

/** The bare mode object is a few dozen bytes; anything larger is rejected. */
const AUTH_MODE_MAX_BYTES = 1024;
/** Proxy sign-in returns only the session DTO; anything larger is rejected. */
const PROXY_SESSION_MAX_BYTES = 4096;
async function readBoundedJson(
  response: Response,
  limit: number,
): Promise<unknown> {
  const body = response.body;
  if (!body) throw new TypeError("Expected sign-in method");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new TypeError("Sign-in method response too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export interface AtlasSessionEndpoints {
  /** Canonical published paths: /api/atlas/auth/session and /api/atlas/auth/login.
   * The host explicitly supplies mounted routes; no route is enabled by default. */
  session: string;
  login: string;
  /** Published logout acknowledgement: {schemaVersion:1,signedOut:true}. */
  logout?: string;
  /** Canonical mode path /api/atlas/auth/mode with at least one sign-in path:
   * /api/atlas/auth/local (signIn) and/or /api/atlas/auth/proxy (proxySignIn).
   * Supplied only when the host mounts them; never enabled by default. */
  localAccess?: { mode: string; signIn?: string; proxySignIn?: string };
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
      // An authoritative no-session response already confirms completion.
      if (!info) return;
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
  const localAccess = endpoints.localAccess;
  if (localAccess) {
    const localSignIn = localAccess.signIn,
      proxySignIn = localAccess.proxySignIn;
    // A mode route without any sign-in action is a host configuration error.
    if (!localSignIn && !proxySignIn)
      throw new TypeError("Expected sign-in route");
    client.localAccess = {
      // Informational route: any non-2xx, including 401, is a mode failure. A
      // mode without its configured action is also a failure, never a fallback.
      mode: async (signal) => {
        const response = await request(localAccess.mode, signal, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new AtlasReadError(response.status);
        const mode = decodeAuthMode(
          await readBoundedJson(response, AUTH_MODE_MAX_BYTES),
        );
        if (
          (mode === "trusted-proxy" && !proxySignIn) ||
          (mode === "loopback-local" && !localSignIn)
        )
          throw new TypeError("Unsupported sign-in method");
        return mode;
      },
      // Literal empty body: no credentials, CSRF or actor. The host issues the
      // native HttpOnly cookie and returns the actual session.
      ...(localSignIn
        ? {
            signIn: async (signal: AbortSignal) => {
              const response = await request(localSignIn, signal, {
                method: "POST",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                body: "{}",
              });
              if (!response.ok) throw new AtlasReadError(response.status);
              const value: unknown = await response.json();
              return decodeSessionInfo(value);
            },
          }
        : {}),
      // Same literal empty body; no identity header. The host's gateway owns
      // identity and returns the actual session with its native cookie.
      ...(proxySignIn
        ? {
            proxySignIn: async (signal: AbortSignal) => {
              const response = await request(proxySignIn, signal, {
                method: "POST",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                body: "{}",
              });
              if (!response.ok) throw new AtlasReadError(response.status);
              return decodeSessionInfo(
                await readBoundedJson(response, PROXY_SESSION_MAX_BYTES),
              );
            },
          }
        : {}),
    };
  }
  return client;
}
