import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { SessionApp } from "../src/app/SessionApp";
import type { StockAdmission } from "../src/app/StockApplication";
import type { AtlasClient, AtlasView } from "../src/app/types";
import { createAtlasClient, createAtlasSessionClient } from "../src/api/client";
import { createStockSchemas } from "./stock-schemas";
import { createStockDispatch } from "./stock-dispatch";
import { createEditingClient } from "./editing-client";
import type { AtlasSessionClient, AtlasSessionInfo } from "../src/app/session";
import "../src/styles/atlas.css";
import "../src/styles/session.css";
import "../src/styles/stock.css";
import "../src/ai/ai.css";
import "../src/ai/host/host.css";
import type { AiApplicationPort } from "../src/ai/host/index.js";

const element = document.getElementById("root");
if (!element) throw new Error("HouseAtlas root missing");
const root = element;
const schemas = createStockSchemas();
const service = createStockDispatch();
const events = new EventTarget();
/** Other confirmed host session actions notify this transient subscriber only.
 * Session GET itself emits nothing, preventing a rotation/reload cycle. */
export function notifySessionChanged(): void { events.dispatchEvent(new Event("changed")); }
const nativeSessions = createAtlasSessionClient({
  session: root.dataset.sessionUrl ?? "/api/atlas/auth/session",
  login: root.dataset.loginUrl ?? "/api/atlas/auth/login",
  logout: root.dataset.logoutUrl ?? "/api/atlas/auth/logout",
});
let currentSession: AtlasSessionInfo | null = null;
let sessionGeneration = 0;
const nativeSignOut = nativeSessions.signOut;
const sessions: AtlasSessionClient = {
  async session(signal) {
    const generation = ++sessionGeneration;
    currentSession = null;
    const value = await nativeSessions.session(signal);
    if (!signal.aborted && generation === sessionGeneration) currentSession = value;
    return value;
  },
  async signIn(credentials, signal) {
    const generation = ++sessionGeneration;
    currentSession = null;
    const value = await nativeSessions.signIn(credentials, signal);
    if (!signal.aborted && generation === sessionGeneration) currentSession = value;
    return value;
  },
  ...(nativeSignOut ? { async signOut(signal: AbortSignal) {
    ++sessionGeneration;
    currentSession = null;
    await nativeSignOut(signal);
  } } : {}),
  subscribe(changed: () => void) {
    events.addEventListener("changed", changed);
    return () => events.removeEventListener("changed", changed);
  },
};
const editing = createEditingClient(schemas, () => currentSession);
const nativeClient = createAtlasClient({
  bootstrap: root.dataset.bootstrapUrl ?? "/api/atlas/view",
  home: scope => `/api/atlas/homes/${encodeURIComponent(scope.workspaceId)}/${encodeURIComponent(scope.homeId)}/view`,
});
export function HostApplication({ ai }: { readonly ai?: AiApplicationPort }) {
  const [admission, setAdmission] = useState<StockAdmission | null>(null);
  const client = useMemo<AtlasClient>(() => {
    let generation = 0;
    const load = async (operation: (signal: AbortSignal) => Promise<AtlasView>, signal: AbortSignal) => {
      const attempt = ++generation;
      setAdmission(null);
      const view = await operation(signal);
      if (view.status === "ready") {
        const scope = view.scope;
        try {
          const response = await fetch(`/api/atlas/stock/v3/workspaces/${encodeURIComponent(scope.workspaceId)}/homes/${encodeURIComponent(scope.homeId)}/admission`, {
            method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
            headers: { Accept: "application/json" },
          });
          if (response.ok) {
            const row: unknown = await response.json();
            if (row && typeof row === "object" && "schemaVersion" in row && row.schemaVersion === 3 && "scope" in row && "commandIds" in row && "revision" in row) {
              const candidate = row as { scope: { workspaceId?: unknown; homeId?: unknown }; commandIds: unknown; revision: unknown };
              if (candidate.scope?.workspaceId === scope.workspaceId && candidate.scope.homeId === scope.homeId && Array.isArray(candidate.commandIds) && candidate.commandIds.every(id => typeof id === "string") && typeof candidate.revision === "string" && !signal.aborted && attempt === generation)
                setAdmission({ scope, commandIds: candidate.commandIds, revision: candidate.revision });
            }
          }
        } catch (error) {
          if (signal.aborted) throw error;
          // Keep the authorized home visible; tools remain unregistered until
          // an actual admitted catalog arrives on a later successful load.
        }
      }
      return view;
    };
    return {
      load: signal => load(s => nativeClient.load(s), signal),
      loadHome: (scope, signal) => load(s => nativeClient.loadHome(scope, s), signal),
    };
  }, []);
  // Keep the concrete editing port stable through view/catalog refreshes.
  // Each place admission and command obtains the actual request authority.
  return <SessionApp client={client} sessions={sessions} accessEvents={window} editing={editing} stock={{ schemas, service, admission }} {...(ai ? { ai } : {})} />;
}
createRoot(root).render(<StrictMode><HostApplication /></StrictMode>);
