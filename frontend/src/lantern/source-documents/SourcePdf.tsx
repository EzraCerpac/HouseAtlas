import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { OptionalViewerBoundary } from '../components/OptionalViewerBoundary';
import type { SourcePdfOutcome, SourcePdfViewProps } from './SourcePdfView';

export type { SourcePdfOutcome, SourcePdfViewProps } from './SourcePdfView';

const SourcePdfView = lazy(() => import('./SourcePdfView').then(module => ({ default: module.SourcePdfView })));

let attempts = 0;

/** Eager seam for the lazy PDF viewer. It owns one outcome per blob, signal and
 * page: `opened` only from the viewer's drawn page; `unavailable` when the
 * viewer chunk, module or render fails, on withdrawal before the viewer
 * loads, or on unmount first. Neighbouring save and provenance stay outside. */
export function SourcePdf(props: SourcePdfViewProps) {
  const { blob, signal, initialPage, onOutcome } = props;
  const notify = useRef(onOutcome);
  notify.current = onOutcome;
  // One attempt per request; its callback is the one current when it began.
  const attempt = useMemo(() => {
    const target = notify.current;
    let reported = false;
    return { id: ++attempts, report: (value: SourcePdfOutcome) => { if (!reported) { reported = true; target?.(value); } } };
  }, [blob, signal, initialPage]);
  return <SourcePdfAttempt key={attempt.id} {...props} onOutcome={attempt.report} />;
}

function SourcePdfAttempt(props: SourcePdfViewProps & { readonly onOutcome: (value: SourcePdfOutcome) => void }) {
  const { signal, onOutcome } = props;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const withdraw = () => onOutcome('unavailable');
    if (signal.aborted) withdraw();
    signal.addEventListener('abort', withdraw, { once: true });
    return () => {
      signal.removeEventListener('abort', withdraw); mounted.current = false;
      // Unmount resolves after the commit unless StrictMode remounted this attempt.
      queueMicrotask(() => { if (!mounted.current) withdraw(); });
    };
  }, [signal, onOutcome]);
  return <OptionalViewerBoundary label="The PDF viewer" onError={() => onOutcome('unavailable')}>
    <Suspense fallback={<p role="status">Loading PDF viewer…</p>}><SourcePdfView {...props} /></Suspense>
  </OptionalViewerBoundary>;
}
