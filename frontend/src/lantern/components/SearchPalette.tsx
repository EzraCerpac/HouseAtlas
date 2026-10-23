import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { SEARCH_GROUPS, dueState, getRecord, locate, nameOf, search, type SearchHit } from '../data/query';
import type { HouseData } from '../data/types';
import { fmtDate, fmtShortDate } from '../data/time';
import { useSelect, useStore, type AtlasLens, type ViewId } from '../state/store';
import { Icon } from './Icon';
import { KIND_ICON } from './ui';
import { KIND_LABEL } from '../data/query';
import { isArchivedEntry } from '../../app/model';
import { useTopology } from '../topology/TopologyProvider';
import { nativePlaceSearch, openNativePlaceSearchHit, type NativePlaceSearchHit } from '../topology/search';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** A group's heading names its kind when it holds only one, so its results
 * need no kind of their own; a group that holds several keeps each result's. */
function groupMixesKinds(label: string): boolean {
  return (SEARCH_GROUPS.find((group) => group.label === label)?.kinds.length ?? 2) > 1;
}

/** Where a chosen place-bound result opens. On a reviewed plan it opens on the
 * map, any lens set aside. Otherwise it opens Rooms & places beside the map,
 * as it once opened the Rooms view, unless the Atlas already shows the map or
 * Rooms & places, which stay as they are. The Network lens is not where an
 * unplanned place is found, so it gives way to Rooms & places, as the Network
 * view once did. Other results keep the current view. */
function searchRoute(placeBound: boolean, planned: boolean, current: ViewId, lens: AtlasLens | null): { view?: ViewId; lens?: AtlasLens | null } | undefined {
  if (!placeBound) return undefined;
  if (planned) return { view: 'atlas', lens: null };
  return current === 'atlas' && lens?.kind !== 'network' ? { view: 'atlas' } : { view: 'rooms' };
}

/** A letter, digit or combining mark: a character that continues a word. */
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;

/** Whether the title already says this exact whole name: the same characters,
 * ignoring only letter case, standing as their own word or phrase. "TV" is not
 * in "HDTV"; nothing is folded, stemmed or matched loosely. Display only. */
function titleSays(title: string, name: string): boolean {
  const haystack = title.toLowerCase(), needle = name.trim().toLowerCase();
  if (!needle) return false;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = Array.from(haystack.slice(0, at)).pop() ?? '';
    const after = Array.from(haystack.slice(at + needle.length))[0] ?? '';
    if (!WORD_CHARACTER.test(before) && !WORD_CHARACTER.test(after)) return true;
  }
  return false;
}

/** Whether a linked record's name may be left out because the title already
 * says it. A link to a record that is not in this view is never left out: its
 * placeholder name marks the missing record, whatever the title says. */
function titleSaysRecord(house: HouseData, title: string, id: string): boolean {
  return getRecord(house, id) !== undefined && titleSays(title, nameOf(house, id));
}

/** A recorded date, short when the saved view supplies its own date to read
 * the year against; otherwise, or when that reading fails, in full. Never
 * judged against this device's clock. */
function displayDate(house: HouseData, iso: string): string {
  const full = fmtDate(iso);
  if (house.displayNow === undefined || full === 'Unknown' || full === 'No date') return full;
  const short = fmtShortDate(iso, house.displayNow);
  return short === 'Unknown' ? full : short;
}

/** The line under a result's title: what tells it apart at a glance, said
 * once. A document says what it is for, leaving out any name its title
 * already says, and that it is only an external link; its kind and storage
 * stay on the document itself. An upkeep task says where it stands, reading
 * its own status before any date, and what it is for only when its title
 * does not already say so. Every other result keeps the location the search
 * supplied. Links and targets are unchanged on the records themselves. */
