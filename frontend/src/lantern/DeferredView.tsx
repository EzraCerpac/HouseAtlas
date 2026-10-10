import { Component, Suspense, type ReactNode } from 'react';

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

export function DeferredView({ label, children }: Props) {
  return <ViewBoundary label={label}>
    <Suspense fallback={<div className="view" role="status" aria-live="polite" aria-busy="true">Loading {label}…</div>}>
      {children}
    </Suspense>
  </ViewBoundary>;
}
