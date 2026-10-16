import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Modal } from '../components/Modal';
import { Empty } from '../components/ui';
import { fmtDate, fmtDateTime } from '../data/time';
import { SourcePdf } from './SourcePdf';
import type { SourceDate, SourceDocument, SourceDocumentFrame, SourceDocumentMime, SourceDocumentReader,
  SourceDocumentsPort, SourcePreviewAvailability } from './types';
import './source-documents.css';

const AVAILABILITY: Readonly<Record<SourcePreviewAvailability, string>> = {
  available: 'Available', unavailable: 'Unavailable', 'access-revoked': 'Access revoked', stale: 'Out of date',
  quarantined: 'Quarantined', 'not-qualified': 'No qualified preview',
};
const LICENCE = { unknown: 'Licence unknown', permitted: 'Licence permits use', restricted: 'Licence restricted' } as const;
const MIME: Readonly<Record<SourceDocumentMime, { readonly label: string; readonly extension: string }>> = {
  'application/pdf': { label: 'PDF', extension: 'pdf' }, 'image/png': { label: 'PNG image', extension: 'png' },
  'image/tiff': { label: 'TIFF image', extension: 'tif' }, 'application/geo+json': { label: 'GeoJSON', extension: 'geojson' },
  'application/city+json': { label: 'CityJSON', extension: 'city.json' }, 'application/json': { label: 'JSON', extension: 'json' },
};
const CHANGED = 'This document changed or your access ended, so it is no longer shown. Close it and open it again.';
const count = (value: number) => value.toLocaleString('en-GB');
const sourceDate = (date: SourceDate | null) => !date ? 'Not recorded'
  : date.precision === 'year' ? `${date.value} (year only)` : date.precision === 'day' ? fmtDate(date.value) : fmtDateTime(date.value);
function readFailure(error: unknown): string {
  const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
  return status === 403 ? 'You do not have access to this document.'
    : status === 409 ? 'This document changed while it was being read. Close it and open it again.'
    : status === 404 ? 'This document is no longer available.'
    : 'This document could not be read. Try again later.';
}

/** Native v2 source Documents for the current home. The reader module loads
 * here, belongs to this section and is disposed with it. */
export function SourceDocuments({ port }: { readonly port: SourceDocumentsPort }) {
  const [slot, setSlot] = useState<{ readonly port: SourceDocumentsPort; readonly reader: SourceDocumentReader | null } | null>(null);
  useEffect(() => {
    let live = true, made: SourceDocumentReader | null = null;
    port.createReader().then(reader => { if (!live) { reader.dispose(); return; } made = reader; setSlot({ port, reader }); },
      () => { if (live) setSlot({ port, reader: null }); });
    return () => { live = false; made?.dispose(); };
  }, [port]);
  const headingId = useId();
  const current = slot?.port === port ? slot : null;
  return <section className="source-docs" aria-labelledby={headingId}>
    <div className="section-head"><h2 id={headingId}>Source documents</h2></div>
    <p className="source-docs-note">Retained source files with their recorded origin, licence and dates.
      Their metadata does not place anything in a building, floor or room.</p>
    {!current ? <p role="status">Reading source documents…</p>
      : !current.reader ? <Empty>Source documents are not available in this browser.</Empty>
      : <SourceDocumentList reader={current.reader} />}
  </section>;
}

type ListState = {
  readonly owner: object; readonly status: 'loading' | 'ready' | 'failed';
  readonly documents: readonly SourceDocument[]; readonly next: string | null; readonly moreFailed: boolean;
};

