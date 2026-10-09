import type { Doc, Observation, Task } from '../data/types';
import { dueState, historyFor, nameOf, writesFor } from '../data/query';
import { fmtDateTime, fmtShortDate, rel } from '../data/time';
import { useCanWrite, useSelect, useStore } from '../state/store';
import { Icon } from './Icon';
import { Empty, StorageTag, WritePill } from './ui';

export function DocRow({ doc, showLinked }: { doc: Doc; showLinked?: boolean | undefined }) {
  const { dispatch, house } = useStore();
  const select = useSelect();
  return (
    <li className="doc-row">
      <span className={`doc-thumb doc-thumb-${doc.storage === 'link' ? 'link' : doc.kind}`} aria-hidden="true">
        <Icon name={doc.storage === 'link' ? 'link' : doc.kind === 'photo' ? 'photo' : 'file'} size={18} />
      </span>
      <span className="doc-main">
        <button type="button" className="row-title" onClick={() => select(doc.id)}>
          {doc.title}
        </button>
        <span className="row-meta">
          <StorageTag doc={doc} />
          <span>{doc.kind === 'photo' ? `Taken ${fmtShortDate(doc.capturedAt, house.displayNow)}` : `Added ${fmtShortDate(doc.addedAt, house.displayNow)}`}</span>
          {showLinked && doc.linkedTo.length > 0 && <span>{doc.linkedTo.slice(0, 2).map((l) => nameOf(house, l)).join(', ')}</span>}
        </span>
      </span>
      <button
        type="button"
        className="btn btn-quiet btn-small"
        onClick={() => dispatch({ type: 'dialog', dialog: { type: 'preview', docId: doc.id } })}
        aria-label={`${doc.storage === 'link' ? 'Open link details for' : 'File details for'} ${doc.title}`}
      >
        {doc.storage === 'link' ? 'Link details' : 'File details'}
      </button>
    </li>
  );
}

export function DocList({ docs, empty, showLinked }: { docs: Doc[]; empty?: string; showLinked?: boolean | undefined }) {
  if (!docs.length) return <Empty>{empty ?? 'No documents or photos linked yet.'}</Empty>;
  return (
    <ul className="rows">
      {docs.map((d) => (
        <DocRow key={d.id} doc={d} showLinked={showLinked} />
      ))}
    </ul>
  );
}

export function TaskRow({ task, showTarget }: { task: Task; showTarget?: boolean | undefined }) {
  const { dispatch, house } = useStore();
  const select = useSelect();
  const can = useCanWrite('HomeBox');
  const st = dueState(task, house.displayNow);
  const pending = writesFor(house, task.id).length > 0;
  return (
    <li className={`task-row due-${st}`}>
      <span className="task-mark" aria-hidden="true">
        {st === 'done' ? <Icon name="check" size={15} /> : null}
      </span>
      <span className="task-main">
        <button type="button" className="row-title" onClick={() => select(task.id)}>
          {task.title}
        </button>
        <span className="row-meta">
          {st === 'done' ? (
            <span>
              Done {fmtShortDate(task.completedAt, house.displayNow)}
              {task.completedBy ? ` by ${task.completedBy}` : ''}
            </span>
          ) : (
            <span className={`due-text due-${st}`}>
              {task.due ? <>{st === 'overdue' ? 'Overdue, was due ' : 'Due '}{fmtShortDate(task.due, house.displayNow)} ({rel(task.due, house.displayNow)})</> : 'No schedule supplied'}
            </span>
          )}
          {task.cost !== undefined && <span>Recorded cost {task.cost}, currency not recorded</span>}
          {showTarget && <span>{nameOf(house, task.targetId)}</span>}
        </span>
      </span>
      {st !== 'done' && (
        <button
          type="button"
          className="btn btn-small"
          disabled={!can.ok || pending}
          title={!can.ok ? can.reason : pending ? 'A change to this task is already in progress.' : undefined}
          onClick={() => dispatch({ type: 'dialog', dialog: { type: 'complete', taskId: task.id } })}
        >
          {pending ? 'Saving' : 'Mark done'}
        </button>
      )}
    </li>
  );
}

export function TaskList({ tasks, showTarget, empty }: { tasks: Task[]; showTarget?: boolean | undefined; empty?: string }) {
  if (!tasks.length) return <Empty>{empty ?? 'No upkeep recorded.'}</Empty>;
  const sorted = [...tasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'scheduled' ? -1 : 1;
    if (a.status === 'done') return (b.completedAt ?? '').localeCompare(a.completedAt ?? '');
    return (a.due ?? '9999').localeCompare(b.due ?? '9999');
  });
  return (
    <ul className="rows">
      {sorted.map((t) => (
        <TaskRow key={t.id} task={t} showTarget={showTarget} />
      ))}
    </ul>
  );
}

export function HistoryList({ id }: { id: string }) {
  const { house } = useStore();
  const events = historyFor(house, id);
  if (!events.length) return <Empty>History is not supplied by this saved view.</Empty>;
  return (
    <ol className="history">
      {events.map((e) => (
        <li key={e.id}>
          <span className="history-when">{fmtDateTime(e.at)}</span>
          <span className="history-what">{e.what}</span>
          <span className="history-who">
            {e.who}, in {e.system}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function PendingWrites({ id }: { id: string }) {
  const { house, dispatch } = useStore();
  const writes = writesFor(house, id);
  if (!writes.length) return null;
  return (
    <div className="pending" role="status">
      {writes.map((w) => (
        <div key={w.id} className={`pending-row pending-${w.status}`}>
          <WritePill status={w.status} />
          <span className="pending-title">{w.title}</span>
          {(w.status === 'conflict' || w.status === 'uncertain') && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() =>
                w.status === 'conflict'
                  ? dispatch({ type: 'dialog', dialog: { type: 'conflict', writeId: w.id } })
                  : dispatch({ type: 'view', view: 'changes', focus: w.id })
              }
            >
              Review
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function ObservationList({ obs }: { obs: Observation[] }) {
  const sorted = [...obs].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  return (
    <ul className="obs-list">
      {sorted.map((o) => (
        <li key={o.id} className="obs">
          <p className="obs-summary">{o.summary}</p>
          <dl className="obs-times">
            <div>
              <dt>Observed</dt>
              <dd>{fmtDateTime(o.observedAt)}</dd>
            </div>
            <div>
              <dt>Retrieved</dt>
              <dd>{fmtDateTime(o.retrievedAt)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{o.source}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>
                <span className={`conf conf-${o.confidence}`}>{o.confidence[0]!.toUpperCase() + o.confidence.slice(1)}</span>
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

export function IdentityBlock({ id, rows }: { id: string; rows: [string, string][] }) {
  const { projection } = useStore();
  const entry = projection.entries.get(id);
  return <dl className="facts identity">
    <div><dt>Qualified source key</dt><dd><code className="atlas-id">{entry?.key ?? 'Not supplied'}</code></dd></div>
    {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
  </dl>;
}
