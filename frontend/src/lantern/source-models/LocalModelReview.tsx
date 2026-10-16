import { lazy, Suspense } from 'react';
import { OptionalViewerBoundary } from '../components/OptionalViewerBoundary';
import type { LocalModelReviewOptions } from '../electrical-documentary/types';

const LocalGlbPreview = lazy(() => import('../canonical-ifc/LocalGlbPreview').then(module => ({ default: module.LocalGlbPreview })));

export interface LocalModelReviewProps extends LocalModelReviewOptions {
  /** The chosen File objects, unchanged. A new array is a new renderer. */
  readonly files: readonly File[];
}

/** Public neutral review surface: the standard-loader local model viewer with
 * optional source-owner electrical documents. It imports no private policy,
 * wrapper or asset; the composition injects them through `createElectricalBridge`. */
export function LocalModelReview({ files, ...options }: LocalModelReviewProps) {
  return <OptionalViewerBoundary label="The model viewer">
    <Suspense fallback={<p role="status">Loading model viewer…</p>}>
      <LocalGlbPreview files={files} review={options} />
    </Suspense>
  </OptionalViewerBoundary>;
}
