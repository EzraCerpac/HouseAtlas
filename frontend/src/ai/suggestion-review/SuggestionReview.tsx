import { useId, useSyncExternalStore } from 'react';
import type { SuggestionReviewController } from './controller';
import type { MaintenanceTaskView, MaintenanceTaskDraft, MaintenanceUnit, MaintenanceUrgency } from './view-types';
import './suggestion-review.css';

const relation = { 'possible-duplicate': 'Possible duplicate', 'same-product': 'Same product, identity unconfirmed',
  'proposed-association': 'Proposed association' };
const headings = { inventory: 'Inventory suggestions', document: 'Document suggestions', maintenance: 'Maintenance suggestions', answer: 'Cited answer', contradictions: 'Record comparisons' };
const unitLabels: Record<MaintenanceUnit, string> = { days: 'Days', weeks: 'Weeks', months: 'Months', years: 'Years', 'usage-hours': 'Usage hours' };
const urgencyLabels: Record<MaintenanceUrgency, string> = { unknown: 'Unknown', routine: 'Routine', 'review-soon': 'Review soon' };
const answerRoutes = { inventory: 'Inventory', documents: 'Documents', maintenance: 'Maintenance',
  electrical: 'Electrical records', network: 'Network records', clarify: 'Clarification needed', unknown: 'Route unknown' };
const comparisonPatterns = { 'incompatible-location': 'Possible incompatible locations',
  'conflicting-association': 'Possible conflicting associations', 'possible-supersession': 'Possible supersession' };
