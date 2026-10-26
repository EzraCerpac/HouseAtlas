import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { LanternHost } from "../src/lantern/Host";
import { SessionApp } from "../src/app/SessionApp";
import { createInitialHomeBootstrap } from "../src/app/session-bootstrap";
import type { StockAdmission } from "../src/app/StockApplication";
import type { AtlasClient, AtlasView, ReadyView } from "../src/app/types";
import { createAtlasClient, createAtlasSessionClient } from "../src/api/client";
import { createStockSchemas } from "./stock-schemas";
import { createStockDispatch } from "./stock-dispatch";
import { createAtlasGatewayDownloadResolver } from "../src/api/managed-download-client";
import { createEditingClient } from "./editing-client";
import { createCaptureDraftAdapter } from "./capture-drafts-adapter";
import { CaptureDraftProvider } from "../src/capture-drafts-ui/Context";
import { createQuantityClient } from "./quantity-client";
import { createPinnedFileClient } from "./pinned-file-client";
import { createNativePlaceClient } from "../src/api/native-place-client";
import { classificationRequest, kindLabel } from "../src/app/editing";
import { getOutbox, type OutboxEntry } from "../src/outbox";
import { PLACE_CLASSIFICATION, PLACE_NAME } from "../src/outbox/kinds";
import { createTopologyClient } from "../src/api/topology-client";
import { createNetworkRelationsClient } from "../src/api/network-relations-client";
import type { NativeGeometryScanCache } from "./native-geometry-scan-cache";
import type { AtlasCacheActor, UnifiedAtlasCache } from "./unified-atlas-cache";
import { createNativeEvidenceDocumentClient } from "./native-evidence-document-client";
import { createSourceDocumentsService } from "./source-documents-service";
import { createOfflineHouseAcquisition } from "./offline-house-acquisition";
import type { SourceModelPort } from "../src/lantern/source-ports";
import type { ElectricalLibraryPort } from "../src/lantern/electrical-library/types";
import type { ModelOverviewSelection } from "../src/lantern/source-models/overview-types";
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
import { forgetSavedEntry } from "../src/offline/saved-entry";

// After each launch, keep the public Saved shell and the root offline entry on
// this build, so a later launch without the server opens the Saved entry with
// the last Atlas copy and the waiting outbox. Registered before anything else
// here can fail. Public build files only; a failure leaves every launch to the
// network, as before.
forgetSavedEntry();
addEventListener("load", () => setTimeout(() => {
  void import("../src/offline/shell").then(module => module.verifySavedShell()).catch(() => undefined);
}, 3_000), { once: true });
const element = document.getElementById("root");
if (!element) throw new Error("HouseAtlas root missing");
const root = element;
const schemas = createStockSchemas();
const service = createStockDispatch();
const downloads = createAtlasGatewayDownloadResolver(schemas);
const events = new EventTarget();
const outbox = getOutbox();
/** Other confirmed host session actions notify this transient subscriber only.
 * Session GET itself emits nothing, preventing a rotation/reload cycle. */
export function notifySessionChanged(): void { captureDrafts.invalidateSession(); events.dispatchEvent(new Event("changed")); }
// Root emits the mode attribute with each sign-in attribute it mounts; no
// defaults. Each sign-in path is passed only when its own attribute exists.
const authModeUrl = root.dataset.authModeUrl;
const localSignInUrl = root.dataset.localSignInUrl;
const proxySignInUrl = root.dataset.proxySignInUrl;
const nativeSessions = createAtlasSessionClient({
  session: root.dataset.sessionUrl ?? "/api/atlas/auth/session",
  login: root.dataset.loginUrl ?? "/api/atlas/auth/login",
  logout: root.dataset.logoutUrl ?? "/api/atlas/auth/logout",
  rotate: root.dataset.rotateUrl ?? "/api/atlas/auth/rotate",
  ...(authModeUrl && (localSignInUrl || proxySignInUrl) ? { localAccess: {
    mode: authModeUrl,
    ...(localSignInUrl ? { signIn: localSignInUrl } : {}),
    ...(proxySignInUrl ? { proxySignIn: proxySignInUrl } : {}),
  } } : {}),
});
let currentSession: AtlasSessionInfo | null = null;
let currentQuantityScope: Scope | null = null;
let currentStockAdmission: StockAdmission | null = null;
let currentReadyView: ReadyView | null = null;
/** Read-only tool admission for the current scope; cleared with every scope clear. */
let currentQuantityAdmission: QuantityToolAdmission | null = null;
const quantityEvents = new EventTarget();
const quantityChanged = () => { configureOutbox(); sourceDocuments.refresh(); houseAcquisition.refresh(); quantityEvents.dispatchEvent(new Event("changed")); };
// Native browser support only; undefined sends no admission request and registers nothing.
const modelContext = detectModelContext(document);
let sessionGeneration = 0;
// Scan derivative bytes kept by builds before the unified Atlas; nothing reads
// them now, and sign-out still deletes any left on this device.
let scanCache: Promise<NativeGeometryScanCache> | undefined;
const getScanCache = () => scanCache ??= import("./native-geometry-scan-cache").then(module =>
  module.openNativeGeometryScanCache(typeof indexedDB === "undefined" ? undefined : indexedDB));
