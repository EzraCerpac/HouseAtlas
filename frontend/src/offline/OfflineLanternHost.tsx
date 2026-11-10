import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { LiveCopyRetention } from '../../integration/live-copy-retention';
import type { OfflineCatalogItemV1, OfflineCatalogV1, OfflineCopyHandle, OfflineDocumentAvailability, OfflineElectricalCatalogV1, OfflineElectricalBuildingV1, OfflineElectricalPinV1, OfflineElectricalAvailability, OfflineHomeboxAvailability, OfflineHomeboxPinV1, OfflineViewSnapshotV1 } from './live-copy-types';
import { SectionNavigation } from '../lantern/components/SectionNavigation';
import type { ViewId } from '../lantern/state/store';
import { Icon } from '../lantern/components/Icon';
import { Modal } from '../lantern/components/Modal';
import { SourcePdf } from '../lantern/source-documents/SourcePdf';
import UnifiedAtlas from '../lantern/unified-atlas/UnifiedAtlas';
import { SavedAtlasHost, type LastAtlasCopy } from './SavedAtlasHost';
import { markSavedEntry } from './saved-entry';
import { useLiveHost } from './connection-probe';
import { useOutbox } from '../outbox';
import { OfflineStorageSettings, storageSize } from './OfflineStorageSettings';
import './offline-app.css';
import '../lantern/styles/panels.css';
import '../lantern/styles/integration.css';

interface Selection {
  readonly handle: OfflineCopyHandle; readonly snapshot: OfflineViewSnapshotV1; readonly signal: AbortSignal;
}
type OpenAtlas = (signal: AbortSignal, handle: OfflineCopyHandle) => Promise<LastAtlasCopy | null>;

/** Historical display only. No SessionApp, live client, edit port or outbox configure call. */
export function OfflineLanternHost({ owner, openAtlas, openLegacyAtlas }: {
  owner: LiveCopyRetention; openAtlas: OpenAtlas; openLegacyAtlas(signal: AbortSignal): Promise<LastAtlasCopy | null>;
}) {
  const [selection, setSelection] = useState<Selection | null>(null), [missing, setMissing] = useState(false);
  const [unavailable, setUnavailable] = useState(false), acquired = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let controller: AbortController | null = null;
    const refresh = () => {
      box.current?.setAttribute('hidden', ''); controller?.abort();
      controller = new AbortController(); const signal = controller.signal;
      setSelection(null); setMissing(false); setUnavailable(false);
      void owner.read.readLast(signal).then(result => {
        if (signal.aborted) return;
        if (result.status === 'ok') { acquired.current = true; setSelection({ ...result.value, signal }); }
        else if (result.status === 'missing' && !acquired.current) setMissing(true);
        else setUnavailable(true);
        box.current?.removeAttribute('hidden');
      });
    };
    const stop = owner.read.subscribe(refresh); refresh();
    return () => { stop(); controller?.abort(); };
  }, [owner]);
  return <div ref={box} className="offline-app-root">
    {selection ? <RetainedApp key={selection.snapshot.snapshotRevision} owner={owner} selection={selection} openAtlas={openAtlas} />
      : missing ? <SavedAtlasHost openLastCopy={openLegacyAtlas} /> : unavailable
        ? <main className="lantern-host saved-atlas-app"><p role="status">Held app information is unavailable or was removed.</p><a href="/?live">Open live</a></main>
        : <p role="status">Opening held information…</p>}
  </div>;
}

