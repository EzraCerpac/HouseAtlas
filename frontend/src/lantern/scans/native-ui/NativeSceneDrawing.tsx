import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ElectricalFixtureSheet } from '../../overlays/electricity/fixture-types';
import type { NativeEvidenceDocumentClient, NativeEvidenceDocumentFrame } from '../native-evidence-document-types';

/** A hash selects among current building evidence; it grants no read access.
 * Each candidate is resolved by the native document owner before any bytes paint. */
export function NativeSceneDrawing({ client, sheet, evidenceIds, current, onClose }: {
  readonly client: NativeEvidenceDocumentClient; readonly sheet: ElectricalFixtureSheet;
  readonly evidenceIds: readonly string[]; readonly current: () => boolean; readonly onClose: () => void;
}) {
  const [shown, setShown] = useState<{ frame: NativeEvidenceDocumentFrame; url: string } | null>(null);
  const [status, setStatus] = useState('Checking saved drawing…'), [zoom, setZoom] = useState(1);
  const payload = useRef<HTMLDivElement>(null), closer = useRef<HTMLButtonElement>(null);
  const currentRef = useRef(current); currentRef.current = current;
  useLayoutEffect(() => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    let held: NativeEvidenceDocumentFrame | null = null, url: string | null = null;
    let stop: () => void = () => undefined, disposed = false;
    const live = () => !disposed && !controller.signal.aborted && currentRef.current();
    const withdraw = () => {
      if (payload.current) payload.current.hidden = true;
      stop(); stop = () => undefined;
      if (url) { URL.revokeObjectURL(url); url = null; }
      if (held) { client.release(held); held = null; }
      setShown(null);
    };
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closer.current?.focus(); setShown(null); setZoom(1); setStatus('Checking saved drawing…');
    void (async () => {
      if (!live() || evidenceIds.length > 64 || new Set(evidenceIds).size !== evidenceIds.length
        || !/^[0-9a-f]{64}$/.test(sheet.renderedPhotoSha256)) throw new Error('Drawing references unavailable');
      for (const evidenceId of evidenceIds) {
        if (!live()) return;
        let frame: NativeEvidenceDocumentFrame;
        try { frame = await client.open(evidenceId, controller.signal); }
        catch { if (!live()) return; continue; }
        if (!live() || !client.isCurrent(frame)) { client.release(frame); return; }
        if (frame.asset.sha256 !== sheet.renderedPhotoSha256 || frame.mode !== 'inline-png'
          || frame.asset.contentType !== 'image/png') { client.release(frame); continue; }
        const blob = client.getBlob(frame);
        if (!blob || blob.type !== 'image/png') { client.release(frame); throw new Error('Drawing unavailable'); }
        held = frame; url = URL.createObjectURL(blob);
        stop = client.subscribeInvalidation(frame, () => {
          withdraw(); controller.abort(); setStatus('This saved drawing is no longer current. Close it and reload scans.');
        });
        if (!live() || !client.isCurrent(frame) || held !== frame) { withdraw(); return; }
        clearTimeout(timer); setShown({ frame, url }); setStatus(''); return;
      }
      clearTimeout(timer);
      if (live()) setStatus('No current saved PNG matches this drawing. Add its reading copy to this building and reload scans.');
    })().catch(() => { clearTimeout(timer); if (live()) setStatus('The current saved drawing could not be read. Close it and try again.'); });
    const aborted = () => { if (!disposed) {
      withdraw(); setStatus('The saved drawing read did not complete. Close it and try again.');
    } };
    controller.signal.addEventListener('abort', aborted, { once: true });
    return () => {
      disposed = true; clearTimeout(timer); controller.signal.removeEventListener('abort', aborted);
      controller.abort(); withdraw(); if (opener?.isConnected) opener.focus();
    };
  }, [client, sheet, evidenceIds]);
  useLayoutEffect(() => {
    if (payload.current) payload.current.hidden = !shown || !currentRef.current() || !client.isCurrent(shown.frame);
  }, [client, shown]);
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return <section className="native-scene-drawing" role="dialog" aria-modal="true"
    aria-label={sheet.title} onKeyDown={keys}>
    <header><div><h3>{sheet.title}</h3><p>Historical drawing · reference PDF page {sheet.pdfPage}</p></div>
      <button ref={closer} type="button" className="chip-btn" onClick={onClose}>Close drawing</button></header>
    {status && <p role="status">{status}</p>}
    {shown && currentRef.current() && client.isCurrent(shown.frame) && <div ref={payload}>
      <div role="group" aria-label="Drawing size">
        <button type="button" onClick={() => setZoom(1)}>Fit</button>
        <button type="button" disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value / 2))}>Zoom out</button>
        <button type="button" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value * 2))}>Zoom in</button>
      </div>
      <div className="native-scene-drawing-image"><img src={shown.url} alt={`${sheet.title}, historical electrical drawing`}
        onError={() => { setShown(null); setStatus('The saved PNG could not be rendered. Close it and try again.'); }}
        style={{ width: `${zoom * 100}%`, maxWidth: 'none', height: 'auto' }} /></div>
    </div>}
  </section>;
}
