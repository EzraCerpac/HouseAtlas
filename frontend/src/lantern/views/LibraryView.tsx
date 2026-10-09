import { useState } from 'react';
import type { Entry } from '../../app/types';
import type { Doc } from '../data/types';
import { nameOf } from '../data/query';
import { fmtDate } from '../data/time';
import { useSelect, useStore } from '../state/store';
import { Icon } from '../components/Icon';
import { Empty, StorageTag } from '../components/ui';

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
function DocQualifiers({ d, entry }: { d: Doc; entry: Entry | undefined }) {
  const parent = parentQualifier(entry);
  return (
    <>
      {d.linkArchived && <span>Link archived in HomeBox</span>}
      {parent && <span>{parent}</span>}
      <span>{d.addedAt ? `Added ${fmtDate(d.addedAt)} by ${d.addedBy}` : 'Attachment add date and actor not supplied'}</span>
      <span>Source record updated in HomeBox: {entry?.sourceUpdatedAt ? fmtDate(entry.sourceUpdatedAt) : 'Unknown'}</span>
      <span>Source record retrieved: {entry ? fmtDate(entry.retrievedAt) : 'Unknown'}</span>
    </>
  );
}

export function LibraryView() {
  const { house, dispatch, projection } = useStore();
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
          {stored} stored files and {house.docs.length - stored} external links{archivedLinks > 0 ? `, ${archivedLinks} archived in HomeBox` : ''}. Stored files are kept with the household records; links keep only an address.
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
      ) : (
        <ul className="library">
          {docs.map((d) => (
            <li key={d.id} className="lib-row">
              <Thumb d={d} />
              <div className="lib-main">
                <button type="button" className="row-title" onClick={() => select(d.id)}>
                  {d.title}
                </button>
                <span className="row-meta">
                  <StorageTag doc={d} />
                  <DocQualifiers d={d} entry={projection.entries.get(d.id)} />
                </span>
                {d.linkedTo.length > 0 && <span className="lib-linked">For {d.linkedTo.map((l) => nameOf(house, l)).join(', ')}</span>}
              </div>
              <button type="button" className="btn btn-small" onClick={() => dispatch({ type: 'dialog', dialog: { type: 'preview', docId: d.id } })} aria-label={`${d.storage === 'link' ? 'Link details for' : 'File details for'} ${d.title}`}>
                {d.storage === 'link' ? 'Link details' : 'File details'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