function hitSubtitle(house: HouseData, hit: SearchHit): { readonly text: string; readonly alert?: boolean } {
  if (hit.kind === 'doc') {
    const doc = house.docs.find((d) => d.id === hit.id);
    if (!doc) return { text: hit.context };
    const unsaid = doc.linkedTo.filter((id) => !titleSaysRecord(house, doc.title, id)).map((id) => nameOf(house, id));
    const parts = [unsaid.length > 0 ? `For ${unsaid.join(', ')}` : null,
      doc.storage === 'link' ? 'External link' : null].filter(Boolean);
    return { text: parts.join(' · ') };
  }
  if (hit.kind === 'task') {
    const task = house.tasks.find((t) => t.id === hit.id);
    if (!task) return { text: hit.context };
    const target = nameOf(house, task.targetId);
    const recorded = task.due ? fmtDate(task.due) : null;
    const date = task.due && recorded !== 'Unknown' ? displayDate(house, task.due) : recorded;
    let state: string, alert = false;
    if (task.status === 'done') state = task.completedAt && fmtDate(task.completedAt) !== 'Unknown' ? `Done ${displayDate(house, task.completedAt)}` : 'Done';
    else if (task.status !== 'scheduled') state = date ? `Status not supplied, date ${date}` : 'Status not supplied';
    else if (!recorded) state = 'No date supplied';
    else if (recorded === 'Unknown') state = 'Due date unreadable';
    else {
      const due = dueState(task, house.displayNow);
      if (due === 'overdue') { state = `Overdue, was due ${date}`; alert = true; }
      else if (due === 'soon') state = `Due soon, ${date}`;
      else state = `Due ${date}`;
    }
    return { text: titleSaysRecord(house, task.title, task.targetId) ? state : `${target} · ${state}`, alert };
  }
  return { text: hit.context };
}

/** Keep retained records reachable without a filter strip on every page. */
function ArchiveFilter({ choose }: { choose: (hit: Pick<SearchHit, 'id' | 'kind'>) => void }) {
  const { actions, projection } = useStore();
  const visibility = actions.archiveVisibility;
  const hasArchived = projection.view.entries.some(entry =>
    entry.workspaceId === projection.view.scope.workspaceId
    && entry.homeId === projection.view.scope.homeId && isArchivedEntry(entry));
  if (!visibility || (!hasArchived && !visibility.included)) return null;
  const archived = [...projection.house.spaces, ...projection.house.items].flatMap(record => {
    const entry = projection.entries.get(record.id);
    return entry && isArchivedEntry(entry) ? [{ record, entry }] : [];
  });
  return <section className={`archive-filter${visibility.included ? ' is-on' : ''}`} aria-label="Archived records">
    <label className="archive-toggle"><input type="checkbox" checked={visibility.included}
      onChange={event => visibility.setIncluded(event.currentTarget.checked)} /> Include archived records</label>
    {visibility.included && <details>
      <summary>Archived records ({archived.length})</summary>
      {archived.length ? <ul className="rows">{archived.map(({ record, entry }) => <li key={record.id}>
        <button type="button" className="row-title" onClick={() => choose({ id: record.id,
          kind: entry.kind === 'place' ? 'space' : entry.kind === 'unknown' ? 'unknown' : 'item' })}>{record.name || 'Unnamed source record'}</button>
        <span className="row-meta">Entity archived: {entry.entity.archived ? 'yes' : 'no'} · Source: {entry.sourceState}; cache: {entry.cacheStatus}</span>
      </li>)}</ul> : <p className="empty">No archived records in this saved view.</p>}
    </details>}
  </section>;
}