function SourceDocumentList({ reader }: { readonly reader: SourceDocumentReader }) {
  const owner = useSyncExternalStore(reader.subscribeOwner, reader.owner);
  const [state, setState] = useState<ListState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [opened, setOpened] = useState<{ readonly owner: object; readonly document: SourceDocument } | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController(); pending.current = controller;
    setState({ owner, status: 'loading', documents: [], next: null, moreFailed: false });
    reader.list(null, controller.signal).then(
      page => { if (!controller.signal.aborted) setState({ owner, status: 'ready', documents: page.documents, next: page.nextCursor, moreFailed: false }); },
      () => { if (!controller.signal.aborted) setState({ owner, status: 'failed', documents: [], next: null, moreFailed: false }); },
    ).finally(() => { if (pending.current === controller) pending.current = null; });
    return () => { pending.current?.abort(); pending.current = null; };
  }, [reader, owner, attempt]);
  const current = owner && state?.owner === owner ? state : null;
  const loadMore = () => {
    if (!current || current.status !== 'ready' || current.next === null || pending.current) return;
    const prior = current, controller = new AbortController(); pending.current = controller;
    setState({ ...prior, moreFailed: false });
    reader.list(prior.next, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      const seen = new Set(prior.documents.map(document => document.documentId));
      if (page.documents.some(document => seen.has(document.documentId))) throw new TypeError('Source document page repeated');
      setState({ ...prior, documents: [...prior.documents, ...page.documents], next: page.nextCursor });
    }).catch(() => { if (!controller.signal.aborted) setState({ ...prior, moreFailed: true }); })
      .finally(() => { if (pending.current === controller) pending.current = null; });
  };
  if (!owner) return <Empty>Source documents are not available for this view.</Empty>;
  if (!current || current.status === 'loading') return <p role="status">Reading source documents…</p>;
  if (current.status === 'failed') return <div className="source-docs-retry">
    <p role="status">Source documents could not be read.</p>
    <button type="button" className="btn btn-small" onClick={() => setAttempt(value => value + 1)}>Try again</button>
  </div>;
  const shown = opened?.owner === owner ? opened.document : null;
  return <>
    {current.documents.length === 0 ? <Empty>No source documents are saved for this home.</Empty>
      : <ul className="library source-docs-list">{current.documents.map(document =>
        <li key={document.documentId} className="lib-row">
          <span className="lib-thumb lib-thumb-export" aria-hidden="true"><span className="lib-page"><span /><span /><span /></span></span>
          <div className="lib-main">
            <button type="button" className="row-title" onClick={() => setOpened({ owner, document })}>{document.title}</button>
            <span className="row-meta">
              <span>{document.provenance.agency}</span>
              <span>Retrieved {fmtDate(document.provenance.retrievedAt)}</span>
              <span>{LICENCE[document.provenance.license.status]}</span>
              {document.availability.original !== 'available' && <span>Original: {AVAILABILITY[document.availability.original]}</span>}
              <span>Preview: {AVAILABILITY[document.availability.preview]}</span>
              {document.lifecycle === 'tombstoned' && <span>Withdrawn</span>}
            </span>
          </div>
          <button type="button" className="btn btn-small" aria-label={`Open ${document.title}`} onClick={() => setOpened({ owner, document })}>Open</button>
        </li>)}</ul>}
    {current.next !== null && <button type="button" className="btn btn-small source-docs-more" onClick={loadMore}>Load more</button>}
    {current.moreFailed && <p role="status">More source documents could not be read.</p>}
    {shown && <SourceDocumentDialog key={shown.documentId} reader={reader} document={shown} onClose={() => setOpened(null)} />}
  </>;
}

function SourceDocumentDialog({ reader, document, onClose }: {
  readonly reader: SourceDocumentReader; readonly document: SourceDocument; readonly onClose: () => void;
}) {
  const previewReady = document.availability.preview === 'available' && document.preview !== null;
  const [mode, setMode] = useState<'preview' | 'original'>(previewReady ? 'preview' : 'original');
  return <Modal title={document.title} kicker="Source document" onClose={onClose} wide>
    <div className="seg source-doc-mode" role="group" aria-label="Show">
      <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Qualified preview</button>
      <button type="button" aria-pressed={mode === 'original'} onClick={() => setMode('original')}>Original</button>
    </div>
    <LeasedPayload key={mode} reader={reader} document={document} mode={mode} />
    <Provenance document={document} />
  </Modal>;
}

type Shown = { readonly frame: SourceDocumentFrame; readonly url: string; readonly blob: Blob; readonly signal: AbortSignal };

/** Shows one leased byte frame. Invalidation hides it synchronously, revokes
 * its URL and releases the lease; late completions are released unseen. */
