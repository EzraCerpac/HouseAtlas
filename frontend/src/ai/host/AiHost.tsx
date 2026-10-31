import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AiModelsBinding } from '../AiPanel.js';
import { failureMessages } from '../model.js';
import type { useAiSession } from '../useAiSession.js';
import type { AiClient, AiReceiptIdentity } from '../types.js';

const SessionOwner = lazy(() => import('./AiSessionOwner.js').then(module => ({ default: module.AiSessionOwner })));
const SettingsView = lazy(() => import('./AiSessionOwner.js').then(module => ({ default: module.AiSettingsView })));

/** Supplied by the authenticated host; a home label or role is not a scope key. */
export interface AiHostContext {
  readonly client: AiClient;
  /** Full actor/home/provider registration/session and cancellation epoch identity. */
  readonly scopeKey: string;
  /** Stable status-receipt identity excluding only the cancellation epoch. */
  readonly receiptIdentity?: AiReceiptIdentity;
  readonly scopeLabel: string;
}
type Session = ReturnType<typeof useAiSession>;
export interface AiHostDisplay {
  readonly modelsBinding: AiModelsBinding;
  readonly session: Session;
  readonly scopeLabel: string;
  readonly prompt: string;
  readonly setPrompt: (prompt: string) => void;
}
export interface AiHostSnapshot {
  readonly context: AiHostContext;
  readonly display: AiHostDisplay;
}
interface Host {
  readonly activate: () => void;
  readonly display: AiHostDisplay | null;
}
const HostContext = createContext<Host | null>(null);

function sameBinding(left: AiHostContext, right: AiHostContext): boolean {
  const a = left.receiptIdentity, b = right.receiptIdentity;
  return left.client === right.client && left.scopeKey === right.scopeKey
    && (a === b || !!a && !!b && a.actorId === b.actorId && a.workspaceId === b.workspaceId
      && a.homeId === b.homeId && a.registrationId === b.registrationId && a.authorityEpoch === b.authorityEpoch);
}

/** Keep this above page navigation: leaving Settings must not lose a review/run.
 * Remove the context immediately when the committed authorized view is absent. */
export function AiHost({ context, children }: {
  readonly context: AiHostContext | null;
  readonly children: ReactNode;
}) {
  // Loading is requested once per host lifetime, not once per Settings visit or
  // authorized scope. Later scope changes retain the original hook lifecycle.
  const [activated, setActivated] = useState(false);
  const activate = useCallback(() => setActivated(true), []);
  return context
    ? <BoundHost key={context.scopeKey} context={context} activated={activated} activate={activate}>{children}</BoundHost>
    : <HostContext.Provider value={null}>{children}</HostContext.Provider>;
}
function BoundHost({ context, children, activated, activate }: {
  readonly context: AiHostContext;
  readonly children: ReactNode;
  readonly activated: boolean;
  readonly activate: () => void;
}) {
  const [snapshot, setSnapshot] = useState<AiHostSnapshot | null>(null);
  // Never expose a snapshot from an old client, full scope or receipt identity,
  // even in the render before the lazy owner reconciles its hook. Fresh context
  // objects for the same binding keep the panel mounted and use today's label
  // and render identity, just as the original host did.
  const display = snapshot && sameBinding(snapshot.context, context) ? {
    ...snapshot.display, scopeLabel: context.scopeLabel,
    modelsBinding: { client: context.client, scopeKey: context.scopeKey, renderIdentity: context,
      ...(context.receiptIdentity ? { receiptIdentity: context.receiptIdentity } : {}) },
  } : null;
  return <HostContext.Provider value={{ activate, display }}>
    {children}
    {activated && <Suspense fallback={null}><SessionOwner context={context} onSnapshot={setSnapshot} /></Suspense>}
  </HostContext.Provider>;
}

/** True only when the authenticated host supplied an AI binding. Entry points
 * (Ask, Settings rows) hide without one rather than showing a dead panel. */
export function useAiHostAvailable(): boolean {
  return useContext(HostContext) !== null;
}

/** Mount only in the existing Settings list. All policy/status copy is donor-owned. */
export function AiSettingsSection() {
  const host = useContext(HostContext);
  const activate = host?.activate;
  useEffect(() => { activate?.(); }, [activate]);
  if (!host?.display) return null;
  return <Suspense fallback={null}><SettingsView display={host.display} /></Suspense>;
}

/** Small factual notice outside Settings; canonical output stays in the panel. */
export function AiActivityStatus({ onOpenSettings }: { readonly onOpenSettings?: (() => void) | undefined } = {}) {
  const host = useContext(HostContext)?.display;
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
    <p>{message} {onOpenSettings ? <button type="button" onClick={onOpenSettings}>AI in Settings</button> : <a href="#settings">AI in Settings</a>}</p>
  </div>;
}
