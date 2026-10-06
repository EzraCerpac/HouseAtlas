import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canInfer } from './model.js';
import type { AiClient, AiSessionState } from './types.js';

interface Scope {
  readonly client: AiClient;
  readonly key: string;
}

interface PendingRun {
  readonly scope: Scope;
  readonly requestId: string;
  readonly controller: AbortController;
  cancellationSent: boolean;
  cancellationConfirmed: boolean;
  resultLost: boolean;
}

interface ScopedState {
  readonly scope: Scope;
  readonly state: AiSessionState;
}

function initialState(): AiSessionState {
  return { connection: { status: 'loading' }, request: { status: 'idle' } };
}

export function useAiSession(client: AiClient, scopeKey: string) {
  const scope = useMemo<Scope>(() => ({ client, key: scopeKey }), [client, scopeKey]);
  const activeScope = useRef<Scope | null>(null);
  const connectionController = useRef<AbortController | null>(null);
  const pendingRun = useRef<PendingRun | null>(null);
  const [scopedState, setScopedState] = useState<ScopedState>(() => ({ scope, state: initialState() }));
  const state = scopedState.scope === scope ? scopedState.state : initialState();

  const update = useCallback((change: (previous: AiSessionState) => AiSessionState) => {
    if (activeScope.current !== scope) return;
    setScopedState(previous => ({
      scope,
      state: change(previous.scope === scope ? previous.state : initialState()),
    }));
  }, [scope]);

  const refresh = useCallback(async () => {
    if (activeScope.current !== scope || pendingRun.current !== null) return;
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
    }
  }, [scope, update]);

  useEffect(() => {
    activeScope.current = scope;
    setScopedState({ scope, state: initialState() });
    void refresh();
    return () => {
      if (activeScope.current === scope) activeScope.current = null;
      connectionController.current?.abort();
      connectionController.current = null;
      const pending = pendingRun.current;
      if (pending?.scope !== scope) return;
      pendingRun.current = null;
      pending.controller.abort();
      // Disposal aborts the transport and requests cancellation independently.
      // Neither action is represented as a confirmed terminal outcome.
      if (!pending.cancellationSent) {
        try { void scope.client.cancel(pending.requestId).catch(() => undefined); }
        catch { /* The disposed UI cannot observe cancellation status. */ }
      }
    };
  }, [scope, refresh]);

  const submit = useCallback(async (prompt: string) => {
    const text = prompt.trim();
    if (activeScope.current !== scope || pendingRun.current !== null || text.length === 0
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
    update(previous => ({ ...previous, request: { status: 'running', requestId, cancellation: { status: 'idle' } } }));
    try {
      const outcome = await scope.client.run({ requestId, prompt: text }, pending.controller.signal);
      if (pendingRun.current !== pending || pending.controller.signal.aborted) return;
      pendingRun.current = null;
      update(previous => ({ ...previous, request: { status: 'finished', requestId, outcome } }));
    } catch {
      if (pendingRun.current !== pending || pending.controller.signal.aborted) return;
      pending.resultLost = true;
      if (pending.cancellationConfirmed) {
        pendingRun.current = null;
        update(previous => ({ ...previous, request: { status: 'finished', requestId,
          outcome: { status: 'cancelled', usage: { inputTokens: null, outputTokens: null, totalTokens: null } } } }));
        return;
      }
      // Retain the pending identifier for cancellation. Transport failure is
      // not proof that the provider stopped or that the request can be retried.
      update(previous => {
        const cancellation = previous.request.status === 'running' || previous.request.status === 'unconfirmed'
          ? previous.request.cancellation : { status: 'idle' as const };
        return { ...previous, request: { status: 'unconfirmed', requestId, cancellation } };
      });
    }
  }, [scope, state.connection, update]);

  const cancel = useCallback(async () => {
    const pending = pendingRun.current;
    if (activeScope.current !== scope || pending?.scope !== scope || pending.cancellationSent) return;
    pending.cancellationSent = true;
    const setCancellation: typeof update = change => {
      if (pendingRun.current === pending) update(change);
    };
    setCancellation(previous => {
      if (previous.request.status !== 'running' && previous.request.status !== 'unconfirmed') return previous;
      return { ...previous, request: { ...previous.request, cancellation: { status: 'sending' } } };
    });
    try {
      const receipt = await scope.client.cancel(pending.requestId);
      if (receipt.requestId !== pending.requestId) throw new Error('Unexpected cancellation receipt');
      pending.cancellationConfirmed = receipt.status === 'confirmed';
      setCancellation(previous => {
        if (previous.request.status !== 'running' && previous.request.status !== 'unconfirmed') return previous;
        // A trusted terminal receipt can resolve a lost result transport.
        // No token counts are inferred from the cancellation receipt.
        if (pending.resultLost && receipt.status === 'confirmed') {
          return { ...previous, request: { status: 'finished', requestId: pending.requestId,
            outcome: { status: 'cancelled', usage: { inputTokens: null, outputTokens: null, totalTokens: null } } } };
        }
        return { ...previous, request: { ...previous.request, cancellation: { status: 'received', receipt } } };
      });
      if (pending.resultLost && receipt.status === 'confirmed' && pendingRun.current === pending) pendingRun.current = null;
    } catch {
      pending.cancellationSent = false;
      setCancellation(previous => {
        if (previous.request.status !== 'running' && previous.request.status !== 'unconfirmed') return previous;
        return { ...previous, request: { ...previous.request, cancellation: { status: 'unavailable' } } };
      });
    }
  }, [scope, update]);

  return { state, refresh, submit, cancel };
}
