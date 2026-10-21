import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { canonicalPack } from './manifest';
import type { LosslessJson } from '../numeric/lossless-json';
import type { SavedCatalogOriginal, SavedDocumentItem } from './saved-catalog';
import type { SavedCatalogSelection } from './SavedAtlasHost';

type OriginalState = Readonly<{ state: 'idle' | 'opening' | 'unavailable' }> |
  Readonly<{ state: 'verified'; url: string; original: Omit<SavedCatalogOriginal, 'bytes'> }>;

/** Caller-owned byte/URL lifetime. The adapter never opens a URL or window. */
export function createSavedOriginalOwner(selection: SavedCatalogSelection) {
  let state: OriginalState = { state: 'idle' }, active = false;
  let request: AbortController | null = null, url: string | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: OriginalState) => { state = next; for (const listener of listeners) listener(); };
  const close = () => {
    const pending = request; request = null; pending?.abort();
    if (url !== null) { URL.revokeObjectURL(url); url = null; }
    publish({ state: 'idle' });
  };
  return {
    current: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect() {
      active = true;
      const retire = () => { active = false; close(); };
      selection.signal.addEventListener('abort', retire, { once: true });
      if (!selection.isCurrent() || selection.signal.aborted) retire();
      return () => { selection.signal.removeEventListener('abort', retire); retire(); };
    },
    close,
    async open(key: string) {
      close(); if (!active || !selection.isCurrent() || selection.signal.aborted) return;
      const pending = new AbortController(); request = pending;
      const owns = () => active && request === pending && !pending.signal.aborted
        && !selection.signal.aborted && selection.isCurrent();
      publish({ state: 'opening' });
      try {
        const opened = await selection.read.openOriginal(key, pending.signal);
        if (!owns()) return;
        const localUrl = URL.createObjectURL(new Blob([opened.bytes], { type: opened.contentType }));
        if (!owns()) { URL.revokeObjectURL(localUrl); return; }
        const { bytes: _bytes, ...original } = opened;
        url = localUrl; publish({ state: 'verified', url: localUrl, original });
      } catch { if (owns()) publish({ state: 'unavailable' }); }
    },
  };
}

function Raw({ value }: { readonly value: LosslessJson }) {
  return <pre className="saved-catalog-raw">{canonicalPack(value)}</pre>;
}
function CapturedDate({ label, value }: { readonly label: string; readonly value: string | null }) {
  return <div><dt>{label}</dt><dd>{value === null ? 'Unknown' : <time dateTime={value}>{value}</time>}</dd></div>;
}