const qualitative = { tentative: 'Tentative', ambiguous: 'Ambiguous', unknown: 'Unknown' };
const freshness = { 'snapshot-current': 'Snapshot current at proposal', stale: 'Stale source', unknown: 'Freshness unknown' };
/** Unmounted review island. The host owns the stable controller and all source resolution. */
export function SuggestionReview({ controller }: { readonly controller: SuggestionReviewController }) {
  const id = useId();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const view = state.view, editable = state.phase === 'reviewing';
  if (!view) return <section className="ha-suggestion-review" aria-label="Suggestion review"><p role="status">{state.message}</p></section>;
  const readOnly = view.kind === 'answer' || view.kind === 'contradictions';
  const selected = state.fields.some(f => f.selected) || state.candidateKeys.length > 0 || state.maintenance.some(task => task.selected);
  const incomplete = state.maintenance.some(task => task.selected && !task.valid);
  const inspectable = state.phase === 'reviewing' || state.phase === 'stale';
  return <section className="ha-suggestion-review" aria-labelledby={id + '-title'}>
    <header><h2 id={id + '-title'}>{headings[view.kind]}</h2>
      <p>{view.title}</p><p>{view.kind === 'answer' ? 'Read-only answer from bounded source evidence.' : view.kind === 'contradictions' ? 'Comparison candidates; no assertion has been selected as correct.' : 'Proposals require source-owner review before a change.'}</p></header>
    <p role="status" aria-live="polite">{state.message}</p>
    <section aria-labelledby={id + '-evidence'}><h3 id={id + '-evidence'}>Original evidence</h3>
      {!view.sources.length && <p>No cited source supplied.</p>}
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
    {(view.kind === 'inventory' || view.kind === 'document') && <><section aria-labelledby={id + '-fields'}><h3 id={id + '-fields'}>Proposed fields</h3>
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
    </>}
    {view.kind === 'maintenance' && <section aria-labelledby={id + '-maintenance'}>
      <h3 id={id + '-maintenance'}>Proposed maintenance</h3>
      {!view.maintenance?.length && <p>No maintenance task suggested.</p>}
      {view.maintenance?.map((task, index) => <MaintenanceTaskEditor key={task.key} task={task}
        draft={state.maintenance.find(v => v.key === task.key)!} controller={controller}
        disabled={!editable} id={id + '-task-' + index}
        evidenceLabels={task.evidenceKeys.map(key => view.sources.find(source => source.key === key)!.label)} />)}
      {incomplete && <p role="status">Complete each selected task title, interval and condition before review.</p>}
    </section>}
    {view.kind === 'answer' && view.answer && <section aria-labelledby={id + '-answer'}>
      <h3 id={id + '-answer'}>{answerRoutes[view.answer.route]}</h3>
      <p>{view.answer.coverage === 'partial' ? 'Partial answer; retrieved records are not exhaustive.' : 'No supported answer.'}</p>
      {view.answer.route === 'clarify' && <p>The admitted evidence requires clarification before answering.</p>}
      {view.answer.route === 'unknown' && <p>No supported question route was established.</p>}
      {view.answer.statements.map(statement => <article key={statement.key}>
        <p className="ha-suggestion-answer-text">{statement.text}</p>
        <p>Source rationale: {statement.reason}</p><p>Uncertainty: {statement.uncertainty}</p>
        <p>Evidence: {statement.evidenceKeys.map(key => {
          const source = view.sources.find(value => value.key === key)!;
          return source.label + ' · version ' + source.recordVersion
            + (source.page === null ? ' · page unknown' : ' · page ' + source.page)
            + (source.section ? ' · ' + source.section : '') + ' · source date ' + (source.sourceDate ?? 'Unknown');
        }).join('; ')}</p>
      </article>)}
      <h4>Ranked records</h4>
      {view.answer.rankedCandidates.length ? <><ol>{view.answer.rankedCandidates.map(candidate =>
        <li key={candidate.key}>{candidate.label}</li>)}</ol><p>Source-provided order; no identity, confidence or approval is established.</p></>
        : <p>No ranked record supplied.</p>}
      <h4>Missing evidence</h4>
      {view.answer.missingEvidence.length ? <ul>{view.answer.missingEvidence.map((value, index) =>
        <li className="ha-suggestion-answer-text" key={index}>{value}</li>)}</ul> : <p>No missing-evidence detail supplied; coverage remains partial.</p>}
      {(view.answer.route === 'electrical' || view.answer.route === 'network') &&
        <p>Source records do not establish tested wiring, a safe breaker, a physical route or an instruction to operate equipment.</p>}
    </section>}
    {view.kind === 'contradictions' && view.contradictions && <section aria-labelledby={id + '-comparisons'}>
      <h3 id={id + '-comparisons'}>Flagged comparisons</h3>
      <p>Old age or newer retrieval does not establish falsity or superiority. Different assertions may describe compatible history.</p>
      <p>Matching names do not establish the same item.</p>
      {!view.contradictions.findings.length && <p>No comparison candidate supplied; this does not establish that records agree.</p>}
      {view.contradictions.findings.map(finding => <article key={finding.key}>
        <h4>{comparisonPatterns[finding.pattern]}</h4>
        <p className="ha-suggestion-assertion-text">Why flagged: {finding.rationale}</p>
        <p>Comparison uncertainty: {qualitative[finding.uncertainty]}</p>
        <ol className="ha-suggestion-assertions">{finding.assertions.map(assertion => <li key={assertion.key}>
          <p className="ha-suggestion-assertion-text">Cited assertion: {assertion.text}</p>
          <p>Assertion uncertainty: {qualitative[assertion.uncertainty]}</p>
          <p>Fact date: {assertion.factDate ?? 'Unknown'}</p>
          {assertion.evidenceKeys.map(key => {
            const source = view.sources.find(value => value.key === key)!;
            return <dl key={key}><dt>Source</dt><dd>{source.label}</dd>
              <dt>Version</dt><dd>{source.recordVersion}</dd>
              <dt>Source date</dt><dd>{source.sourceDate ?? 'Unknown'}</dd>
              <dt>Retrieved</dt><dd>{source.retrievedAt ?? 'Unknown'}</dd>
              <dt>Evidence location</dt><dd>{source.page === null ? 'Page unknown' : 'Page ' + source.page}
                {source.section ? ' · ' + source.section : ''}</dd>
              <dt>Freshness</dt><dd>{freshness[source.freshness]}</dd>
              <dt>Original</dt><dd>{source.original}</dd></dl>;
          })}
        </li>)}</ol>
      </article>)}
      <h4>Missing information</h4>
      {view.contradictions.missingEvidence.length ? <ul>{view.contradictions.missingEvidence.map((value, index) =>
        <li className="ha-suggestion-assertion-text" key={index}>{value}</li>)}</ul> : <p>No missing-information detail supplied; the candidate remains unconfirmed.</p>}
      <p>These comparisons do not establish tested wiring, a safe breaker, a physical route or an instruction to operate equipment.</p>
      <p>Dismissal is local; no correction, persistent decision or duplicate-resolution history is recorded.</p>
    </section>}
    <section aria-labelledby={id + '-unknowns'}><h3 id={id + '-unknowns'}>Uncertainty</h3>
      {view.uncertainty.length ? <ul>{view.uncertainty.map((text, index) => <li key={index}>{text}</li>)}</ul> : <p>No uncertainty detail supplied.</p>}
      {view.uncalibratedScore !== null && <p>Uncalibrated model score: {view.uncalibratedScore}. This is not a probability or approval.</p>}
      {view.kind === 'document' && <p>Documentary links do not establish tested wiring or physical placement.</p>}
    </section>
    <footer>{!readOnly && <><button type="button" disabled={!editable || !selected || incomplete} onClick={() => { void controller.decide('accept-for-review'); }}>Accept selection for review</button>
      <button type="button" disabled={!editable} onClick={() => { void controller.decide('reject'); }}>Reject suggestion</button></>}
      <button type="button" onClick={controller.dismiss}>Dismiss</button></footer>
  </section>;
}

