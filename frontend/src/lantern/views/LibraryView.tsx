import { useEffect, useId, useRef, useState, type RefObject } from 'react';
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

/** The section under the sticky shortcuts: the last whose top has reached
 * them. A chosen shortcut holds until the reader scrolls or presses, so a short final
 * section still reads as current after its jump. */
function useCurrentSection(sections: readonly RefObject<HTMLElement | null>[], bar: RefObject<HTMLElement | null>) {
  const [current, setCurrent] = useState(0);
  const chosen = useRef<number | null>(null);
  useEffect(() => {
    const nav = bar.current;
    const scroller = nav?.closest<HTMLElement>('.main');
    if (!nav || !scroller) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (chosen.current !== null) return;
      const line = nav.getBoundingClientRect().bottom + 24;
      let index = 0;
      sections.forEach((ref, i) => { const top = ref.current?.getBoundingClientRect().top; if (top !== undefined && top <= line) index = i; });
      setCurrent(index);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const release = () => { chosen.current = null; };
    const input = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    scroller.addEventListener('scroll', onScroll, { passive: true });
    input.forEach(type => scroller.addEventListener(type, release, { passive: true }));
    measure();
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', onScroll);
      input.forEach(type => scroller.removeEventListener(type, release));
    };
    // The refs are stable objects; only how many sections there are changes.
  }, [sections.length, bar]);
  const choose = (index: number) => { chosen.current = index; setCurrent(index); };
  return [current, choose] as const;
}

export function LibraryView() {
  const { house, dispatch, projection } = useStore();
  const { documents, electricalLibrary } = useSourcePorts();
  const select = useSelect();
  const [filter, setFilter] = useState<Filter>('all');
  const homeboxHeading = useId(), categoryId = useId();
  const homeboxRef = useRef<HTMLElement>(null), documentsRef = useRef<HTMLDivElement>(null), drawingsRef = useRef<HTMLDivElement>(null);
  // A filter is offered only when two or more kinds have files; otherwise All is the only choice.
  const kinds = FILTERS.filter(f => f.id !== 'all' && house.docs.some(f.test)).length;
  const offered = FILTERS.filter(f => f.id === 'all' || f.id === filter || house.docs.some(f.test));
  const test = FILTERS.find((f) => f.id === (kinds > 1 ? filter : 'all'))!.test;
  const docs = house.docs.filter(test).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  const stored = house.docs.filter((d) => d.storage === 'stored').length;
  const archivedLinks = house.docs.filter((d) => d.linkArchived === true).length;
  // HomeBox files opens the page; the links name every section, in page order.
  const sections = [
    { label: 'HomeBox files', ref: homeboxRef },
    ...(documents ? [{ label: 'Source documents', ref: documentsRef }] : []),
    ...(electricalLibrary ? [{ label: 'Electrical drawings', ref: drawingsRef }] : []),
  ];
  const barRef = useRef<HTMLElement>(null);
  const [current, choose] = useCurrentSection(sections.map(s => s.ref), barRef);
  return (
    <div className="view">
      {/* With shortcuts, the heading's rule moves under them and they stay at the top while the page scrolls. */}
      <header className={`view-head library-head${sections.length > 1 ? ' has-jump' : ''}`}>
        <h1>Library</h1>
      </header>
      {sections.length > 1 && <nav ref={barRef} className="library-jump" aria-label="Library sections">
        {sections.map(({ label, ref }, index) => <button key={label} type="button" aria-current={index === current ? 'true' : undefined}
          onClick={() => { choose(index); jumpTo(ref); }}>{label}</button>)}
      </nav>}
      <section ref={homeboxRef} className="library-section" tabIndex={-1} aria-labelledby={homeboxHeading}>
        <div className="section-head"><h2 id={homeboxHeading}>HomeBox files</h2></div>
        <p className="library-scope">
          HomeBox reports {plural(stored, 'stored file', 'stored files')} and {plural(house.docs.length - stored, 'external link', 'external links')}{archivedLinks > 0 ? `, ${archivedLinks} archived` : ''}.
        </p>
        {kinds > 1 && <><div className="field filter-select"><label htmlFor={categoryId}>Category</label>
          <select id={categoryId} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            {offered.map((f) => <option key={f.id} value={f.id}>{f.label} ({house.docs.filter(f.test).length})</option>)}
          </select></div>
        <div className="filter-row" role="group" aria-label="Filter HomeBox files">
          {offered.map((f) => (
            <button key={f.id} type="button" className="chip-btn" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              <span className="chip-count">{house.docs.filter(f.test).length}</span>
            </button>
          ))}
        </div></>}
        {docs.length === 0 ? (
          <Empty>No HomeBox files of this kind supplied for this home.</Empty>
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
