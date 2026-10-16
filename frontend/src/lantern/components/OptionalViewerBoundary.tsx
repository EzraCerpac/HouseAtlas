import { Component, type ReactNode } from 'react';
import './optional-viewer.css';

interface Props {
  /** Sentence subject for the fallback, for example "The PDF viewer". */
  readonly label: string;
  /** Called once when the viewer's chunk, module or render fails. */
  readonly onError?: () => void;
  readonly children: ReactNode;
}

/** Contains one optional viewer. A failed lazy chunk, module evaluation or
 * viewer render stops here, so navigation and any save or provenance beside
 * the viewer stay usable. React caches rejected lazy imports; a retry needs a
 * fresh document load. */
export class OptionalViewerBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError?.(); }
  render() {
    if (this.state.failed) return <div className="viewer-unavailable" role="alert">
      <p>{this.props.label} could not load here. Reload the app to try again.</p>
      <button type="button" className="btn btn-small" onClick={() => window.location.reload()}>Reload app</button>
    </div>;
    return this.props.children;
  }
}
