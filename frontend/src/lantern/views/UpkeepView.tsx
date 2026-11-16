import type { Task } from '../data/types';
import { dueState } from '../data/query';
import { fmtDate } from '../data/time';
import { useStore } from '../state/store';
import { TaskRow } from '../components/rows';
import { UpkeepQualifiers, useSharedTaskCache } from '../DeferredView';
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

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** Empty groups are not drawn; the page lists them in one line instead. */
function Group({ title, tasks, tone, dateOf, now, sharedCache }: { title: string; tasks: Task[]; tone: string; dateOf: (t: Task) => string | undefined; now?: string | undefined; sharedCache?: string | undefined }) {
  if (!tasks.length) return null;
  const id = `tl-${slug(title)}`;
  return (
    <section className={`tl-group tl-${tone}`} aria-labelledby={id}>
      <h2 id={id}>
        {title}
        <span className="section-count">{tasks.length}</span>
      </h2>
      <ol className="timeline">
          {tasks.map((t) => (
            <li key={t.id} className="tl-row">
              <DateMark iso={dateOf(t)} now={now} />
              <ul className="rows">
                <TaskRow task={t} showTarget sharedCache={sharedCache} />
              </ul>
            </li>
          ))}
        </ol>
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
  // One cache status for every task is stated once; a differing row keeps its own.
  const sharedCache = useSharedTaskCache();
  const groups = [['Overdue', overdue], ['Next two weeks', soon], ['Later', later], ['No schedule supplied', undated], ['Completed', done]] as const;
  const empty = groups.filter(([, tasks]) => !tasks.length).map(([title]) => title);
  return (
    <div className="view">
      <header className="view-head">
        <h1>Upkeep</h1>
        <UpkeepQualifiers />
      </header>
      {state.settings.outage && <Note tone="warn">HomeBox is unreachable, so tasks can’t be marked done right now. You are looking at the cached copy.</Note>}
      {empty.length === groups.length ? <Empty>No tasks.</Empty>
        : empty.length > 0 && <ul className="upkeep-empty" aria-label="Empty groups">
          {empty.map(title => <li key={title}>{title}<span className="section-count">0</span></li>)}
        </ul>}
      <div className="tl-columns">
        <div>
          <Group title="Overdue" tasks={overdue} tone="overdue" dateOf={(t) => t.due} now={house.displayNow} sharedCache={sharedCache} />
          <Group title="Next two weeks" tasks={soon} tone="soon" dateOf={(t) => t.due} now={house.displayNow} sharedCache={sharedCache} />
          <Group title="Later" tasks={later} tone="later" dateOf={(t) => t.due} now={house.displayNow} sharedCache={sharedCache} />
          <Group title="No schedule supplied" tasks={undated} tone="later" dateOf={(t) => t.due} now={house.displayNow} sharedCache={sharedCache} />
        </div>
        <div>
          <Group title="Completed" tasks={done} tone="done" dateOf={(t) => t.completedAt} now={house.displayNow} sharedCache={sharedCache} />
        </div>
      </div>
    </div>
  );
}
