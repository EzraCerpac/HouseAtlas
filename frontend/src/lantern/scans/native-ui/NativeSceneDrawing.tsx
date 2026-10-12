import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ElectricalFixtureSheet } from '../../overlays/electricity/fixture-types';
import type { NativeEvidenceDocumentClient, NativeEvidenceDocumentFrame } from '../native-evidence-document-types';
import type { NativeSceneDrawingPdfReference, NativeSceneDrawingProvenance } from '../native-scene-source-types';

const referencePageSize = 64;

/** A hash selects among current building evidence; it grants no read access.
 * Each candidate is resolved by the native document owner before any bytes paint. */
export function NativeSceneDrawing({ client, sheet, evidenceIds, reference, provenance, current, onClose }: {
  readonly client: NativeEvidenceDocumentClient; readonly sheet: ElectricalFixtureSheet;
  readonly reference?: NativeSceneDrawingPdfReference | undefined;
  readonly provenance?: NativeSceneDrawingProvenance | undefined;
  readonly evidenceIds: readonly string[]; readonly current: () => boolean; readonly onClose: () => void;
}) {
  const [shown, setShown] = useState<{ frame: NativeEvidenceDocumentFrame; url: string; generation: number } | null>(null);
  const [status, setStatus] = useState('Checking saved drawing…'), [zoom, setZoom] = useState(1);
  const [pdfPage, setPdfPage] = useState(sheet.pdfPage);
  const [pdfPageInput, setPdfPageInput] = useState(String(sheet.pdfPage));
  const [cursor, setCursor] = useState<{ client: NativeEvidenceDocumentClient; sheet: ElectricalFixtureSheet;
    evidenceIds: readonly string[]; reference: NativeSceneDrawingPdfReference | undefined; start: number; unreadable: boolean } | null>(null);
  const [continuation, setContinuation] = useState<{ generation: number; next: number; unreadable: boolean } | null>(null);
  const selectedCursor = cursor?.client === client && cursor.sheet === sheet && cursor.evidenceIds === evidenceIds
    && cursor.reference === reference ? cursor : null;
  const pageStart = selectedCursor?.start ?? 0, previouslyUnreadable = selectedCursor?.unreadable ?? false;
  const payload = useRef<HTMLDivElement>(null), closer = useRef<HTMLButtonElement>(null);
  const currentRef = useRef(current); currentRef.current = current;
  const generationRef = useRef(0);
  const activeDrawing = useRef<{ frame: NativeEvidenceDocumentFrame; url: string; generation: number; withdraw: () => boolean } | null>(null);
  const goToPdfPage = (page: number) => {
    const selected = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(page)));
    setPdfPage(selected); setPdfPageInput(String(selected));
  };
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  useLayoutEffect(() => {
    if (!selectedCursor && cursor) setCursor(null);
    const generation = ++generationRef.current;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    let held: NativeEvidenceDocumentFrame | null = null, url: string | null = null;
    let stop: (() => void) | null = null, disposed = false;
    const live = () => !disposed && !controller.signal.aborted && currentRef.current();
    const withdraw = () => {
      const hadResources = !!stop || !!url || !!held;
      // Withdraw the action synchronously before release can notify or reenter.
      if (generationRef.current === generation) {
        if (payload.current) payload.current.hidden = true;
        if (activeDrawing.current?.generation === generation) activeDrawing.current = null;
      }
      const unsubscribe = stop; stop = null;
      unsubscribe?.();
      if (url) { URL.revokeObjectURL(url); url = null; }
      if (held) { client.release(held); held = null; }
      if (generationRef.current !== generation) return false;
      if (hadResources) setShown(null);
      return hadResources;
    };
    closer.current?.focus(); setShown(null); setContinuation(null); setZoom(1);
    setPdfPage(sheet.pdfPage); setPdfPageInput(String(sheet.pdfPage)); setStatus('Checking saved drawing…');
    void (async () => {
      // Each explicit continuation owns at most one bounded page and the same
      // ten-second read budget. Never allocate or reject the whole evidence list.
      const page = reference ? [reference.evidenceId] : evidenceIds.slice(pageStart, pageStart + referencePageSize);
      if (!live() || new Set(page).size !== page.length
        || !/^[0-9a-f]{64}$/.test(sheet.renderedPhotoSha256)) throw new Error('Drawing references unavailable');
      if (reference && (reference.sheetId !== sheet.id || reference.pdfPage !== sheet.pdfPage
        || reference.originalPhotoSha256 !== sheet.originalPhotoSha256
        || reference.renderedPhotoSha256 !== sheet.renderedPhotoSha256
        || !evidenceIds.includes(reference.evidenceId))) throw new Error('Drawing correlation unavailable');
      let unreadable = previouslyUnreadable;
      for (const evidenceId of page) {
        if (!live()) return;
        let frame: NativeEvidenceDocumentFrame;
        try { frame = await client.open(evidenceId, controller.signal); }
        catch { if (!live()) return; unreadable = true; continue; }
        held = frame;
        if (!live() || !client.isCurrent(frame)) { client.release(frame); held = null; return; }
        const matches = reference
          ? frame.evidenceId === reference.evidenceId && frame.evidenceRevision === reference.evidenceRevision
            && frame.asset.assetId === reference.assetId && frame.asset.revision.compare(reference.assetRevision) === 0
            && frame.asset.sha256 === reference.assetSha256 && frame.asset.byteSize.compare(reference.byteSize) === 0
            && frame.mode === 'original-download' && frame.asset.contentType === 'application/pdf'
            && frame.asset.purpose === 'evidence-original' && frame.asset.previewPolicy === 'download-only'
          : frame.asset.sha256 === sheet.renderedPhotoSha256 && frame.mode === 'inline-png'
            && frame.asset.contentType === 'image/png';
        if (!matches) { client.release(frame); held = null; continue; }
        const blob = client.getBlob(frame);
        if (!blob || blob.type !== (reference ? 'application/pdf' : 'image/png')
          || (reference && blob.size !== reference.byteSize.toSafeInteger())) throw new Error('Drawing unavailable');
        url = URL.createObjectURL(blob);
        stop = client.subscribeInvalidation(frame, () => {
          const currentGeneration = !disposed && generationRef.current === generation;
          withdraw(); controller.abort();
          if (currentGeneration && !disposed && generationRef.current === generation) {
            setStatus('This saved drawing is no longer current. Close it and reload scans.');
          }
        });
        if (!live() || !client.isCurrent(frame) || held !== frame) { withdraw(); return; }
        const active = { frame, url, generation, withdraw };
        activeDrawing.current = active;
        clearTimeout(timer); setShown({ frame, url, generation }); setStatus(''); return;
      }
      clearTimeout(timer);
      if (live()) {
        if (reference) { setStatus('The correlated reference PDF is unavailable for this current drawing. Close it and reload scans.'); return; }
        const next = pageStart + page.length;
        if (next < evidenceIds.length) {
          setContinuation({ generation, next, unreadable });
          const remaining = evidenceIds.length - next;
          setStatus(`${unreadable ? 'Some checked drawing references could not be read.' : 'No current saved PNG matches the checked references.'} ${remaining} ${remaining === 1 ? 'reference remains' : 'references remain'} to check.`);
        } else setStatus(unreadable
          ? 'Some saved drawing references could not be read. Close it and try again.'
          : 'No current saved PNG or qualified reference PDF is available for this drawing. Reload scans after its source is available.');
      }
    })().catch(() => { clearTimeout(timer); withdraw(); if (live()) setStatus('The current saved drawing could not be read. Close it and try again.'); });
    const aborted = () => {
      withdraw();
      if (!disposed && generationRef.current === generation) {
        setStatus('The saved drawing read did not complete. Close it and try again.');
      }
    };
    controller.signal.addEventListener('abort', aborted, { once: true });
    return () => {
      disposed = true; clearTimeout(timer); controller.signal.removeEventListener('abort', aborted);
      controller.abort(); withdraw();
      if (activeDrawing.current?.generation === generation) activeDrawing.current = null;
    };
  }, [client, sheet, evidenceIds, reference, pageStart, previouslyUnreadable]);
  useLayoutEffect(() => {
    if (payload.current) payload.current.hidden = !shown || !currentRef.current() || !client.isCurrent(shown.frame);
  }, [client, shown]);
  const renderFailed = (expected: NonNullable<typeof shown>) => {
    const active = activeDrawing.current;
    if (!active || active.generation !== expected.generation || generationRef.current !== expected.generation
      || active.frame !== expected.frame || active.url !== expected.url || !active.withdraw()
      || generationRef.current !== expected.generation) return;
    setStatus('The saved PNG could not be rendered. Close it and try again.');
  };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), summary, [tabindex="0"]')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return <section className="native-scene-drawing" role="dialog" aria-modal="true"
    aria-label={sheet.title} onKeyDown={keys}>
    <header><div><h3>{sheet.title}</h3><p>Historical drawing · reference PDF page {sheet.pdfPage}</p></div>
      <button ref={closer} type="button" className="chip-btn" onClick={onClose}>Close drawing</button></header>
    {provenance && <details className="native-drawing-provenance" style={{ overflowWrap: 'anywhere' }}>
      <summary>Drawing source review</summary>
      <p>Room filters use the current native review. The retained historical ledger bytes are unchanged.</p>
      <dl><dt>Historical room-mapping receipt</dt><dd>{provenance.historicalRoomMappingReceipt.id}</dd>
        <dt>Historical receipt SHA-256</dt><dd>{provenance.historicalRoomMappingReceipt.sha256}</dd>
        <dt>Unchanged fixture-ledger SHA-256</dt><dd>{provenance.fixtureLedgerSha256}</dd>
        <dt>Support original SHA-256</dt><dd>{provenance.supportOriginalSha256}</dd>
        <dt>Current native room review</dt><dd>{provenance.currentNativeRoomReview.id}</dd>
        <dt>Current review SHA-256</dt><dd>{provenance.currentNativeRoomReview.sha256}</dd></dl>
    </details>}
    {status && <p role="status">{status}</p>}
    {continuation && continuation.generation === generationRef.current && currentRef.current() && <button type="button"
      className="chip-btn" onClick={() => {
        if (continuation.generation !== generationRef.current || !currentRef.current()) return;
        setContinuation(null);
        setCursor({ client, sheet, evidenceIds, reference, start: continuation.next, unreadable: continuation.unreadable });
      }}>Check next references</button>}
    {shown && currentRef.current() && client.isCurrent(shown.frame) && <div ref={payload}>
      {shown.frame.mode === 'original-download' ? <>
        <p>Reference PDF · page {sheet.pdfPage}</p>
        <div className="native-scene-pdf-controls">
          <div className="native-scene-pdf-page">
            <button type="button" className="chip-btn" aria-label="Previous PDF page" disabled={pdfPage <= 1}
              onClick={() => goToPdfPage(pdfPage - 1)}>Previous page</button>
            <label>Page <input type="number" min="1" step="1" value={pdfPageInput} onChange={event => {
              const value = event.currentTarget.value, page = Number(value);
              setPdfPageInput(value);
              if (value && Number.isSafeInteger(page) && page >= 1) setPdfPage(page);
            }} onBlur={() => {
              const page = Number(pdfPageInput);
              if (!pdfPageInput || !Number.isSafeInteger(page) || page < 1) setPdfPageInput(String(pdfPage));
            }} /></label>
            <button type="button" className="chip-btn" aria-label="Next PDF page"
              onClick={() => goToPdfPage(pdfPage + 1)}>Next page</button>
          </div>
          <div role="group" aria-label="PDF zoom" className="native-scene-pdf-zoom">
            <button type="button" className="chip-btn" aria-label="Zoom out PDF" disabled={zoom <= 0.5}
              onClick={() => setZoom(value => Math.max(0.5, value / 2))}>−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" className="chip-btn" aria-label="Zoom in PDF" disabled={zoom >= 4}
              onClick={() => setZoom(value => Math.min(4, value * 2))}>+</button>
            <button type="button" className="chip-btn" onClick={() => setZoom(1)}>Reset zoom</button>
          </div>
        </div>
        <iframe className="native-scene-pdf" title={`${sheet.title}, reference PDF`} tabIndex={-1} referrerPolicy="no-referrer"
          src={`${shown.url}#page=${pdfPage}&zoom=${Math.round(zoom * 100)}`} />
        <a href={shown.url} download={`atlas-original-${shown.frame.asset.assetId}.pdf`} onClick={event => {
          if (!currentRef.current() || !client.isCurrent(shown.frame)
            || activeDrawing.current?.generation !== shown.generation) {
            event.preventDefault(); activeDrawing.current?.withdraw();
            setStatus('This reference PDF is no longer current. Close it and reload scans.');
          }
        }}>Download reference PDF</a>
      </> : <>
      <div role="group" aria-label="Drawing size">
        <button type="button" onClick={() => setZoom(1)}>Fit</button>
        <button type="button" disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value / 2))}>Zoom out</button>
        <button type="button" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value * 2))}>Zoom in</button>
      </div>
      <div className="native-scene-drawing-image" role="region" aria-label={`${sheet.title}, drawing image`} tabIndex={0}><img src={shown.url} alt={`${sheet.title}, historical electrical drawing`}
        onError={() => renderFailed(shown)}
        style={{ width: `${zoom * 100}%`, maxWidth: 'none', height: 'auto' }} /></div>
      </>}
    </div>}
  </section>;
}