function MaintenanceTaskEditor({ task, draft, controller, disabled, id, evidenceLabels }: {
  readonly task: MaintenanceTaskView; readonly draft: MaintenanceTaskDraft;
  readonly controller: SuggestionReviewController; readonly disabled: boolean; readonly id: string; readonly evidenceLabels: readonly string[];
}) {
  const proposed = task.interval.kind === 'periodic' ? 'Every ' + task.interval.every + ' ' + unitLabels[task.interval.unit].toLowerCase()
    : task.interval.kind === 'conditional' ? 'When: ' + task.interval.condition : 'Unknown';
  return <fieldset disabled={disabled}>
    <legend>{task.title}</legend>
    <p>Target: {task.targetLabel || 'Unknown'}</p>
    <p>Recorded service baseline: {task.baselineDate ?? 'Unknown'}</p>
    <p>Proposed interval: {proposed}</p>
    <p>Proposed urgency: {urgencyLabels[task.urgency]}</p>
    <label><input type="checkbox" checked={draft.selected}
      onChange={event => { controller.selectMaintenanceTask(task.key, event.target.checked); }} />Select task for review</label>
    {draft.edited && <p>Edited for review</p>}
    <label htmlFor={id + '-title'}>Task title for review</label>
    <input id={id + '-title'} value={draft.title} maxLength={4096}
      onChange={event => { controller.editMaintenanceTask(task.key, { title: event.target.value }); }} />
    <label htmlFor={id + '-kind'}>Interval for review</label>
    <select id={id + '-kind'} value={draft.interval.kind} onChange={event => {
      const kind = event.target.value; if (kind === draft.interval.kind) return;
      if (kind === 'periodic') controller.editMaintenanceTask(task.key, { interval: { kind, every: '', unit: null } });
      else if (kind === 'conditional') controller.editMaintenanceTask(task.key, { interval: { kind, condition: '' } });
      else if (kind === 'unknown') controller.editMaintenanceTask(task.key, { interval: { kind } });
    }}>
      <option value="unknown">Unknown interval</option><option value="periodic">Periodic</option><option value="conditional">Condition-based</option>
    </select>
    {draft.interval.kind === 'periodic' && <>
      <label htmlFor={id + '-every'}>Every</label>
      <input id={id + '-every'} inputMode="numeric" value={draft.interval.every} maxLength={10}
        onChange={event => { if (draft.interval.kind === 'periodic') controller.editMaintenanceTask(task.key,
          { interval: { ...draft.interval, every: event.target.value } }); }} />
      <label htmlFor={id + '-unit'}>Unit</label>
      <select id={id + '-unit'} value={draft.interval.unit ?? ''} onChange={event => {
        if (draft.interval.kind === 'periodic') controller.editMaintenanceTask(task.key,
          { interval: { ...draft.interval, unit: event.target.value === '' ? null : event.target.value as MaintenanceUnit } });
      }}><option value="">Select unit</option>
        {(Object.keys(unitLabels) as MaintenanceUnit[]).map(unit => <option key={unit} value={unit}>{unitLabels[unit]}</option>)}
      </select>
    </>}
    {draft.interval.kind === 'conditional' && <>
      <label htmlFor={id + '-condition'}>Interval condition</label>
      <textarea id={id + '-condition'} value={draft.interval.condition} maxLength={4096}
        onChange={event => { if (draft.interval.kind === 'conditional') controller.editMaintenanceTask(task.key,
          { interval: { kind: 'conditional', condition: event.target.value } }); }} />
    </>}
    <label htmlFor={id + '-urgency'}>Urgency for review</label>
    <select id={id + '-urgency'} value={draft.urgency}
      onChange={event => { controller.editMaintenanceTask(task.key, { urgency: event.target.value as MaintenanceUrgency }); }}>
      {(Object.keys(urgencyLabels) as MaintenanceUrgency[]).map(urgency => <option key={urgency} value={urgency}>{urgencyLabels[urgency]}</option>)}
    </select>
    <p>Conditions for review</p>
    {!draft.conditions.length && <p>No conditions specified.</p>}
    {draft.conditions.map((condition, index) => <div key={index}>
      <label htmlFor={id + '-condition-' + index}>Condition {index + 1}</label>
      <textarea id={id + '-condition-' + index} value={condition} maxLength={4096} onChange={event => {
        controller.editMaintenanceTask(task.key, { conditions: draft.conditions.map((v, i) => i === index ? event.target.value : v) });
      }} />
      <button type="button" onClick={() => { controller.editMaintenanceTask(task.key,
        { conditions: draft.conditions.filter((_, i) => i !== index) }); }}>Remove condition {index + 1}</button>
    </div>)}
    <button type="button" disabled={disabled || draft.conditions.length >= 16} onClick={() => {
      controller.editMaintenanceTask(task.key, { conditions: [...draft.conditions, ''] });
    }}>Add condition</button>
    <p>Proposal rationale: {task.reason}</p><p>Uncertainty: {task.uncertainty || 'Not supplied'}</p>
    <p>Evidence: {evidenceLabels.join('; ')}</p>
  </fieldset>;
}