// Verified unified Atlas scenes and model bytes, opened on first Atlas read;
// sign-out deletes them with the scan bytes. Unavailable storage reads afresh.
let atlasStore: Promise<NativeGeometryScanCache> | undefined;
const getAtlasStore = () => atlasStore ??= import("./unified-atlas-cache").then(async module => {
  const store = module.openUnifiedAtlasStore(typeof indexedDB === "undefined" ? undefined : indexedDB);
  await store.ready(); return store;
});
let atlasActor: Promise<AtlasCacheActor | null> = Promise.resolve(null);
/** Only completed canonical observations select the account whose historical
 * copy may open offline. An unavailable session read keeps the prior witness;
 * pending reads, cached IDs and outbox rows never become live authority. */
function observeAtlasActor(value: AtlasSessionInfo | null): void {
  const generation = sessionGeneration;
  const current = () => generation === sessionGeneration && currentSession === value;
  atlasCacheOwner = null;
  atlasActor = Promise.all([import("./unified-atlas-cache"), getAtlasStore()])
    .then(([module, store]) => current() ? module.observeUnifiedAtlasActor(store, value?.actorId ?? null, current) : null)
    .catch(() => null);
}
const nativeSignOut = nativeSessions.signOut;
const nativeLocalAccess = nativeSessions.localAccess;
const nativeLocalSignIn = nativeLocalAccess?.signIn;
const nativeProxySignIn = nativeLocalAccess?.proxySignIn;
/** Normalize issued login receipts to this native cookie's canonical marker
 * before publishing an authenticated binding to any application client. */
