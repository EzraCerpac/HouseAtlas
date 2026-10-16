import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalModelReview, type LocalModelReviewProps } from './LocalModelReview';
import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/app.css';
import './source-models.css';

export { LocalModelReview, type LocalModelReviewProps } from './LocalModelReview';
export { SourcePdf, type SourcePdfOutcome, type SourcePdfViewProps } from '../source-documents/SourcePdf';
export { createLocalSourceReader, LOCAL_TEXT_MAX_BYTES, type LocalSourceDisplay, type LocalSourceFence,
  type LocalSourceReaderStore } from '../electrical-documentary/local-source-reader';
export { LocalSourceView } from '../electrical-documentary/LocalSourceView';
export { createRendererOwner, type RendererOwnerHandle } from '../electrical-documentary/renderer-owner';
export type * from '../electrical-documentary/types';
export { HOST_ELECTRICAL_DOCUMENTARY_CONTRACT } from '../electrical-documentary/types';

export interface LocalModelReviewMount {
  /** Re-renders with new props. New `files` retire the previous renderer
   * owner and close its bridge before the new set is read. */
  render(props: LocalModelReviewProps): void;
  /** Retires the renderer, closes the bridge and clears any shown source. */
  unmount(): void;
}

/** Mounts the review surface into an element the composition owns. */
export function mountLocalModelReview(element: Element, props: LocalModelReviewProps): LocalModelReviewMount {
  const root = createRoot(element);
  let mounted = true;
  const render = (next: LocalModelReviewProps) => {
    if (!mounted) return;
    root.render(<StrictMode><div className="lantern-host local-model-review"><LocalModelReview {...next} /></div></StrictMode>);
  };
  render(props);
  return { render, unmount() { if (mounted) { mounted = false; root.unmount(); } } };
}
