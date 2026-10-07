import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canInfer } from './model.js';
import type {
  AiClient, AiSessionState, CancellationState, ConnectionAction, ConnectionActionState, RequestState, RunOutcome, UnresolvedConnectionAction,
} from './types.js';

interface Scope {
  readonly client: AiClient;
  /** Exact genuine host actor/session/workspace/home/registration/epoch key. */
  readonly key: string;
}

interface RetainedRequest {
  readonly requestId: string;
  cancellation: CancellationState;
}

// Correlation survives view disposal within this loaded browser module. Keep
// only bounded opaque IDs and cancellation metadata, never clients or payloads.
// Unknown work is not evicted to admit another submission.
const MAX_RETAINED_REQUESTS = 32;
const MAX_SCOPE_KEY_LENGTH = 4096;
const retainedRequests = new Map<string, RetainedRequest>();
// At most one currently mounted observer per retained request. Disposal removes
// its callback; request correlation itself never retains a disposed view/client.
const requestObservers = new Map<RetainedRequest, () => void>();

interface PendingRun {
  readonly scope: Scope;
  readonly requestId: string;
  readonly retained: RetainedRequest;
  controller: AbortController;
}

interface PendingConnectionAction extends UnresolvedConnectionAction {
  readonly scopeKey: string;
}

// Bounded correlation only: no client, command payload, snapshot or observer.
// Exact authenticated scope keys keep actions isolated across navigation.
const pendingConnectionActions = new Map<string, PendingConnectionAction>();
const MAX_RETAINED_CONNECTION_ACTIONS = 96;

interface ScopedState {
  readonly scope: Scope;
  readonly state: AiSessionState;
}

function initialState(): AiSessionState {
  return {
    connection: { status: 'loading' }, request: { status: 'idle' },
    connectionAction: { status: 'idle', action: null, actionId: null }, reviewAction: { status: 'idle' }, recoveryAction: { status: 'idle' },
  };
}

const MAX_UNRESOLVED_CONNECTION_ACTIONS = 3;

function retainedConnectionState(
  actions: Iterable<PendingConnectionAction>, scope: Scope, fallback: ConnectionActionState,
): ConnectionActionState {
  let latest: PendingConnectionAction | null = null;
  for (const action of actions) if (action.scopeKey === scope.key) latest = action;
  return latest === null ? fallback : { status: latest.status, action: latest.action, actionId: latest.actionId };
}

function retainRequest(scopeKey: string, requestId: string): RetainedRequest | null {
  if (scopeKey.length === 0 || scopeKey.length > MAX_SCOPE_KEY_LENGTH
    || retainedRequests.has(scopeKey) || retainedRequests.size >= MAX_RETAINED_REQUESTS) return null;
  const retained: RetainedRequest = { requestId, cancellation: { status: 'idle' } };
  retainedRequests.set(scopeKey, retained);
  return retained;
}

function cancellationRecorded(retained: RetainedRequest): boolean {
  return retained.cancellation.status === 'sending' || retained.cancellation.status === 'received';
}

async function cancelRetainedRequest(scope: Scope, retained: RetainedRequest): Promise<void> {
  const current = () => retainedRequests.get(scope.key) === retained;
  if (!current() || cancellationRecorded(retained)) return;
  const observe = (cancellation: CancellationState) => {
    if (!current()) return;
    retained.cancellation = cancellation;
    requestObservers.get(retained)?.();
  };
  observe({ status: 'sending' });
  try {
    const receipt = await scope.client.cancel(retained.requestId);
    if (receipt.requestId !== retained.requestId) throw new Error('Unexpected cancellation receipt');
    // Even a confirmed acknowledgement does not replace the canonical outcome
    // and its usage/domain evidence. Keep correlation for requestStatus.
    observe({ status: 'received', receipt: { requestId: receipt.requestId, status: receipt.status } });
  } catch {
    observe({ status: 'unavailable' });
  }
}

/** scopeKey comes from the genuine authenticated host and includes actor,
 * application session, workspace/home, registration and cancellation epoch.
 * Labels and client object identity cannot replace that complete key. */
