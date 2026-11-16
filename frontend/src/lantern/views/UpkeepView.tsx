import type { Task } from '../data/types';
import { fmtDate } from '../data/time';
import { useStore } from '../state/store';
import { TaskRow } from '../components/rows';
import { UpkeepQualifiers, upkeepGroups, useSharedTaskCache } from '../DeferredView';
import { Empty, Note } from '../components/ui';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Day, month and year on every row, due or done, so no date reads as another year's. */
function DateMark({ iso }: { iso?: string | undefined }) {
  if (!iso || fmtDate(iso.slice(0, 10)) === 'Unknown') return <span className="tl-date">Unknown</span>;
  const [y, m = 1, d] = iso.slice(0, 10).split('-').map(Number);
  return (
    <time className="tl-date" dateTime={iso.slice(0, 10)}>
      <span className="tl-day">{d}</span>
      <span className="tl-mon">{MON[m - 1]} {y}</span>
    </time>
  );
}

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** Empty groups are not drawn; the page lists them in one line instead. */
function Group({ title, tasks, tone, dateOf, sharedCache }: { title: string; tasks: readonly Task[]; tone: string; dateOf: (t: Task) => string | undefined; sharedCache?: string | undefined }) {
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
              <DateMark iso={dateOf(t)} />
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
  // One cache status for every task is stated once; a differing row keeps its own.
  const sharedCache = useSharedTaskCache();
  const groups = upkeepGroups(house);
  const empty = groups.filter(group => !group.tasks.length).map(group => group.title);
  const column = (list: typeof groups[number][]) => <div>{list.map(group => <Group key={group.title} title={group.title} tasks={group.tasks} tone={group.tone}
    dateOf={group.title === 'Completed' ? (t) => t.completedAt : (t) => t.due} sharedCache={sharedCache} />)}</div>;
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
        {column(groups.slice(0, 4))}
        {column(groups.slice(4))}
      </div>
    </div>
  );
}
