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
import { createTopologyClient } from "../src/api/topology-client";
import { createNetworkRelationsClient } from "../src/api/network-relations-client";
import { createNativeGeometryReadClient, signOutWithScanCleanup } from "./native-geometry-read-client";
import type { NativeGeometryScanCache } from "./native-geometry-scan-cache";
import type { UnifiedAtlasCache } from "./unified-atlas-cache";
import { createNativeEvidenceDocumentClient } from "./native-evidence-document-client";
import { createNativeSceneAssociationClient } from "./native-scene-association-client";
import { createNativeSceneSourceClient } from "./native-scene-source-client";
import type { NativeSceneSourceSelection } from "../src/lantern/scans/native-scene-source-types";
import type { NativeSceneHost } from "../src/lantern/scans/native-ui/native-scene-host";
import { createSourceDocumentsService } from "./source-documents-service";
import { createOfflineHouseAcquisition } from "./offline-house-acquisition";
import type { SourceModelPort } from "../src/lantern/source-ports";
import type { ModelOverviewSelection } from "../src/lantern/source-models/overview-types";
import { createNativeGeometryWriteClient } from "./native-geometry-write-client";
import { createNativeGeometryAssociationClient } from "./native-geometry-association-client";
import type { NativeAssociationPending, NativeAssociationPrepared } from "../src/lantern/scans/native-association-types";
import type { NativeGeometryIntakeAssociation } from "../src/lantern/scans/native-ui/NativeGeometryIntake";
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
let currentSceneSelection: NativeSceneSourceSelection | null = null;
const sceneEvents = new EventTarget();
/** Read-only tool admission for the current scope; cleared with every scope clear. */
let currentQuantityAdmission: QuantityToolAdmission | null = null;
const quantityEvents = new EventTarget();
const quantityChanged = () => { sourceDocuments.refresh(); houseAcquisition.refresh(); currentSceneSelection = null; sceneEvents.dispatchEvent(new Event("changed")); quantityEvents.dispatchEvent(new Event("changed")); };
// Native browser support only; undefined sends no admission request and registers nothing.
const modelContext = detectModelContext(document);
let sessionGeneration = 0;
// Verified scan derivative bytes only, opened on first scan read; sign-out
// deletes them. Unavailable storage reads from the server as before.
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
    if (!signal.aborted && generation === sessionGeneration) { currentSession = value; captureDrafts.observeCanonical(value); quantityChanged(); }
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
    if (!signal.aborted && generation === sessionGeneration) { currentSession = value; captureDrafts.observeCanonical(value); quantityChanged(); }
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
    await signOutWithScanCleanup(() => nativeSignOut(signal), async () => {
      atlasCacheOwner = null;
      await Promise.all([getScanCache().then(cache => cache.clear()).catch(() => undefined),
        getAtlasStore().then(store => store.clear()).catch(() => undefined)]);
      captureDrafts.announceSessionChange();
    });
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
      if (!signal.aborted && generation === sessionGeneration) { currentSession = value; captureDrafts.observeCanonical(value); quantityChanged(); }
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
      if (!signal.aborted && generation === sessionGeneration) { currentSession = value; captureDrafts.observeCanonical(value); quantityChanged(); }
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
// Native geometry gets the original canonical session allocation and the
// completed authorized view scope. Every replacement/gap invalidates its reads.
// Verified mesh bytes are reused only for an identical derivative offered by a
// freshly read descriptor: from page memory for the same session object and
// home (a home-view reload keeps them; a session check, sign-out, expiry or
// other home does not), and from the scan cache for the same authenticated
// actor and home across page loads.
const nativeGeometry = createNativeGeometryReadClient({
  origin: window.location.origin,
  getBinding: () => currentSession && currentQuantityScope
    ? { sessionIdentity: currentSession, actorId: currentSession.actorId, expiresAt: currentSession.expiresAt, scope: currentQuantityScope } : null,
  subscribeBinding: changed => {
    quantityEvents.addEventListener("changed", changed);
    return () => quantityEvents.removeEventListener("changed", changed);
  },
  retainMeshes: { sessionPresent: () => currentSession !== null, persist: getScanCache },
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
// Review and scene reads each keep their own retained-document lease. Opening a
// second original cannot withdraw the first original or the displayed scene.
const makeSceneDocumentOwner = () => createNativeEvidenceDocumentClient({
  origin: window.location.origin,
  getBinding: () => currentSession && currentQuantityScope
    ? { sessionIdentity: currentSession, expiresAt: currentSession.expiresAt, scope: currentQuantityScope } : null,
  subscribeBinding: changed => {
    quantityEvents.addEventListener("changed", changed);
    return () => quantityEvents.removeEventListener("changed", changed);
  },
});
const scenePrimaryReview = makeSceneDocumentOwner(), sceneHistoricalReview = makeSceneDocumentOwner();
const sceneReadDocuments = makeSceneDocumentOwner(), sceneDrawings = makeSceneDocumentOwner();
const sceneAssociations = createNativeSceneAssociationClient({
  getContext: () => currentSession && currentReadyView && currentQuantityScope
    && currentReadyView.scope === currentQuantityScope
    ? { sessionIdentity: currentSession, session: currentSession, view: currentReadyView, admission: currentStockAdmission } : null,
  subscribe: changed => {
    quantityEvents.addEventListener("changed", changed);
    return () => quantityEvents.removeEventListener("changed", changed);
  },
  primaryReview: scenePrimaryReview, historicalReview: sceneHistoricalReview, createDrawingReview: makeSceneDocumentOwner,
  geometryCurrent: frame => nativeGeometry.isCurrent(frame),
});
const sceneSources = createNativeSceneSourceClient({
  documents: sceneReadDocuments, geometry: nativeGeometry, createDrawingReview: makeSceneDocumentOwner,
  getSelection: () => currentSceneSelection,
  subscribeSelection: changed => {
    sceneEvents.addEventListener("changed", changed);
    return () => sceneEvents.removeEventListener("changed", changed);
  },
});
const nativeScene: NativeSceneHost = {
  associations: sceneAssociations, sources: sceneSources, drawings: sceneDrawings,
  select(selection) {
    if (!currentSession || !currentReadyView || currentReadyView.scope !== currentQuantityScope
      || selection.sessionIdentity !== currentSession || selection.workspaceId !== currentReadyView.scope.workspaceId
      || selection.homeId !== currentReadyView.scope.homeId || selection.expiresAt !== currentSession.expiresAt
      || Date.parse(selection.expiresAt) <= Date.now()) return false;
    currentSceneSelection = selection; sceneEvents.dispatchEvent(new Event("changed")); return true;
  },
  clear(selection) { if (currentSceneSelection === selection) {
    currentSceneSelection = null; sceneEvents.dispatchEvent(new Event("changed"));
  } },
};
// Custody and association share the read client's actual canonical owner,
// completed view allocation and synchronous host change notifications. The
// published command catalog is admission, never a label-edit capability.
const nativeGeometryContext = () => currentSession && currentQuantityScope && currentStockAdmission
  ? { sessionIdentity: currentSession, session: currentSession, scope: currentQuantityScope, admission: currentStockAdmission } : null;
const subscribeNativeGeometry = (changed: () => void) => {
  quantityEvents.addEventListener("changed", changed);
  return () => quantityEvents.removeEventListener("changed", changed);
};
const nativeGeometryWrite = createNativeGeometryWriteClient({
  getContext: nativeGeometryContext, subscribe: subscribeNativeGeometry,
});
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
// Local files and the optional selected provisional overview have separate
// owners. Saved reads require the current authenticated service facet and pins.
// No electrical bridge or target provider is connected here.
let modelReviewOwner: { readonly session: AtlasSessionInfo; readonly scope: Scope; readonly token: object } | null = null;
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
  if (atlasCacheOwner?.key !== key) atlasCacheOwner = { key, cache: Promise.all([import('./unified-atlas-cache'), getAtlasStore()])
    .then(([module, store]) => module.createUnifiedAtlasCache(store, owner), () => null) };
  return atlasCacheOwner.cache;
}
const sourceModels: SourceModelPort = {
  localFiles: "browser-only",
  overview: {
    current: currentOverview, subscribe: subscribeOverview,
    async read(selection, signal) {
      const controller = new AbortController();
      const unsubscribe = subscribeOverview(() => { if (currentOverview() !== selection) controller.abort(); });
      try {
        const reader = await import('./model-overview-reader');
        return await reader.readModelOverview({ selection, signal: AbortSignal.any([signal, controller.signal]),
          origin: window.location.origin, isCurrent: () => currentOverview() === selection });
      } finally { unsubscribe(); }
    },
  },
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
    async stored(selection, signal) {
      const reader = await import('./unified-atlas-reader');
      // The fresh read waits on this display-only path, so storage that is slow to open is skipped.
      const cache = await Promise.race([atlasCache(selection),
        new Promise<null>(resolve => setTimeout(resolve, reader.CACHE_LOOKUP_MS, null))]);
      signal.throwIfAborted();
      return cache && currentOverview() === selection ? reader.readCachedUnifiedAtlas({ selection, signal, cache }) : null;
    },
  },
  session: {
    current() {
      if (!currentSession || !currentQuantityScope) return null;
      if (modelReviewOwner?.session !== currentSession || modelReviewOwner.scope !== currentQuantityScope)
        modelReviewOwner = { session: currentSession, scope: currentQuantityScope, token: Object.freeze({}) };
      return modelReviewOwner.token;
    },
    subscribe: subscribeNativeGeometry,
  },
};
const geometryAssociationCommands = ['atlas.identity.get', 'atlas.location-semantics.get', 'atlas.evidence.get', 'atlas.asset.get',
  'atlas.batch.execute', 'atlas.evidence.create', 'atlas.geometry.create', 'atlas.identity.replace'] as const;
