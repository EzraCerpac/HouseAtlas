import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { HouseAtlasPdfBinaryDataFactory, pdfjsDecoderUrl } from 'virtual:houseatlas-pdfjs-resources';
import { fitPdfCanvas } from './pdf-canvas-fit';
import './source-pdf.css';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const FAILED = 'This PDF page could not be shown here. You can still save the original.';
export type SourcePdfOutcome = 'opened' | 'unavailable';
export interface SourcePdfViewProps {
  /** Bytes owned by the caller's current lease or local source capability. */
  readonly blob: Blob;
  readonly title: string;
  /** One-based page requested by the source owner; page 1 when absent. */
  readonly initialPage?: number;
  /** The owner aborts this synchronously on withdrawal: the render is
   * cancelled, the PDF task destroyed and the canvas cleared at once. */
  readonly signal: AbortSignal;
  /** Reported once: `opened` only after the requested page is actually drawn
   * and visible; `unavailable` on any failure, withdrawal or unmount first. */
  readonly onOutcome?: (outcome: SourcePdfOutcome) => void;
}

/** Draws a PDF to a canvas only: no text, link, form, annotation or XFA layer,
 * and no external fonts, maps or navigation. Unmount is the fallback cleanup. */
export function SourcePdfView({ blob, title, initialPage = 1, signal, onOutcome }: SourcePdfViewProps) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const work = useRef<{ task: ReturnType<typeof pdfjs.getDocument> | null; render: { cancel(): void } | null }>({ task: null, render: null });
  const outcome = useRef<((value: SourcePdfOutcome) => void) | null>(null);
  const notify = useRef(onOutcome);
  notify.current = onOutcome;
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(initialPage);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState('Loading PDF…');
  const [reduced, setReduced] = useState(false);
  const request = useRef<{ readonly blob: Blob; readonly signal: AbortSignal; readonly initialPage: number } | null>(null);
  useEffect(() => {
    let reported = false;
    const report = (value: SourcePdfOutcome) => { if (!reported) { reported = true; notify.current?.(value); } };
    const mine = { blob, signal, initialPage };
    const same = (other: typeof request.current) => other !== null && other !== mine
      && other.blob === blob && other.signal === signal && other.initialPage === initialPage;
    outcome.current = report; request.current = mine;
    let disposed = false;
    const stop = (deferred: boolean) => {
      if (disposed) return; disposed = true;
      const { task, render } = work.current; work.current = { task: null, render: null };
      render?.cancel(); if (task) void task.destroy();
      const target = canvas.current;
      if (target) { target.style.visibility = 'hidden'; target.width = 0; target.height = 0; }
      if (!deferred) { report('unavailable'); return; }
      // Unmount reports after the commit, unless the same request was
      // immediately remounted (StrictMode effect replay) and now reports itself.
      queueMicrotask(() => { if (!same(request.current)) report('unavailable'); });
    };
    const abort = () => stop(false);
    signal.addEventListener('abort', abort, { once: true });
    setPdf(null); setStatus('Loading PDF…');
    if (signal.aborted) abort();
    else if (!Number.isSafeInteger(initialPage) || initialPage < 1) { setStatus('The requested PDF page is not a page number.'); outcome.current('unavailable'); }
    else void (async () => {
      const data = new Uint8Array(await blob.arrayBuffer());
      if (disposed) return null;
      const task = pdfjs.getDocument({ data, enableXfa: false, useWasm: true, useWorkerFetch: false,
        wasmUrl: pdfjsDecoderUrl, cMapUrl: 'houseatlas:/', standardFontDataUrl: 'houseatlas:/',
        BinaryDataFactory: HouseAtlasPdfBinaryDataFactory });
      work.current.task = task;
      return task.promise;
    })().then(loaded => {
      if (!loaded || disposed) return;
      if (initialPage > loaded.numPages) {
        setStatus(`Page ${initialPage} is not in this PDF, which has ${loaded.numPages} ${loaded.numPages === 1 ? 'page' : 'pages'}.`);
        outcome.current?.('unavailable'); return;
      }
      setPage(initialPage); setPdf(loaded); setStatus('');
    }, () => { if (!disposed) { setStatus('This PDF could not be opened here. You can still save the original.'); outcome.current?.('unavailable'); } });
    return () => { signal.removeEventListener('abort', abort); if (request.current === mine) request.current = null; stop(true); };
  }, [blob, signal, initialPage]);
  useLayoutEffect(() => { if (canvas.current) canvas.current.style.visibility = 'hidden'; }, [pdf, page, zoom]);
  useEffect(() => {
    if (!pdf || !host.current || signal.aborted) return;
    let cancelled = false, request = 0, handle: PDFPageProxy | null = null, queue = Promise.resolve();
    const live = () => !cancelled && !signal.aborted;
    const paint = () => {
      if (!live() || !handle) return;
      const mine = ++request, current = handle;
      work.current.render?.cancel();
      queue = queue.then(async () => {
        const target = canvas.current, frame = host.current;
        if (!live() || mine !== request || !target || !frame) return;
        target.style.visibility = 'hidden';
        try {
          const base = current.getViewport({ scale: 1 });
          const fit = fitPdfCanvas(base.width, base.height, Math.min(4, Math.max(120, frame.clientWidth - 24) / base.width * zoom),
            Math.max(1, Math.min(2, window.devicePixelRatio || 1)));
          const context = target.getContext('2d');
          if (!fit || !context) { setStatus(FAILED); outcome.current?.('unavailable'); return; }
          const viewport = current.getViewport({ scale: fit.cssScale });
          target.width = fit.width; target.height = fit.height;
          target.style.width = `${Math.round(fit.width / fit.ratio)}px`; target.style.height = `${Math.round(fit.height / fit.ratio)}px`;
          context.setTransform(fit.ratio, 0, 0, fit.ratio, 0, 0);
          const rendering = current.render({ canvas: target, canvasContext: context, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE });
          work.current.render = rendering;
          try { await rendering.promise; } finally { if (work.current.render === rendering) work.current.render = null; }
          if (!live() || mine !== request) return;
          target.style.visibility = 'visible'; setStatus(''); setReduced(fit.reduced);
          if (page === initialPage) outcome.current?.('opened');
        } catch (error) {
          if (live() && mine === request && !(error instanceof pdfjs.RenderingCancelledException)) { setStatus(FAILED); outcome.current?.('unavailable'); }
        }
      }).catch(() => undefined);
    };
    void pdf.getPage(page).then(found => { if (live()) { handle = found; paint(); } },
      () => { if (live()) { setStatus(FAILED); outcome.current?.('unavailable'); } });
    const observer = new ResizeObserver(() => paint());
    observer.observe(host.current);
    return () => { cancelled = true; observer.disconnect(); work.current.render?.cancel(); };
  }, [pdf, page, zoom, signal, initialPage]);
  const pages = pdf?.numPages ?? null;
  return <div className="source-pdf">
    <div className="source-pdf-controls">
      <div role="group" aria-label="PDF page">
        <button type="button" className="chip-btn" disabled={!pages || page <= 1} onClick={() => setPage(page - 1)}>Previous page</button>
        <span>Page {page} of {pages ?? '…'}</span>
        <button type="button" className="chip-btn" disabled={!pages || page >= pages} onClick={() => setPage(page + 1)}>Next page</button>
      </div>
      <div role="group" aria-label="PDF zoom">
        <button type="button" className="chip-btn" aria-label="Zoom out PDF" disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value / 2))}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" className="chip-btn" aria-label="Zoom in PDF" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value * 2))}>+</button>
      </div>
    </div>
    {status && <p role="status">{status}</p>}
    {reduced && !status && <p className="source-pdf-note">Drawn at reduced detail to stay within this browser's drawing limit.</p>}
    <div ref={host} className="source-pdf-page" role="region" tabIndex={0} aria-label={`${title}, page ${page} of ${pages ?? 'loading'}`}>
      <canvas ref={canvas} role="img" aria-label={`${title}, PDF page ${page}`} />
    </div>
  </div>;
}