function LeasedPayload({ reader, document, mode }: {
  readonly reader: SourceDocumentReader; readonly document: SourceDocument; readonly mode: 'preview' | 'original';
}) {
  const box = useRef<HTMLDivElement>(null);
  const withdrawRef = useRef<() => void>(() => undefined);
  const [shown, setShown] = useState<Shown | null>(null);
  const availability = mode === 'preview' ? document.availability.preview : document.availability.original;
  const [status, setStatus] = useState(availability !== 'available' ? null : mode === 'preview' ? 'Reading qualified preview…' : 'Reading original…');
  useEffect(() => {
    if (availability !== 'available' || (mode === 'preview' && !document.preview)) return;
    const controller = new AbortController();
    let held: { readonly frame: SourceDocumentFrame; readonly url: string; readonly stop: () => void; readonly view: AbortController } | null = null;
    const withdraw = (message: string | null) => {
      const ending = held; held = null; if (!ending) return;
      // Hide, then cancel owned PDF work and destroy its task before the lease ends.
      box.current?.setAttribute('hidden', '');
      ending.view.abort();
      ending.stop(); URL.revokeObjectURL(ending.url); reader.release(ending.frame);
      if (message !== null) { setShown(null); setStatus(message); }
    };
    withdrawRef.current = () => withdraw(CHANGED);
    const read = mode === 'preview' ? reader.openPreview(document.documentId, document.revision, controller.signal)
      : reader.openOriginal(document.documentId, document.revision, controller.signal);
    read.then(frame => {
      if (controller.signal.aborted) { reader.release(frame); return; }
      let ended = false;
      const stop = reader.subscribeInvalidation(frame, () => { ended = true; withdraw(CHANGED); });
      const blob = reader.getBlob(frame);
      if (ended || !blob) { stop(); reader.release(frame); setStatus(CHANGED); return; }
      held = { frame, url: URL.createObjectURL(blob), stop, view: new AbortController() };
      box.current?.removeAttribute('hidden');
      setShown({ frame, url: held.url, blob, signal: held.view.signal }); setStatus(null);
    }, error => { if (!controller.signal.aborted) setStatus(readFailure(error)); });
    return () => { controller.abort(); withdraw(null); withdrawRef.current = () => undefined; };
  }, [reader, document, mode, availability]);
  const save = useCallback((frame: SourceDocumentFrame) => (event: { preventDefault(): void }) => {
    if (!reader.isCurrent(frame)) { event.preventDefault(); withdrawRef.current(); }
  }, [reader]);
  const live = shown && reader.isCurrent(shown.frame) ? shown : null;
  const lineage = document.preview;
  const original = live?.frame.mode === 'original' ? MIME[live.frame.measuredContentType] : null;
  return <div className="source-doc-view">
    {availability !== 'available' ? <p className="source-doc-status">{mode === 'preview'
      ? `${AVAILABILITY[availability]}. ${availability === 'not-qualified' ? 'Only qualified previews are shown; the original is unchanged.' : 'No preview is shown.'}`
      : `Original: ${AVAILABILITY[availability]}.`}</p>
      : mode === 'preview' && !lineage ? <p className="source-doc-status">No qualified preview.</p>
      : status && <p className="source-doc-status" role="status">{status}</p>}
    <div ref={box} className="source-doc-payload">
      {live && live.frame.mode === 'preview' && lineage && <figure className="source-doc-preview">
        <img src={live.url} alt={`Qualified preview of ${document.title}`} />
        <figcaption>Qualified stripped PNG preview from {lineage.renderer} {lineage.rendererVersion}. {lineage.description}</figcaption>
      </figure>}
      {live && original && <>
        {live.frame.measuredContentType === 'application/pdf'
          ? <><p className="source-doc-status">Original PDF, drawn in this browser as page images. Links, forms and attachments are not opened.</p>
            <SourcePdf blob={live.blob} title={document.title} signal={live.signal} /></>
          : <p className="source-doc-status">{original.label} originals have no viewer here. Save the original to open it in another program.</p>}
        <a className="btn btn-small" href={live.url} download={`source-document-${document.documentId}.${original.extension}`}
          onClick={save(live.frame)}>Save original ({original.label}, {count(live.frame.asset.bytes)} bytes)</a>
      </>}
    </div>
  </div>;
}

function Provenance({ document }: { readonly document: SourceDocument }) {
  const { provenance: source, original, preview } = document, frame = source.frame;
  return <dl className="facts source-doc-facts">
    <div><dt>Source</dt><dd>{source.agency}</dd></div>
    <div><dt>Recorded address</dt><dd>{source.url ?? 'Not recorded'}
      {source.url && <span className="fact-help">Recorded text only. It is not opened from here.</span>}</dd></div>
    <div><dt>Licence</dt><dd>{LICENCE[source.license.status]}{source.license.reference ? `: ${source.license.reference}` : ''}</dd></div>
    <div><dt>Retrieved</dt><dd>{fmtDateTime(source.retrievedAt)}</dd></div>
    <div><dt>Published</dt><dd>{sourceDate(source.published)}</dd></div>
    <div><dt>Observed</dt><dd>{sourceDate(source.observed)}</dd></div>
    <div><dt>Coordinate system</dt><dd>{frame.crs ?? 'Not recorded'}</dd></div>
    <div><dt>Axes and unit</dt><dd>{frame.axes.length ? frame.axes.join(', ') : 'Axes not recorded'}; {frame.linearUnit ?? 'unit not recorded'}</dd></div>
    <div><dt>Extent</dt><dd>{frame.extent ? frame.extent.join(', ') : 'Not recorded'}</dd></div>
    <div><dt>Original</dt><dd>{count(original.bytes)} bytes, asset revision {original.revision}, {AVAILABILITY[document.availability.original].toLowerCase()}
      <code>{original.sha256}</code></dd></div>
    <div><dt>Custody receipt</dt><dd><code>{source.custodyReceiptSha256}</code></dd></div>
    <div><dt>Preview</dt><dd>{preview ? <>{preview.renderer} {preview.rendererVersion}, {count(preview.asset.bytes)} bytes,
      from this original{preview.sourceCropExtent ? `, cropped to ${preview.sourceCropExtent.join(', ')}` : ''}. {preview.description}
      <span className="fact-help">Configuration <code>{preview.rendererConfigSha256}</code></span>
      <span className="fact-help">Qualification <code>{preview.qualificationReceiptSha256}</code></span></>
      : 'No qualified preview'}</dd></div>
    <div><dt>Record</dt><dd>Revision {document.revision}, {document.lifecycle === 'active' ? 'active' : 'withdrawn'}, updated {fmtDateTime(document.updatedAt)}</dd></div>
  </dl>;
}
