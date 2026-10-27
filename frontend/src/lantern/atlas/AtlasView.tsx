import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useStore, type AtlasLens } from '../state/store';
import { Icon } from '../components/Icon';
import { OptionalViewerBoundary } from '../components/OptionalViewerBoundary';
import { BuildingSection } from '../topology/BuildingScope';
import { useSourcePorts } from '../source-ports';
import { PlacesLens } from './PlacesLens';
import { NetworkLens } from './NetworkLens';
import './atlas-sources.css';

const SiteArtifactView = lazy(() => import('../site-artifacts/SiteArtifactView').then(module => ({ default: module.SiteArtifactView })));
const UnifiedAtlas = lazy(() => import('../unified-atlas/UnifiedAtlas'));
const noSelection = () => null;
const noSubscription = () => () => {};

/** What the workspace holds where the map goes: the house model, which can
 * stand beside a lens or shrink to an inset, or a document (no house model
 * yet, over the building sections) that a lens replaces while it is open. */
type MapKind = 'map' | 'document';

export function AtlasView() {
  const { models } = useSourcePorts();
  const { state, dispatch } = useStore();
  const atlasSelection = useSyncExternalStore(models?.atlas?.subscribe ?? noSubscription,
    models?.atlas?.current ?? noSelection, noSelection);
  const [other, setOther] = useState<'site' | null>(null);
  const lens = state.atlasLens;
  const setLens = useCallback((next: AtlasLens | null) => dispatch({ type: 'atlasLens', lens: next }), [dispatch]);
  const releaseReading = useCallback((claim: AtlasLens) => dispatch({ type: 'atlasReadingRelease', claim }), [dispatch]);
  const [nativeTarget, setNativeTarget] = useState<HTMLElement | null>(null);
  const panelId = useId();
  // Another source takes the Atlas's place; the lens belongs to the Atlas, so
  // it is set aside, and Back to Atlas returns to the map.
  const openOther = (id: 'site') => { setLens(null); setOther(id); };
  // A route to a lens (Rooms & places or Network from elsewhere) returns to the Atlas.
  useEffect(() => { if (lens) setOther(null); }, [lens]);
  const workspace = (kind: MapKind, map: ReactNode, native: boolean, sources?: ReactNode) => <AtlasWorkspace kind={kind} lens={lens} setLens={setLens}
    releaseReading={releaseReading} panelId={panelId} nativeTarget={setNativeTarget} native={native} selection={state.selection?.id ?? null} sources={sources}>{map}</AtlasWorkspace>;
  const others = models?.site ? [{ id: 'site' as const, label: 'Site' }] : [];
  const open = others.find(row => row.id === other) ?? null;
  if (open && models?.site) return <>
    <div className="atlas-sources is-open">
      <button type="button" className="text-btn" onClick={() => setOther(null)}><Icon name="back" size={16} />Back to Atlas</button>
      <h2>{open.label}</h2>
    </div>
    <OptionalViewerBoundary key="site" label="The site viewer">
      <Suspense fallback={<p className="source-model-pane" role="status">Loading site viewer…</p>}>
        <div className="source-model-pane"><SiteArtifactView port={models.site} /></div></Suspense>
    </OptionalViewerBoundary>
  </>;
  // Other sources stay in the row above the stage.
  const sources = others.length > 0 && <details className="atlas-source-details" onBlur={event => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }} onKeyDown={event => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false;
    event.currentTarget.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  }}>
    <summary>Other sources</summary>
    <nav className="atlas-sources" aria-label="Source inspection">
      {others.map(row => <button key={row.id} type="button" className="text-btn" onClick={() => openOther(row.id)}>{row.label}</button>)}
    </nav>
  </details>;
  // With a selected house model publication the unified Atlas is the Atlas.
  if (models?.atlas && atlasSelection) return workspace('map', <OptionalViewerBoundary key="atlas" label="The Atlas">
    <Suspense fallback={<p className="source-model-pane" role="status">Loading Atlas…</p>}>
      <UnifiedAtlas port={models.atlas}
        otherSources={others.map(row => ({ id: row.id, label: row.label, open: () => openOther(row.id) }))}
        lens={{ value: lens, set: setLens, target: nativeTarget, panelId }} />
    </Suspense>
  </OptionalViewerBoundary>, true, sources);
  // Without one there is no map to draw: the Atlas says so above the home's
  // building sections, and the lenses still list the home's own records.
  return workspace('document', <BuildingSection />, false, sources);
}