function RetainedApp({ owner, selection, openAtlas }: { owner: LiveCopyRetention; selection: Selection; openAtlas: OpenAtlas }) {
  const [view, setView] = useState<ViewId>('atlas'), [settings, setSettings] = useState(false);
  const [atlas, setAtlas] = useState<LastAtlasCopy | null>(null), [atlasLoading, setAtlasLoading] = useState(true);
  const live = useLiveHost(), outbox = useOutbox();
  const reducedMotion = useSyncExternalStore(changed => {
    const query = matchMedia('(prefers-reduced-motion: reduce)'); query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, () => matchMedia('(prefers-reduced-motion: reduce)').matches, () => false);
  const { snapshot, signal } = selection;
  useEffect(() => {
    let ended = false, held: LastAtlasCopy | null = null, stop: (() => void) | undefined;
    void openAtlas(signal, selection.handle).then(copy => {
      if (ended || signal.aborted) { void copy?.close(); return; }
      held = copy; setAtlas(copy); setAtlasLoading(false);
      stop = copy?.port.subscribe(() => { if (!copy.port.current()) { setAtlas(null); void copy.close(); } });
    }, () => { if (!ended && !signal.aborted) setAtlasLoading(false); });
    return () => { ended = true; stop?.(); void held?.close(); };
  }, [openAtlas, signal, selection.handle]);
  const count = outbox.waiting;
  const waiting = count ? ` · ${count} ${count === 1 ? 'change' : 'changes'} waiting` : '';
  return <div className={`lantern-host app view-${view} offline-app`}>
    <a className="skip" href="#main">Skip to content</a>
    <header className="topbar"><span className="brand-name">HouseAtlas</span><span className="house-name">{snapshot.data.homeLabel}</span></header>
    <SectionNavigation view={view} onView={setView} />
    <div className="shell-tools">
      {live.reachable ? <a className="offline-pill" href="/?live">Back online · Open live{count ? ` to sync ${count} changes` : ''}</a>
        : <button className="offline-pill" type="button" onClick={live.check} disabled={live.checking} title="Check connection">{live.checking ? 'Checking…' : `Offline${waiting}`}</button>}
      <button type="button" className="icon-btn" aria-label="Settings" onClick={() => setSettings(true)}><Icon name="settings" size={20} /></button>
    </div>
    <main id="main" className="main" tabIndex={-1}>
      {view === 'atlas' ? atlas ? <div className="offline-atlas"><UnifiedAtlas port={atlas.port} environment={{ reducedMotion, openDocuments: () => setView('library') }} /></div>
        : <div className="view"><h1>Atlas</h1><p role="status">{atlasLoading ? 'Opening held Atlas…' : 'No matching Atlas is held on this device.'}</p></div>
        : <div className="view"><header className="view-head"><h1>{view === 'upkeep' ? 'Upkeep' : view === 'library' ? 'Library' : 'Changes'}</h1>
          <p>Held information from <time dateTime={snapshot.capturedAt}>{snapshot.capturedAt}</time>.</p></header>
          {view === 'upkeep' && <OfflineUpkeep snapshot={snapshot} />}
          {view === 'library' && <OfflineLibrary owner={owner} selection={selection} />}
          {view === 'changes' && <><h2>Waiting changes</h2><p>{outbox.loaded ? `${count} changes waiting on this device.` : 'Reading waiting changes…'}</p>
            <p>Open live to review and send waiting changes after signing in.</p><h2>Operation history</h2><p>Operation history is not held on this device. Open live to read it.</p></>}
        </div>}
    </main>
    {settings && <Modal title="Settings" onClose={() => setSettings(false)}><div className="settings"><OfflineStorageSettings controls={owner} /><a className="btn" href="/saved/index.html" onClick={markSavedEntry}>Saved house copies</a></div></Modal>}
  </div>;
}

function OfflineUpkeep({ snapshot }: { snapshot: OfflineViewSnapshotV1 }) {
  const entries = snapshot.data.entries.filter(entry => entry.maintenance.length > 0);
  return <><p>Maintenance is kept in HomeBox. Open live for current records and verified maintenance links.</p>
    {!entries.length && <p>No maintenance records were captured.</p>}
    {entries.map(entry => <section className="section" key={entry.key}><h2>{entry.entity.name}</h2>
      <ul>{entry.maintenance.map(task => <li key={task.entryId}><strong>{task.name}</strong>{task.description && <p>{task.description}</p>}
        <p>{task.completedDate ? `Completed: ${task.completedDate}` : task.scheduledDate ? `Scheduled: ${task.scheduledDate}` : 'Schedule unknown'}</p></li>)}</ul>
      <p>Source updated: {entry.sourceUpdatedAt ?? 'Unknown'} · Retrieved: {entry.retrievedAt}</p>
    </section>)}</>;
}

function OfflineLibrary({ owner, selection }: { owner: LiveCopyRetention; selection: Selection }) {
  const [catalog, setCatalog] = useState<OfflineCatalogV1 | null>(null), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void owner.read.readCatalog(selection.handle, selection.signal).then(result => {
      if (!active || selection.signal.aborted) return;
      setCatalog(result.status === 'ok' ? result.value : null); setLoading(false);
    });
    return () => { active = false; };
  }, [owner, selection]);
  const attachments = selection.snapshot.data.entries.flatMap(entry => entry.attachments.map(attachment => ({ entry, attachment })));
  return <><h2>Documents</h2>{catalog ? <>
      <p>{catalog.completeness === 'captured-complete' ? 'Document list captured' : 'Some documents captured'}: <time dateTime={catalog.capturedAt}>{catalog.capturedAt}</time>.</p>
      {!catalog.documents.length && <p>No documents in this captured list.</p>}
      <ul className="offline-documents">{catalog.documents.map(row => <DocumentRow key={row.documentId} row={row} owner={owner} selection={selection} />)}</ul>
    </> : <p role="status">{loading ? 'Reading held documents…' : 'The document list is not held on this device.'}</p>}
    <h2>HomeBox attachments</h2>{attachments.length ? <ul className="offline-documents">{attachments.map(({ entry, attachment }) => attachment.kind === 'stored-file'
      ? <HomeboxAttachmentRow key={`${entry.key}:${attachment.attachmentId}`} owner={owner} selection={selection} entry={entry} attachment={attachment} />
      : <li key={`${entry.key}:${attachment.attachmentId}`}><strong>{attachment.title ?? 'Untitled attachment'}</strong> · {entry.entity.name}<p>Open live for the external link.</p></li>)}</ul>
      : <p>No HomeBox attachments were captured.</p>}
    <OfflineElectricalLibrary owner={owner} selection={selection} />
  </>;
}

