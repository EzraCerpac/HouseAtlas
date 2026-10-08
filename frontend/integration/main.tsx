import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { LanternHost } from "../src/lantern/Host";
import { SessionApp } from "../src/app/SessionApp";
import type { StockAdmission } from "../src/app/StockApplication";
import type { AtlasClient, AtlasView } from "../src/app/types";
import { createAtlasClient, createAtlasSessionClient } from "../src/api/client";
import { createStockSchemas } from "./stock-schemas";
import { createStockDispatch } from "./stock-dispatch";
import { createAtlasGatewayDownloadResolver } from "../src/api/managed-download-client";
import { createEditingClient } from "./editing-client";
import { createQuantityClient } from "./quantity-client";
import { createPinnedFileClient } from "./pinned-file-client";
import { detectModelContext } from "../src/webmcp/browser";
import { quantityAdmissionUrl, readQuantityAdmission, type QuantityAdmissionPort, type QuantityToolAdmission } from "../src/webmcp/quantity/tool";
import type { Scope } from "../src/api/generated/contracts";
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
const downloads = createAtlasGatewayDownloadResolver(schemas);
const events = new EventTarget();
/** Other confirmed host session actions notify this transient subscriber only.
 * Session GET itself emits nothing, preventing a rotation/reload cycle. */