const nativeGeometryAssociationOwner = createNativeGeometryAssociationClient({
  getContext: () => {
    const context = nativeGeometryContext();
    return context && geometryAssociationCommands.every(command => context.admission.commandIds.includes(command)) ? context : null;
  },
  subscribe: subscribeNativeGeometry,
});
// Confirmations stay observable across command-catalog gaps. A missing or
// uncorrelated result never proves that a batch was not dispatched/committed.
// Retention has no admission role: every new call still uses the strict owner.
type AssociationRetentionOwner = {
  readonly identity: object; readonly session: AtlasSessionInfo; readonly actor: string;
  readonly csrf: string; readonly expiry: string; readonly workspace: string; readonly home: string;
};
const associationConfirmations = new Map<NativeAssociationPrepared, {
  readonly owner: AssociationRetentionOwner; readonly row: NativeAssociationPending;
}>();
const associationIntents = new WeakSet<NativeAssociationPrepared>();
const associationRetentionListeners = new Set<() => void>();
const notifyAssociationRetention = () => { for (const listener of associationRetentionListeners) queueMicrotask(listener); };
let associationRetentionOwner: AssociationRetentionOwner | null = null;
const sameAssociationOwner = (owner: AssociationRetentionOwner, session: AtlasSessionInfo, scope: Scope) =>
  owner.session === session && owner.actor === session.actorId && owner.csrf === session.csrfToken
  && owner.expiry === session.expiresAt && owner.workspace === scope.workspaceId && owner.home === scope.homeId;