function DocumentRow({ row, owner, selection }: { row: OfflineCatalogItemV1; owner: LiveCopyRetention; selection: Selection }) {
  const [status, setStatus] = useState<OfflineDocumentAvailability | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    void owner.read.documentStatus(selection.handle, row, selection.signal).then(result => {
      if (active && !selection.signal.aborted) setStatus(result.status === 'ok' ? result.value : null);
    });
    return () => { active = false; };
  }, [row, owner, selection]);
  return <li><strong>{row.title}</strong> · {storageSize(row.bytes)}
    <p>{row.lifecycle === 'tombstoned' ? 'Withdrawn document' : status?.availability === 'held' ? 'On this device' : status?.availability === 'failed-integrity' ? 'Held file failed verification' : 'Not held on this device'}</p>
    {row.lifecycle === 'active' && status?.availability === 'held' && <button className="btn" type="button" onClick={() => setOpen(true)}>Open {row.title}</button>}
    {open && status?.availability === 'held' && <Modal title={row.title} onClose={() => setOpen(false)} wide><HeldDocument owner={owner} selection={selection} pin={status.pin} title={row.title} /></Modal>}
  </li>;
}

function HeldDocument({ owner, selection, pin, title }: { owner: LiveCopyRetention; selection: Selection; pin: Extract<OfflineDocumentAvailability, { availability: 'held' }>['pin']; title: string }) {
  const [blob, setBlob] = useState<Blob | null>(null), [failed, setFailed] = useState(false);
  const [controller] = useState(() => new AbortController());
  useEffect(() => {
    const abort = () => controller.abort(); selection.signal.addEventListener('abort', abort, { once: true });
    if (selection.signal.aborted) controller.abort();
    void owner.read.readDocument(selection.handle, pin, controller.signal).then(result => {
      if (!controller.signal.aborted) { setBlob(result.status === 'ok' ? result.value : null); setFailed(result.status !== 'ok'); }
    });
    return () => { selection.signal.removeEventListener('abort', abort); controller.abort(); };
  }, [owner, selection, pin, controller]);
  return blob ? pin.contentType === 'application/pdf' ? <><SourcePdf blob={blob} title={title} signal={controller.signal} /><HeldDownload blob={blob} title={title} signal={controller.signal} /></>
    : <HeldDownload blob={blob} title={title} signal={controller.signal} />
    : <p role="status">{failed ? 'The held file is unavailable or changed.' : 'Verifying held file…'}</p>;
}
function HeldDownload({ blob, title, signal }: { blob: Blob; title: string; signal: AbortSignal }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (signal.aborted) return;
    const held = URL.createObjectURL(blob), revoke = () => { URL.revokeObjectURL(held); setUrl(null); };
    setUrl(held); signal.addEventListener('abort', revoke, { once: true });
    return () => { signal.removeEventListener('abort', revoke); URL.revokeObjectURL(held); };
  }, [blob, signal]);
  return url ? <a className="btn" href={url} download={title} onClick={event => { if (signal.aborted) event.preventDefault(); }}>Save held original</a> : null;
}