const LENS_TITLE = { places: 'Rooms & places', network: 'Network' } as const;
/** Said in the lens in place of the unified Atlas's own part, its model rooms
 * or network graph, when there is no house model yet. */
const NO_ROOM_MAP = {
  places: 'There is no house model yet, so its rooms are not listed here.',
  network: 'There is no house model yet, so its network graph is not shown here.',
} as const;

/** The Atlas workspace: one row to choose Map, Rooms & places or Network, then
 * the map with the chosen lens beside it. Read wide, the lens takes the room
 * and the map stands in the corner as a still-drawn inset, returned by Show
 * map. A record opened from the lens reads wide in the same way while it is
 * open, and closing it, or leaving the Atlas, brings the map back beside the
 * lens unless the lens was chosen again since. A spatial map is
 * the same element in every arrangement, so its source, camera and selection
 * stay as they are; a document fallback unmounts while a lens replaces it,
 * ending its reads; only a lens mounts and unmounts otherwise. */
function AtlasWorkspace({ kind, lens, setLens, releaseReading, panelId, nativeTarget, native, selection, sources, children }: {
  readonly kind: MapKind; readonly lens: AtlasLens | null; readonly setLens: (next: AtlasLens | null) => void;
  /** Returns to Beside only while the lens is still the one a record read wide. */
  readonly releaseReading: (claim: AtlasLens) => void;
  readonly panelId: string; readonly nativeTarget: (node: HTMLElement | null) => void;
  /** The unified Atlas fills its own part of the lens. */
  readonly native: boolean;
  /** The record the details sheet shows, if any. */
  readonly selection: string | null;
  readonly sources?: ReactNode; readonly children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null), expandButton = useRef<HTMLButtonElement>(null), showMapButton = useRef<HTMLButtonElement>(null);
  const mapButton = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null), body = useRef<HTMLDivElement>(null);
  const mapArea = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const kindOpen = lens?.kind ?? null;
  const reading = lens !== null && lens.reading && kind === 'map';
  const replaced = lens !== null && kind === 'document';
  // A record opened from the lens reads wide while it is open: an activation
  // inside the lens marks the selection it causes. The mark lasts only for
  // that event, so a later selection from elsewhere never counts.
  const fromLens = useRef(false);
  const markLens = () => { fromLens.current = true; window.setTimeout(() => { fromLens.current = false; }, 0); };
  // The lens read wide because that record opened: closing it returns to
  // Beside. Any lens choice since replaces the lens, so the claim no longer
  // matches and the choice stays.
  const byRecord = useRef<AtlasLens | null>(null);
  // A reading change made for the record sheet leaves focus with the sheet.
  const quiet = useRef(false);
  const selectedBefore = useRef(selection);
  useLayoutEffect(() => {
    const before = selectedBefore.current; selectedBefore.current = selection;
    if (before === selection) return;
    if (selection !== null) {
      const active = document.activeElement;
      const inLens = fromLens.current || (active instanceof Node && panel.current?.contains(active) === true);
      fromLens.current = false;
      if (inLens && lens && kind === 'map' && !lens.reading) {
        const claim = { ...lens, reading: true };
        byRecord.current = claim; quiet.current = true;
        setLens(claim);
      }
      return;
    }
    const claim = byRecord.current;
    if (!claim) return;
    byRecord.current = null;
    if (lens === claim) { quiet.current = reading; releaseReading(claim); }
  }, [selection]);
  // Leaving the Atlas ends the record's reading too, so it is not found wide
  // on return without the record that began it.
  useEffect(() => () => { const claim = byRecord.current; if (claim) releaseReading(claim); }, []);
  // Opening a lens, or changing it, takes focus to its heading; closing it
  // returns focus to what opened it when that is still shown, else to Map,
  // else (the lens bar hidden on a phone) to the map's own lens control.
  const shownBefore = useRef<string | null>(null);
  useLayoutEffect(() => {
    const before = shownBefore.current; shownBefore.current = kindOpen;
    if (kindOpen === before) return;
    // An explicit lens change ends any reading the record began.
    byRecord.current = null;
    if (kindOpen) {
      // A new lens starts at its top; Expand and Show map keep the reader's place.
      if (body.current) body.current.scrollTop = 0;
      const active = document.activeElement;
      if (before === null) opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      heading.current?.focus({ preventScroll: true });
      return;
    }
    const back = opener.current; opener.current = null;
    const active = document.activeElement;
    // Focus already placed elsewhere, such as Map itself, stays.
    if (active && active !== document.body) return;
    const shown = (target: HTMLElement | null | undefined): target is HTMLElement =>
      !!target && target.isConnected && target.getClientRects().length > 0 && !target.closest('[inert]');
    [back, mapButton.current, mapArea.current?.querySelector<HTMLElement>('[data-lens-return]')].find(shown)?.focus({ preventScroll: true });
  }, [kindOpen]);
  // Read wide and back: focus follows to the control that undoes it.
  const readBefore = useRef(reading);
  useLayoutEffect(() => {
    if (readBefore.current === reading) return;
    readBefore.current = reading;
    if (quiet.current) { quiet.current = false; return; }
    (reading ? showMapButton : expandButton).current?.focus({ preventScroll: true });
  }, [reading]);
  // Expand and Show map are the user's own choice, never undone by a record closing.
  const setReading = (next: boolean) => { byRecord.current = null; if (lens) setLens({ ...lens, reading: next }); };
  const choose = (next: 'places' | 'network' | null) => {
    if (next === null) setLens(null);
    else if (lens?.kind !== next) setLens({ kind: next, reading: false });
  };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault(); event.stopPropagation();
    if (lens?.reading) setReading(false); else setLens(null);
  };
  // The sheet is always this one element: its width, the room the Atlas has
  // beside the details column, decides the arrangement below.
  return <div className="atlas-sheet">
    <div className="atlas-lens-bar">
      <div className="seg atlas-lens-switch" role="group" aria-label="Atlas lens">
        <button ref={mapButton} type="button" aria-pressed={lens === null} onClick={() => choose(null)}><Icon name="atlas" size={16} />Map</button>
        <button type="button" aria-pressed={lens?.kind === 'places'} aria-controls={lens ? panelId : undefined} onClick={() => choose('places')}>
          <Icon name="rooms" size={16} /><span className="atlas-lens-name" data-short="Rooms"><span className="atlas-lens-full">Rooms &amp; places</span></span></button>
        <button type="button" aria-pressed={lens?.kind === 'network'} aria-controls={lens ? panelId : undefined} onClick={() => choose('network')}>
          <Icon name="network" size={16} />Network</button>
      </div>
      {sources}
    </div>
    <div className={`atlas-workspace${lens ? ` has-lens is-${lens.kind}` : ''}${reading ? ' is-reading' : ''}${replaced ? ' is-replaced' : ''}`}>
      {lens && <section ref={panel} id={panelId} className={`atlas-lens is-${lens.kind}`} aria-labelledby={`${panelId}-title`} onKeyDown={keys}
        onClickCapture={markLens} onKeyDownCapture={event => { if (event.key === 'Enter' || event.key === ' ') markLens(); }}>
        <header className="atlas-lens-head">
          <h2 id={`${panelId}-title`} ref={heading} tabIndex={-1}>{LENS_TITLE[lens.kind]}</h2>
          {kind === 'map' && !reading && <button ref={expandButton} type="button" className="chip-btn atlas-lens-expand"
            onClick={() => setReading(true)}><Icon name="fit" size={15} /><span>Expand</span></button>}
          <button type="button" className="chip-btn atlas-lens-close" onClick={() => setLens(null)}>
            <Icon name="close" size={15} /><span>Close<span className="sr-only"> {LENS_TITLE[lens.kind]}</span></span></button>
        </header>
        <div ref={body} className="atlas-lens-body">
          {/* The unified Atlas renders its own model rooms or network graph here;
              without one, the lens says so before the home's own records. */}
          {native ? <div ref={nativeTarget} className="atlas-lens-native" />
            : <p className="atlas-lens-status">{NO_ROOM_MAP[lens.kind]}</p>}
          {lens.kind === 'places' ? <PlacesLens /> : <NetworkLens />}
        </div>
      </section>}
      {/* Inset while read wide: drawn and kept current, out of the tab order.
          A document replaced by the lens is not kept mounted behind it. */}
      <div ref={mapArea} className={`atlas-map${reading ? ' is-inset' : ''}`} inert={reading || replaced}>{replaced ? null : children}</div>
      {reading && <button ref={showMapButton} type="button" className="btn atlas-show-map" onClick={() => setReading(false)}>
        <Icon name="atlas" size={16} />Show map</button>}
    </div>
  </div>;
}
