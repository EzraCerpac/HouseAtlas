import type { Scope, SourceRef } from '../src/api/generated/contracts.ts';
import type { AtlasSessionInfo } from '../src/app/session.ts';
import type { AtlasEditingClient } from '../src/app/editing.ts';
import type { StockSchemaPort } from '../src/webmcp/stock.ts';
import { createCaptureDrafts } from '../src/capture-drafts/controller.ts';
import { openDraftStore } from '../src/capture-drafts/indexeddb.ts';
import type { DraftBoundary, DraftHost, DraftStore } from '../src/capture-drafts/types.ts';
import { sameTarget, type CaptureDraftPort } from '../src/capture-drafts-ui/port.ts';

interface Options {
  getSession(): AtlasSessionInfo | null;
  getGeneration(): number;
  getReadScope(): Scope | null;
  readSession(signal: AbortSignal): Promise<AtlasSessionInfo | null>;
  editing: AtlasEditingClient;
  schemas: StockSchemaPort;
  recheckSession(): void;
  foreground(): boolean;
  openStore?: () => DraftStore;
}
const sameScope = (a: Scope | null, b: Scope | null) => !!a && !!b
  && a.workspaceId === b.workspaceId && a.homeId === b.homeId;
const sameSession = (a: AtlasSessionInfo, b: AtlasSessionInfo) => a.actorId === b.actorId
  && a.csrfToken === b.csrfToken && a.expiresAt === b.expiresAt;
const validSession = (s: AtlasSessionInfo | null): s is AtlasSessionInfo => !!s && s.schemaVersion === 1
  && !!s.actorId && !!s.csrfToken && Number.isFinite(Date.parse(s.expiresAt)) && Date.parse(s.expiresAt) > Date.now();

/** Native profile only: canonical GET's private CSRF marker is stable for the
 * exact HttpOnly cookie. Login receipts do not seed this continuity tuple.
 * No constructor IO; storage opens only for an explicit local-draft action. */
