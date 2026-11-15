import { Component, Suspense, type ReactNode } from 'react';
import { useStore } from './state/store';
import { useSourcePorts } from './source-ports';

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
      {label === 'Library' && sections.length > 1 && <nav className="seg library-jump" aria-label="Library sections">
        {sections.map(title => <button key={title} type="button" disabled>{title}</button>)}</nav>}</header>
    <div className={label === 'Changes' ? 'changes-grid' : undefined}>
      {sections.map((title, index) => <section key={title} className={label === 'Changes' ? 'section' : 'loading-section'}>
        {title && <div className="section-head">{label === 'Changes' ? <h3>{title}</h3> : <h2>{title}</h2>}</div>}
        {index === 0 && status}
        <span className="loading-rows" aria-hidden="true" />
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
