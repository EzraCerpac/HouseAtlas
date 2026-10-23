import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Empty } from '../components/ui';
import { useTopology } from '../topology/TopologyProvider';
import type { NativeEvidenceDocumentClient } from '../scans/native-evidence-document-types';
import type { ElectricalLibraryFrame, ElectricalLibraryPage, ElectricalLibraryPort, ElectricalLibraryReader, ElectricalLibrarySheet } from './types';
import './electrical-library.css';
import '../scans/native-ui/native-scene.css';

const Drawing = lazy(() => import('../scans/native-ui/NativeSceneDrawing').then(module => ({ default: module.NativeSceneDrawing })));
const CHANGED = 'The drawing references changed or are no longer available. Reload drawings.';

/** Optional native evidence collection, separate from HomeBox attachments and
 * Document v2. Mounting it never changes the Atlas building selection. */
export function ElectricalLibrary({ port }: { readonly port: ElectricalLibraryPort }) {
  const topology = useTopology(), heading = useId(), selector = useId();
  const [selection, setSelection] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ port: ElectricalLibraryPort; reader: ElectricalLibraryReader | null } | null>(null);
  useEffect(() => topology.activate(), [topology.activate]);
  useEffect(() => {
    let live = true, held: ElectricalLibraryReader | null = null;
    void port.createReader().then(reader => {
      if (!live) { reader.dispose(); return; }
      held = reader; setSlot({ port, reader });
    }, () => { if (live) setSlot({ port, reader: null }); });
    return () => { live = false; held?.dispose(); };
  }, [port]);
  const buildings = topology.index?.buildings ?? [];
  const building = buildings.find(item => item.id === selection) ?? (buildings.length === 1 ? buildings[0]! : null);
  const current = slot?.port === port ? slot : null;
  return <section className="electrical-library" aria-labelledby={heading}>
    <div className="section-head"><h2 id={heading}>Electrical drawings</h2></div>
    <p>Historical drawing references. Group labels do not establish current wiring.</p>
    {topology.status === 'loading' ? <p role="status">Reading buildings…</p>
      : topology.status !== 'ready' ? <Empty>Buildings could not be read. Electrical drawings are unavailable.</Empty>
      : buildings.length === 0 ? <Empty>No reviewed building is available in this read.</Empty> : <>
        <label htmlFor={selector}>Building</label>{' '}
        <select id={selector} value={building?.id ?? ''} onChange={event => setSelection(event.currentTarget.value || null)}>
          <option value="">Choose a building</option>
          {buildings.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        {topology.index?.data.sourceStatuses.some(status => status !== 'current') && <p role="status">Building list source: {topology.index.data.sourceStatuses.join(', ')}.</p>}
        {!building ? <Empty>Choose a building to read its drawing references.</Empty>
          : !current ? <p role="status">Preparing drawing reader…</p>
          : !current.reader ? <Empty>Electrical drawings are unavailable for this view.</Empty>
          : <BuildingDrawings key={building.id} reader={current.reader} buildingId={building.id} />}
      </>}
  </section>;
}

function SheetFacts({ entry }: { readonly entry: ElectricalLibrarySheet }) {
  const source = entry.documentary;
  return <div className="electrical-library-sheet-facts">
    <span>Drawing date: {entry.sheet.sourceDate ?? 'Not recorded'}</span>
    {entry.rooms.length === 0 ? <span>No room association recorded</span> : entry.rooms.map(room =>
      <span key={JSON.stringify([room.packagePlaceKey, room.packagePlaceUuid, room.label, room.basis])}>{room.label} · {room.basis === 'owner-reported' ? 'Owner reported' : 'Inferred'}
        {room.nativePlaceId === null ? ' · Native room unresolved' : ''}</span>)}
    {source && <details><summary>Drawing interpretation</summary>
      <p>{source.directReading.text} · {source.directReading.uncertainty.explanation}</p>
      <p>{source.drawingAssociation.text} · {source.drawingAssociation.uncertainty.explanation}</p>
      <p>{source.openUncertainty}</p>
      <p>Fact date: {source.source.factAt ?? 'Not recorded'} · Retrieved: {source.source.retrievedAt ?? 'Not recorded'} · Interpreted: {source.source.interpretationDate}</p>
      {source.roomAssociations.map(room => <p key={JSON.stringify([room.packagePlaceKey, room.packagePlaceUuid])}>
        {room.label} · {room.relationship}{room.historicalLabel ? ` · Historical label: ${room.historicalLabel}` : ''}{room.statement ? ` · ${room.statement}` : ''}
      </p>)}
    </details>}
  </div>;
}

