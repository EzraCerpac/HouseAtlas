import { useState } from 'react';
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

export function LibraryView() {
  const { house, dispatch } = useStore();
  const select = useSelect();
  const [filter, setFilter] = useState<Filter>('all');
  const test = FILTERS.find((f) => f.id === filter)!.test;
  const docs = house.docs.filter(test).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  const stored = house.docs.filter((d) => d.storage === 'stored').length;
  return (
    <div className="view">
      <header className="view-head">
        <h1>Library</h1>
        <p>
          {stored} stored files and {house.docs.length - stored} external links. Stored files are kept with the household records; links keep only an address.
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
                  <span>
                    Added {fmtDate(d.addedAt)} by {d.addedBy}
                  </span>
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
