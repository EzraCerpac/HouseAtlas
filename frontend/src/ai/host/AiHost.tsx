import { createContext, useContext, useState, type ReactNode } from 'react';
import { AiPanelView } from '../AiPanel.js';
import { failureMessages } from '../model.js';
import { useAiSession } from '../useAiSession.js';
import type { AiClient } from '../types.js';

/** Supplied by the authenticated host; a home label or role is not a scope key. */
export interface AiHostContext {
  readonly client: AiClient;
  /** Full actor/home/provider registration/session and cancellation epoch identity. */
  readonly scopeKey: string;
  readonly scopeLabel: string;
}
type Session = ReturnType<typeof useAiSession>;
interface Display {
  readonly session: Session;
  readonly scopeLabel: string;
  readonly prompt: string;
  readonly setPrompt: (prompt: string) => void;
}
const HostContext = createContext<Display | null>(null);

/** Keep this above page navigation: leaving Settings must not lose a review/run.
 * Remove the context immediately when the committed authorized view is absent. */
export function AiHost({ context, children }: {
  readonly context: AiHostContext | null;
  readonly children: ReactNode;
}) {
  return context
    ? <BoundHost key={context.scopeKey} context={context}>{children}</BoundHost>
    : <HostContext.Provider value={null}>{children}</HostContext.Provider>;
}
function BoundHost({ context, children }: {
  readonly context: AiHostContext;
  readonly children: ReactNode;
}) {
  const session = useAiSession(context.client, context.scopeKey);
  const [prompt, setPrompt] = useState('');
  return <HostContext.Provider value={{ session, scopeLabel: context.scopeLabel, prompt, setPrompt }}>
    {children}
  </HostContext.Provider>;
}

/** Mount only in the existing Settings list. All policy/status copy is donor-owned. */
export function AiSettingsSection() {
  const host = useContext(HostContext);
  if (!host) return <section className="setting ai-host" aria-label="AI">
    <div className="setting-text"><h2>AI</h2><p role="status">AI host is unavailable.</p></div>
  </section>;
  const { session } = host;
  return <div className="setting ai-host">
    <AiPanelView
      state={session.state} scopeLabel={host.scopeLabel} prompt={host.prompt}
      onPromptChange={host.setPrompt} onSubmit={() => { void session.submit(host.prompt); }}
      onCancel={() => { void session.cancel(); }} onRefresh={() => { void session.refresh(); }}
      onConnectionAction={input => { void session.connectionAction(input); }}
      onReview={() => { void session.review(); }} onRecover={() => { void session.recover(); }}
      unresolvedConnectionActions={session.unresolvedConnectionActions}
    />
  </div>;
}

/** Small factual notice outside Settings; canonical output stays in the panel. */
export function AiActivityStatus() {
  const host = useContext(HostContext);
  if (!host || host.session.state.request.status === 'idle') return null;
  const request = host.session.state.request;
  let message: string;
  switch (request.status) {
    case 'running': message = 'AI request is running.'; break;
    case 'unconfirmed': message = 'AI request completion is unconfirmed.'; break;
    case 'start-unavailable': message = 'AI request could not be started.'; break;
    case 'awaiting-review': message = 'AI tool review is required.'; break;
    case 'domain-held': message = 'AI domain operation remains held.'; break;
    case 'finished': {
      const outcome = request.outcome;
      switch (outcome.status) {
        case 'completed': message = 'AI response is available.'; break;
        case 'cancelled': message = 'AI request was cancelled.'; break;
        case 'stopped': message = 'AI local processing stopped. Provider completion is unconfirmed.'; break;
        case 'failed': message = failureMessages[outcome.reason]; break;
        case 'review-required': message = 'AI tool review is required.'; break;
        case 'domain-held': message = 'AI domain operation remains held.'; break;
      }
      break;
    }
  }
  return <div className="ai-host-activity" role="status" aria-live="polite">
    <p>{message} <a href="#settings">AI in Settings</a></p>
  </div>;
}
