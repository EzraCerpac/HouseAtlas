import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ElectricityDrawingViewerProps } from './fixture-types';
import './drawing-viewer.css';

/** Read the actual drawing, independently of its interpretation or current wiring. */
export function ElectricityDrawingViewer({ source, onClose }: ElectricityDrawingViewerProps) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  const sourceKey = source ? JSON.stringify([source.sheetId, source.kind, source.url, source.sha256, source.pdfPage]) : null;
  const [scale, setScale] = useState<{ key: string | null; value: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!sourceKey) return;
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); latestClose.current(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener('keydown', key);
      if (prior?.isConnected) prior.focus();
    };
  }, [sourceKey]);
  if (!source) return null;
  const zoom = scale?.key === sourceKey ? scale.value : 1;
  const unavailable = !source.url || failed === sourceKey;
  const fileUrl = source.kind === 'pdf' ? `${source.url.split('#')[0]}#page=${source.pdfPage}` : source.url;
  return createPortal(<div className="edv-backdrop">
    <div className="edv-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
      <header className="edv-header">
        <div><h2 id={`${id}-title`}>{source.title}</h2><p>Drawing · PDF page {source.pdfPage} · {source.custody === 'private-local-copy' ? 'Private local copy' : 'Retained Atlas file'}</p></div>
        <button type="button" ref={close} onClick={onClose}>Close drawing</button>
      </header>
      <nav className="edv-tools" aria-label="Drawing controls">
        {source.kind === 'image' && <>
          <button type="button" onClick={() => setScale({ key: sourceKey, value: 1 })}>Fit</button>
          <button type="button" onClick={() => setScale({ key: sourceKey, value: Math.max(1, zoom - 0.5) })} disabled={zoom <= 1}>Zoom out</button>
          <button type="button" onClick={() => setScale({ key: sourceKey, value: Math.min(4, zoom + 0.5) })} disabled={zoom >= 4}>Zoom in</button>
          <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        </>}
        {source.url && <a href={fileUrl} target="_blank" rel="noopener">{source.kind === 'pdf' ? 'Open PDF controls' : 'Open file'}</a>}
      </nav>
      <div className={`edv-content${source.kind === 'pdf' ? ' edv-pdf' : ''}`}>
        {unavailable ? <p role="status">Drawing file unavailable. Close this viewer and reload the source.</p>
          : source.kind === 'image' ? <div className="edv-image-stage" style={{ width: `${zoom * 100}%` }}>
            <img src={source.url} alt={`${source.title}, historical electrical drawing`} onError={() => setFailed(sourceKey)} />
          </div> : <iframe src={fileUrl} title={`${source.title}, PDF page ${source.pdfPage}`} tabIndex={-1} onFocus={() => close.current?.focus()} />}
      </div>
    </div>
  </div>, document.body);
}
