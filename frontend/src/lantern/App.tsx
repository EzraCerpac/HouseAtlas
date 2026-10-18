import { lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion, useStore, type ViewId } from './state/store';
import { Icon } from './components/Icon';
import { AtlasView } from './atlas/AtlasView';
import { RoomsView } from './views/RoomsView';
import { DeferredView } from './DeferredView';
import { DetailPanel } from './components/DetailPanel';
import { AskPanel } from './components/AskPanel';
import { RealPreview } from './components/RealPreview';
import { SourceDetails } from './components/SourceDetails';
import { SearchPalette } from './components/SearchPalette';
import { SettingsDialog } from './components/SettingsDialog';
import { Modal } from './components/Modal';
import { ShellMenu } from './components/ShellMenu';
import { attentionCount } from './components/DetailPanel';
import { AiActivityStatus } from '../ai/host/index.js';

// Keep the default Atlas/Rooms path and shared providers eager. These modules
// load only when selected; no background prefetch or source reads are added.
const UpkeepView = lazy(() => import('./views/UpkeepView').then(m => ({ default: m.UpkeepView })));
const NetworkView = lazy(() => import('./views/NetworkView').then(m => ({ default: m.NetworkView })));
const LibraryView = lazy(() => import('./views/LibraryView').then(m => ({ default: m.LibraryView })));
const ChangesView = lazy(() => import('./views/ChangesView').then(m => ({ default: m.ChangesView })));

/** `short`: the phone tab bar's visible name where the full one would wrap; the full name stays the control's name. */
const VIEWS: { id: ViewId; label: string; short?: string; icon: string }[] = [
  { id: 'atlas', label: 'Atlas', icon: 'atlas' },
  { id: 'rooms', label: 'Rooms & places', short: 'Rooms', icon: 'rooms' },
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

/** The shell's entry to the home overview and contextual source details. */
function OverviewToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { house } = useStore();
  const attention = attentionCount(house);
  return (
    <button
      type="button"
      className="source-status"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls="details"
      aria-label={`Overview${attention > 0 ? `: ${attention} need attention` : ''}`}
    >
      <Icon name="info" size={18} />
      <span className="source-status-main" aria-hidden="true">
        <span className="source-status-name">Overview</span>
      </span>
      {attention > 0 && <span className="source-status-count" aria-hidden="true">{attention}</span>}
    </button>
  );
}

