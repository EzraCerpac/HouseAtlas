import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { cancellationMessage, canInfer, failureMessages, readinessMessage, tokenCount } from './model.js';
import type {
  AiClient, AiSessionState, ConnectionAction, ConnectionSnapshot, DomainHeld, RunOutcome, RuntimeRoute, UnresolvedConnectionAction, Usage,
} from './types.js';
import { hasConnectionActionCapacity, useAiSession } from './useAiSession.js';

export interface AiPanelProps {
  readonly client: AiClient;
  readonly scopeLabel: string;
  /** Host-provided full context/epoch identity; labels are not identities. */
  readonly scopeKey: string;
}

/** Remount the draft when the qualified scope changes. */
export function AiPanel(props: AiPanelProps) {
  return <AiPanelSession key={props.scopeKey} {...props} />;
}

function AiPanelSession({ client, scopeLabel, scopeKey }: AiPanelProps) {
  const session = useAiSession(client, scopeKey);
  const [prompt, setPrompt] = useState('');
  return <AiPanelView
    state={session.state}
    scopeLabel={scopeLabel}
    prompt={prompt}
    onPromptChange={setPrompt}
    onSubmit={() => { void session.submit(prompt); }}
    onCancel={() => { void session.cancel(); }}
    onRefresh={() => { void session.refresh(); }}
    onConnectionAction={input => { void session.connectionAction(input); }}
    onReview={() => { void session.review(); }}
    onRecover={() => { void session.recover(); }}
    unresolvedConnectionActions={session.unresolvedConnectionActions}
  />;
}

export interface AiPanelViewProps {
  readonly state: AiSessionState;
  readonly scopeLabel: string;
  readonly prompt: string;
  readonly onPromptChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly onRefresh: () => void;
  readonly onConnectionAction: (input: ConnectionAction) => void;
  readonly onReview: () => void;
  readonly onRecover: () => void;
  readonly unresolvedConnectionActions?: readonly UnresolvedConnectionAction[];
}

const methodLabels: Record<ConnectionSnapshot['method'], string> = {
  'sign-in-with-chatgpt': 'Sign in with ChatGPT', 'api-key': 'API key', 'local-runtime': 'Local runtime',
};
const authorizationLabels: Record<ConnectionSnapshot['authorization'], string> = {
  unconfigured: 'Unconfigured', 'sign-in-required': 'Sign-in required', connected: 'Connected', expired: 'Expired',
};
const eligibilityLabels: Record<ConnectionSnapshot['eligibility'], string> = {
  unknown: 'Unknown', eligible: 'Eligible', ineligible: 'Ineligible', 'not-applicable': 'Not applicable',
};
const permissionLabels: Record<ConnectionSnapshot['permission'], string> = {
  unknown: 'Unknown', granted: 'Granted', denied: 'Denied', 'not-applicable': 'Not applicable',
};
const availabilityLabels: Record<ConnectionSnapshot['runtime']['availability'], string> = {
  unknown: 'Unknown', ready: 'Ready', sleeping: 'Sleeping', unreachable: 'Unreachable',
};
const routeLabels: Record<RuntimeRoute, string> = {
  unset: 'Unset', 'local-sign-in-helper': 'Local sign-in helper',
  'issued-website-client': 'Issued website client', 'local-inference-companion': 'Local inference companion',
};
const paidUseLabels: Record<ConnectionSnapshot['paidUseAdmission'], string> = {
  held: 'Held', 'verified-zero-paid-use': 'Zero paid use verified', 'explicit-spend-approval': 'Specific credit spending approved',
};
const actionLabels: Record<ConnectionAction['action'], string> = {
  connect: 'Connect', consent: 'Inference consent', disconnect: 'Disconnect', 'manage-usage': 'Manage usage',
};
const heldMessages: Record<DomainHeld['state'], string> = {
  prepared: 'Current domain intent is prepared and has not been dispatched.',
  queued: 'Current domain operation is queued. Its completion is unconfirmed.',
  dispatching: 'Current domain operation is dispatching. Its completion is unconfirmed.',
  'rejected-before-dispatch': 'Current domain operation was rejected before dispatch.',
  partial: 'Current domain operation has partial effects. Reconciliation is required.',
  'unknown-held': 'Current domain operation has unknown effects and remains held. Reconciliation is required.',
};