export function useAiSession(client: AiClient, scopeKey: string) {
  const scope = useMemo<Scope>(() => ({ client, key: scopeKey }), [client, scopeKey]);
  const activeScope = useRef<Scope | null>(null);
  const connectionController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const reviewController = useRef<AbortController | null>(null);
  const recoveryController = useRef<AbortController | null>(null);
  const pendingRun = useRef<PendingRun | null>(null);
  const requestObserver = useRef<{ readonly retained: RetainedRequest; readonly changed: () => void } | null>(null);
  const [scopedState, setScopedState] = useState<ScopedState>(() => ({ scope, state: initialState() }));
  const state = scopedState.scope === scope ? scopedState.state : initialState();

  const update = useCallback((change: (previous: AiSessionState) => AiSessionState) => {
    if (activeScope.current !== scope) return;
    setScopedState(previous => ({ scope, state: change(previous.scope === scope ? previous.state : initialState()) }));
  }, [scope]);

  const unwatchRequest = useCallback(() => {
    const observer = requestObserver.current;
    if (observer && requestObservers.get(observer.retained) === observer.changed) requestObservers.delete(observer.retained);
    requestObserver.current = null;
  }, []);

  const watchRequest = useCallback((pending: PendingRun) => {
    unwatchRequest();
    const changed = () => {
      if (activeScope.current !== scope || pendingRun.current !== pending
        || retainedRequests.get(scope.key) !== pending.retained) return;
      update(previous => 'cancellation' in previous.request && previous.request.requestId === pending.requestId
        ? { ...previous, request: { ...previous.request, cancellation: pending.retained.cancellation } } : previous);
    };
    requestObservers.set(pending.retained, changed);
    requestObserver.current = { retained: pending.retained, changed };
  }, [scope, update, unwatchRequest]);

  const refresh = useCallback(async () => {
    if (activeScope.current !== scope || actionController.current !== null) return;
    connectionController.current?.abort();
    const controller = new AbortController();
    connectionController.current = controller;
    const current = () => connectionController.current === controller && !controller.signal.aborted
      && activeScope.current === scope;
    update(previous => ({ ...previous, connection: { status: 'loading' } }));
    try {
      try {
        const snapshot = await scope.client.connection(controller.signal);
        if (!current()) return;
        update(previous => ({ ...previous, connection: { status: 'available', snapshot } }));
      } catch {
        if (!current()) return;
        update(previous => ({ ...previous, connection: { status: 'unavailable' } }));
      }
      const retained = [...pendingConnectionActions.values()].filter(action => action.scopeKey === scope.key);
      for (const pending of retained) {
        if (!current()) return;
        try {
          const result = await scope.client.connectionActionStatus(pending.actionId, controller.signal);
          if (!current()) return;
          if (pendingConnectionActions.get(pending.actionId) !== pending) continue;
          if (result.actionId !== pending.actionId) throw new Error('Unexpected connection action status');
          if (result.status === 'completed') pendingConnectionActions.delete(pending.actionId);
          else pendingConnectionActions.set(pending.actionId, { ...pending, status: result.status });
          // Each workflow is correlated separately from current connection facts.
          update(previous => ({ ...previous, connectionAction: retainedConnectionState(
            pendingConnectionActions.values(), scope,
            result.status === 'completed'
              ? { status: 'idle', action: pending.action, actionId: pending.actionId }
              : previous.connectionAction,
          ) }));
        } catch {
          if (!current()) return;
          if (pendingConnectionActions.get(pending.actionId) !== pending) continue;
          pendingConnectionActions.set(pending.actionId, { ...pending, status: 'unconfirmed' });
          update(previous => ({ ...previous, connectionAction: retainedConnectionState(
            pendingConnectionActions.values(), scope, previous.connectionAction,
          ) }));
        }
      }
    } finally {
      if (connectionController.current === controller) connectionController.current = null;
    }
  }, [scope, update]);

  const acceptOutcome = useCallback((pending: PendingRun, outcome: RunOutcome) => {
    if (pendingRun.current !== pending || activeScope.current !== scope
      || retainedRequests.get(scope.key) !== pending.retained) return;
    recoveryController.current?.abort();
    recoveryController.current = null;
    if (outcome.status === 'completed' || outcome.status === 'cancelled' || outcome.status === 'failed'
      || outcome.status === 'domain-held') {
      // DomainHeld is a canonical terminal request result. Its domain operation
      // stays held and visible; it does not occupy the inference request slot.
      unwatchRequest();
      requestObservers.delete(pending.retained);
      retainedRequests.delete(scope.key);
      pendingRun.current = null;
    }
    update(previous => {
      const cancellation = pending.retained.cancellation;
      const request: RequestState = outcome.status === 'review-required'
        ? { status: 'awaiting-review', requestId: pending.requestId, outcome, cancellation }
        : outcome.status === 'domain-held'
          ? { status: 'domain-held', requestId: pending.requestId, outcome, cancellation }
          : outcome.status === 'stopped'
            ? { status: 'unconfirmed', requestId: pending.requestId, outcome, cancellation }
            : { status: 'finished', requestId: pending.requestId, outcome };
      return { ...previous, request, recoveryAction: { status: 'idle' } };
    });
  }, [scope, update, unwatchRequest]);

  const awaitOutcome = useCallback(async (pending: PendingRun, operation: (signal: AbortSignal) => Promise<RunOutcome>) => {
    const controller = pending.controller;
    try {
      const outcome = await operation(controller.signal);
      if (pendingRun.current !== pending || pending.controller !== controller || controller.signal.aborted) return;
      acceptOutcome(pending, outcome);
    } catch {
      if (pendingRun.current !== pending || pending.controller !== controller || controller.signal.aborted) return;
      // Keep correlation for authoritative recovery; never replay a lost request.
      update(previous => previous.request.status === 'domain-held' || previous.request.status === 'awaiting-review'
        || (previous.request.status === 'unconfirmed' && 'outcome' in previous.request)
        ? previous : { ...previous, request: {
          status: 'unconfirmed', requestId: pending.requestId, cancellation: pending.retained.cancellation,
        } });
    }
  }, [acceptOutcome, update]);

  const submit = useCallback(async (prompt: string) => {
    const text = prompt.trim();
    if (activeScope.current !== scope || pendingRun.current !== null || actionController.current !== null || text.length === 0
      || state.connection.status !== 'available' || !canInfer(state.connection.snapshot)) return;
    let requestId: string;
    try { requestId = globalThis.crypto.randomUUID(); }
    catch {
      update(previous => ({ ...previous, request: { status: 'start-unavailable' } }));
      return;
    }
    // Reserve correlation before any host submission; capacity never causes
    // an already submitted request to be forgotten or an old one to be evicted.
    const retained = retainRequest(scope.key, requestId);
    if (retained === null) {
      update(previous => ({ ...previous, request: { status: 'start-unavailable' } }));
      return;
    }
    const pending: PendingRun = { scope, requestId, retained, controller: new AbortController() };
    pendingRun.current = pending;
    watchRequest(pending);
    update(previous => ({ ...previous, request: { status: 'running', requestId, cancellation: { status: 'idle' } },
      reviewAction: { status: 'idle' }, recoveryAction: { status: 'idle' } }));
    await awaitOutcome(pending, signal => scope.client.run({ requestId, prompt: text }, signal));
  }, [scope, state.connection, awaitOutcome, update, watchRequest]);

  const cancel = useCallback(async () => {
    const pending = pendingRun.current;
    if (activeScope.current !== scope || pending?.scope !== scope || cancellationRecorded(pending.retained)) return;
    reviewController.current?.abort();
    reviewController.current = null;
    update(previous => ({ ...previous, reviewAction: { status: 'idle' } }));
    await cancelRetainedRequest(scope, pending.retained);
  }, [scope, update]);

  const connectionAction = useCallback(async (input: ConnectionAction) => {
    if (activeScope.current !== scope || actionController.current !== null
      || (pendingRun.current !== null && input.action !== 'manage-usage' && input.action !== 'disconnect')) return;
    const retained = [...pendingConnectionActions.values()].filter(action => action.scopeKey === scope.key);
    if (scope.key.length === 0 || scope.key.length > MAX_SCOPE_KEY_LENGTH
      || retained.length >= MAX_UNRESOLVED_CONNECTION_ACTIONS
      || pendingConnectionActions.size >= MAX_RETAINED_CONNECTION_ACTIONS) {
      // Keep every unresolved row; admission failure is visible separately
      // from their status and cannot submit or evict a workflow.
      update(previous => ({ ...previous,
        connection: input.action === 'disconnect' ? { status: 'unavailable' } : previous.connection,
        connectionAction: { status: 'unavailable', action: input.action, actionId: null } }));
      return;
    }
    if (retained.some(action => action.action === input.action)
      || ((input.action === 'connect' || input.action === 'consent') && retained.length > 0)) return;
    connectionController.current?.abort();
    if (input.action === 'disconnect') void cancel();
    let actionId: string;
    try {
      actionId = globalThis.crypto.randomUUID();
      if (pendingConnectionActions.has(actionId)) throw new Error('Duplicate connection action identifier');
    }
    catch {
      update(previous => ({ ...previous,
        connection: input.action === 'disconnect' ? { status: 'unavailable' } : previous.connection,
        connectionAction: retainedConnectionState(pendingConnectionActions.values(), scope,
          { status: 'unavailable', action: input.action, actionId: null }) }));
      return;
    }
    const controller = new AbortController();
    const pending: PendingConnectionAction = { scopeKey: scope.key, actionId, action: input.action, status: 'unconfirmed' };
    actionController.current = controller;
    // Retain every submitted workflow, including a lost response, until its own completion.
    pendingConnectionActions.set(actionId, pending);
    update(previous => ({ ...previous,
      connection: input.action === 'disconnect' ? { status: 'loading' } : previous.connection,
      connectionAction: { status: 'working', action: input.action, actionId } }));
    try {
      const result = await scope.client.connectionAction({ actionId, command: input }, controller.signal);
      if (actionController.current !== controller || controller.signal.aborted || activeScope.current !== scope
        || pendingConnectionActions.get(actionId) !== pending) return;
      if (result.actionId !== actionId) throw new Error('Unexpected connection action result');
      if (result.status === 'completed') pendingConnectionActions.delete(actionId);
      else pendingConnectionActions.set(actionId, { ...pending, status: result.status });
      update(previous => ({ ...previous, connection: { status: 'available', snapshot: result.snapshot },
        connectionAction: retainedConnectionState(pendingConnectionActions.values(), scope,
          { status: 'idle', action: input.action, actionId }) }));
    } catch {
      if (actionController.current !== controller || controller.signal.aborted || activeScope.current !== scope
        || pendingConnectionActions.get(actionId) !== pending) return;
      update(previous => ({ ...previous,
        connection: input.action === 'disconnect' ? { status: 'unavailable' } : previous.connection,
        connectionAction: retainedConnectionState(pendingConnectionActions.values(), scope,
          { status: 'unconfirmed', action: input.action, actionId }) }));
    } finally {
      if (actionController.current === controller) actionController.current = null;
    }
  }, [scope, cancel, update]);

  const review = useCallback(async () => {
    const pending = pendingRun.current;
    if (activeScope.current !== scope || pending?.scope !== scope || cancellationRecorded(pending.retained)
      || reviewController.current !== null || recoveryController.current !== null || state.request.status !== 'awaiting-review'
      || state.connection.status !== 'available' || !canInfer(state.connection.snapshot)) return;
    const input = { requestId: pending.requestId, continuationId: state.request.outcome.continuationId };
    const controller = new AbortController();
    reviewController.current = controller;
    update(previous => ({ ...previous, reviewAction: { status: 'working' } }));
    try {
      const result = await scope.client.openReview(input, controller.signal);
      if (reviewController.current !== controller || controller.signal.aborted || pendingRun.current !== pending) return;
      if (result.status !== 'ready-to-resume') {
        update(previous => ({ ...previous, reviewAction: { status: result.status === 'closed' ? 'idle' : 'pending' } }));
        return;
      }
      pending.controller.abort();
      pending.controller = new AbortController();
      update(previous => ({ ...previous, reviewAction: { status: 'idle' }, request: {
        status: 'running', requestId: pending.requestId, cancellation: pending.retained.cancellation,
      } }));
      // The server consumes its own retained receipt and validates current authority.
      await awaitOutcome(pending, signal => scope.client.resume(input, signal));
    } catch {
      if (reviewController.current !== controller || controller.signal.aborted || pendingRun.current !== pending) return;
      update(previous => ({ ...previous, reviewAction: { status: 'unavailable' } }));
    } finally {
      if (reviewController.current === controller) reviewController.current = null;
    }
  }, [scope, state.request, state.connection, awaitOutcome, update]);

  const recover = useCallback(async () => {
    const pending = pendingRun.current;
    if (activeScope.current !== scope || pending?.scope !== scope || retainedRequests.get(scope.key) !== pending.retained || recoveryController.current !== null
      || reviewController.current !== null) return;
    const controller = new AbortController();
    recoveryController.current = controller;
    update(previous => ({ ...previous, recoveryAction: { status: 'working' } }));
    try {
      const result = await scope.client.requestStatus(pending.requestId, controller.signal);
      if (recoveryController.current !== controller || controller.signal.aborted || pendingRun.current !== pending
        || activeScope.current !== scope || retainedRequests.get(scope.key) !== pending.retained) return;
      if (result.requestId !== pending.requestId) throw new Error('Unexpected request status');
      if (result.status === 'finished') {
        pending.controller.abort();
        acceptOutcome(pending, result.outcome);
        return;
      } else {
        update(previous => previous.request.status === 'domain-held' || previous.request.status === 'awaiting-review'
          || (previous.request.status === 'unconfirmed' && 'outcome' in previous.request)
          ? previous : { ...previous, request: { status: result.status, requestId: pending.requestId,
            cancellation: pending.retained.cancellation } });
      }
      update(previous => ({ ...previous, recoveryAction: { status: result.status === 'unconfirmed' ? 'unconfirmed' : 'idle' } }));
    } catch {
      if (recoveryController.current !== controller || controller.signal.aborted || pendingRun.current !== pending
        || activeScope.current !== scope || retainedRequests.get(scope.key) !== pending.retained) return;
      update(previous => ({ ...previous, recoveryAction: { status: 'unavailable' } }));
    } finally {
      if (recoveryController.current === controller) recoveryController.current = null;
    }
  }, [scope, acceptOutcome, update]);

  useEffect(() => {
    activeScope.current = scope;
    const retained = retainedRequests.get(scope.key);
    if (retained) {
      const pending: PendingRun = { scope, requestId: retained.requestId, retained, controller: new AbortController() };
      pendingRun.current = pending;
      watchRequest(pending);
      setScopedState({ scope, state: { ...initialState(), connectionAction: retainedConnectionState(
        pendingConnectionActions.values(), scope, initialState().connectionAction), request: {
        status: 'unconfirmed', requestId: retained.requestId, cancellation: retained.cancellation,
      } } });
      // Reattach only this exact genuine host scope. Read the original request
      // once; never restore a prompt, resubmit run, or automatically resume.
      void recover();
    } else {
      pendingRun.current = null;
      setScopedState({ scope, state: { ...initialState(), connectionAction: retainedConnectionState(
        pendingConnectionActions.values(), scope, initialState().connectionAction) } });
    }
    void refresh();
    return () => {
      if (activeScope.current === scope) activeScope.current = null;
      unwatchRequest();
      for (const ref of [connectionController, actionController, reviewController, recoveryController]) {
        ref.current?.abort();
        ref.current = null;
      }
      const pending = pendingRun.current;
      if (pending?.scope !== scope) return;
      pendingRun.current = null;
      pending.controller.abort();
      // Drop only view-local transport. The bounded registry keeps the original
      // ID despite abort, requested acknowledgement or failed cancellation.
      void cancelRetainedRequest(scope, pending.retained);
    };
  }, [scope, refresh, recover, watchRequest, unwatchRequest]);

  const unresolvedConnectionActions: readonly UnresolvedConnectionAction[] = [...pendingConnectionActions.values()]
    .filter(action => action.scopeKey === scope.key).map(({ actionId, action, status }) => ({ actionId, action, status }));
  const pendingConnectionKinds = unresolvedConnectionActions.map(action => action.action);
  return { state, refresh, submit, cancel, connectionAction, review, recover, pendingConnectionKinds, unresolvedConnectionActions };
}