async function canonicalSignIn(receipt: AtlasSessionInfo, signal: AbortSignal): Promise<AtlasSessionInfo> {
  const value = await nativeSessions.session(signal);
  signal.throwIfAborted();
  if (!value || value.actorId !== receipt.actorId || value.expiresAt !== receipt.expiresAt)
    throw new Error("Check the current session before opening Home");
  return value;
}
const sessions: AtlasSessionClient = {
  async rotate(signal) {
    captureDrafts.announceSessionChange();
    const generation = ++sessionGeneration;
    currentSession = null;
    captureDrafts.setScope(null);
    currentQuantityAdmission = null;
    currentQuantityScope = null;
    currentReadyView = null;
    quantityChanged();
    let value: AtlasSessionInfo;
    try { value = await nativeSessions.rotate!(signal); }
    finally { captureDrafts.announceSessionChange(); }
    signal.throwIfAborted();
    if (generation !== sessionGeneration) throw new Error("Session changed during rotation");
    currentSession = value;
    observeAtlasActor(value);
    captureDrafts.observeCanonical(value);
    quantityChanged();
    return value;
  },
  async session(signal) {
    captureDrafts.invalidateSession();
    const generation = ++sessionGeneration;
    currentSession = null;
    currentQuantityAdmission = null;
    currentQuantityScope = null;
    currentReadyView = null;
    quantityChanged();
    const value = await nativeSessions.session(signal);
    if (!signal.aborted && generation === sessionGeneration) { currentSession = value; observeAtlasActor(value); captureDrafts.observeCanonical(value); quantityChanged(); }
    return value;
  },
  async signIn(credentials, signal) {
    captureDrafts.announceSessionChange();
    const generation = ++sessionGeneration;
    currentSession = null;
    currentQuantityAdmission = null;
    currentQuantityScope = null;
    currentReadyView = null;
    quantityChanged();
    let value: AtlasSessionInfo;
    try { value = await canonicalSignIn(await nativeSessions.signIn(credentials, signal), signal); }
    finally { captureDrafts.announceSessionChange(); }
    if (!signal.aborted && generation === sessionGeneration) { currentSession = value; observeAtlasActor(value); captureDrafts.observeCanonical(value); quantityChanged(); }
    return value;
  },
  ...(nativeSignOut ? { async signOut(signal: AbortSignal) {
    captureDrafts.announceSessionChange();
    ++sessionGeneration;
    currentSession = null;
    currentQuantityAdmission = null;
    currentQuantityScope = null;
    currentReadyView = null;
    quantityChanged();
    // Device copies are deleted even when the sign-out request fails.
    try { await nativeSignOut(signal); }
    finally {
      atlasCacheOwner = null;
      atlasActor = Promise.resolve(null);
      await Promise.all([getScanCache().then(cache => cache.clear()).catch(() => undefined),
        getAtlasStore().then(store => store.clear()).catch(() => undefined)]);
      captureDrafts.announceSessionChange();
    }
  } } : {}),
  // Mode is informational and writes no shared state; local and proxy sign-in
  // publish the returned session under the same fence as password sign-in.
  ...(nativeLocalAccess ? { localAccess: {
    mode: (signal: AbortSignal) => nativeLocalAccess.mode(signal),
    ...(nativeLocalSignIn ? { async signIn(signal: AbortSignal) {
      captureDrafts.announceSessionChange();
      const generation = ++sessionGeneration;
      currentSession = null;
      captureDrafts.setScope(null);
      currentQuantityAdmission = null;
      currentQuantityScope = null;
    currentReadyView = null;
      quantityChanged();
      let value: AtlasSessionInfo;
      try { value = await canonicalSignIn(await nativeLocalSignIn(signal), signal); }
      finally { captureDrafts.announceSessionChange(); }
      if (!signal.aborted && generation === sessionGeneration) { currentSession = value; observeAtlasActor(value); captureDrafts.observeCanonical(value); quantityChanged(); }
      return value;
    } } : {}),
    ...(nativeProxySignIn ? { async proxySignIn(signal: AbortSignal) {
      captureDrafts.announceSessionChange();
      const generation = ++sessionGeneration;
      currentSession = null;
      captureDrafts.setScope(null);
      currentQuantityAdmission = null;
      currentQuantityScope = null;
    currentReadyView = null;
      quantityChanged();
      let value: AtlasSessionInfo;
      try { value = await canonicalSignIn(await nativeProxySignIn(signal), signal); }
      finally { captureDrafts.announceSessionChange(); }
      if (!signal.aborted && generation === sessionGeneration) { currentSession = value; observeAtlasActor(value); captureDrafts.observeCanonical(value); quantityChanged(); }
      return value;
    } } : {}),
  } } : {}),
  subscribe(changed: () => void) {
    events.addEventListener("changed", changed);
    return () => events.removeEventListener("changed", changed);
  },
};
// One owner survives StrictMode effect replay and HostApplication remounts.
// It grants one initial attempt through the canonical wrapped session port.
const initialHomeBootstrap = createInitialHomeBootstrap(sessions);
const editing = createEditingClient(schemas, () => currentSession);
const captureDrafts = createCaptureDraftAdapter({
  getSession: () => currentSession, getGeneration: () => sessionGeneration,
  getReadScope: () => currentQuantityScope,
  readSession: signal => nativeSessions.session(signal), editing, schemas,
  recheckSession: notifySessionChanged,
  foreground: () => document.visibilityState === "visible" && document.hasFocus(),
});
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
// Edits wait in the device's outbox while the server is out of reach and go
// out for the signed-in person and home they were made for. Each kind says
// how to show the record as it is now and how to prepare the edit again when
// the person keeps their version after a conflict.
function configureOutbox(): void {
  outbox.configure(currentSession && currentQuantityScope ? { actorId: currentSession.actorId, csrfToken: currentSession.csrfToken,
    workspaceId: currentQuantityScope.workspaceId, homeId: currentQuantityScope.homeId } : null);
}
// A source whose link was moved to another place meanwhile does not carry
// the queued edit along: that place is edited on its own.
const placeAdmission = async (entry: OutboxEntry, signal: AbortSignal) => {
  const admission = await editing.loadPlace(JSON.parse(entry.intent.source!), signal);
  if (!admission?.canReplaceClassification) throw new Error("This place can no longer be edited");
  if (admission.record.recordId !== entry.target.recordId) throw new Error("This now points to a different place; edit that place on its own");
  return admission;
};
outbox.register(PLACE_CLASSIFICATION, {
  current: async (entry, signal) => kindLabel((await placeAdmission(entry, signal)).record.payload.semanticKind),
  async rebase(entry, signal) {
    const request = classificationRequest(await placeAdmission(entry, signal),
      entry.intent.semanticKind as Parameters<typeof classificationRequest>[1], entry.intent.reason!);
    return { requestId: request.requestId, body: JSON.stringify(request), label: entry.label };
  },
});
const nameAdmission = (recordId: string, signal: AbortSignal) => {
  const binding = nativePlaces.getBinding();
  if (!binding) throw new Error("Atlas places are unavailable");
  return nativePlaces.load(binding, recordId, signal);
};
outbox.register(PLACE_NAME, {
  current: async (entry, signal) => (await nameAdmission(entry.intent.recordId!, signal)).record.payload.label ?? "No name",
  async rebase(entry, signal) {
    const prepared = nativePlaces.prepareRename(await nameAdmission(entry.intent.recordId!, signal),
      { label: entry.intent.label || null, statement: entry.intent.statement!, reason: entry.intent.reason! });
    return { requestId: prepared.requestId, body: prepared.body, label: entry.label };
  },
});
// Saved originals share the current canonical owner and completed view scope.
const nativeEvidenceDocuments = createNativeEvidenceDocumentClient({
  origin: window.location.origin,
  getBinding: () => currentSession && currentQuantityScope
    ? { sessionIdentity: currentSession, expiresAt: currentSession.expiresAt, scope: currentQuantityScope } : null,
  subscribeBinding: changed => {
    quantityEvents.addEventListener("changed", changed);
    return () => quantityEvents.removeEventListener("changed", changed);
  },
});
// Each reader keeps its own retained-document lease, so opening a second
// original cannot withdraw the first.
const makeSceneDocumentOwner = () => createNativeEvidenceDocumentClient({
  origin: window.location.origin,
  getBinding: () => currentSession && currentQuantityScope
    ? { sessionIdentity: currentSession, expiresAt: currentSession.expiresAt, scope: currentQuantityScope } : null,
  subscribeBinding: changed => {
    quantityEvents.addEventListener("changed", changed);
    return () => quantityEvents.removeEventListener("changed", changed);
  },
});
// Electrical Library discovery uses existing current read authority and separate
// original-document leases. Neither geometry nor a Document v2 facet admits it.
const sourceElectricalLibrary: ElectricalLibraryPort = {
  async createReader() {
    const { createNativeElectricalLibraryReader } = await import("./native-electrical-library-reader");
    return createNativeElectricalLibraryReader({
      getContext: () => currentSession && currentReadyView && currentQuantityScope
        && currentReadyView.scope === currentQuantityScope
        ? { sessionIdentity: currentSession, session: currentSession, view: currentReadyView, admission: currentStockAdmission } : null,
      subscribeContext: changed => {
        quantityEvents.addEventListener("changed", changed);
        return () => quantityEvents.removeEventListener("changed", changed);
      },
      createDocuments: makeSceneDocumentOwner,
    });
  },
};
// Every native read and write shares the actual canonical owner, the completed
// view allocation and these synchronous host change notifications.
const subscribeNativeGeometry = (changed: () => void) => {
  quantityEvents.addEventListener("changed", changed);
  return () => quantityEvents.removeEventListener("changed", changed);
};
// Native v2 Documents require the current completed view's exact service facet.
const sourceDocuments = createSourceDocumentsService({
  state: () => ({ session: currentSession, scope: currentQuantityScope, view: currentReadyView }),
  origin: window.location.origin,
  loadReader: () => import("./native-source-document-reader"),
});
const houseAcquisition = createOfflineHouseAcquisition({
  state: () => ({ session: currentSession, scope: currentQuantityScope, view: currentReadyView }),
  origin: window.location.origin,
});
// The selected house model publication. Saved reads require the current
// authenticated service facet and pins.
let overviewSelection: ModelOverviewSelection | null = null;
let overviewSession: AtlasSessionInfo | null = null;
let overviewScope: Scope | null = null;
function currentOverview(): ModelOverviewSelection | null {
  const service = currentReadyView?.modelOverviewService;
  if (!currentSession || !currentQuantityScope || currentReadyView?.scope !== currentQuantityScope || !service
    || !Number.isFinite(Date.parse(currentSession.expiresAt)) || Date.parse(currentSession.expiresAt) <= Date.now()) {
    overviewSelection = null; overviewSession = null; overviewScope = null; return null;
  }
  if (overviewSession !== currentSession || overviewScope !== currentQuantityScope || !overviewSelection
    || overviewSelection.scope.workspaceId !== currentQuantityScope.workspaceId || overviewSelection.scope.homeId !== currentQuantityScope.homeId
    || overviewSelection.expiresAt !== currentSession.expiresAt
    || overviewSelection.publicationId !== service.publicationId || overviewSelection.manifestSha256 !== service.manifestSha256) {
    overviewSession = currentSession;
    overviewScope = currentQuantityScope;
    overviewSelection = Object.freeze({ owner: Object.freeze({}), scope: Object.freeze({ ...currentQuantityScope }), expiresAt: currentSession.expiresAt,
      publicationId: service.publicationId, manifestSha256: service.manifestSha256 });
  }
  return overviewSelection;
}
function subscribeOverview(changed: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observe = () => {
    if (timer !== undefined) clearTimeout(timer);
    const selected = currentOverview();
    if (selected) timer = setTimeout(observe, Math.min(2_147_483_647, Math.max(1, Date.parse(selected.expiresAt) - Date.now() + 1)));
    changed();
  };
  const unsubscribe = subscribeNativeGeometry(observe);
  // Schedule expiry without synthesizing an owner change on subscribe.
  const selected = currentOverview();
  if (selected) timer = setTimeout(observe, Math.min(2_147_483_647, Math.max(1, Date.parse(selected.expiresAt) - Date.now() + 1)));
  return () => { unsubscribe(); if (timer !== undefined) clearTimeout(timer); };
}
/** The persistent Atlas cache for the authenticated actor and the selection's home, or null. */
let atlasCacheOwner: { readonly key: string; readonly cache: Promise<UnifiedAtlasCache | null> } | null = null;
function atlasCache(selection: ModelOverviewSelection): Promise<UnifiedAtlasCache | null> {
  const session = currentSession;
  if (!session?.actorId || currentOverview() !== selection) return Promise.resolve(null);
  const owner = { actorId: session.actorId, workspaceId: selection.scope.workspaceId, homeId: selection.scope.homeId };
  const key = JSON.stringify(owner);
  if (atlasCacheOwner?.key !== key) atlasCacheOwner = { key, cache: Promise.all([import('./unified-atlas-cache'), getAtlasStore(), atlasActor])
    .then(([module, store, actor]) => module.createUnifiedAtlasCache(store, owner, actor), () => null) };
  return atlasCacheOwner.cache;
}
const sourceModels: SourceModelPort = {
  // The unified Atlas reads the same selected publication's opt-in scene and
  // pinned model bytes; the same owner, session and expiry fence every step.
  atlas: {
    current: currentOverview, subscribe: subscribeOverview,
    async createOverlays(selection, scene, building, signal) {
      const session = currentSession, scope = currentQuantityScope, view = currentReadyView, admission = currentStockAdmission;
      if (!session || !scope || !view || view.scope !== scope) return null;
      const current = () => !signal.aborted && currentOverview() === selection && currentSession === session
        && currentQuantityScope === scope && currentReadyView === view && currentStockAdmission === admission && view.scope === scope;
      if (!current() || building.nativePlaceId === null) return null;
      const { createUnifiedAtlasReviewedOverlays } = await import('./unified-atlas-room-links-host');
      if (!current()) return null;
      return createUnifiedAtlasReviewedOverlays({ selection, scene, building, signal,
        native: Object.freeze({ sessionIdentity: session, session, view, admission }),
        origin: window.location.origin, isCurrent: current, subscribe: subscribeOverview, createDocuments: makeSceneDocumentOwner });
    },
    // Overlay records last projected on this device for the same scene; the
    // Atlas shows them only where no current frame is held.
    async storedOverlays(selection, scene, selectable, signal) {
      const [cache, codec] = await Promise.all([atlasCache(selection), import('../src/lantern/unified-atlas/stored-overlays')]);
      signal.throwIfAborted();
      if (!cache || currentOverview() !== selection || scene.scope.homeId !== selection.scope.homeId) return null;
      const bytes = await cache.overlays(scene.publication.publicationId, scene.selection.revision, scene.publication.semanticsSha256);
      signal.throwIfAborted();
      return bytes && currentOverview() === selection ? codec.decodeStoredOverlays(bytes, scene, selectable) : null;
    },
    keepOverlays(selection, scene, overlays) {
      void Promise.all([atlasCache(selection), import('../src/lantern/unified-atlas/stored-overlays')]).then(([cache, codec]) => {
        if (!cache || currentOverview() !== selection || scene.scope.homeId !== selection.scope.homeId) return;
        cache.keepOverlays(scene.publication.publicationId, scene.selection.revision, scene.publication.semanticsSha256, codec.encodeStoredOverlays(scene, overlays));
      }, () => undefined);
    },
    async read(selection, signal) {
      const controller = new AbortController();
      const unsubscribe = subscribeOverview(() => { if (currentOverview() !== selection) controller.abort(); });
      try {
        // The cache opens beside the scene GET; slow or unavailable storage never delays it.
        const reader = await import('./unified-atlas-reader');
        return await reader.readUnifiedAtlas({ selection, signal: AbortSignal.any([signal, controller.signal]),
          origin: window.location.origin, isCurrent: () => currentOverview() === selection, cache: atlasCache(selection) });
      } finally { unsubscribe(); }
    },
    async readDetail(selection, scene, signal) {
      const controller = new AbortController();
      const unsubscribe = subscribeOverview(() => { if (currentOverview() !== selection) controller.abort(); });
      try {
        const reader = await import('./unified-atlas-reader');
        return await reader.readUnifiedAtlasDetail({ selection, scene, signal: AbortSignal.any([signal, controller.signal]),
          origin: window.location.origin, isCurrent: () => currentOverview() === selection });
      } finally { unsubscribe(); }
    },
    async stored(selection, signal) {
      const reader = await import('./unified-atlas-reader');
      // The fresh read waits on this display-only path, so storage that is slow to open is skipped.
      const cache = await Promise.race([atlasCache(selection),
        new Promise<null>(resolve => setTimeout(resolve, reader.CACHE_LOOKUP_MS, null))]);
      signal.throwIfAborted();
      return cache && currentOverview() === selection ? reader.readCachedUnifiedAtlas({ selection, signal, cache }) : null;
    },
  },
};
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
  useEffect(() => captureDrafts.connect(window, document), []);
  const [admission, setAdmission] = useState<StockAdmission | null>(null);
  const client = useMemo<AtlasClient>(() => {
    let generation = 0;
    const load = async (operation: (signal: AbortSignal) => Promise<AtlasView>, signal: AbortSignal) => {
      const attempt = ++generation;
      const originalSession = currentSession;
      const originalSessionGeneration = sessionGeneration;
      const sameSession = () => originalSession !== null && currentSession === originalSession
        && sessionGeneration === originalSessionGeneration;
      captureDrafts.setScope(null);
      currentQuantityAdmission = null;
      currentQuantityScope = null;
    currentReadyView = null;
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
      if (!signal.aborted && attempt === generation && sameSession()) {
        currentReadyView = view.status === "ready" ? view : null; quantityChanged();
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
  return <div className="lantern-integration"><AccountObservationProvider client={account}><SessionApp initialHomeBootstrap={initialHomeBootstrap} onScopeCommit={captureDrafts.setScope} localCaptures={captureDrafts.port} renderContent={(view, content, actions) => <CaptureDraftProvider port={captureDrafts.port}>{view.status === "ready" ? <LanternHost view={view} actions={{ ...actions, quantity }} nativeContent={content} pinnedFiles={pinnedFiles} networkRelations={networkRelations} topology={topology} nativePlaces={nativePlaces} nativeEvidenceDocuments={nativeEvidenceDocuments} sourceModels={sourceModels} sourceDocuments={sourceDocuments.current()} sourceElectricalLibrary={sourceElectricalLibrary} houseAcquisition={houseAcquisition.port} {...(modelContext ? { quantityWebMcp: { admission: quantityAdmissionPort, modelContext } } : {})} /> : content}</CaptureDraftProvider>} client={client} sessions={sessions} accessEvents={window} editing={editing} stock={{ schemas, service, admission, downloads }} {...(ai ? { ai } : {})} /></AccountObservationProvider></div>;
}
createRoot(root).render(<StrictMode><HostApplication /></StrictMode>);
