import { useId, useSyncExternalStore } from 'react';
import type { SuggestionReviewController } from './controller';
import './suggestion-review.css';

const relation = { 'possible-duplicate': 'Possible duplicate', 'same-product': 'Same product, identity unconfirmed',
  'proposed-association': 'Proposed association' };
const freshness = { 'snapshot-current': 'Snapshot current at proposal', stale: 'Stale source', unknown: 'Freshness unknown' };
/** Unmounted review island. The host owns the stable controller and all source resolution. */
export function SuggestionReview({ controller }: { readonly controller: SuggestionReviewController }) {
  const id = useId();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const view = state.view, editable = state.phase === 'reviewing';
  if (!view) return <section className="ha-suggestion-review" aria-label="Suggestion review"><p role="status">{state.message}</p></section>;
  const selected = state.fields.some(f => f.selected) || state.candidateKeys.length > 0;
  const inspectable = state.phase === 'reviewing' || state.phase === 'stale';
  return <section className="ha-suggestion-review" aria-labelledby={id + '-title'}>
    <header><h2 id={id + '-title'}>{view.kind === 'inventory' ? 'Inventory suggestions' : 'Document suggestions'}</h2>
      <p>{view.title}</p><p>Proposals require source-owner review before a change.</p></header>
    <p role="status" aria-live="polite">{state.message}</p>
    <section aria-labelledby={id + '-evidence'}><h3 id={id + '-evidence'}>Original evidence</h3>
      {view.sources.map((source, index) => <article key={source.key}>
        <h4>{source.label}</h4>
        <dl><dt>Version</dt><dd>{source.recordVersion}</dd><dt>Source date</dt><dd>{source.sourceDate ?? 'Unknown'}</dd>
          <dt>Retrieved</dt><dd>{source.retrievedAt ?? 'Unknown'}</dd><dt>Freshness</dt><dd>{freshness[source.freshness]}</dd>
          <dt>Original</dt><dd>{source.original}</dd><dt>Location</dt><dd>
            {source.page === null ? 'Page unknown' : 'Page ' + source.page}{source.section ? ' · ' + source.section : ''}</dd></dl>
        <blockquote>{source.excerpt || 'No excerpt supplied.'}</blockquote>
        <button type="button" disabled={!inspectable || source.original !== 'available'}
          onClick={() => { void controller.inspectSource(source.key); }}>Inspect source {index + 1}</button>
      </article>)}
    </section>
    <section aria-labelledby={id + '-fields'}><h3 id={id + '-fields'}>Proposed fields</h3>
      {!view.fields.length && <p>No field suggestion.</p>}
      {view.fields.map((field, index) => {
        const draft = state.fields.find(f => f.key === field.key)!;
        return <fieldset key={field.key} disabled={!editable}>
          <legend>{field.label}</legend>
          <label><input type="checkbox" checked={draft.selected}
            onChange={event => { controller.selectField(field.key, event.target.checked); }} />Select for review</label>
          <p>Current: {field.current ?? 'Unknown'}</p>
          <label htmlFor={id + '-field-' + index}>Proposed value</label>
          <input id={id + '-field-' + index} value={draft.value} maxLength={4096}
            onChange={event => { controller.editField(field.key, event.target.value); }} />
          <p>{field.reason}</p><p>Uncertainty: {field.uncertainty || 'Not supplied'}</p>
          <p>Evidence: {field.evidenceKeys.map(key => view.sources.find(s => s.key === key)!.label).join('; ')}</p>
        </fieldset>;
      })}
    </section>
    <section aria-labelledby={id + '-candidates'}><h3 id={id + '-candidates'}>Candidates</h3>
      {!view.candidates.length && <p>No candidate supplied. Identity and location remain unknown.</p>}
      {view.candidates.map(candidate => <fieldset key={candidate.key} disabled={!editable}>
        <legend>{candidate.label}</legend><p>{relation[candidate.relation]}</p>
        <label><input type="checkbox" checked={state.candidateKeys.includes(candidate.key)}
          onChange={event => { controller.selectCandidate(candidate.key, event.target.checked); }} />Select candidate for review</label>
        <p>{candidate.reason}</p><p>Uncertainty: {candidate.uncertainty || 'Not supplied'}</p>
        <p>Evidence: {candidate.evidenceKeys.map(key => view.sources.find(s => s.key === key)!.label).join('; ')}</p>
      </fieldset>)}
    </section>
    <section aria-labelledby={id + '-unknowns'}><h3 id={id + '-unknowns'}>Uncertainty</h3>
      {view.uncertainty.length ? <ul>{view.uncertainty.map((text, index) => <li key={index}>{text}</li>)}</ul> : <p>No uncertainty detail supplied.</p>}
      {view.uncalibratedScore !== null && <p>Uncalibrated model score: {view.uncalibratedScore}. This is not a probability or approval.</p>}
      {view.kind === 'document' && <p>Documentary links do not establish tested wiring or physical placement.</p>}
    </section>
    <footer><button type="button" disabled={!editable || !selected} onClick={() => { void controller.decide('accept-for-review'); }}>Accept selection for review</button>
      <button type="button" disabled={!editable} onClick={() => { void controller.decide('reject'); }}>Reject suggestion</button>
      <button type="button" onClick={controller.dismiss}>Dismiss</button></footer>
  </section>;
}
