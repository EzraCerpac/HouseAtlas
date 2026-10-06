import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { cancellationMessage, canInfer, failureMessages, readinessMessage, tokenCount } from './model.js';
import type { AiClient, AiSessionState, ConnectionSnapshot, RunOutcome, Usage } from './types.js';
import { useAiSession } from './useAiSession.js';

export interface AiPanelProps {
  readonly client: AiClient;
  readonly scopeLabel: string;
  /** Host-provided full context/epoch identity; labels are not identities. */
  readonly scopeKey: string;
}

/** Remount the draft when the displayed scope changes. */
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
}

const methodLabels: Record<ConnectionSnapshot['method'], string> = {
  'sign-in-with-chatgpt': 'Sign in with ChatGPT',
  'api-key': 'API key',
  'local-runtime': 'Local runtime',
};

const authorizationLabels: Record<ConnectionSnapshot['authorization'], string> = {
  unconfigured: 'Unconfigured',
  'sign-in-required': 'Sign-in required',
  connected: 'Connected',
  expired: 'Expired',
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

export function AiPanelView({ state, scopeLabel, prompt, onPromptChange, onSubmit, onCancel, onRefresh }: AiPanelViewProps) {
  const id = useId();
  const busy = state.request.status === 'running' || state.request.status === 'unconfirmed';
  const ready = state.connection.status === 'available' && canInfer(state.connection.snapshot);
  const cancellation = busy ? cancellationMessage(state.request.cancellation) : null;
  const cancelDisabled = busy && (state.request.cancellation.status === 'sending'
    || state.request.cancellation.status === 'received');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (ready && !busy && prompt.trim().length > 0) onSubmit();
  };

  return <section className="ha-ai" aria-labelledby={`${id}-heading`}>
    <header className="ha-ai__header">
      <h2 id={`${id}-heading`}>AI</h2>
      <button type="button" onClick={onRefresh} disabled={busy || state.connection.status === 'loading'}>Refresh status</button>
    </header>
    <dl className="ha-ai__facts"><dt>Scope</dt><dd>{scopeLabel}</dd></dl>
    {state.connection.status === 'available'
      ? <ConnectionDetails connection={state.connection.snapshot} />
      : <p role="status">{state.connection.status === 'loading' ? 'Checking connection.' : 'Connection status is unavailable.'}</p>}
    <form onSubmit={submit}>
      <label htmlFor={`${id}-prompt`}>Prompt</label>
      <textarea id={`${id}-prompt`} value={prompt} onChange={event => onPromptChange(event.target.value)} rows={4} disabled={busy} />
      <div className="ha-ai__actions">
        <button type="submit" disabled={!ready || busy || prompt.trim().length === 0}>Run</button>
        {busy && <button type="button" onClick={onCancel} disabled={cancelDisabled}>Cancel request</button>}
      </div>
    </form>
    <div className="ha-ai__result" aria-live="polite" aria-atomic="false">
      {state.request.status === 'running' && <p role="status">Running</p>}
      {state.request.status === 'unconfirmed' && <p role="status">Result is unavailable. Request completion is unconfirmed.</p>}
      {state.request.status === 'start-unavailable' && <p role="status">The request could not be started.</p>}
      {cancellation !== null && <p role="status">{cancellation}</p>}
      {state.request.status === 'finished' && <Outcome outcome={state.request.outcome} />}
    </div>
  </section>;
}

function ConnectionDetails({ connection }: { readonly connection: ConnectionSnapshot }) {
  return <div>
    <dl className="ha-ai__facts">
      <dt>Connection</dt><dd>{methodLabels[connection.method]}</dd>
      <dt>Authorization</dt><dd>{authorizationLabels[connection.authorization]}</dd>
      <dt>Eligibility</dt><dd>{eligibilityLabels[connection.eligibility]}</dd>
      <dt>Inference permission</dt><dd>{permissionLabels[connection.permission]}</dd>
      <dt>Runtime</dt><dd>{connection.runtime.kind === 'local' ? 'Local' : 'Hosted'} · {availabilityLabels[connection.runtime.availability]}</dd>
      <dt>Runtime checked</dt><dd>{connection.runtime.checkedAt === null ? 'Unknown' : <time dateTime={connection.runtime.checkedAt}>{connection.runtime.checkedAt}</time>}</dd>
      <dt>Token usage</dt><dd>{connection.usageSupported ? 'Supported' : 'Unavailable'}</dd>
    </dl>
    {(!canInfer(connection) || connection.eligibility === 'unknown') && <p role="status">{readinessMessage(connection)}</p>}
  </div>;
}

function Outcome({ outcome }: { readonly outcome: RunOutcome }) {
  return <>
    {outcome.status === 'completed' && <><h3>Response</h3><p className="ha-ai__text">{outcome.text}</p></>}
    {outcome.status === 'cancelled' && <p role="status">Request cancelled.</p>}
    {outcome.status === 'stopped' && <p role="status">Local processing stopped. Provider completion is unconfirmed.</p>}
    {outcome.status === 'failed' && <><h3>Request failed</h3><p role="status">{failureMessages[outcome.reason]}</p></>}
    {outcome.status === 'review-required' && <>
      <h3>Tool review</h3>
      <p>Proposed tool calls have not been executed. Approval is unavailable in this panel.</p>
      <ol className="ha-ai__calls">{outcome.calls.map(call => <li key={call.callId}>
        <h4>{call.name}</h4>
        <dl className="ha-ai__facts"><dt>Call ID</dt><dd>{call.callId}</dd></dl>
        <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
      </li>)}</ol>
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
