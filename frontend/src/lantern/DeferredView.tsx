import { Component, Suspense, type ReactNode } from 'react';
import { useCanWrite, useStore } from './state/store';
import { useSourcePorts } from './source-ports';
import { referenceDayLabel } from './data/time';
import { dueState } from './data/query';
import type { HouseData, Task } from './data/types';
import { InlineTime } from './components/ui';
import { sourceMarkers, sourceStateLines } from './adapters/read';
import { Icon } from './components/Icon';

interface Props { readonly label: string; readonly children: ReactNode }

/** A failed view chunk leaves navigation, session and detail providers mounted.
 * React caches rejected lazy imports; recovery requires a fresh document load. */
class ViewBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section className="view" aria-label={this.props.label}>
      <header className="view-head"><h1>{this.props.label}</h1></header>
      <p role="alert">This view could not load. Reload to try again.</p>
      <button type="button" className="btn" onClick={() => window.location.reload()}>Reload app</button>
    </section>;
    return this.props.children;
  }
}

/** Changes' source freshness: per saved source, its state and last successful
 * update. A short collection marker keeps two collections of one owner apart
 * at a glance; the full source and collection identity sits in each row's
 * disclosure. Drawn the same while Changes loads; refresh stays in Overview. */
export function SourceStates() {
  const { projection } = useStore();
  const lines = sourceStateLines(projection.view.caches);
  const markers = sourceMarkers(projection.view.caches);
  return <section className="section changes-sources-section" aria-labelledby="changes-sources-head">
    <header className="section-head"><h2 id="changes-sources-head">Sources</h2></header>
    <ul className="changes-sources" aria-labelledby="changes-sources-head">
      {lines.map((line, index) => {
        const name = markers[index] ? `${line.source} ${markers[index]}` : line.source;
        return <li key={index}>
          <span><span className="changes-source-name">{line.source}{markers[index] && <> <span className="changes-source-marker">{markers[index]}</span></>}</span>
            : <strong>{line.state}</strong>, last successful update{' '}
            {line.at ? <InlineTime value={line.at} /> : 'unknown'}</span>
          {line.identity && <details className="changes-source-id">
            <summary aria-label={`Source identity, ${name}`}>Source identity</summary>
            <code>{line.identity}</code></details>}
        </li>;
      })}
      {!lines.length && <li>No cache information supplied.</li>}
    </ul>
  </section>;
}

/** The cache status every task shares, if one; the Upkeep page states it once. */
export function useSharedTaskCache(): string | undefined {
  const { house, projection } = useStore();
  const statuses = new Set(house.tasks.map(t => projection.entries.get(t.id)?.cacheStatus));
  const [only] = statuses;
  return statuses.size === 1 && only !== undefined ? only : undefined;
}

/** Upkeep's groups in page order, the first four in the timeline column and
 * Completed in the second. The loading view draws the same groups from the
 * tasks already in the store, so the page keeps its shape when it arrives. */
