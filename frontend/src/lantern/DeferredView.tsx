import { Component, Suspense, type ReactNode } from 'react';
import { useStore } from './state/store';

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

/** Holds the view's heading where the loaded view puts it, so nothing jumps. */
function LoadingView({ label }: { readonly label: string }) {
  const { house } = useStore();
  return <section className="view" aria-label={label} aria-busy="true">
    <header className="view-head"><h1>{label}</h1>
      <p role="status" aria-live="polite">Loading {label} for {house.name}…</p></header>
  </section>;
}

export function DeferredView({ label, children }: Props) {
  return <ViewBoundary label={label}>
    <Suspense fallback={<LoadingView label={label} />}>
      {children}
    </Suspense>
  </ViewBoundary>;
}