function BuildingDrawings({ reader, buildingId }: { readonly reader: ElectricalLibraryReader; readonly buildingId: string }) {
  const owner = useSyncExternalStore(reader.subscribeOwner, reader.owner);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ owner: object; frame: ElectricalLibraryFrame | null; message: string } | null>(null);
  const [opened, setOpened] = useState<{ frame: ElectricalLibraryFrame; page: ElectricalLibraryPage } | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController(); let frame: ElectricalLibraryFrame | null = null, off: (() => void) | null = null;
    setState({ owner, frame: null, message: 'Reading drawing references…' }); setOpened(null);
    const withdraw = () => {
      // Retire links and the dialog synchronously, before React's next paint.
      surface.current?.setAttribute('hidden', '');
      if (!controller.signal.aborted) { setOpened(null); setState({ owner, frame: null, message: CHANGED }); }
    };
    void reader.read(buildingId, controller.signal).then(result => {
      if (result.status !== 'available') {
        if (!controller.signal.aborted) setState({ owner, frame: null, message: result.reason === 'no-current-association'
          ? 'No current drawing association is recorded for this building.' : 'Drawing references could not be read for this building.' });
        return;
      }
      frame = result;
      if (controller.signal.aborted) { reader.release(result); return; }
      let ended = false;
      off = reader.subscribeInvalidation(result, () => { ended = true; withdraw(); });
      if (ended || !reader.isCurrent(result)) { off(); off = null; reader.release(result); withdraw(); return; }
      surface.current?.removeAttribute('hidden'); setState({ owner, frame: result, message: '' });
    }, () => { if (!controller.signal.aborted) setState({ owner, frame: null, message: 'Drawing references could not be read for this building.' }); });
    return () => { controller.abort(); off?.(); if (frame) reader.release(frame); };
  }, [reader, owner, buildingId, attempt]);
  const current = state?.owner === owner && state.frame && reader.isCurrent(state.frame) ? state.frame : null;
  const message = !owner ? 'Electrical drawings are unavailable for this view.' : state?.owner === owner ? state.message : 'Reading drawing references…';
  const shown = opened && opened.frame === current ? opened : null;
  return <>
    {message && <p role="status">{message}</p>}
    <button type="button" className="btn btn-small" disabled={!owner} onClick={() => setAttempt(value => value + 1)}>Reload drawings</button>
    <div ref={surface}>
      {current && <>
        <p>{current.documents.length} reference {current.documents.length === 1 ? 'PDF' : 'PDFs'} · Original access is checked when opened.</p>
        {current.documents.length === 0 && current.unlinkedSheets.length === 0 && <Empty>No electrical sheets are recorded in this current source.</Empty>}
        <ul className="electrical-library-documents">{current.documents.map(document => <li key={document.key}>
          <h3>Electrical reference PDF</h3>
          <p>{document.pages.length} referenced {document.pages.length === 1 ? 'sheet' : 'sheets'} · {document.byteSize.token} bytes</p>
          <details><summary>Document identity</summary><dl>
            <dt>Evidence</dt><dd>{document.evidenceId} · revision {document.evidenceRevision}</dd>
            <dt>Original asset</dt><dd>{document.assetId} · revision {document.assetRevision.token}</dd>
            <dt>Original SHA-256</dt><dd>{document.sha256}</dd>
          </dl></details>
          <ul>{document.pages.map(page => <li key={page.sheet.id}>
            <button type="button" className="row-title" onClick={() => {
              if (reader.isCurrent(current)) setOpened({ frame: current, page });
            }} aria-label={`Open ${page.sheet.title}, PDF page ${page.reference.pdfPage}`}>{page.sheet.title} · Page {page.reference.pdfPage}</button>
            <SheetFacts entry={page} />
          </li>)}</ul>
        </li>)}</ul>
        {current.unlinkedSheets.length > 0 && <div><h3>Sheet references</h3>
          <p>No qualified PDF correlation is available for these sheets.</p>
          <ul>{current.unlinkedSheets.map(entry => <li key={entry.sheet.id}>
            {entry.sheet.title} · Referenced page {entry.sheet.pdfPage}<SheetFacts entry={entry} />
          </li>)}</ul>
        </div>}
        {shown && <DrawingDialog key={shown.page.sheet.id} reader={reader} frame={shown.frame} page={shown.page} onClose={() => setOpened(null)} />}
      </>}
    </div>
  </>;
}

function DrawingDialog({ reader, frame, page, onClose }: { readonly reader: ElectricalLibraryReader; readonly frame: ElectricalLibraryFrame;
  readonly page: ElectricalLibraryPage; readonly onClose: () => void }) {
  const [client, setClient] = useState<NativeEvidenceDocumentClient | null>(null);
  const [failed, setFailed] = useState(false);
  const evidenceIds = useMemo(() => Object.freeze([page.reference.evidenceId]), [page]);
  useEffect(() => {
    if (!reader.isCurrent(frame)) return;
    try {
      const owned = reader.createDrawingClient(frame); setClient(owned);
      return () => { owned.dispose(); };
    } catch { setFailed(true); }
  }, [reader, frame]);
  return <div className="electrical-library-backdrop">
    {failed && <div role="status">The drawing source is unavailable. <button type="button" onClick={onClose}>Close drawing</button></div>}
    <Suspense fallback={<div role="status">Preparing drawing… <button type="button" onClick={onClose}>Close drawing</button></div>}>
      {client && <Drawing client={client} sheet={page.sheet} reference={page.reference}
        evidenceIds={evidenceIds} {...(frame.provenance ? { provenance: frame.provenance } : {})}
        current={() => reader.isCurrent(frame)} onClose={onClose} />}
    </Suspense>
  </div>;
}