export function AiPanelView({
  state, scopeLabel, prompt, onPromptChange, onSubmit, onCancel, onRefresh, onConnectionAction, onReview, onRecover, unresolvedConnectionActions,
}: AiPanelViewProps) {
  const id = useId();
  const [selectedRoute, setSelectedRoute] = useState<RuntimeRoute>('unset');
  const activeRequest = 'cancellation' in state.request && state.request.status !== 'domain-held'
    ? state.request : null;
  const busy = activeRequest !== null;
  const connectionBusy = state.connectionAction.status === 'working';
  const unresolvedActions = unresolvedConnectionActions ?? (
    (state.connectionAction.status === 'pending' || state.connectionAction.status === 'unconfirmed')
      && state.connectionAction.action !== null ? [{
        actionId: state.connectionAction.actionId, action: state.connectionAction.action, status: state.connectionAction.status,
      }] : []
  );
  const pendingKinds = unresolvedActions.map(action => action.action);
  const disconnectPending = unresolvedActions.some(action => action.action === 'disconnect' && action.status === 'pending');
  const disconnectCapacityExhausted = !hasConnectionActionCapacity(unresolvedActions.length);
  // The submitted action is retained before its opening call settles. Show its
  // working progress separately, while preserving every older unresolved row.
  const visibleActions = unresolvedActions.filter(action => !(connectionBusy && action.actionId === state.connectionAction.actionId));
  const ready = state.connection.status === 'available' && canInfer(state.connection.snapshot);
  const cancellation = activeRequest === null ? null : cancellationMessage(activeRequest.cancellation);
  const cancelDisabled = activeRequest !== null && (activeRequest.cancellation.status === 'sending'
    || activeRequest.cancellation.status === 'received');
  const outcome = 'outcome' in state.request ? state.request.outcome : null;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (ready && !busy && !connectionBusy && prompt.trim().length > 0) onSubmit();
  };

  return <section className="ha-ai" aria-labelledby={`${id}-heading`}>
    <header className="ha-ai__header">
      <h2 id={`${id}-heading`}>AI</h2>
      <button type="button" onClick={onRefresh} disabled={connectionBusy || state.connection.status === 'loading'}>Refresh status</button>
    </header>
    <dl className="ha-ai__facts"><dt>Scope</dt><dd>{scopeLabel}</dd></dl>
    {state.connection.status === 'available'
      ? <ConnectionDetails connection={state.connection.snapshot} />
      : <p role="status">{state.connection.status === 'loading' ? 'Checking connection.' : 'Connection status is unavailable.'}</p>}
    <fieldset className="ha-ai__connection">
      <legend>Connection actions</legend>
      <label htmlFor={`${id}-route`}>Candidate runtime</label>
      <select id={`${id}-route`} value={selectedRoute} disabled={busy || connectionBusy}
        onChange={event => { const route = event.target.value; if (Object.hasOwn(routeLabels, route)) setSelectedRoute(route as RuntimeRoute); }}>
        {Object.entries(routeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {selectedRoute === 'local-sign-in-helper' && <p>A local sign-in result does not qualify server inference.</p>}
      {selectedRoute === 'issued-website-client' && <p>A registered server callback and supported credential placement require qualification.</p>}
      {selectedRoute === 'local-inference-companion' && <p>The selected computer must be available for inference. Phone relay remains unqualified.</p>}
      <div className="ha-ai__actions">
        <button type="button" disabled={selectedRoute === 'unset' || busy || connectionBusy || pendingKinds.length > 0}
          onClick={() => { if (selectedRoute !== 'unset') onConnectionAction({ action: 'connect', route: selectedRoute }); }}>Connect</button>
        <button type="button" disabled={busy || connectionBusy || pendingKinds.length > 0 || state.connection.status !== 'available'}
          onClick={() => onConnectionAction({ action: 'consent' })}>Review inference consent</button>
        <button type="button" disabled={connectionBusy || disconnectPending || disconnectCapacityExhausted || state.connection.status !== 'available'}
          onClick={() => onConnectionAction({ action: 'disconnect' })}>Disconnect</button>
        <button type="button" disabled={connectionBusy || pendingKinds.includes('manage-usage') || state.connection.status !== 'available'}
          onClick={() => onConnectionAction({ action: 'manage-usage' })}>Manage usage</button>
      </div>
      {disconnectCapacityExhausted && <p role="status">Disconnect retry capacity is full.</p>}
      {state.connectionAction.status === 'working' && <p role="status">Opening connection action.</p>}
      {visibleActions.length > 0 && <ul aria-label="Unresolved connection actions">
        {visibleActions.map(action => <li key={action.actionId ?? action.action}><p role="status">
          {action.status === 'pending'
            ? `${actionLabels[action.action]} is pending. Refresh status after the host action finishes.`
            : action.action === 'disconnect' ? 'Disconnect or remote revocation is unconfirmed.' : `${actionLabels[action.action]} is unconfirmed.`}
        </p></li>)}
      </ul>}
      {state.connectionAction.status === 'unavailable' && <p role="status">Connection action is unavailable.</p>}
    </fieldset>
    <form onSubmit={submit}>
      <label htmlFor={`${id}-prompt`}>Prompt</label>
      <textarea id={`${id}-prompt`} value={prompt} onChange={event => onPromptChange(event.target.value)} rows={4} disabled={busy} />
      <div className="ha-ai__actions">
        <button type="submit" disabled={!ready || busy || connectionBusy || prompt.trim().length === 0}>Run</button>
        {busy && <button type="button" onClick={onCancel} disabled={cancelDisabled}>Cancel request</button>}
        {busy && <button type="button" onClick={onRecover}
          disabled={state.recoveryAction.status === 'working' || state.reviewAction.status === 'working'}>Refresh request status</button>}
      </div>
    </form>
    <div className="ha-ai__result" aria-live="polite" aria-atomic="false">
      {state.request.status === 'running' && <p role="status">Running</p>}
      {state.request.status === 'unconfirmed' && <p role="status">Result is unavailable. Request completion is unconfirmed.</p>}
      {state.request.status === 'start-unavailable' && <p role="status">The request could not be started.</p>}
      {cancellation !== null && <p role="status">{cancellation}</p>}
      {state.recoveryAction.status === 'working' && <p role="status">Checking request status.</p>}
      {state.recoveryAction.status === 'unavailable' && <p role="status">Request status is unavailable. The original request remains retained.</p>}
      {state.recoveryAction.status === 'unconfirmed' && <p role="status">The host has not confirmed request completion.</p>}
      {outcome !== null && <Outcome outcome={outcome} />}
      {state.request.status === 'awaiting-review' && <>
        <button type="button" onClick={onReview} disabled={!ready || connectionBusy || cancelDisabled || state.reviewAction.status === 'working' || state.recoveryAction.status === 'working'}>Open human review</button>
        {state.reviewAction.status === 'working' && <p role="status">Waiting for the trusted human review UI.</p>}
        {state.reviewAction.status === 'pending' && <p role="status">Human review is pending.</p>}
        {state.reviewAction.status === 'unavailable' && <p role="status">Human review is unavailable. Proposed calls remain retained.</p>}
      </>}
    </div>
  </section>;
}

function ConnectionDetails({ connection }: { readonly connection: ConnectionSnapshot }) {
  return <div>
    <dl className="ha-ai__facts">
      <dt>Connection</dt><dd>{methodLabels[connection.method]}</dd>
      <dt>Active account</dt><dd>{connection.account?.label ?? 'Unknown'}</dd>
      <dt>Workspace</dt><dd>{connection.account?.workspaceId ?? 'Unknown'}</dd>
      <dt>Authorization</dt><dd>{authorizationLabels[connection.authorization]}</dd>
      <dt>Eligibility</dt><dd>{eligibilityLabels[connection.eligibility]}</dd>
      <dt>Inference permission</dt><dd>{permissionLabels[connection.permission]}</dd>
      <dt>Plan use</dt><dd>{paidUseLabels[connection.paidUseAdmission]}</dd>
      <dt>Runtime route</dt><dd>{routeLabels[connection.runtime.route]}</dd>
      <dt>Runtime qualification</dt><dd>{connection.runtime.qualification === 'qualified' ? 'Qualified' : 'Held'}</dd>
      <dt>Runtime</dt><dd>{connection.runtime.kind === 'local' ? 'Local' : 'Hosted'} · {availabilityLabels[connection.runtime.availability]}</dd>
      <dt>Runtime checked</dt><dd>{connection.runtime.checkedAt === null ? 'Unknown' : <time dateTime={connection.runtime.checkedAt}>{connection.runtime.checkedAt}</time>}</dd>
      <dt>Token usage</dt><dd>{connection.usageSupported ? 'Supported' : 'Unavailable'}</dd>
    </dl>
    {connection.paidUseAdmission === 'held' && <p role="status">Inference is disabled until zero paid use is verified or specific credit spending is approved.</p>}
    {connection.runtime.qualification === 'held' && <p role="status">The inference runtime is awaiting qualification.</p>}
    {(!canInfer(connection) || connection.eligibility === 'unknown')
      && connection.paidUseAdmission !== 'held' && connection.runtime.qualification !== 'held'
      && <p role="status">{readinessMessage(connection)}</p>}
  </div>;
}

function Outcome({ outcome }: { readonly outcome: RunOutcome }) {
  return <>
    {outcome.status === 'completed' && <><h3>Response</h3><p className="ha-ai__text">{outcome.text}</p></>}
    {outcome.status === 'cancelled' && <p role="status">Request cancelled.</p>}
    {outcome.status === 'stopped' && <p role="status">Local processing stopped. Provider completion is unconfirmed.</p>}
    {outcome.status === 'failed' && <><h3>Request failed</h3><p role="status">{failureMessages[outcome.reason]}</p>
      {outcome.operationIds.length > 0 && <><p>Earlier domain operations remain recorded by the host.</p><ul>{outcome.operationIds.map(id => <li key={id}>{id}</li>)}</ul></>}</>}
    {outcome.status === 'domain-held' && <>
      <h3>Domain operation</h3><p role="status">{heldMessages[outcome.state]}</p>
      <dl className="ha-ai__facts"><dt>Current operation ID</dt><dd>{outcome.operationId ?? 'Unknown'}</dd></dl>
      {outcome.operationIds.length > 0 && <><p>Recorded domain operations</p>
        <ul aria-label="Recorded domain operations">{outcome.operationIds.map(id => <li key={id}>{id}</li>)}</ul></>}
    </>}
    {outcome.status === 'review-required' && <>
      <h3>Tool review</h3>
      <p>Proposed calls require the separate trusted human review UI.</p>
      <ol className="ha-ai__calls">{outcome.calls.map(call => <li key={call.callId}>
        <h4>{call.name}</h4>
        <dl className="ha-ai__facts"><dt>Call ID</dt><dd>{call.callId}</dd></dl>
        <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
      </li>)}</ol>
      {outcome.reviews.map(review => <div key={review.challengeId} className="ha-ai__review">
        <h4>{review.commandId}</h4>
        <dl className="ha-ai__facts">
          <dt>Challenge ID</dt><dd>{review.challengeId}</dd>
          <dt>Recoverability</dt><dd>{review.recoverability}</dd>
          <dt>Expires</dt><dd><time dateTime={review.expiresAt}>{review.expiresAt}</time></dd>
        </dl>
        <details><summary>Affected targets and intent</summary>
          <pre>{JSON.stringify(review.affectedTargets, null, 2)}</pre>
          <dl className="ha-ai__facts">
            <dt>Request digest</dt><dd>{review.requestDigest}</dd><dt>Target digest</dt><dd>{review.targetDigest}</dd>
            <dt>Impact ID</dt><dd>{review.impactId}</dd><dt>Impact digest</dt><dd>{review.impactDigest}</dd>
          </dl>
        </details>
      </div>)}
    </>}
    <UsageDetails usage={outcome.usage} />
  </>;
}

function UsageDetails({ usage }: { readonly usage: Usage }) {
  return <dl className="ha-ai__facts" aria-label="Token usage">
    <dt>Input tokens</dt><dd>{tokenCount(usage.inputTokens)}</dd>
    <dt>Output tokens</dt><dd>{tokenCount(usage.outputTokens)}</dd>
    <dt>Total tokens</dt><dd>{tokenCount(usage.totalTokens)}</dd>
  </dl>;
}
