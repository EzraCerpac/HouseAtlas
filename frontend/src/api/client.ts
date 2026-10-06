import { decodeAtlasView } from "../app/decode";
import type { AtlasClient, AtlasView, Scope } from "../app/types";

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
    if (response.status === 403) return { status: "revoked" };
    if (!response.ok) throw new AtlasReadError(response.status);
    const payload: unknown = await response.json();
    return decodeAtlasView(payload);
  };
  return {
    load: (signal) => read(endpoints.bootstrap, signal),
    loadHome: (scope, signal) => read(endpoints.home(scope), signal),
  };
}
