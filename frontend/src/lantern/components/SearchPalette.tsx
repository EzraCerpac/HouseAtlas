import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { SEARCH_GROUPS, locate, search, type SearchHit } from '../data/query';
import { useSelect, useStore, type ViewId } from '../state/store';
import { Icon } from './Icon';
import { KIND_ICON } from './ui';
import { KIND_LABEL } from '../data/query';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SearchPalette() {
  const { house, dispatch, state } = useStore();
  const select = useSelect();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(true);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const hits = useMemo(() => search(house, q).slice(0, 40), [house, q]);
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
  const choose = (h: SearchHit) => {
    restoreFocus.current = false;
    const loc = locate(house, h.id);
    const planned = house.floors.find((f) => f.id === loc.floorId)?.hasPlan;
    let view: ViewId | undefined;
    if (['space', 'item', 'container', 'panel', 'outlet', 'valve', 'device', 'circuit'].includes(h.kind)) {
      view = planned && house.geometry === 'reviewed' ? 'atlas' : state.view === 'atlas' ? 'atlas' : 'rooms';
    }
    select(h.id, view ? { view } : undefined);
    close();
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
        <div className="palette-results" id="palette-results" role="listbox" ref={listRef} aria-label="Results">
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
              No matches for “{q.trim()}” in this home.
            </p>
          )}
          {grouped.map((g) => (
            <div key={g.label} className="palette-group" role="group" aria-label={g.label}>
              <p className="palette-group-label">{g.label}</p>
              {g.hits.map((h) => {
                index += 1;
                const i = index;
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
                    <span className="hit-context">{h.context}</span>
                    <span className="hit-kind">{KIND_LABEL[h.kind]}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="palette-foot">Arrow keys to move, Enter to open, Esc to close.</p>
      </div>
    </div>
  );
}
