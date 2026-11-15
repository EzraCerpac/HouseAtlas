import { useState } from 'react';
import { useStore } from '../state/store';
import { Empty } from '../components/ui';
import { Sources } from '../components/DetailPanel';

/** The same reload as Settings; the failure it answers stays beside it. */
function ReloadHistory({ status }: { status: string }) {
  const { actions } = useStore();
  const [state, setState] = useState<'idle' | 'reloading' | 'failed'>('idle');
  const reload = async () => {
    if (state === 'reloading') return;
    setState('reloading');
    try { setState((await actions.reload()) ? 'idle' : 'failed'); } catch { setState('failed'); }
  };
  return <>
    <button type="button" className="btn" onClick={reload} disabled={state === 'reloading'}>{state === 'reloading' ? 'Reloading saved information…' : 'Reload saved information'}</button>
    {state === 'failed' && <p className="body-text" role="status">The reload did not succeed; operation history is still {status}.</p>}
  </>;
}

export function ChangesView() {
  const { house, dispatch, projection, actions } = useStore();
  const history = projection.operationHistory;
  const events = history.status === 'ready' ? [...(history.earlierPages ?? []), history.page].flatMap(page => page.entries) : [];
  return <div className="view"><header className="view-head view-head-row"><h1>Changes</h1>
      {actions.nativeContent != null && <button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'nativeOpen', open: true })}>Atlas tools</button>}</header>
    <div className="changes-grid"><section className="section"><header className="section-head"><h3>Operation history</h3></header>
      {history.status === 'loading' && <p className="body-text" role="status">Loading operation history…</p>}
      {/* A view without a signed-in session (the example house) has no history reader to retry. */}
      {history.status === 'unavailable' && (actions.session
        ? <><p className="body-text" role="status">Operation history could not be loaded.</p><ReloadHistory status={history.status} /></>
        : <p className="body-text muted" role="status">Operation history is not supplied in this view, so past changes are unknown here.</p>)}
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
