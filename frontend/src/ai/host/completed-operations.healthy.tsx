/** Positive actual Rust DTO projections in the strict decoder and real panel.
 * Render only: no host action, inference, review, domain dispatch or transport. */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AiPanelView } from '../AiPanel.js';
import { healthyAiExamples } from '../examples.js';
import { decodeRequestStatus, decodeRunOutcome } from './decode.js';
import type { RunOutcome } from '../types.js';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export async function runHealthyCompletedOperations(container: HTMLElement, peer: unknown) {
  assert(peer !== null && typeof peer === 'object', 'Actual Rust DTO projections');
  const row = peer as Record<string, unknown>;
  const expected = row['expectedIds'];
  assert(Array.isArray(expected) && expected.length === 4
    && expected.every(id => typeof id === 'string'), 'Four ordered synthetic prior/new correlations');
  const resumed = decodeRunOutcome(row['resumed']);
  const fresh = decodeRunOutcome(row['fresh']);
  const polled = decodeRequestStatus(row['requestStatus'], 'synthetic-completed-status');
  assert(resumed.status === 'completed' && fresh.status === 'completed'
    && polled.status === 'finished' && polled.outcome.status === 'completed', 'Completed DTO branches');
  assert(JSON.stringify(resumed.operationIds) === JSON.stringify(expected), 'Ordered resumed IDs decoded');
  assert(JSON.stringify(polled.outcome.operationIds) === JSON.stringify(expected), 'Polling preserves every ID');
  assert(fresh.operationIds.length === 0, 'Explicit empty operation list decoded');
  assert(resumed.usage.inputTokens === 9 && resumed.usage.outputTokens === 4
    && resumed.usage.totalTokens === null, 'Known and unknown usage retained');
  const root = createRoot(container);
  const noop = () => undefined;
  function render(outcome: RunOutcome) {
    flushSync(() => root.render(<AiPanelView
      state={{ ...healthyAiExamples.completed,
        request: { status: 'finished', requestId: 'synthetic-completed-panel', outcome } }}
      scopeLabel="Synthetic completed home" prompt="" onPromptChange={noop}
      onSubmit={noop} onCancel={noop} onRefresh={noop} onConnectionAction={noop}
      onReview={noop} onRecover={noop} />));
  }
  function renderedIds() {
    return [...container.querySelectorAll('[aria-label="Recorded domain operations"] li')]
      .map(item => item.textContent);
  }
  function tokens(name: string) {
    return [...container.querySelectorAll('dt')].find(item => item.textContent === name)
      ?.nextElementSibling?.textContent;
  }
  try {
    render(resumed);
    assert(JSON.stringify(renderedIds()) === JSON.stringify(expected), 'All ordered IDs visible beside response');
    assert(container.textContent?.includes(resumed.text), 'Response text retained');
    assert(tokens('Input tokens') === '9' && tokens('Output tokens') === '4'
      && tokens('Total tokens') === 'Unknown', 'Usage uncertainty remains visible');
    render(polled.outcome);
    assert(JSON.stringify(renderedIds()) === JSON.stringify(expected), 'Polled completion retains display');
    render(fresh);
    assert(renderedIds().length === 0, 'Fresh empty list does not retain earlier IDs');
    assert(container.textContent?.includes(fresh.text), 'Fresh response retained');
    return { case: 'healthy-completed-operations', orderedOperationIds: [...expected],
      branches: ['resumed completion', 'original-ID finished status', 'explicit empty completion'],
      usage: resumed.usage, scope: 'Actual Rust serde DTOs, strict decoder and real React panel; render only, no callback/dispatch/provider/inference.' };
  } finally { flushSync(() => root.unmount()); }
}
