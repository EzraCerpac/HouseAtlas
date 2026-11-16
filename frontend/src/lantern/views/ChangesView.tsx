import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Empty } from '../components/ui';
import { Sources } from '../components/DetailPanel';

export function ChangesView() {
  const { house, dispatch, projection, actions } = useStore();
  const history = projection.operationHistory;
  // A read asked from the button: 'asked' until the host shows it loading, 'reading' until it settles.
  // The button stays mounted through both, so keyboard focus is kept while the read runs.
  const [retry, setRetry] = useState<'idle' | 'asked' | 'reading'>('idle');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (retry === 'asked' && history.status === 'loading') setRetry('reading');
    else if (retry === 'reading' && history.status !== 'loading') {
      setRetry('idle');
      // The history arrived and the button went: focus left on the page moves to the section heading.
      if (history.status !== 'unavailable' && document.activeElement === document.body) heading.current?.focus();
    }
  }, [retry, history.status]);
  const retrying = retry !== 'idle' && history.status === 'loading';
  const events = history.status === 'ready' ? [...(history.earlierPages ?? []), history.page].flatMap(page => page.entries) : [];
  return <div className="view"><header className="view-head view-head-row"><h1>Changes</h1>
      {actions.nativeContent != null && <button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'nativeOpen', open: true })}>Atlas tools</button>}</header>
    <div className="changes-grid"><section className="section"><header className="section-head"><h3 ref={heading} tabIndex={-1}>Operation history</h3></header>
      {history.status === 'loading' && !retrying && <p className="body-text" role="status">Loading operation history…</p>}
      {/* The read failed or this view has no history to read; the client cannot tell which. The button repeats that read. */}
      {(history.status === 'unavailable' || retrying) && <><p className="body-text" role="status">{retrying ? 'Reading operation history…'
        : 'Operation history could not be read in this view, so past changes are unknown here. Sources are read separately.'}</p>
        {actions.retryOperationHistory && <button type="button" className="btn" aria-disabled={retrying}
          onClick={() => { if (retry !== 'idle') return; setRetry('asked'); actions.retryOperationHistory?.(); }}>Read operation history again</button>}</>}
      {history.status === 'denied' && <p className="body-text" role="status">Access to operation history is denied.</p>}
      {history.status === 'expired' && <p className="body-text" role="status">The session for this history read has expired.</p>}
      {history.status === 'ready' && <>
        <p className="body-text muted">Partial coverage: retained Atlas stock events only. Unlinked, legacy and provider history are excluded.</p>
        {!events.length && <Empty>No retained Atlas stock events were returned for this home.</Empty>}
        <ol className="history" aria-label="Retained operation events">
          {events.map(event => <li key={event.eventId}>
            <span className="history-when">Audit time {event.at}</span>
            <span className="history-what">{event.commandId}</span>
            <span className="history-who">Actor {event.actorId} · state: {event.state}</span>
            <details><summary>Event details</summary><dl className="facts">
              <div><dt>Event ID</dt><dd>{event.eventId}</dd></div>
              <div><dt>Root operation ID</dt><dd>{event.rootOperationId}</dd></div>
              <div><dt>Operation ID</dt><dd>{event.operationId}</dd></div>
              <div><dt>Target authority</dt><dd>{event.target.authority}</dd></div>
              <div><dt>Record type</dt><dd>{event.target.recordType}</dd></div>
              <div><dt>Record ID</dt><dd>{event.target.recordId}</dd></div>
              <div><dt>Request digest</dt><dd>{event.requestDigest}</dd></div>
            </dl></details>
          </li>)}
        </ol>
        {history.page.nextCursor !== null && <>
          <p className="body-text muted">More covered events are available.</p>
          <button type="button" className="btn" disabled={history.loadingMore || !projection.loadMoreOperations}
            onClick={() => projection.loadMoreOperations?.()}>Load more</button>
        </>}
        {history.loadingMore && <p className="body-text" role="status">Loading more operation history…</p>}
        {history.moreUnavailable && <p className="body-text" role="status">More events could not be loaded. The displayed pages remain partial.</p>}
      </>}
    </section><Sources house={house} outage={false} /></div>
  </div>;
}