function HomePicker({ onClose }: { onClose: () => void }) {
  const { dispatch, projection } = useStore();
  return (
    <Modal title="Home" onClose={onClose}>
      <fieldset className="field radio-cards home-picker">
        <legend className="sr-only">Home</legend>
        {projection.view.homes.map((home) => {
          const id = JSON.stringify([home.workspaceId, home.homeId]);
          const selected = projection.view.scope.workspaceId === home.workspaceId && projection.view.scope.homeId === home.homeId;
          return (
            <label key={id} className={`radio-card${selected ? ' is-on' : ''}`}>
              <input type="radio" name="home" checked={selected} onChange={() => {
                if (selected) return;
                dispatch({ type: 'house', id });
                onClose();
              }} />
              <span className="radio-title">{home.label}</span>
            </label>
          );
        })}
      </fieldset>
    </Modal>
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
  const [homesOpen, setHomesOpen] = useState(false);
  // The strip's own tools, where the phone menu hands focus when it is hidden.
  const toolsButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const reviewCount = house.writes.filter((w) => w.status === 'conflict' || w.status === 'uncertain').length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || state.dialog || state.settingsOpen || state.nativeOpen || state.askOpen || state.searchOpen || homesOpen) return;
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
  }, [dispatch, state.dialog, state.settingsOpen, state.nativeOpen, state.askOpen, state.searchOpen, homesOpen]);

  // sheetOpen is the requested overview. A selection shows its record instead and
  // drops that request, so closing the record collapses the sheet; asking for the
  // overview while a record is open clears the record and keeps the overview.
  useEffect(() => {
    if (state.selection) setSheetOpen(false);
  }, [state.selection]);

  const view = (() => {
    switch (state.view) {
      case 'rooms':
        return <RoomsView />;
      case 'upkeep':
        return <DeferredView key="upkeep" label="Upkeep"><UpkeepView /></DeferredView>;
      case 'network':
        return <DeferredView key="network" label="Network"><NetworkView /></DeferredView>;
      case 'library':
        return <DeferredView key="library" label="Library"><LibraryView /></DeferredView>;
      case 'changes':
        return <DeferredView key="changes" label="Changes"><ChangesView /></DeferredView>;
      default:
        return <AtlasView />;
    }
  })();

  const sheetExpanded = !!state.selection || sheetOpen;
  // Focus returns to what opened the sheet when it collapses, because the
  // collapsed sheet (and its handle) is not displayed at narrow widths.
  const opener = useRef<HTMLElement | null>(null);
  const showingRecord = useRef(false);
  const wasExpanded = useRef(false);
  useLayoutEffect(() => {
    if (!state.selection) {
      if (sheetExpanded) { showingRecord.current = false; opener.current = null; }
      return;
    }
    if (!showingRecord.current) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && !document.getElementById('details')?.contains(active) ? active : null;
    }
    showingRecord.current = true;
    document.getElementById('detail-title')?.focus();
  }, [state.selection]);
  useLayoutEffect(() => {
    const collapsed = wasExpanded.current && !sheetExpanded;
    wasExpanded.current = sheetExpanded;
    if (!collapsed) return;
    const fromRecord = showingRecord.current, target = fromRecord ? opener.current : document.querySelector<HTMLElement>('.source-status');
    showingRecord.current = false; opener.current = null;
    const details = document.getElementById('details'), active = document.activeElement;
    // Leave focus that already moved elsewhere, such as a click on the model.
    if (active && active !== document.body && !details?.contains(active)) return;
    (target?.isConnected && target.getClientRects().length && !details?.contains(target) ? target : document.getElementById('main'))?.focus();
  }, [sheetExpanded]);
  const openTools = () => dispatch({ type: 'nativeOpen', open: true });
  const openSettings = () => dispatch({ type: 'settingsOpen', open: true });
  const toggleOverview = () => {
    if (state.selection) {
      dispatch({ type: 'select', sel: null });
      setSheetOpen(true);
    } else setSheetOpen(!sheetOpen);
  };

  return (
    <div className={`lantern-host app view-${state.view}${sheetExpanded ? ' has-detail' : ''}${state.askOpen ? ' ask-open' : ''}${reduced ? ' is-reduced' : ''}${state.settings.motion === 'full' ? ' motion-full' : ''}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      {/* The title block: what the set is, which home it draws and the way to
          find anything in it. Its tools stand at the right end of the strip. */}
      <header className="topbar">
        <div className="brand">
          <Mark />
          <span className="brand-name">HouseAtlas</span>
        </div>
        <button type="button" className="house-btn" onClick={() => setHomesOpen(true)} aria-haspopup="dialog" aria-label={`Home: ${house.name}. Choose home.`}>
          <span className="house-field">
            <span className="house-label" aria-hidden="true">Home</span>
            <span className="house-name">{house.name}</span>
          </span>
          <Icon name="chevronDown" size={15} />
        </button>
        <button type="button" className="search-trigger" aria-label="Search rooms, belongings, manuals" onClick={() => dispatch({ type: 'search', open: true })}>
          <Icon name="search" size={18} />
          <span className="search-label">Search</span>
          <kbd aria-hidden="true">/</kbd>
        </button>
      </header>

      <nav className="navrail" aria-label="Sections">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className={`nav-btn${state.view === v.id ? ' is-current' : ''}`} aria-label={v.short ? v.label : undefined} aria-current={state.view === v.id ? 'page' : undefined} onClick={() => dispatch({ type: 'view', view: v.id })}>
            <Icon name={v.icon} size={20} />
            {v.short
              ? <span className="nav-label" data-short={v.short}><span className="nav-label-full">{v.label}</span></span>
              : <span className="nav-label">{v.label}</span>}
            {v.id === 'changes' && reviewCount > 0 && (
              <span className="nav-badge" aria-label={`${reviewCount} to review`}>
                {reviewCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="shell-tools">
        <OverviewToggle expanded={sheetExpanded && !state.selection} onToggle={toggleOverview} />
        {/* Atlas tools holds the saved house copy and the native tools; on
            phones it shares one menu with Settings. */}
        <button ref={toolsButton} type="button" className="tools-btn" aria-haspopup="dialog" onClick={openTools}>
          <Icon name="tools" size={18} />
          <span className="tools-label">Atlas tools</span>
        </button>
        <button type="button" aria-label="Ask" className={`ask-btn${state.askOpen ? ' is-on' : ''}`} aria-pressed={state.askOpen} onClick={() => dispatch({ type: 'ask', open: !state.askOpen })}>
          <Icon name="ask" size={18} />
          <span>Ask</span>
        </button>
        <button ref={settingsButton} type="button" className="icon-btn tool-settings" aria-label="Settings" onClick={openSettings}>
          <Icon name="settings" size={20} />
        </button>
        <ShellMenu items={[{ label: 'Atlas tools', icon: 'tools', open: openTools, equivalent: toolsButton },
          { label: 'Settings', icon: 'settings', open: openSettings, equivalent: settingsButton }]} />
      </div>

      <main id="main" className="main" tabIndex={-1}>
        {!state.askOpen && !state.nativeOpen && (
          <div hidden={state.settingsOpen}>
            <AiActivityStatus onOpenSettings={() => dispatch({ type: 'settingsOpen', open: true })} />
          </div>
        )}
        {view}
      </main>

      <aside id="details" className={`detail-col${sheetExpanded ? ' is-expanded' : ''}`} aria-label="Details">
        <button id="detail-sheet-handle" type="button" className="sheet-handle" aria-expanded={sheetExpanded} onClick={() => (state.selection ? dispatch({ type: 'select', sel: null }) : setSheetOpen(!sheetOpen))}>
          <span className="sheet-grip" aria-hidden="true" />
          <span>{state.selection ? 'Close details' : sheetOpen ? 'Hide overview' : `${house.name} overview`}</span>
        </button>
        {sheetExpanded && <div className="detail-scroll">
          <DetailPanel onCloseOverview={() => { setSheetOpen(false); document.querySelector<HTMLElement>('.source-status')?.focus(); }} />
          <SourceDetails key={state.selection?.id ?? "overview"} />
        </div>}
      </aside>

      {state.askOpen && <AskPanel />}
      {state.searchOpen && <SearchPalette />}
      {state.settingsOpen && <SettingsDialog />}
      {homesOpen && <HomePicker onClose={() => setHomesOpen(false)} />}
      <RealPreview key={state.dialog?.type === "preview" ? state.dialog.docId : "none"} />
      <Toasts />
    </div>
  );
}
