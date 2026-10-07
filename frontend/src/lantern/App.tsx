import { useEffect, useLayoutEffect, useState } from 'react';
import { useReducedMotion, useStore, type ViewId } from './state/store';
import { fmtDateTime } from './data/time';
import { Icon } from './components/Icon';
import { AtlasView } from './atlas/AtlasView';
import { RoomsView } from './views/RoomsView';
import { UpkeepView } from './views/UpkeepView';
import { NetworkView } from './views/NetworkView';
import { LibraryView } from './views/LibraryView';
import { ChangesView } from './views/ChangesView';
import { DetailPanel } from './components/DetailPanel';
import { AskPanel } from './components/AskPanel';
import { RealPreview } from './components/RealPreview';
import { SourceDetails } from './components/SourceDetails';
import { SearchPalette } from './components/SearchPalette';
import { SettingsDialog } from './components/SettingsDialog';

const VIEWS: { id: ViewId; label: string; icon: string }[] = [
  { id: 'atlas', label: 'Atlas', icon: 'atlas' },
  { id: 'rooms', label: 'Rooms & places', icon: 'rooms' },
  { id: 'upkeep', label: 'Upkeep', icon: 'upkeep' },
  { id: 'network', label: 'Network', icon: 'network' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'changes', label: 'Changes', icon: 'changes' },
];

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 23 34 30 20 37 6 30Z" fill="#D8BE8E" />
      <path d="M20 13 34 20 20 27 6 20Z" fill="#FFE39A" stroke="#1E2638" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M20 3 34 10 20 17 6 10Z" fill="#FBF9F4" stroke="#1E2638" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function SyncChip() {
  const { dispatch, projection } = useStore();
  const caches = projection.view.caches.filter(c => c.owner === 'homebox');
  const warning = !caches.length || caches.some(c => c.displayStatus !== 'fresh');
  const text = caches.length ? caches.map(c => `HomeBox ${c.displayStatus}, last successful update ${c.lastSuccessfulFetchAt ? fmtDateTime(c.lastSuccessfulFetchAt) : 'unknown'}`).join('; ') : 'HomeBox cache unavailable';
  return (
    <button
      type="button"
      className={`sync-chip${warning ? ' is-warn' : ''}`}
      title={text}
      onClick={() => dispatch({ type: 'view', view: 'changes' })}
      aria-label={`${text}. Open Changes.`}
    >
      <span className="sync-dot" aria-hidden="true" />
      <span className="sync-text">{text}</span>
    </button>
  );
}

function Toasts() {
  const { state, dispatch } = useStore();
  useEffect(() => {
    const timers = state.toasts.map((t) => window.setTimeout(() => dispatch({ type: 'dismissToast', id: t.id }), 4600));
    return () => timers.forEach(clearTimeout);
  }, [state.toasts, dispatch]);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {state.toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <Icon name={t.tone === 'ok' ? 'check' : t.tone === 'warn' ? 'alert' : 'info'} size={16} />
          <span>{t.text}</span>
          <button type="button" className="icon-btn" aria-label={`Dismiss: ${t.text}`} onClick={() => dispatch({ type: 'dismissToast', id: t.id })}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const { state, dispatch, house } = useStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const reduced = useReducedMotion();
  const reviewCount = house.writes.filter((w) => w.status === 'conflict' || w.status === 'uncertain').length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        dispatch({ type: 'search', open: true });
      } else if (e.key === '/' && !typing && !state.dialog) {
        e.preventDefault();
        dispatch({ type: 'search', open: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, state.dialog]);

  useEffect(() => {
    if (state.selection) setSheetOpen(true);
  }, [state.selection]);

  const view = (() => {
    switch (state.view) {
      case 'rooms':
        return <RoomsView />;
      case 'upkeep':
        return <UpkeepView />;
      case 'network':
        return <NetworkView />;
      case 'library':
        return <LibraryView />;
      case 'changes':
        return <ChangesView />;
      default:
        return <AtlasView />;
    }
  })();

  useLayoutEffect(() => {
    if (state.selection) document.getElementById('detail-title')?.focus();
  }, [state.selection]);
  const sheetExpanded = !!state.selection || sheetOpen;

  return (
    <div className={`lantern-host app view-${state.view}${state.askOpen ? ' ask-open' : ''}${reduced ? ' is-reduced' : ''}${state.settings.motion === 'full' ? ' motion-full' : ''}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="brand">
          <Mark />
          <span className="brand-name">
            HouseAtlas <span className="brand-concept">Lantern</span>
          </span>
        </div>
        <button type="button" className="house-btn" onClick={() => dispatch({ type: 'settingsOpen', open: true })} aria-label={`House: ${house.name}. Change house in settings.`}>
          <span className="house-name">{house.name}</span>

          <Icon name="chevronDown" size={15} />
        </button>
        <button type="button" className="search-trigger" aria-label="Search rooms, belongings, manuals" onClick={() => dispatch({ type: 'search', open: true })}>
          <Icon name="search" size={18} />
          <span className="search-label">Search rooms, belongings, manuals</span>
          <kbd aria-hidden="true">/</kbd>
        </button>
        <SyncChip />
        <button type="button" aria-label="Ask" className={`ask-btn${state.askOpen ? ' is-on' : ''}`} aria-pressed={state.askOpen} onClick={() => dispatch({ type: 'ask', open: !state.askOpen })}>
          <Icon name="ask" size={18} />
          <span>Ask</span>
        </button>
        <button type="button" className="icon-btn" aria-label="Settings" onClick={() => dispatch({ type: 'settingsOpen', open: true })}>
          <Icon name="settings" size={20} />
        </button>
      </header>

      <nav className="navrail" aria-label="Sections">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className={`nav-btn${state.view === v.id ? ' is-current' : ''}`} aria-current={state.view === v.id ? 'page' : undefined} onClick={() => dispatch({ type: 'view', view: v.id })}>
            <Icon name={v.icon} size={21} />
            <span>{v.label}</span>
            {v.id === 'changes' && reviewCount > 0 && (
              <span className="nav-badge" aria-label={`${reviewCount} to review`}>
                {reviewCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <main id="main" className="main" tabIndex={-1}>
        {view}
      </main>

      <aside className={`detail-col${sheetExpanded ? ' is-expanded' : ''}`} aria-label="Details">
        <button type="button" className="sheet-handle" aria-expanded={sheetExpanded} onClick={() => (state.selection ? dispatch({ type: 'select', sel: null }) : setSheetOpen(!sheetOpen))}>
          <span className="sheet-grip" aria-hidden="true" />
          <span>{state.selection ? 'Close details' : sheetOpen ? 'Hide overview' : `${house.name} overview`}</span>
        </button>
        <div className="detail-scroll">
          <DetailPanel />
          <SourceDetails key={state.selection?.id ?? "overview"} />
        </div>
      </aside>

      {state.askOpen && <AskPanel />}
      {state.searchOpen && <SearchPalette />}
      {state.settingsOpen && <SettingsDialog />}
      <RealPreview key={state.dialog?.type === "preview" ? state.dialog.docId : "none"} />
      <Toasts />
    </div>
  );
}
