import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canInfer } from './model.js';
import type {
  AiClient, AiSessionState, CancellationState, ConnectionAction, ConnectionActionState, RequestState, RunOutcome, UnresolvedConnectionAction,
} from './types.js';

interface Scope {
  readonly client: AiClient;
  readonly key: string;
}

interface PendingRun {
  readonly scope: Scope;
  readonly requestId: string;
  controller: AbortController;
  cancellationSent: boolean;
  cancellationConfirmed: boolean;
  resultLost: boolean;
}

interface PendingConnectionAction extends UnresolvedConnectionAction {
  readonly scope: Scope;
}

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
  for (const action of actions) if (action.scope === scope) latest = action;
  return latest === null ? fallback : { status: latest.status, action: latest.action, actionId: latest.actionId };
}

function cancellationFor(request: RequestState, requestId: string): CancellationState {
  return 'cancellation' in request && request.requestId === requestId ? request.cancellation : { status: 'idle' };
}

export function useAiSession(client: AiClient, scopeKey: string) {
  const scope = useMemo<Scope>(() => ({ client, key: scopeKey }), [client, scopeKey]);
  const activeScope = useRef<Scope | null>(null);
  const connectionController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const reviewController = useRef<AbortController | null>(null);
  const recoveryController = useRef<AbortController | null>(null);
  const pendingRun = useRef<PendingRun | null>(null);
  const pendingConnectionActions = useRef(new Map<string, PendingConnectionAction>());
  const [scopedState, setScopedState] = useState<ScopedState>(() => ({ scope, state: initialState() }));
  const state = scopedState.scope === scope ? scopedState.state : initialState();

  const update = useCallback((change: (previous: AiSessionState) => AiSessionState) => {
    if (activeScope.current !== scope) return;
    setScopedState(previous => ({ scope, state: change(previous.scope === scope ? previous.state : initialState()) }));
  }, [scope]);

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
      const retained = [...pendingConnectionActions.current.values()].filter(action => action.scope === scope);
      for (const pending of retained) {
        if (!current()) return;
        try {
          const result = await scope.client.connectionActionStatus(pending.actionId, controller.signal);
          if (!current()) return;
          if (pendingConnectionActions.current.get(pending.actionId) !== pending) continue;
          if (result.actionId !== pending.actionId) throw new Error('Unexpected connection action status');
          if (result.status === 'completed') pendingConnectionActions.current.delete(pending.actionId);
          else pendingConnectionActions.current.set(pending.actionId, { ...pending, status: result.status });
          // Each workflow is correlated separately from current connection facts.
          update(previous => ({ ...previous, connectionAction: retainedConnectionState(
            pendingConnectionActions.current.values(), scope,
            result.status === 'completed'
              ? { status: 'idle', action: pending.action, actionId: pending.actionId }
              : previous.connectionAction,
          ) }));
        } catch {
          if (!current()) return;
          if (pendingConnectionActions.current.get(pending.actionId) !== pending) continue;
          pendingConnectionActions.current.set(pending.actionId, { ...pending, status: 'unconfirmed' });
          update(previous => ({ ...previous, connectionAction: retainedConnectionState(
            pendingConnectionActions.current.values(), scope, previous.connectionAction,
          ) }));
        }
      }
    } finally {
      if (connectionController.current === controller) connectionController.current = null;
    }
  }, [scope, update]);

  useEffect(() => {
    activeScope.current = scope;
    setScopedState({ scope, state: initialState() });
    void refresh();
    return () => {
      if (activeScope.current === scope) activeScope.current = null;
      for (const ref of [connectionController, actionController, reviewController, recoveryController]) {
        ref.current?.abort();
        ref.current = null;
      }
      for (const [actionId, action] of pendingConnectionActions.current) {
        if (action.scope === scope) pendingConnectionActions.current.delete(actionId);
      }
      const pending = pendingRun.current;
      if (pending?.scope !== scope) return;
      pendingRun.current = null;
      pending.controller.abort();
      // Disposal cannot confirm remote end or remove domain operation holds.
      if (!pending.cancellationSent) {
        try { void scope.client.cancel(pending.requestId).catch(() => undefined); }
        catch { /* The disposed UI cannot observe cancellation status. */ }
      }
    };
  }, [scope, refresh]);

  const acceptOutcome = useCallback((pending: PendingRun, outcome: RunOutcome) => {
    if (pendingRun.current !== pending || activeScope.current !== scope) return;
    recoveryController.current?.abort();
    recoveryController.current = null;
    pending.resultLost = false;
    if (outcome.status !== 'review-required' && outcome.status !== 'domain-held') pendingRun.current = null;
    update(previous => {
      const cancellation = cancellationFor(previous.request, pending.requestId);
      const request: RequestState = outcome.status === 'review-required'
        ? { status: 'awaiting-review', requestId: pending.requestId, outcome, cancellation }
        : outcome.status === 'domain-held'
          ? { status: 'domain-held', requestId: pending.requestId, outcome, cancellation }
          : { status: 'finished', requestId: pending.requestId, outcome };
      return { ...previous, request, recoveryAction: { status: 'idle' } };
    });
  }, [scope, update]);

  const awaitOutcome = useCallback(async (pending: PendingRun, operation: (signal: AbortSignal) => Promise<RunOutcome>) => {
    const controller = pending.controller;
    try {
      const outcome = await operation(controller.signal);
      if (pendingRun.current !== pending || pending.controller !== controller || controller.signal.aborted) return;
      acceptOutcome(pending, outcome);
    } catch {
      if (pendingRun.current !== pending || pending.controller !== controller || controller.signal.aborted) return;
      pending.resultLost = true;
      if (pending.cancellationConfirmed) {
        acceptOutcome(pending, { status: 'cancelled', usage: { inputTokens: null, outputTokens: null, totalTokens: null } });
        return;
      }
      // Keep correlation for authoritative recovery; never replay a lost request.
      update(previous => ({ ...previous, request: {
        status: 'unconfirmed', requestId: pending.requestId, cancellation: cancellationFor(previous.request, pending.requestId),
      } }));
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
    const pending: PendingRun = {
      scope, requestId, controller: new AbortController(),
      cancellationSent: false, cancellationConfirmed: false, resultLost: false,
    };
    pendingRun.current = pending;
    update(previous => ({ ...previous, request: { status: 'running', requestId, cancellation: { status: 'idle' } },
      reviewAction: { status: 'idle' }, recoveryAction: { status: 'idle' } }));
    await awaitOutcome(pending, signal => scope.client.run({ requestId, prompt: text }, signal));
  }, [scope, state.connection, awaitOutcome, update]);

  const cancel = useCallback(async () => {
    const pending = pendingRun.current;
    if (activeScope.current !== scope || pending?.scope !== scope || pending.cancellationSent) return;
    pending.cancellationSent = true;
    reviewController.current?.abort();
    reviewController.current = null;
    update(previous => ({ ...previous, reviewAction: { status: 'idle' } }));
    const setCancellation = (cancellation: CancellationState) => {
      if (pendingRun.current !== pending) return;
      update(previous => 'cancellation' in previous.request
        ? { ...previous, request: { ...previous.request, cancellation } } : previous);
    };
    setCancellation({ status: 'sending' });
    try {
      const receipt = await scope.client.cancel(pending.requestId);
      if (receipt.requestId !== pending.requestId) throw new Error('Unexpected cancellation receipt');
      pending.cancellationConfirmed = receipt.status === 'confirmed';
      if (pending.resultLost && receipt.status === 'confirmed') {
        // Hosts may confirm only a terminal cancellation with no unresolved domain hold.
        acceptOutcome(pending, { status: 'cancelled', usage: { inputTokens: null, outputTokens: null, totalTokens: null } });
      } else setCancellation({ status: 'received', receipt });
    } catch {
      pending.cancellationSent = false;
      setCancellation({ status: 'unavailable' });
    }
  }, [scope, acceptOutcome, update]);

  const connectionAction = useCallback(async (input: ConnectionAction) => {
    if (activeScope.current !== scope || actionController.current !== null
      || (pendingRun.current !== null && input.action !== 'manage-usage' && input.action !== 'disconnect')) return;
    const retained = [...pendingConnectionActions.current.values()].filter(action => action.scope === scope);
    if (pendingConnectionActions.current.size >= MAX_UNRESOLVED_CONNECTION_ACTIONS
      || retained.some(action => action.action === input.action)
      || ((input.action === 'connect' || input.action === 'consent') && retained.length > 0)) return;
    connectionController.current?.abort();
    if (input.action === 'disconnect') void cancel();
    let actionId: string;
    try {
      actionId = globalThis.crypto.randomUUID();
      if (pendingConnectionActions.current.has(actionId)) throw new Error('Duplicate connection action identifier');
    }
    catch {
      update(previous => ({ ...previous,
        connection: input.action === 'disconnect' ? { status: 'unavailable' } : previous.connection,
        connectionAction: retainedConnectionState(pendingConnectionActions.current.values(), scope,
          { status: 'unavailable', action: input.action, actionId: null }) }));
      return;
    }
    const controller = new AbortController();
    const pending: PendingConnectionAction = { scope, actionId, action: input.action, status: 'unconfirmed' };
    actionController.current = controller;
    // Retain every submitted workflow, including a lost response, until its own completion.
    pendingConnectionActions.current.set(actionId, pending);
    update(previous => ({ ...previous,
      connection: input.action === 'disconnect' ? { status: 'loading' } : previous.connection,
      connectionAction: { status: 'working', action: input.action, actionId } }));
    try {
      const result = await scope.client.connectionAction({ actionId, command: input }, controller.signal);
      if (actionController.current !== controller || controller.signal.aborted || activeScope.current !== scope
        || pendingConnectionActions.current.get(actionId) !== pending) return;
      if (result.actionId !== actionId) throw new Error('Unexpected connection action result');
      if (result.status === 'completed') pendingConnectionActions.current.delete(actionId);
      else pendingConnectionActions.current.set(actionId, { ...pending, status: result.status });
      update(previous => ({ ...previous, connection: { status: 'available', snapshot: result.snapshot },
        connectionAction: retainedConnectionState(pendingConnectionActions.current.values(), scope,
          { status: 'idle', action: input.action, actionId }) }));
    } catch {
      if (actionController.current !== controller || controller.signal.aborted || activeScope.current !== scope
        || pendingConnectionActions.current.get(actionId) !== pending) return;
      update(previous => ({ ...previous,
        connection: input.action === 'disconnect' ? { status: 'unavailable' } : previous.connection,
        connectionAction: retainedConnectionState(pendingConnectionActions.current.values(), scope,
          { status: 'unconfirmed', action: input.action, actionId }) }));
    } finally {
      if (actionController.current === controller) actionController.current = null;
    }
  }, [scope, cancel, update]);

  const review = useCallback(async () => {
    const pending = pendingRun.current;
    if (activeScope.current !== scope || pending?.scope !== scope || pending.cancellationSent
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
        status: 'running', requestId: pending.requestId, cancellation: cancellationFor(previous.request, pending.requestId),
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
    if (activeScope.current !== scope || pending?.scope !== scope || recoveryController.current !== null
      || reviewController.current !== null) return;
    const controller = new AbortController();
    recoveryController.current = controller;
    update(previous => ({ ...previous, recoveryAction: { status: 'working' } }));
    try {
      const result = await scope.client.requestStatus(pending.requestId, controller.signal);
      if (recoveryController.current !== controller || controller.signal.aborted || pendingRun.current !== pending
        || activeScope.current !== scope) return;
      if (result.requestId !== pending.requestId) throw new Error('Unexpected request status');
      if (result.status === 'finished') {
        pending.controller.abort();
        acceptOutcome(pending, result.outcome);
        return;
      } else {
        update(previous => previous.request.status === 'domain-held' || previous.request.status === 'awaiting-review'
          ? previous : { ...previous, request: { status: result.status, requestId: pending.requestId,
            cancellation: cancellationFor(previous.request, pending.requestId) } });
      }
      update(previous => ({ ...previous, recoveryAction: { status: result.status === 'unconfirmed' ? 'unconfirmed' : 'idle' } }));
    } catch {
      if (recoveryController.current !== controller || controller.signal.aborted || pendingRun.current !== pending
        || activeScope.current !== scope) return;
      update(previous => ({ ...previous, recoveryAction: { status: 'unavailable' } }));
    } finally {
      if (recoveryController.current === controller) recoveryController.current = null;
    }
  }, [scope, acceptOutcome, update]);

  const unresolvedConnectionActions: readonly UnresolvedConnectionAction[] = [...pendingConnectionActions.current.values()]
    .filter(action => action.scope === scope).map(({ actionId, action, status }) => ({ actionId, action, status }));
  const pendingConnectionKinds = unresolvedConnectionActions.map(action => action.action);
  return { state, refresh, submit, cancel, connectionAction, review, recover, pendingConnectionKinds, unresolvedConnectionActions };
}