export function upkeepGroups(house: HouseData) {
  const byDue = (a: Task, b: Task) => (a.due ?? '9999').localeCompare(b.due ?? '9999');
  const timed = (state: string) => house.tasks.filter(t => (state !== 'later' || t.status !== 'unknown') && dueState(t, house.displayNow) === state).sort(byDue);
  return [
    { title: 'Overdue', tone: 'overdue', tasks: timed('overdue') },
    { title: 'Next two weeks', tone: 'soon', tasks: timed('soon') },
    { title: 'Later', tone: 'later', tasks: timed('later') },
    { title: 'No schedule supplied', tone: 'later', tasks: house.tasks.filter(t => t.status === 'unknown') },
    { title: 'Completed', tone: 'done', tasks: house.tasks.filter(t => t.status === 'done').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')) },
  ] as const;
}

/** Upkeep's lines under its heading: what every date is relative to, the shared
 * task cache state, and why Mark done is unavailable. Drawn the same while
 * Upkeep loads, so it claims nothing about tasks not yet shown. */
export function UpkeepQualifiers() {
  const { house } = useStore();
  const can = useCanWrite('HomeBox');
  const cache = useSharedTaskCache();
  const reference = referenceDayLabel(house.displayNow);
  const dates = [reference !== undefined && `Dates relative to ${reference}`, cache !== undefined && `HomeBox tasks: ${cache.replace(/-/g, ' ')}`].filter(Boolean).join(' · ');
  return <>
    {dates && <p className="fine">{dates}</p>}
    {!can.ok && house.tasks.some(task => task.status !== 'done') && <p className="fine upkeep-owner"><Icon name="info" size={13} />Mark done is unavailable: HomeBox owns these tasks.</p>}
  </>;
}

/** Upkeep while it loads, in the loaded page's structure: the row of empty
 * groups, then each group's heading and timeline rows in the two columns.
 * Only the numbers and row contents wait. */
function UpkeepLoading({ status }: { readonly status: ReactNode }) {
  const { house } = useStore();
  const groups = upkeepGroups(house);
  const empty = groups.filter(group => !group.tasks.length);
  const column = (list: typeof groups[number][]) => <div>{list.filter(group => group.tasks.length).map(group =>
    <div key={group.title} className={`tl-group tl-${group.tone}`}>
      <h2>{group.title}<span className="section-count"><b /></span></h2>
      <span className="loading-rows loading-timeline">
        {group.tasks.map(task => <i key={task.id}><b /><b /><b /></i>)}</span>
    </div>)}</div>;
  return <>
    {empty.length > 0 && empty.length < groups.length && <ul className="upkeep-empty loading-summary" aria-hidden="true">
      {empty.map(group => <li key={group.title}>{group.title}<span className="section-count"><b /></span></li>)}</ul>}
    {status}
    {empty.length < groups.length && <div className="tl-columns loading-columns" aria-hidden="true">
      {column(groups.slice(0, 4))}{column(groups.slice(4))}</div>}
  </>;
}

/** The view's own headings and section links, which need no data, with quiet
 * placeholder rows under them, so nothing jumps when the view arrives. */
function LoadingView({ label }: { readonly label: string }) {
  const { house } = useStore();
  const ports = useSourcePorts();
  const sections = label === 'Library' ? ['HomeBox files', ...(ports.documents ? ['Source documents'] : []), ...(ports.electricalLibrary ? ['Electrical drawings'] : [])]
    : label === 'Changes' ? ['Operation history'] : [''];
  const status = <p className="fine loading-status" role="status" aria-live="polite">Loading {label} for {house.name}…</p>;
  return <section className="view" aria-label={label} aria-busy="true">
    <header className={label === 'Library' && sections.length > 1 ? 'view-head library-head has-jump' : 'view-head'}><h1>{label}</h1>
      {label === 'Upkeep' && <UpkeepQualifiers />}</header>
    {label === 'Library' && sections.length > 1 && <nav className="library-jump" aria-label="Library sections">
      {sections.map(title => <button key={title} type="button" disabled>{title}</button>)}</nav>}
    {label === 'Upkeep' ? <UpkeepLoading status={status} /> : <div className={label === 'Changes' ? 'changes-grid' : undefined}>
      {sections.map((title, index) => <section key={title} className={label === 'Changes' ? 'section'
        : label === 'Library' ? `loading-section loading-library${title === 'Source documents' ? ' loading-source-docs' : ''}` : 'loading-section'}>
        {title && <div className="section-head"><h2>{title}</h2></div>}
        {index === 0 && status}
        {/* Library: as the loaded sections, a summary line, then one row in a file row's shape (title, action slot, facts). */}
        {label === 'Library' ? <>{index > 0 && <span className="loading-lib-note" aria-hidden="true" />}
            <span className="loading-rows loading-lib" aria-hidden="true"><i><b /></i></span></>
          // Changes: one row, as short as the loaded history's first state.
          : label === 'Changes' ? <span className="loading-rows" aria-hidden="true"><i /></span>
          : <span className="loading-rows" aria-hidden="true"><i /><i /><i /></span>}
      </section>)}
      {label === 'Changes' && <SourceStates />}
    </div>}
  </section>;
}

export function DeferredView({ label, children }: Props) {
  return <ViewBoundary label={label}>
    <Suspense fallback={<LoadingView label={label} />}>
      {children}
    </Suspense>
  </ViewBoundary>;
}