type HeldEntry = OfflineViewSnapshotV1['data']['entries'][number];
/** Exact source/entity/attachment association only. A held copy is one earlier server capture, not the current HomeBox file. */
function HomeboxAttachmentRow({ owner, selection, entry, attachment }: { owner: LiveCopyRetention; selection: Selection; entry: HeldEntry; attachment: HeldEntry['attachments'][number] }) {
  const [status, setStatus] = useState<OfflineHomeboxAvailability | null>(null), [open, setOpen] = useState(false);
  const title = attachment.title ?? 'Untitled attachment';
  useEffect(() => {
    let active = true;
    void owner.read.homeboxStatus(selection.handle, { source: 'homebox-attachment', sourceInstanceId: entry.source.sourceInstanceId,
      collectionId: entry.source.collectionId, entityId: entry.source.externalId, attachmentId: attachment.attachmentId }, selection.signal).then(result => {
      if (active && !selection.signal.aborted) setStatus(result.status === 'ok' ? result.value : null);
    });
    return () => { active = false; };
  }, [owner, selection, entry, attachment]);
  const held = status?.availability === 'held' ? status.pin : null;
  return <li><strong>{title}</strong> · {entry.entity.name}{held && <> · {storageSize(held.bytes)}</>}
    <p>{held ? <>On this device · Copied from HomeBox <time dateTime={held.bodyRetrievedAt}>{held.bodyRetrievedAt}</time></>
      : status?.availability === 'failed-integrity' ? 'Held file failed verification · Open live to read this file.' : 'Not held on this device · Open live to read this file.'}</p>
    {held && <button className="btn" type="button" onClick={() => setOpen(true)}>Open {title}</button>}
    {open && held && <Modal title={title} onClose={() => setOpen(false)} wide><HeldHomeboxDocument owner={owner} selection={selection} pin={held} title={title} /></Modal>}
  </li>;
}
function HeldHomeboxDocument({ owner, selection, pin, title }: { owner: LiveCopyRetention; selection: Selection; pin: OfflineHomeboxPinV1; title: string }) {
  const [blob, setBlob] = useState<Blob | null>(null), [failed, setFailed] = useState(false);
  const [controller] = useState(() => new AbortController());
  useEffect(() => {
    const abort = () => controller.abort(); selection.signal.addEventListener('abort', abort, { once: true });
    if (selection.signal.aborted) controller.abort();
    void owner.read.readHomeboxDocument(selection.handle, pin, controller.signal).then(result => {
      if (!controller.signal.aborted) { setBlob(result.status === 'ok' ? result.value : null); setFailed(result.status !== 'ok'); }
    });
    return () => { selection.signal.removeEventListener('abort', abort); controller.abort(); };
  }, [owner, selection, pin, controller]);
  // Only locally measured PDF bytes reach the sandboxed viewer; other files are offered as a saved copy.
  return blob ? pin.contentType === 'application/pdf' ? <><SourcePdf blob={blob} title={title} signal={controller.signal} /><HeldDownload blob={blob} title={title} signal={controller.signal} /></>
    : <><p>This file type is not shown here.</p><HeldDownload blob={blob} title={title} signal={controller.signal} /></>
    : <p role="status">{failed ? 'The held file is unavailable or changed.' : 'Verifying held file…'}</p>;
}