const getAssociationRetentionOwner = (scope: Scope): AssociationRetentionOwner | null => {
  const session = currentSession, actualScope = currentQuantityScope;
  if (!session || !actualScope || session.schemaVersion !== 1 || !session.actorId || !session.csrfToken
    || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()
    || actualScope.workspaceId !== scope.workspaceId || actualScope.homeId !== scope.homeId) return null;
  if (!associationRetentionOwner || !sameAssociationOwner(associationRetentionOwner, session, scope)) {
    // Restore the same canonical session/home's hold after a view/scope gap.
    const retained = [...associationConfirmations.values()].find(entry => sameAssociationOwner(entry.owner, session, scope));
    associationRetentionOwner = retained?.owner ?? { identity: Object.freeze({}), session, actor: session.actorId,
      csrf: session.csrfToken, expiry: session.expiresAt, workspace: scope.workspaceId, home: scope.homeId };
  }
  return associationRetentionOwner;
};
const retainedAssociations = (owner: AssociationRetentionOwner) =>
  [...associationConfirmations.values()].filter(entry => entry.owner === owner).map(entry => entry.row);
const nativeGeometryAssociation: NativeGeometryIntakeAssociation = {
  ...nativeGeometryAssociationOwner,
  getRetention(scope) {
    const owner = getAssociationRetentionOwner(scope);
    return owner ? Object.freeze({ owner: owner.identity, rows: Object.freeze(retainedAssociations(owner)) }) : null;
  },
  subscribePending(changed) {
    associationRetentionListeners.add(changed);
    const stop = nativeGeometryAssociationOwner.subscribePending(changed);
    return () => { associationRetentionListeners.delete(changed); stop(); };
  },
  prepare(admission, input) {
    const owner = getAssociationRetentionOwner(admission.binding.scope);
    if (!owner || associationConfirmations.size >= 16 || retainedAssociations(owner).some(row => row.outcome === 'unknown'))
      throw new TypeError('Building association preparation is unavailable');
    const prepared = nativeGeometryAssociationOwner.prepare(admission, input);
    associationIntents.add(prepared);
    return prepared;
  },
  async commit(prepared, signal) {
    signal.throwIfAborted();
    const owner = getAssociationRetentionOwner(prepared.binding.scope);
    if (!owner || nativeGeometryAssociationOwner.getBinding() !== prepared.binding || !associationIntents.has(prepared)
      || associationConfirmations.has(prepared) || associationConfirmations.size >= 16
      || retainedAssociations(owner).some(row => row.outcome === 'unknown'))
      throw new TypeError('Building association confirmation is unavailable');
    // Record the deliberate confirmation before invoking any owner/transport
    // callback. Reentrant admission loss cannot mask the unresolved hold.
    associationConfirmations.set(prepared, { owner, row: Object.freeze({ prepared, outcome: 'unknown' }) });
    notifyAssociationRetention();
    const receipt = await nativeGeometryAssociationOwner.commit(prepared, signal);
    associationConfirmations.set(prepared, { owner, row: Object.freeze({ prepared, outcome: 'committed', receipt }) });
    notifyAssociationRetention();
    return receipt;
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
  return <div className="lantern-integration"><AccountObservationProvider client={account}><SessionApp initialHomeBootstrap={initialHomeBootstrap} onScopeCommit={captureDrafts.setScope} localCaptures={captureDrafts.port} renderContent={(view, content, actions) => <CaptureDraftProvider port={captureDrafts.port}>{view.status === "ready" ? <LanternHost view={view} actions={{ ...actions, quantity }} nativeContent={content} pinnedFiles={pinnedFiles} networkRelations={networkRelations} topology={topology} nativePlaces={nativePlaces} nativeGeometry={nativeGeometry} nativeGeometryWrite={nativeGeometryWrite} nativeGeometryAssociation={nativeGeometryAssociation} nativeEvidenceDocuments={nativeEvidenceDocuments} nativeScene={nativeScene} sourceModels={sourceModels} sourceDocuments={sourceDocuments.current()} houseAcquisition={houseAcquisition.port} {...(modelContext ? { quantityWebMcp: { admission: quantityAdmissionPort, modelContext } } : {})} /> : content}</CaptureDraftProvider>} client={client} sessions={sessions} accessEvents={window} editing={editing} stock={{ schemas, service, admission, downloads }} {...(ai ? { ai } : {})} /></AccountObservationProvider></div>;
}
createRoot(root).render(<StrictMode><HostApplication /></StrictMode>);
