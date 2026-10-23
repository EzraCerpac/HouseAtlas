import { useState } from 'react';
import type { Entry } from '../../app/types';
import type { Doc } from '../data/types';
import { nameOf } from '../data/query';
import { fmtDate } from '../data/time';
import { useSelect, useStore } from '../state/store';
import { Icon } from '../components/Icon';
import { Empty, StorageTag } from '../components/ui';
import { useSourcePorts } from '../source-ports';
import { SourceDocuments } from '../source-documents/SourceDocuments';
import { ElectricalLibrary } from '../electrical-library/ElectricalLibrary';

type Filter = 'all' | 'manual' | 'photo' | 'report' | 'receipt' | 'link';

const FILTERS: { id: Filter; label: string; test: (d: Doc) => boolean }[] = [
  { id: 'all', label: 'Everything', test: () => true },
  { id: 'manual', label: 'Manuals and guides', test: (d) => d.kind === 'manual' },
  { id: 'photo', label: 'Photos', test: (d) => d.kind === 'photo' },
  { id: 'report', label: 'Reports and records', test: (d) => ['report', 'export', 'schedule', 'note'].includes(d.kind) },
  { id: 'receipt', label: 'Receipts', test: (d) => d.kind === 'receipt' },
  { id: 'link', label: 'External links', test: (d) => d.storage === 'link' },
];

function Thumb({ d }: { d: Doc }) {
  if (d.storage === 'link') {
    return (
      <span className="lib-thumb lib-thumb-link" aria-hidden="true">
        <Icon name="link" size={22} />
      </span>
    );
  }
  if (d.kind === 'photo') {
    return (
      <span className="lib-thumb lib-thumb-photo" aria-hidden="true">
        <Icon name="photo" size={22} />
      </span>
    );
  }
  return (
    <span className={`lib-thumb lib-thumb-${d.kind}`} aria-hidden="true">
      <span className="lib-page">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}

/** Qualifier from the retained parent HomeBox record's source state. */
function parentQualifier(entry: Entry | undefined): string | null {
  switch (entry?.sourceState) {
    case 'archived':
      return 'Source record archived in HomeBox';
    case 'unresolved':
      return 'Source record not found in the latest check';
    case 'confirmed-deleted':
      return 'Source record confirmed deleted in HomeBox';
    case 'unreviewed':
      return 'Source match needs review';
    default:
      return null;
  }
}

/** The link archive flag is attachment-owned; record state and dates belong to the parent. */
function docQualifiers(d: Doc, entry: Entry | undefined): string[] {
  const parent = parentQualifier(entry);
  return [
    ...(d.linkArchived ? ['Link archived in HomeBox'] : []),
    ...(parent ? [parent] : []),
    d.addedAt ? `Added ${fmtDate(d.addedAt)} by ${d.addedBy}` : 'Attachment add date and actor not supplied',
    `Source record updated in HomeBox: ${entry?.sourceUpdatedAt ? fmtDate(entry.sourceUpdatedAt) : 'Unknown'}`,
    `Source record retrieved: ${entry ? fmtDate(entry.retrievedAt) : 'Unknown'}`,
  ];
}

export function LibraryView() {
  const { house, dispatch, projection } = useStore();
  const { documents, electricalLibrary } = useSourcePorts();
  const select = useSelect();
  const [filter, setFilter] = useState<Filter>('all');
  const test = FILTERS.find((f) => f.id === filter)!.test;
  const docs = house.docs.filter(test).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  const stored = house.docs.filter((d) => d.storage === 'stored').length;
  const archivedLinks = house.docs.filter((d) => d.linkArchived === true).length;
  return (
    <div className="view">
      <header className="view-head">
        <h1>Library</h1>
        <p>
          {stored} stored files and {house.docs.length - stored} external links{archivedLinks > 0 ? `, ${archivedLinks} archived in HomeBox` : ''}. HomeBox reports these as stored files; links keep only an address.
        </p>
      </header>
      <div className="filter-row" role="group" aria-label="Filter documents">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className="chip-btn" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
            <span className="chip-count">{house.docs.filter(f.test).length}</span>
          </button>
        ))}
      </div>
      {docs.length === 0 ? (
        <Empty>No documents of this kind in the supplied view.</Empty>
      ) : (() => {
        const rows = docs.map(d => ({ d, qualifiers: docQualifiers(d, projection.entries.get(d.id)) }));
        const [first, ...rest] = rows.map(row => new Set(row.qualifiers));
        const shared = rows.length > 1 ? [...first!].filter(q => rest.every(set => set.has(q))) : [];
        return <>
          {shared.length > 0 && <p className="ledger-shared"><span className="ledger-shared-label">All {rows.length}</span>
            <span className="ledger-facts">{shared.map(q => <span key={q}>{q}</span>)}</span></p>}
          <ul className="library">
            {rows.map(({ d, qualifiers }) => (
              <li key={d.id} className="lib-row">
                <Thumb d={d} />
                <div className="lib-main">
                  <button type="button" className="row-title" onClick={() => select(d.id)}>
                    {d.title}
                  </button>
                  <span className="row-meta">
                    <StorageTag doc={d} />
                    {qualifiers.filter(q => !shared.includes(q)).map(q => <span key={q}>{q}</span>)}
                  </span>
                  {d.linkedTo.length > 0 && <span className="lib-linked"><span className="lib-linked-label">For</span> {d.linkedTo.map((l) => nameOf(house, l)).join(', ')}</span>}
                </div>
                <button type="button" className="btn btn-small" onClick={() => dispatch({ type: 'dialog', dialog: { type: 'preview', docId: d.id } })} aria-label={`${d.storage === 'link' ? 'Link details for' : 'File details for'} ${d.title}`}>
                  {d.storage === 'link' ? 'Link details' : 'File details'}
                </button>
              </li>
            ))}
          </ul>
        </>;
      })()}
      {documents && <SourceDocuments port={documents} />}
      {electricalLibrary && <ElectricalLibrary port={electricalLibrary} />}
    </div>
  );
}
