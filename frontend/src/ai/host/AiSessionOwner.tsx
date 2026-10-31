import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AiPanelView } from '../AiPanel.js';
import { AccountObservationSection } from '../AccountObservation.js';
import { useAiSession } from '../useAiSession.js';
import type { AiHostContext, AiHostDisplay, AiHostSnapshot } from './AiHost.js';

/** One owner above navigation after the first panel mount. Memoization keeps
 * publishing a snapshot from feeding back into another owner render; the hook,
 * prompt and cancellation reconciliation remain alive when all panels close. */
export const AiSessionOwner = memo(function AiSessionOwner({ context, onSnapshot }: {
  readonly context: AiHostContext;
  readonly onSnapshot: (snapshot: AiHostSnapshot) => void;
}) {
  const session = useAiSession(context.client, context.scopeKey, context.receiptIdentity);
  const [prompt, setPrompt] = useState('');
  const reconciledReviewCancellation = useRef<string | null>(null);
  const { request, recoveryAction, reviewAction } = session.state;
  useEffect(() => {
    if (request.status !== 'awaiting-review' || request.cancellation.status !== 'received'
      || request.cancellation.receipt.status !== 'confirmed'
      || request.cancellation.receipt.requestId !== request.requestId
      || recoveryAction.status === 'working' || reviewAction.status === 'working'
      || reconciledReviewCancellation.current === request.requestId) return;
    // Preserve the original canonical terminal-dismissal reconciliation.
    reconciledReviewCancellation.current = request.requestId;
    void session.recover();
  }, [request, recoveryAction.status, reviewAction.status, session.recover]);
  useLayoutEffect(() => {
    onSnapshot({ context, display: {
      modelsBinding: { client: context.client, scopeKey: context.scopeKey, renderIdentity: context,
        ...(context.receiptIdentity ? { receiptIdentity: context.receiptIdentity } : {}) },
      session, scopeLabel: context.scopeLabel, prompt, setPrompt,
    } });
  }, [context, onSnapshot, session, prompt]);
  return null;
});

/** The original panel markup, actions and account observation stay together. */
export function AiSettingsView({ display: host }: { readonly display: AiHostDisplay }) {
  const { session } = host;
  return <><div className="setting ai-host">
    <AiPanelView
      modelsBinding={host.modelsBinding}
      state={session.state} scopeLabel={host.scopeLabel} prompt={host.prompt}
      onPromptChange={host.setPrompt} onSubmit={() => { void session.submit(host.prompt); }}
      onCancel={() => { void session.cancel(); }} onRefresh={() => { void session.refresh(); }}
      onConnectionAction={input => { void session.connectionAction(input); }}
      onReview={() => { void session.review(); }} onRecover={() => { void session.recover(); }}
      unresolvedConnectionActions={session.unresolvedConnectionActions}
    />
  </div><AccountObservationSection /></>;
}
