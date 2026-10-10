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
import { createNativePlaceClient } from "../src/api/native-place-client";
import { createTopologyClient } from "../src/api/topology-client";
import { createNetworkRelationsClient } from "../src/api/network-relations-client";
import { createAccountObservationClient } from "../src/ai/host/account-client";
import { AccountObservationProvider } from "../src/ai/AccountObservation";
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
let currentStockAdmission: StockAdmission | null = null;
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
// The informational AI account read uses the same actual session allocation
// and completed view scope; it is read only on an explicit refresh.
const account = createAccountObservationClient({
  getSessionBinding: () => currentSession && currentQuantityScope
    ? { session: currentSession, scope: currentQuantityScope } : null,
  subscribeSessionBinding: changed => {
    quantityEvents.addEventListener("changed", changed);
    return () => quantityEvents.removeEventListener("changed", changed);
  },
});
// Saved Network relations use the same actual session allocation and completed
// view scope; each page is an explicit GET that the host authorizes anew.
const networkRelations = createNetworkRelationsClient({
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
const topology = createTopologyClient({
  schemas,
  getSessionBinding: () => currentSession && currentQuantityScope
    ? { session: currentSession, scope: currentQuantityScope } : null,
  subscribeSessionBinding: changed => {
    quantityEvents.addEventListener("changed", changed);
    return () => quantityEvents.removeEventListener("changed", changed);
  },
});
const nativePlaces = createNativePlaceClient({
  getContext: () => currentSession && currentQuantityScope && currentStockAdmission
    ? { session: currentSession, scope: currentQuantityScope, admission: currentStockAdmission } : null,
  subscribe: changed => {
    quantityEvents.addEventListener("changed", changed);
    return () => quantityEvents.removeEventListener("changed", changed);
  },
});
const nativeClient = createAtlasClient({
  bootstrap: root.dataset.bootstrapUrl ?? "/api/atlas/view",
  home: scope => `/api/atlas/homes/${encodeURIComponent(scope.workspaceId)}/${encodeURIComponent(scope.homeId)}/view`,
});
/** Internal deadline for each optional admission read, headers and body
 * together. Expiry is no admission: the view is still returned, tools stay
 * unregistered and nothing is retried. */
const admissionTimeoutMs = 10000;
const stockAdmissionMaxBytes = 64 * 1024;
function discardStockAdmission(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}
async function readStockAdmission(response: Response, signal: AbortSignal): Promise<unknown> {
  const declaredLength = response.headers.get("Content-Length");
  if (declaredLength !== null) {
    const contentLength = Number(declaredLength);
    if (!/^[0-9]+$/.test(declaredLength) || !Number.isSafeInteger(contentLength) || contentLength > stockAdmissionMaxBytes) {
      discardStockAdmission(response);
      throw new TypeError("Stock admission response exceeded byte bound");
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError("Stock admission response body missing");
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      if (part.value.byteLength > stockAdmissionMaxBytes - length)
        throw new TypeError("Stock admission response exceeded byte bound");
      if (part.value.byteLength === 0) continue;
      length += part.value.byteLength;
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}
/** Settles one optional read by its deadline even if the transport or body
 * ignores the abort, so a late result is never returned. The caller's abort is
 * forwarded with its own reason; the timer and listeners are always removed. */
async function withAdmissionDeadline<T>(signal: AbortSignal, read: (deadline: AbortSignal) => Promise<T>): Promise<T> {
  const timeout = new AbortController();
  let expire!: () => void;
  const expired = new Promise<never>((_, reject) => { expire = () => reject(timeout.signal.reason); });
  const abort = () => timeout.abort(signal.reason);
  timeout.signal.addEventListener("abort", expire, { once: true });
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(() => timeout.abort(), admissionTimeoutMs);
  try {
    return await Promise.race([read(timeout.signal), expired]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    timeout.signal.removeEventListener("abort", expire);
  }
}
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
      currentStockAdmission = null;
      const view = await operation(signal);
      if (!signal.aborted && attempt === generation && sameSession()) {
        currentQuantityAdmission = null;
        currentQuantityScope = view.status === "ready" ? view.scope : null;
        quantityChanged();
      }
      if (view.status === "ready" && !signal.aborted && attempt === generation && sameSession()) {
        const scope = view.scope;
        // Independent optional admissions start together; the ready view waits
        // for at most one admission deadline rather than two serial deadlines.
        const stockRead = (async () => {
        try {
          // Headers and body share one deadline; a late row is never used.
          const row = await withAdmissionDeadline<unknown>(signal, async deadline => {
            const response = await fetch(`/api/atlas/stock/v3/workspaces/${encodeURIComponent(scope.workspaceId)}/homes/${encodeURIComponent(scope.homeId)}/admission`, {
              method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal: deadline,
              headers: { Accept: "application/json" },
            });
            if (deadline.aborted) { discardStockAdmission(response); deadline.throwIfAborted(); }
            if (!response.ok) { discardStockAdmission(response); return null; }
            return await readStockAdmission(response, deadline);
          });
          if (row && typeof row === "object" && "schemaVersion" in row && row.schemaVersion === 3 && "scope" in row && "commandIds" in row && "revision" in row) {
            const candidate = row as { scope: { workspaceId?: unknown; homeId?: unknown }; commandIds: unknown; revision: unknown };
            if (candidate.scope?.workspaceId === scope.workspaceId && candidate.scope.homeId === scope.homeId && Array.isArray(candidate.commandIds) && candidate.commandIds.every(id => typeof id === "string") && typeof candidate.revision === "string" && !signal.aborted && attempt === generation && sameSession())
              {
                currentStockAdmission = Object.freeze({ scope, commandIds: candidate.commandIds, revision: candidate.revision });
                setAdmission(currentStockAdmission);
                quantityChanged();
              }
          }
        } catch (error) {
          if (signal.aborted) throw error;
          // Keep the authorized home visible; tools remain unregistered until
          // an actual admitted catalog arrives on a later successful load.
        }
        })();
        const quantityRead = (async () => {
        if (modelContext) {
          try {
            // Headers and body share one deadline; a late row is never published.
            const row = await withAdmissionDeadline(signal, async deadline => {
              const response = await fetch(quantityAdmissionUrl(scope), {
                method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal: deadline,
                headers: { Accept: "application/json" },
              });
              // Any non-success status is no admission; there is no fallback.
              if (!response.ok) { await response.body?.cancel(); return null; }
              return readQuantityAdmission(response, scope, deadline);
            });
            if (row && !signal.aborted && attempt === generation && sameSession() && currentQuantityScope === scope) {
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
        })();
        await Promise.all([stockRead, quantityRead]);
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
  return <div className="lantern-integration"><AccountObservationProvider client={account}><SessionApp renderContent={(view, content, actions) => view.status === "ready" ? <LanternHost view={view} actions={{ ...actions, quantity }} nativeContent={content} pinnedFiles={pinnedFiles} networkRelations={networkRelations} topology={topology} nativePlaces={nativePlaces} {...(modelContext ? { quantityWebMcp: { admission: quantityAdmissionPort, modelContext } } : {})} /> : content} client={client} sessions={sessions} accessEvents={window} editing={editing} stock={{ schemas, service, admission, downloads }} {...(ai ? { ai } : {})} /></AccountObservationProvider></div>;
}
createRoot(root).render(<StrictMode><HostApplication /></StrictMode>);