export function SearchPalette() {
  const { house, dispatch, state } = useStore();
  const select = useSelect();
  const topology = useTopology();
  useEffect(() => topology.activate(), [topology.activate]);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(true);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const hits = useMemo(() => [...search(house, q), ...nativePlaceSearch(topology.index, topology.status, q)]
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 40), [house, q, topology.index, topology.status]);
  const grouped = useMemo(() => {
    const out: { label: string; hits: SearchHit[] }[] = [];
    for (const g of SEARCH_GROUPS) {
      const list = hits.filter((h) => g.kinds.includes(h.kind)).slice(0, 6);
      if (list.length) out.push({ label: g.label, hits: list });
    }
    return out;
  }, [hits]);
  const flat = grouped.flatMap((g) => g.hits);
  const suggestions = useMemo(() => [...new Set([
    ...house.spaces.slice(0, 2).map((item) => item.name),
    ...house.items.slice(0, 2).map((item) => item.name),
    ...house.docs.slice(0, 2).map((item) => item.title),
  ].filter(Boolean))].slice(0, 5), [house]);

  useLayoutEffect(() => {
    prevFocus.current = document.activeElement as HTMLElement;
    inputRef.current?.focus();
    const onDialogKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dispatchRef.current({ type: 'search', open: false });
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.offsetParent !== null);
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onDialogKey, true);
    return () => {
      document.removeEventListener('keydown', onDialogKey, true);
      if (restoreFocus.current && prevFocus.current?.isConnected) prevFocus.current.focus();
    };
  }, []);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const close = () => dispatch({ type: 'search', open: false });
  const chooseSaved = (h: Pick<SearchHit, 'id' | 'kind'>) => {
    restoreFocus.current = false;
    const loc = locate(house, h.id);
    const planned = house.floors.find((f) => f.id === loc.floorId)?.hasPlan;
    const placeBound = ['space', 'item', 'container', 'panel', 'outlet', 'valve', 'device', 'circuit'].includes(h.kind);
    select(h.id, searchRoute(placeBound, Boolean(planned && house.geometry === 'reviewed'), state.view, state.atlasLens));
    close();
  };
  const choose = (h: Pick<SearchHit, 'id' | 'kind'> | NativePlaceSearchHit) => {
    if ('location' in h) {
      openNativePlaceSearchHit(h, topology.index, topology.status, house,
        { select, chooseSaved, chooseBuilding: topology.chooseBuilding, dispatch, close });
    } else chooseSaved(h);
  };

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(Math.max(0, flat.length - 1), a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault();
      choose(flat[active]);
    }
  };

  let index = -1;
  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={dialogRef} className="palette" role="dialog" aria-modal="true" aria-label="Search the atlas" tabIndex={-1}>
        <div className="palette-input">
          <Icon name="search" size={20} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search rooms, belongings, manuals, upkeep"
            role="combobox"
            aria-label="Search names, models or documents"
            aria-expanded={flat.length > 0}
            aria-controls="palette-results"
            aria-activedescendant={flat[active] ? `palette-hit-${active}` : undefined}
            aria-autocomplete="list"
          />
          <button type="button" className="icon-btn" aria-label="Close search" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="palette-results">
          <ArchiveFilter choose={choose} />
          {topology.status !== 'ready' && <p className="palette-hint" role="status">{topology.status === 'loading'
            ? 'Loading Atlas places. Saved records are searchable.'
            : 'Atlas places are unavailable for search. Saved records are searchable.'}</p>}
          <div id="palette-results" role="listbox" ref={listRef} aria-label="Results">
            {!q.trim() && (
              <div className="palette-hint">
                <p>Search names, models or documents in this home.</p>
                {suggestions.length > 0 && <div className="palette-try" role="group" aria-label="Search suggestions">
                  {suggestions.map((t) => (
                    <button key={t} type="button" className="chip-btn" onClick={() => setQ(t)}>
                      {t}
                    </button>
                  ))}
                </div>}
              </div>
            )}
            {q.trim() && flat.length === 0 && (
              <p className="palette-empty">
                {topology.status === 'ready' ? `No matches for “${q.trim()}” in this home.` : `No matching saved records for “${q.trim()}”.`}
              </p>
            )}
            {grouped.map((g) => {
              const mixed = groupMixesKinds(g.label);
              return (
              <div key={g.label} className="palette-group" role="group" aria-label={g.label}>
                <p className="palette-group-label">{g.label}</p>
                {g.hits.map((h) => {
                  index += 1;
                  const i = index;
                  const sub = hitSubtitle(house, h);
                  return (
                    <div
                      key={h.id}
                      id={`palette-hit-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={i === active}
                      className={`palette-hit${i === active ? ' is-active' : ''}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(h)}
                    >
                      <Icon name={KIND_ICON[h.kind]} size={17} />
                      <span className="hit-title">{h.title}</span>
                      {sub.text && <span className={`hit-context${sub.alert ? ' is-alert' : ''}`}>{sub.text}</span>}
                      {mixed && <span className="hit-kind">{KIND_LABEL[h.kind]}</span>}
                    </div>
                  );
                })}
              </div>
              );
            })}
          </div>
        </div>
        <p className="palette-foot">Arrow keys to move, Enter to open, Esc to close.</p>
      </div>
    </div>
  );
}