export function SavedCatalogView({ selection, section }: {
  readonly selection: SavedCatalogSelection; readonly section: 'inventory' | 'documents';
}) {
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const detailHeading = useRef<HTMLHeadingElement | null>(null);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const originalButton = useRef<HTMLButtonElement | null>(null);
  const originals = useMemo(() => createSavedOriginalOwner(selection), [selection]);
  const file = useSyncExternalStore(originals.subscribe, originals.current, originals.current);
  useLayoutEffect(() => originals.connect(), [originals]);
  useLayoutEffect(() => {
    const clear = () => { selectedButton.current = null; setDetailKey(null); };
    selection.signal.addEventListener('abort', clear, { once: true });
    return () => { selection.signal.removeEventListener('abort', clear); };
  }, [selection]);
  useLayoutEffect(() => { if (detailKey !== null) detailHeading.current?.focus(); }, [detailKey]);
  if (!selection.isCurrent() || selection.signal.aborted) return null;
  const { catalog } = selection.read, data = catalog[section];
  const inventory = section === 'inventory' && detailKey !== null ? selection.read.inventoryDetail(detailKey) : null;
  const document = section === 'documents' && detailKey !== null ? selection.read.documentDetail(detailKey) : null;
  const detail = inventory ?? document;
  const closeDetail = () => {
    originals.close(); setDetailKey(null);
    if (selectedButton.current?.isConnected) selectedButton.current.focus();
  };
  return <section className="saved-catalog" aria-label={section === 'inventory' ? 'Saved inventory' : 'Saved documents'}>
    <h2>{section === 'inventory' ? 'Inventory' : 'Documents'}</h2>
    <p>Captured <time dateTime={catalog.capturedAt}>{catalog.capturedAt}</time>. Historical, read-only records; current native access is not established.</p>
    <details className="saved-catalog-coverage"><summary>Captured coverage: {data.state}; {data.items.length} {section === 'inventory' ? 'inventory records' : 'document metadata records'}</summary>
      <dl><div><dt>Pack</dt><dd>{catalog.completeness}</dd></div>
        <div><dt>Required section bytes complete</dt><dd>{data.requiredBytesComplete ? 'Yes, at capture' : 'No'}</dd></div>
        <div><dt>Saved key</dt><dd>{catalog.key}</dd></div>
        <div><dt>Snapshot</dt><dd>{catalog.snapshotId}</dd></div>
        <div><dt>Local revision</dt><dd>{catalog.localRevision}</dd></div></dl>
      {data.reasons.length > 0 && <ul>{data.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
      <h3>Section exclusions</h3>
      {data.exclusions.length === 0 ? <p>No section exclusions recorded.</p> : <ul>{data.exclusions.map((row, index) => <li key={index}>{row.code}: {row.label}</li>)}</ul>}
      <h3>Pack exclusions</h3>
      {catalog.exclusions.length === 0 ? <p>No pack exclusions recorded.</p> : <ul>{catalog.exclusions.map((row, index) => <li key={index}>{row.section} / {row.code}: {row.label}</li>)}</ul>}
      <h3>Captured sources</h3><Raw value={[...data.sources]} />
      <h3>Captured cache states</h3><Raw value={[...data.caches]} />
    </details>
    {data.items.length === 0 && <p role="status">{data.state === 'complete' ? 'No records in this captured section.' : `No retained records listed (${data.state}).`}</p>}
    <div className="saved-catalog-columns">
      <ul className="saved-catalog-list" aria-label={section === 'inventory' ? 'Inventory records' : 'Document records'}>
        {data.items.map(item => <li key={item.key}><button type="button" aria-pressed={detailKey === item.key}
          onClick={event => {
            if (!selection.isCurrent() || selection.signal.aborted) return;
            originals.close(); selectedButton.current = event.currentTarget; setDetailKey(item.key);
          }}><strong>{item.title}</strong><span className="saved-catalog-key">{item.key}</span>
          {section === 'documents' && <span>{(item as SavedDocumentItem).original.state === 'retained-unverified' ? 'Original retained; verification required' : 'Original unavailable'}</span>}
        </button></li>)}
      </ul>
      {detail && <article className="saved-catalog-detail" aria-label="Captured record details">
        <button type="button" onClick={closeDetail}>Close record details</button>
        <h3 ref={detailHeading} tabIndex={-1}>{detail.title}</h3>
        <dl><div><dt>Exact record key</dt><dd>{detail.key}</dd></div>
          {inventory && <><CapturedDate label="Source updated" value={inventory.sourceUpdatedAt} /><CapturedDate label="Retrieved" value={inventory.retrievedAt} /></>}
          {document && <><div><dt>Document revision</dt><dd>{document.revision}</dd></div><CapturedDate label="Created" value={document.createdAt} /><CapturedDate label="Updated" value={document.updatedAt} />
            <div><dt>Captured lifecycle</dt><dd>{document.lifecycle ?? 'Unknown'}</dd></div><div><dt>Original</dt><dd>{document.original.state === 'retained-unverified' ? 'Retained bytes; not yet verified for this open' : document.original.reason ?? 'Unavailable'}</dd></div></>}
        </dl>
        {document?.original.state === 'retained-unverified' && <div className="saved-catalog-original">
          <button ref={originalButton} type="button" disabled={file.state === 'opening'} onClick={() => { void originals.open(document.key); }}>Verify retained original</button>
          {file.state === 'opening' && <p role="status">Verifying retained original…</p>}
          {file.state === 'unavailable' && <p role="alert">The retained original is unavailable or changed. Metadata remains historical.</p>}
          {file.state === 'verified' && <>
            <p role="status">Saved original verified for this open.</p>
            <dl><div><dt>Document / revision</dt><dd>{file.original.documentId} / {file.original.documentRevision}</dd></div>
              <div><dt>Asset / revision</dt><dd>{file.original.assetId} / {file.original.assetRevision}</dd></div>
              <div><dt>SHA256</dt><dd>{file.original.sha256}</dd></div><div><dt>MIME</dt><dd>{file.original.contentType}</dd></div></dl>
            <a href={file.url} download={`saved-document-${file.original.documentId}-${file.original.documentRevision}`}>Download verified saved original</a>
            <button type="button" onClick={() => { originals.close(); originalButton.current?.focus(); }}>Close verified original</button>
          </>}
        </div>}
        <h4>Captured fields</h4><Raw value={detail.raw} />
      </article>}
    </div>
  </section>;
}