export function notifySessionChanged(): void { events.dispatchEvent(new Event("changed")); }
// Root emits the mode attribute with each sign-in attribute it mounts; no
// defaults. Each sign-in path is passed only when its own attribute exists.
const authModeUrl = root.dataset.authModeUrl;
const localSignInUrl = root.dataset.localSignInUrl;
const proxySignInUrl = root.dataset.proxySignInUrl;
const nativeSessions = createAtlasSessionClient({
  session: root.dataset.sessionUrl ?? "/api/atlas/auth/session",
  login: root.dataset.loginUrl ?? "/api/atlas/auth/login",
  logout: root.dataset.logoutUrl ?? "/api/atlas/auth/logout",
  ...(authModeUrl && (localSignInUrl || proxySignInUrl) ? { localAccess: {
    mode: authModeUrl,
    ...(localSignInUrl ? { signIn: localSignInUrl } : {}),
    ...(proxySignInUrl ? { proxySignIn: proxySignInUrl } : {}),
  } } : {}),
});
let currentSession: AtlasSessionInfo | null = null;
let currentQuantityScope: Scope | null = null;
/** Read-only tool admission for the current scope; cleared with every scope clear. */
let currentQuantityAdmission: QuantityToolAdmission | null = null;
const quantityEvents = new EventTarget();
const quantityChanged = () => quantityEvents.dispatchEvent(new Event("changed"));
// Native browser support only; undefined sends no admission request and registers nothing.
const modelContext = detectModelContext(document);
let sessionGeneration = 0;
const nativeSignOut = nativeSessions.signOut;
const nativeLocalAccess = nativeSessions.localAccess;
const nativeLocalSignIn = nativeLocalAccess?.signIn;
const nativeProxySignIn = nativeLocalAccess?.proxySignIn;
const sessions: AtlasSessionClient = {
  async session(signal) {
    const generation = ++sessionGeneration;
    currentSession = null;
    currentQuantityAdmission = null;
    currentQuantityScope = null;
    quantityChanged();
    const value = await nativeSessions.session(signal);
    if (!signal.aborted && generation === sessionGeneration) { currentSession = value; quantityChanged(); }
    return value;
  },
  async signIn(credentials, signal) {
    const generation = ++sessionGeneration;
    currentSession = null;
    currentQuantityAdmission = null;
    currentQuantityScope = null;
    quantityChanged();
    const value = await nativeSessions.signIn(credentials, signal);
    if (!signal.aborted && generation === sessionGeneration) { currentSession = value; quantityChanged(); }
    return value;
  },
  ...(nativeSignOut ? { async signOut(signal: AbortSignal) {
    ++sessionGeneration;
    currentSession = null;
    currentQuantityAdmission = null;
    currentQuantityScope = null;
    quantityChanged();
    await nativeSignOut(signal);
  } } : {}),
  // Mode is informational and writes no shared state; local and proxy sign-in
  // publish the returned session under the same fence as password sign-in.
  ...(nativeLocalAccess ? { localAccess: {
    mode: (signal: AbortSignal) => nativeLocalAccess.mode(signal),
    ...(nativeLocalSignIn ? { async signIn(signal: AbortSignal) {
      const generation = ++sessionGeneration;
      currentSession = null;
      currentQuantityAdmission = null;
      currentQuantityScope = null;
      quantityChanged();
      const value = await nativeLocalSignIn(signal);
      if (!signal.aborted && generation === sessionGeneration) { currentSession = value; quantityChanged(); }
      return value;
    } } : {}),
    ...(nativeProxySignIn ? { async proxySignIn(signal: AbortSignal) {
      const generation = ++sessionGeneration;
      currentSession = null;
      currentQuantityAdmission = null;
      currentQuantityScope = null;
      quantityChanged();
      const value = await nativeProxySignIn(signal);
      if (!signal.aborted && generation === sessionGeneration) { currentSession = value; quantityChanged(); }
      return value;
    } } : {}),
  } } : {}),
  subscribe(changed: () => void) {
    events.addEventListener("changed", changed);
    return () => events.removeEventListener("changed", changed);
  },
};
const editing = createEditingClient(schemas, () => currentSession);
const quantity = createQuantityClient({
  getSessionBinding: () => currentSession && currentQuantityScope
    ? { identity: currentSession, session: currentSession, scope: currentQuantityScope } : null,
  subscribeSessionBinding: changed => {
    quantityEvents.addEventListener("changed", changed);
    return () => quantityEvents.removeEventListener("changed", changed);
  },
});
// Local HomeBox files use the same actual session allocation and completed view
// scope; each discovery, capture and availability read is authorized anew.
const pinnedFiles = createPinnedFileClient({
  getSessionBinding: () => currentSession && currentQuantityScope
    ? { session: currentSession, scope: currentQuantityScope } : null,
  subscribeSessionBinding: changed => {
    quantityEvents.addEventListener("changed", changed);
    return () => quantityEvents.removeEventListener("changed", changed);
  },
});
// The admission applies only while the client's own public identity is unchanged.
const quantityAdmissionPort: QuantityAdmissionPort = {
  getSnapshot: () => currentQuantityAdmission && quantity.getBindingIdentity() === currentQuantityAdmission.bindingIdentity
    ? currentQuantityAdmission : null,
  subscribe: changed => {
    quantityEvents.addEventListener("changed", changed);
    const unsubscribe = quantity.subscribeSessionBinding(changed);
    return () => { quantityEvents.removeEventListener("changed", changed); unsubscribe(); };
  },
};
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
      const originalSession = currentSession;
      const originalSessionGeneration = sessionGeneration;
      const sameSession = () => originalSession !== null && currentSession === originalSession
        && sessionGeneration === originalSessionGeneration;
      currentQuantityAdmission = null;
      currentQuantityScope = null;
      quantityChanged();
      setAdmission(null);
      const view = await operation(signal);
      if (view.status === "ready" && !signal.aborted && attempt === generation && sameSession()) {
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
              if (candidate.scope?.workspaceId === scope.workspaceId && candidate.scope.homeId === scope.homeId && Array.isArray(candidate.commandIds) && candidate.commandIds.every(id => typeof id === "string") && typeof candidate.revision === "string" && !signal.aborted && attempt === generation && sameSession())
                setAdmission({ scope, commandIds: candidate.commandIds, revision: candidate.revision });
            }
          }
        } catch (error) {
          if (signal.aborted) throw error;
          // Keep the authorized home visible; tools remain unregistered until
          // an actual admitted catalog arrives on a later successful load.
        }
      }
      if (!signal.aborted && attempt === generation && sameSession()) {
        currentQuantityAdmission = null;
        currentQuantityScope = view.status === "ready" ? view.scope : null;
        quantityChanged();
        const quantityScope = currentQuantityScope;
        if (quantityScope && modelContext) {
          try {
            const response = await fetch(quantityAdmissionUrl(quantityScope), {
              method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
              headers: { Accept: "application/json" },
            });
            // Any non-success status is no admission; there is no fallback.
            const row = response.ok ? await readQuantityAdmission(response, quantityScope, signal) : null;
            if (!response.ok) await response.body?.cancel();
            if (row && !signal.aborted && attempt === generation && sameSession() && currentQuantityScope === quantityScope) {
              const bindingIdentity = quantity.getBindingIdentity();
              if (bindingIdentity !== null) {
                currentQuantityAdmission = Object.freeze({ ...row, bindingIdentity });
                quantityChanged();
              }
            }
          } catch (error) {
            if (signal.aborted) throw error;
            // Keep the view; the quantity tool stays unregistered.
          }
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
  return <div className="lantern-integration"><SessionApp renderContent={(view, content, actions) => view.status === "ready" ? <LanternHost view={view} actions={{ ...actions, quantity }} nativeContent={content} pinnedFiles={pinnedFiles} {...(modelContext ? { quantityWebMcp: { admission: quantityAdmissionPort, modelContext } } : {})} /> : content} client={client} sessions={sessions} accessEvents={window} editing={editing} stock={{ schemas, service, admission, downloads }} {...(ai ? { ai } : {})} /></div>;
}
createRoot(root).render(<StrictMode><HostApplication /></StrictMode>);
