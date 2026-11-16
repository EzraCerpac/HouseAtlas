import { Component, Suspense, type ReactNode } from 'react';
import { useCanWrite, useStore } from './state/store';
import { useSourcePorts } from './source-ports';
import { referenceDayLabel } from './data/time';
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

/** The cache status every task shares, if one; the Upkeep page states it once. */
export function useSharedTaskCache(): string | undefined {
  const { house, projection } = useStore();
  const statuses = new Set(house.tasks.map(t => projection.entries.get(t.id)?.cacheStatus));
  const [only] = statuses;
  return statuses.size === 1 && only !== undefined ? only : undefined;
}

/** Upkeep's lines under its heading: what every date is relative to, the shared
 * cache state, and why Mark done is unavailable. Drawn while Upkeep loads too,
 * where no task is shown yet, so the cache is not yet said to be every task's. */
export function UpkeepQualifiers({ loading = false }: { readonly loading?: boolean }) {
  const { house } = useStore();
  const can = useCanWrite('HomeBox');
  const cache = useSharedTaskCache();
  const reference = referenceDayLabel(house.displayNow);
  const dates = [reference !== undefined && `Dates relative to ${reference}`, cache !== undefined && `Source cache: ${cache}${loading ? '' : ' for every task'}`].filter(Boolean).join(' · ');
  return <>
    {dates && <p className="fine">{dates}</p>}
    {!can.ok && house.tasks.some(task => task.status !== 'done') && <p className="fine upkeep-owner"><Icon name="info" size={13} />Mark done is unavailable: HomeBox owns these tasks.</p>}
  </>;
}

/** The view's own headings and section links, which need no data, with quiet
 * placeholder rows under them, so nothing jumps when the view arrives. */
function LoadingView({ label }: { readonly label: string }) {
  const { house } = useStore();
  const ports = useSourcePorts();
  const sections = label === 'Library' ? ['HomeBox files', ...(ports.documents ? ['Source documents'] : []), ...(ports.electricalLibrary ? ['Electrical drawings'] : [])]
    : label === 'Changes' ? ['Operation history', 'Sources'] : [''];
  const status = <p className="fine loading-status" role="status" aria-live="polite">Loading {label} for {house.name}…</p>;
  return <section className="view" aria-label={label} aria-busy="true">
    <header className="view-head"><h1>{label}</h1>
      {label === 'Library' && sections.length > 1 && <nav className="library-jump" aria-label="Library sections">
        {sections.map(title => <button key={title} type="button" disabled>{title}</button>)}</nav>}
      {label === 'Upkeep' && <UpkeepQualifiers loading />}</header>
    <div className={label === 'Changes' ? 'changes-grid' : undefined}>
      {sections.map((title, index) => <section key={title} className={label === 'Changes' ? 'section' : 'loading-section'}>
        {title && <div className="section-head">{label === 'Changes' ? <h3>{title}</h3> : <h2>{title}</h2>}</div>}
        {index === 0 && status}
        {label === 'Upkeep'
          // Upkeep's rows take the timeline's shape: date, mark, then title and date lines.
          ? <span className="loading-rows loading-timeline" aria-hidden="true">{[0, 1, 2].map(row => <i key={row}><b /><b /><b /></i>)}</span>
          : <span className="loading-rows" aria-hidden="true"><i /><i /><i /></span>}
      </section>)}
    </div>
  </section>;
}

export function DeferredView({ label, children }: Props) {
  return <ViewBoundary label={label}>
    <Suspense fallback={<LoadingView label={label} />}>
      {children}
    </Suspense>
  </ViewBoundary>;
}
