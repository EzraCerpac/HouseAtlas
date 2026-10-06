import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canInfer } from './model.js';
import type {
  AiClient, AiSessionState, CancellationState, ConnectionAction, RequestState, RunOutcome,
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

interface ScopedState {
  readonly scope: Scope;
  readonly state: AiSessionState;
}

function initialState(): AiSessionState {
  return {
    connection: { status: 'loading' }, request: { status: 'idle' },
    connectionAction: { status: 'idle', action: null }, reviewAction: { status: 'idle' }, recoveryAction: { status: 'idle' },
  };
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
    update(previous => ({ ...previous, connection: { status: 'loading' } }));
    try {
      const snapshot = await scope.client.connection(controller.signal);
      if (connectionController.current !== controller || controller.signal.aborted) return;
      update(previous => ({ ...previous, connection: { status: 'available', snapshot } }));
    } catch {
      if (connectionController.current !== controller || controller.signal.aborted) return;
      update(previous => ({ ...previous, connection: { status: 'unavailable' } }));
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
    pending.resultLost = false;
    if (outcome.status !== 'review-required' && outcome.status !== 'domain-held') pendingRun.current = null;
    update(previous => {
      const cancellation = cancellationFor(previous.request, pending.requestId);
      const request: RequestState = outcome.status === 'review-required'
        ? { status: 'awaiting-review', requestId: pending.requestId, outcome, cancellation }
        : outcome.status === 'domain-held'
          ? { status: 'domain-held', requestId: pending.requestId, outcome, cancellation }
          : { status: 'finished', requestId: pending.requestId, outcome };
      return { ...previous, request };
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
    const controller = new AbortController();
    actionController.current = controller;
    connectionController.current?.abort();
    if (input.action === 'disconnect') void cancel();
    update(previous => ({ ...previous,
      connection: input.action === 'disconnect' ? { status: 'loading' } : previous.connection,
      connectionAction: { status: 'working', action: input.action } }));
    try {
      const result = await scope.client.connectionAction(input, controller.signal);
      if (actionController.current !== controller || controller.signal.aborted) return;
      update(previous => ({ ...previous, connection: { status: 'available', snapshot: result.snapshot },
        connectionAction: { status: result.status === 'completed' ? 'idle' : result.status, action: input.action } }));
    } catch {
      if (actionController.current !== controller || controller.signal.aborted) return;
      update(previous => ({ ...previous,
        connection: input.action === 'disconnect' ? { status: 'unavailable' } : previous.connection,
        connectionAction: { status: 'unavailable', action: input.action } }));
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
      if (result.requestId !== pending.requestId) throw new Error('Unexpected request status');
      if (recoveryController.current !== controller || controller.signal.aborted || pendingRun.current !== pending) return;
      if (result.status === 'finished') {
        pending.controller.abort();
        acceptOutcome(pending, result.outcome);
      } else {
        update(previous => previous.request.status === 'domain-held' || previous.request.status === 'awaiting-review'
          ? previous : { ...previous, request: { status: result.status, requestId: pending.requestId,
            cancellation: cancellationFor(previous.request, pending.requestId) } });
      }
      update(previous => ({ ...previous, recoveryAction: { status: result.status === 'unconfirmed' ? 'unconfirmed' : 'idle' } }));
    } catch {
      if (recoveryController.current !== controller || controller.signal.aborted) return;
      update(previous => ({ ...previous, recoveryAction: { status: 'unavailable' } }));
    } finally {
      if (recoveryController.current === controller) recoveryController.current = null;
    }
  }, [scope, acceptOutcome, update]);

  return { state, refresh, submit, cancel, connectionAction, review, recover };
}
