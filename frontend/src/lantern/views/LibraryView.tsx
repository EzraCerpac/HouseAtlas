import { useId, useRef, useState, type RefObject } from 'react';
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
  { id: 'all', label: 'All', test: () => true },
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

/** The link archive flag is attachment-owned; record state and dates belong to the parent.
 * The add date and source update date are in File details. */
function docQualifiers(d: Doc, entry: Entry | undefined): string[] {
  const parent = parentQualifier(entry);
  return [
    ...(d.linkArchived ? ['Link archived in HomeBox'] : []),
    ...(parent ? [parent] : []),
    `Retrieved ${entry ? fmtDate(entry.retrievedAt) : 'date unknown'}`,
  ];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Moves to a Library section: scrolls it to the top and puts focus on it. */
function jumpTo(target: RefObject<HTMLElement | null>) {
  const section = target.current;
  if (!section) return;
  section.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  section.focus({ preventScroll: true });
}

export function LibraryView() {
  const { house, dispatch, projection } = useStore();
  const { documents, electricalLibrary } = useSourcePorts();
  const select = useSelect();
  const [filter, setFilter] = useState<Filter>('all');
  const homeboxHeading = useId(), categoryId = useId();
  const homeboxRef = useRef<HTMLElement>(null), documentsRef = useRef<HTMLDivElement>(null), drawingsRef = useRef<HTMLDivElement>(null);
  const test = FILTERS.find((f) => f.id === filter)!.test;
  const docs = house.docs.filter(test).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  const stored = house.docs.filter((d) => d.storage === 'stored').length;
  const archivedLinks = house.docs.filter((d) => d.linkArchived === true).length;
  // HomeBox files opens the page, under its own heading; the links reach the sections below it.
  const sections = [
    ...(documents ? [{ label: 'Source documents', ref: documentsRef }] : []),
    ...(electricalLibrary ? [{ label: 'Electrical drawings', ref: drawingsRef }] : []),
  ];
  return (
    <div className="view">
      <header className="view-head library-head">
        <h1>Library</h1>
        {sections.length > 0 && <nav className="library-jump" aria-label="Library sections">
          {sections.map(({ label, ref }) => <button key={label} type="button" onClick={() => jumpTo(ref)}>{label}</button>)}
        </nav>}
      </header>
      <section ref={homeboxRef} className="library-section" tabIndex={-1} aria-labelledby={homeboxHeading}>
        <div className="section-head"><h2 id={homeboxHeading}>HomeBox files</h2></div>
        <p className="library-scope">
          HomeBox reports {plural(stored, 'stored file', 'stored files')} and {plural(house.docs.length - stored, 'external link', 'external links')}{archivedLinks > 0 ? `, ${archivedLinks} archived` : ''}.
        </p>
        <div className="field filter-select"><label htmlFor={categoryId}>Category</label>
          <select id={categoryId} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            {FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label} ({house.docs.filter(f.test).length})</option>)}
          </select></div>
        <div className="filter-row" role="group" aria-label="Filter HomeBox files">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="chip-btn" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              <span className="chip-count">{house.docs.filter(f.test).length}</span>
            </button>
          ))}
        </div>
        {docs.length === 0 ? (
          <Empty>No HomeBox files of this kind for this home.</Empty>
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
                    <span className="row-meta"><StorageTag doc={d} /></span>
                    {/* Retrieval and the item it belongs to share one line. */}
                    {(qualifiers.length > shared.length || d.linkedTo.length > 0) && <span className="row-meta">
                      {qualifiers.filter(q => !shared.includes(q)).map(q => <span key={q}>{q}</span>)}
                      {d.linkedTo.length > 0 && <span className="lib-linked"><span className="lib-linked-label">For</span> {d.linkedTo.map((l) => nameOf(house, l)).join(', ')}</span>}
                    </span>}
                  </div>
                  <button type="button" className="btn btn-small" onClick={() => dispatch({ type: 'dialog', dialog: { type: 'preview', docId: d.id } })} aria-label={`${d.storage === 'link' ? 'Link details for' : 'File details for'} ${d.title}`}>
                    {d.storage === 'link' ? 'Link details' : 'File details'}
                  </button>
                </li>
              ))}
            </ul>
          </>;
        })()}
      </section>
      {documents && <div ref={documentsRef} className="library-section" tabIndex={-1}><SourceDocuments port={documents} /></div>}
      {electricalLibrary && <div ref={drawingsRef} className="library-section" tabIndex={-1}><ElectricalLibrary port={electricalLibrary} /></div>}
    </div>
  );
}