export function createCaptureDraftAdapter(options: Options) {
  let scope: Scope | null = null;
  let canonical: AtlasSessionInfo | null = null;
  let sessionObject: AtlasSessionInfo | null = null;
  let rootGeneration = -1;
  let epoch: object | null = null;
  let generation = 0, pending = false, quarantined = false;
  let controller: ReturnType<typeof createCaptureDrafts> | null = null;
  const operations = new Set<AbortController>();
  const verifiedReceipts = new WeakSet<object>();
  const listeners = new Set<(reason: 'boundary' | 'review') => void>();
  let channel: BroadcastChannel | null = null;
  let coordinationUnavailable = false;

  function invalidate(reason: 'boundary' | 'review' = 'review'): void {
    generation++; pending = false;
    controller?.invalidate();
    for (const operation of operations) operation.abort();
    operations.clear();
    for (const listener of listeners) listener(reason);
  }
  function invalidateSession(): void {
    canonical = sessionObject = null; epoch = null; scope = null; pending = false; quarantined = true;
    invalidate('boundary');
  }
  function current(): DraftBoundary | null {
    if (coordinationUnavailable || pending || quarantined || !validSession(canonical) || !epoch || !scope || !options.foreground()
      || options.getSession() !== sessionObject || options.getGeneration() !== rootGeneration
      || !sameScope(scope, options.getReadScope())) return null;
    return Object.freeze({ actorId: canonical.actorId, workspaceId: scope.workspaceId, homeId: scope.homeId, sessionEpoch: epoch });
  }
  async function refreshBoundary(signal: AbortSignal): Promise<DraftBoundary | null> {
    signal.throwIfAborted();
    if (coordinationUnavailable) throw new Error('Cross-tab session coordination is unavailable');
    if (pending) throw new Error('A canonical session check is already pending');
    const capturedScope = scope, original = options.getSession(), root = options.getGeneration(), attempt = generation;
    if (!capturedScope || !validSession(original) || !sameScope(capturedScope, options.getReadScope()) || !options.foreground())
      throw new Error('Select an authorized home in the foreground');
    // Mask only this feature. Its own canonical GET must not invalidate its
    // review or alter existing quantity/pinned/currentSession object bindings.
    pending = true;
    try {
      const fresh = await options.readSession(signal);
      signal.throwIfAborted();
      if (attempt !== generation || options.getGeneration() !== root || options.getSession() !== original
        || !sameScope(scope, capturedScope) || !sameScope(capturedScope, options.getReadScope()) || !options.foreground())
        throw new Error('The current capture context changed');
      if (!validSession(fresh) || !sameSession(fresh, original)
        || (canonical && !sameSession(canonical, fresh))) {
        invalidateSession(); options.recheckSession();
        throw new Error('Check the current session and explicitly review the draft again');
      }
      // The marker stays private to this closure; the public epoch is unrelated.
      canonical = fresh; sessionObject = original; rootGeneration = root;
      epoch ??= Object.freeze({});
      pending = false; quarantined = false;
      return current();
    } catch (error) {
      // An unavailable transport masks this feature. Only a decoded different
      // native session above triggers the existing application session reload.
      if (attempt === generation) {
        // Keep the private comparison tuple/scope for an explicit foreground
        // recheck, but expose no boundary or surviving review while unavailable.
        quarantined = true; epoch = null; invalidate();
      }
      throw error;
    } finally {
      if (attempt === generation) pending = false;
    }
  }
  const host: DraftHost = {
    current, refreshBoundary, foreground: options.foreground,
    loadPlace: (source, signal) => options.editing.loadPlace(source, signal),
    validateAcknowledgement(result, intent) {
      options.schemas.validate('#/$defs/result_atlas_batch_execute', result);
      const value = result as Record<string, unknown>;
      const resolved = value['resolvedScope'] as Record<string, unknown>;
      if (value['status'] !== 'committed' || value['requestId'] !== intent.requestId || value['commandId'] !== 'atlas.batch.execute'
        || resolved['workspaceId'] !== intent.context.workspaceId || resolved['homeId'] !== intent.context.homeId)
        throw new TypeError('A committed correlated acknowledgement is required');
      verifiedReceipts.add(value);
    },
  };
  const drafts = () => controller ??= createCaptureDrafts((options.openStore ?? openDraftStore)(), host);
  const port: CaptureDraftPort = {
    current, prepare: refreshBoundary, invalidate: () => invalidate(),
    unavailableReason: () => coordinationUnavailable ? 'Local drafts are disabled because cross-tab session coordination is unavailable in this browser.' : null,
    operation() {
      const operation = new AbortController(); operations.add(operation);
      return { controller: operation, release: () => operations.delete(operation) };
    },
    subscribeInvalidation(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    save: input => drafts().save(input),
    list: () => drafts().list(),
    review: (id, signal) => drafts().review(id, signal),
    inspectUnknown: (id, signal) => drafts().inspectUnknown(id, signal),
    discard: (id, consent) => drafts().discard(id, consent),
    async clearBeforeSignOut() {
      const operation = port.operation();
      try {
        if (!(await refreshBoundary(operation.controller.signal))) throw new Error('Current boundary is unavailable');
        await drafts().clearAccount({ loseLocalCaptures: true });
      } finally { operation.release(); }
    },
    async submit(review, target: SourceRef, recordId, signal) {
      if (!sameTarget(review.targetSourceRef, target) || review.recordId !== recordId)
        throw new Error('This draft belongs to another Atlas place');
      const upload = options.editing.uploadPlaceEvidence;
      if (!upload) throw new Error('Evidence upload is unavailable');
      const submission = await drafts().beginAttempt(review.token, { confirmed: true }, signal);
      // No await, copy, retention, retry or alternative dispatch between these
      // two operations. The controller already persisted outcome-unknown.
      const result = await upload(submission.takeForForegroundSubmit(), signal);
      // The actual upload client already checks schema and request correlation.
      // Recheck the closed receipt before the UI can report a known commit.
      options.schemas.validate('#/$defs/result_atlas_batch_execute', result);
      const resolved = result['resolvedScope'] as Record<string, unknown>;
      if (result['commandId'] !== 'atlas.batch.execute' || resolved['workspaceId'] !== target.workspaceId || resolved['homeId'] !== target.homeId)
        throw new TypeError('Attachment completion scope differs');
      if (result['status'] !== 'committed') return { result, localCleanup: 'unconfirmed' };
      try { await drafts().acknowledge(submission, result); return { result, localCleanup: 'removed' }; }
      catch (error) {
        // Only a receipt whose private attempt correlation already passed can
        // be reported as saved when the subsequent local deletion fails.
        if (!verifiedReceipts.has(result)) throw error;
        return { result, localCleanup: 'unconfirmed' };
      }
    },
  };
  return {
    port,
    setScope(next: Scope | null) {
      if (sameScope(scope, next)) return;
      scope = next ? Object.freeze({ workspaceId: next.workspaceId, homeId: next.homeId }) : null;
      epoch = scope && canonical ? Object.freeze({}) : null;
      invalidate('boundary');
    },
    observeCanonical(value: AtlasSessionInfo | null) {
      canonical = validSession(value) ? value : null;
      sessionObject = options.getSession(); rootGeneration = options.getGeneration();
      epoch = canonical ? Object.freeze({}) : null; quarantined = !canonical;
    },
    invalidateSession,
    announceSessionChange() { invalidateSession(); channel?.postMessage({ version: 1, type: 'invalidate' }); },
    /** Mount-owned transient listeners. Messages are invalidation signals, never
     * authentication. No account, scope, credential or file appears in them. */
    connect(window: Window, document: Document) {
      try {
        if (typeof BroadcastChannel === 'undefined') throw new Error('Cross-tab coordination unavailable');
        channel = new BroadcastChannel('houseatlas-capture-session-v1'); coordinationUnavailable = false;
      } catch { coordinationUnavailable = true; invalidateSession(); }
      const receive = (event: MessageEvent<unknown>) => {
        const value = event.data;
        if (value && typeof value === 'object' && !Array.isArray(value)
          && Object.keys(value).length === 2 && 'version' in value && value.version === 1 && 'type' in value && value.type === 'invalidate') {
          invalidateSession(); options.recheckSession();
        }
      };
      channel?.addEventListener('message', receive);
      const leave = () => invalidate();
      const enter = () => {
        if (!scope || pending || !options.foreground()) return;
        const operation = port.operation();
        // Healthy foreground verification keeps the actual host session object,
        // admitted scope and candidate File. It never resumes or submits a draft.
        void refreshBoundary(operation.controller.signal).catch(() => undefined).finally(operation.release);
      };
      const visibility = () => document.visibilityState === 'visible' ? enter() : leave();
      const access = () => invalidateSession();
      window.addEventListener('blur', leave); window.addEventListener('pagehide', leave);
      window.addEventListener('focus', enter); window.addEventListener('pageshow', enter);
      window.addEventListener('atlas-access-invalidated', access);
      document.addEventListener('visibilitychange', visibility);
      return () => {
        invalidateSession();
        window.removeEventListener('blur', leave); window.removeEventListener('pagehide', leave);
        window.removeEventListener('focus', enter); window.removeEventListener('pageshow', enter);
        window.removeEventListener('atlas-access-invalidated', access);
        document.removeEventListener('visibilitychange', visibility);
        channel?.removeEventListener('message', receive); channel?.close(); channel = null;
        controller?.close(); controller = null;
      };
    },
  };
}
