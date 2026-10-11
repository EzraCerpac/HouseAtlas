import type { Task } from '../data/types';
import { dueState } from '../data/query';
import { fmtDate } from '../data/time';
import { useStore } from '../state/store';
import { TaskRow } from '../components/rows';
import { Empty, Note } from '../components/ui';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function DateMark({ iso, now }: { iso?: string | undefined; now?: string | undefined }) {
  if (!iso || fmtDate(iso.slice(0, 10)) === 'Unknown') return <span className="tl-date">Unknown</span>;
  const [y, m = 1, d] = iso.slice(0, 10).split('-').map(Number);
  const reference = now === undefined ? new Date() : new Date(now);
  const sameYear = (now === undefined || fmtDate(now) !== 'Unknown') && y === reference.getFullYear();
  return (
    <time className="tl-date" dateTime={iso.slice(0, 10)}>
      <span className="tl-day">{d}</span>
      <span className="tl-mon">
        {MON[m - 1]} {sameYear ? '' : y}
      </span>
    </time>
  );
}

function Group({ title, tasks, tone, dateOf, now }: { title: string; tasks: Task[]; tone: string; dateOf: (t: Task) => string | undefined; now?: string | undefined }) {
  return (
    <section className={`tl-group tl-${tone}`} aria-labelledby={`tl-${tone}`}>
      <h2 id={`tl-${tone}`}>
        {title}
        <span className="section-count">{tasks.length}</span>
      </h2>
      {tasks.length ? (
        <ol className="timeline">
          {tasks.map((t) => (
            <li key={t.id} className="tl-row">
              <DateMark iso={dateOf(t)} now={now} />
              <ul className="rows">
                <TaskRow task={t} showTarget />
              </ul>
            </li>
          ))}
        </ol>
      ) : (
        <Empty>Nothing here.</Empty>
      )}
    </section>
  );
}

export function UpkeepView() {
  const { house, state } = useStore();
  const byDue = (a: Task, b: Task) => (a.due ?? '9999').localeCompare(b.due ?? '9999');
  const overdue = house.tasks.filter((t) => dueState(t, house.displayNow) === 'overdue').sort(byDue);
  const soon = house.tasks.filter((t) => dueState(t, house.displayNow) === 'soon').sort(byDue);
  const later = house.tasks.filter((t) => t.status !== 'unknown' && dueState(t, house.displayNow) === 'later').sort(byDue);
  const undated = house.tasks.filter(t => t.status === 'unknown');
  const done = house.tasks.filter((t) => t.status === 'done').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  return (
    <div className="view">
      <header className="view-head">
        <h1>Upkeep</h1>
        <p>Maintenance records for {house.name}. Upkeep is kept in HomeBox.</p>
      </header>
      {state.settings.outage && <Note tone="warn">HomeBox is unreachable, so tasks can’t be marked done right now. You are looking at the cached copy.</Note>}
<Note>Use the verified HomeBox maintenance link in record details when available.</Note>
      <div className="tl-columns">
        <div>
          <Group title="Overdue" tasks={overdue} tone="overdue" dateOf={(t) => t.due} now={house.displayNow} />
          <Group title="Next two weeks" tasks={soon} tone="soon" dateOf={(t) => t.due} now={house.displayNow} />
          <Group title="Later" tasks={later} tone="later" dateOf={(t) => t.due} now={house.displayNow} />
          <Group title="No schedule supplied" tasks={undated} tone="later" dateOf={(t) => t.due} now={house.displayNow} />
        </div>
        <div>
          <Group title="Completed" tasks={done} tone="done" dateOf={(t) => t.completedAt} now={house.displayNow} />
        </div>
      </div>
    </div>
  );
}