function OfflineElectricalLibrary({ owner, selection }: { owner: LiveCopyRetention; selection: Selection }) {
  const [catalog, setCatalog] = useState<OfflineElectricalCatalogV1 | null>(null), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void owner.read.readElectricalCatalog(selection.handle, selection.signal).then(result => {
      if (active && !selection.signal.aborted) { setCatalog(result.status === 'ok' ? result.value : null); setLoading(false); }
    });
    return () => { active = false; };
  }, [owner, selection]);
  return <section className="section"><h2>Electrical drawings</h2><p>Historical sheet references do not establish current wiring.</p>
    {catalog ? <>
      <p>Drawings were kept separately for each building. Some buildings may be missing.</p>
      {catalog.buildings.map(building => <section key={building.buildingId} className="section">
        <p>Captured <time dateTime={building.capturedAt}>{building.capturedAt}</time>.</p>
        {!building.documents.length && <p>No verified PDF reference was kept for this building.</p>}
        <ul className="offline-documents">{building.documents.map(document => <ElectricalDocumentRow key={document.pin.evidenceId}
          owner={owner} selection={selection} document={document} />)}</ul>
        <details><summary>Drawing provenance</summary><p>Building: {building.buildingId}</p>
          {building.provenance ? <dl>
            <dt>Historical mapping receipt</dt><dd>{building.provenance.historicalRoomMappingReceipt.id}</dd>
            <dt>Historical mapping digest</dt><dd>{building.provenance.historicalRoomMappingReceipt.sha256}</dd>
            <dt>Fixture ledger digest</dt><dd>{building.provenance.fixtureLedgerSha256}</dd>
            <dt>Support original digest</dt><dd>{building.provenance.supportOriginalSha256}</dd>
            <dt>Room review receipt</dt><dd>{building.provenance.currentNativeRoomReview.id}</dd>
            <dt>Room review digest</dt><dd>{building.provenance.currentNativeRoomReview.sha256}</dd>
          </dl> : <p>No drawing provenance was captured.</p>}
        </details>
      </section>)}
    </> : <p role="status">{loading ? 'Reading held electrical drawings…' : 'Electrical drawing references are not held. Open live to read them.'}</p>}
  </section>;
}
function ElectricalDocumentRow({ owner, selection, document }: { owner: LiveCopyRetention; selection: Selection; document: OfflineElectricalBuildingV1['documents'][number] }) {
  const [status, setStatus] = useState<OfflineElectricalAvailability | null>(null), [page, setPage] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    void owner.read.electricalStatus(selection.handle, document.pin, selection.signal).then(result => {
      if (active && !selection.signal.aborted) setStatus(result.status === 'ok' ? result.value : null);
    });
    return () => { active = false; };
  }, [owner, selection, document]);
  return <li><strong>Electrical reference PDF</strong> · {document.pin.byteSize} bytes
    <p>{status?.availability === 'held' ? 'On this device' : status?.availability === 'failed-integrity' ? 'Held file failed verification' : 'Not held on this device'}</p>
    <ul>{document.pages.map(sheet => <li key={sheet.sheetId}>
      <button type="button" className="btn" disabled={status?.availability !== 'held'} onClick={() => setPage(sheet.pdfPage)}>{sheet.title} · Page {sheet.pdfPage}</button>
      <p>Drawing date: {sheet.sourceDate ?? 'Not recorded'}</p>
    </li>)}</ul>
    <details><summary>Original identity</summary><dl><dt>Evidence</dt><dd>{document.pin.evidenceId} · revision {document.pin.evidenceRevision}</dd>
      <dt>Asset</dt><dd>{document.pin.assetId} · revision {document.pin.assetRevision}</dd><dt>SHA-256</dt><dd>{document.pin.sha256}</dd></dl></details>
    {page !== null && status?.availability === 'held' && <Modal title="Electrical reference PDF" onClose={() => setPage(null)} wide>
      <HeldElectricalDocument owner={owner} selection={selection} pin={status.pin} page={page} />
    </Modal>}
  </li>;
}
function HeldElectricalDocument({ owner, selection, pin, page }: { owner: LiveCopyRetention; selection: Selection; pin: OfflineElectricalPinV1; page: number }) {
  const [blob, setBlob] = useState<Blob | null>(null), [failed, setFailed] = useState(false);
  const [controller] = useState(() => new AbortController());
  useEffect(() => {
    const abort = () => controller.abort(); selection.signal.addEventListener('abort', abort, { once: true });
    if (selection.signal.aborted) controller.abort();
    void owner.read.readElectricalDocument(selection.handle, pin, controller.signal).then(result => {
      if (!controller.signal.aborted) { setBlob(result.status === 'ok' ? result.value : null); setFailed(result.status !== 'ok'); }
    });
    return () => { selection.signal.removeEventListener('abort', abort); controller.abort(); };
  }, [owner, selection, pin, controller]);
  return blob ? <><SourcePdf blob={blob} title="Electrical reference PDF" initialPage={page} signal={controller.signal} />
    <HeldDownload blob={blob} title="electrical-reference.pdf" signal={controller.signal} /></>
    : <p role="status">{failed ? 'The held electrical PDF is unavailable or changed.' : 'Verifying held electrical PDF…'}</p>;
}
