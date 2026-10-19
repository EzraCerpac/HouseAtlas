import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useReducedMotion, useSelect, useStore, type AtlasLens } from '../state/store';
import { CLAIM_LABEL, dueState, findSpace, locate, roomContents, unplaced } from '../data/query';
import type { Overlay } from '../data/types';
import { buildHouseGeom, centroid } from './geometry';
import { buildFurniture, buildPins } from './pins';
import { Model, computeViewBox, floorZ, focusIndex, plannedFloors, plateOf, type ModelCam } from './Model';
import { useEased } from './useCamera';
import { LAYER, ROOM_KIND_LABEL, ROOM_TINT } from './palette';
import { Icon } from '../components/Icon';
import { EntityLink } from '../components/ui';
import { OptionalViewerBoundary } from '../components/OptionalViewerBoundary';
import { BuildingSection } from '../topology/BuildingScope';
import { NativeScanAtlas, useNativeGeometryClient } from '../scans/native-ui/NativeScanAtlas';
import { useSourcePorts } from '../source-ports';
import { PlacesLens } from './PlacesLens';
import { NetworkLens } from './NetworkLens';
import '../source-models/source-switch.css';

const DEFAULT_YAW = -32;
const DEFAULT_TILT = 36;
// Camera preferences survive switching to other views and back.
const camPrefs = { yaw: DEFAULT_YAW, tilt: DEFAULT_TILT, zoom: 1, introDone: false };

const OVERLAYS: Overlay[] = ['spaces', 'belongings', 'electrical', 'water', 'network', 'upkeep'];
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const SourceModelView = lazy(() => import('../source-models/SourceModelView').then(module => ({ default: module.SourceModelView })));
const SiteArtifactView = lazy(() => import('../site-artifacts/SiteArtifactView').then(module => ({ default: module.SiteArtifactView })));
const UnifiedAtlas = lazy(() => import('../unified-atlas/UnifiedAtlas'));
const noOverview = () => null;
const noOverviewSubscription = () => () => {};

/** What the workspace holds where the map goes: a spatial view (a model,
 * scan, plan or site) that can stand beside a lens or shrink to an inset, or
 * a document (building sections without a shape projection) that a lens
 * replaces while it is open. */
type MapKind = 'map' | 'document';

export function AtlasView() {
  const { models } = useSourcePorts();
  const { house, state, dispatch } = useStore();
  const nativeGeometry = useNativeGeometryClient();
  const selectedOverview = useSyncExternalStore(models?.overview?.subscribe ?? noOverviewSubscription,
    models?.overview?.current ?? noOverview, noOverview);
  const atlasSelection = useSyncExternalStore(models?.atlas?.subscribe ?? noOverviewSubscription,
    models?.atlas?.current ?? noOverview, noOverview);
  const [source, setSource] = useState<'home' | 'model' | 'site' | null>(null);
  const [other, setOther] = useState<'model' | 'site' | 'home' | null>(null);
  const lens = state.atlasLens;
  const setLens = useCallback((next: AtlasLens | null) => dispatch({ type: 'atlasLens', lens: next }), [dispatch]);
  const releaseReading = useCallback((claim: AtlasLens) => dispatch({ type: 'atlasReadingRelease', claim }), [dispatch]);
  const [nativeTarget, setNativeTarget] = useState<HTMLElement | null>(null);
  const panelId = useId();
  // Without a shape projection or a native scan reader the home Atlas is the
  // building section document, not a map.
  const homeKind: MapKind = house.geometry === 'none' && !nativeGeometry ? 'document' : 'map';
  // Another source takes the Atlas's place; the lens belongs to the Atlas, so
  // it is set aside, and Back to Atlas returns to the map.
  const openOther = (id: 'model' | 'site' | 'home') => { setLens(null); setOther(id); };
  // A route to a lens (Rooms & places or Network from elsewhere) returns to the Atlas.
  useEffect(() => { if (lens) setOther(null); }, [lens]);
  const workspace = (kind: MapKind, map: ReactNode, native = false, sources?: ReactNode) => <AtlasWorkspace kind={kind} lens={lens} setLens={setLens}
    releaseReading={releaseReading} panelId={panelId} nativeTarget={setNativeTarget} native={native} selection={state.selection?.id ?? null} sources={sources}>{map}</AtlasWorkspace>;
  if (!models) return workspace(homeKind, <HomeAtlas />);
  // With the opt-in scene port and a selected publication, the unified Atlas is
  // the Atlas; the other sources stay reachable through their own owners.
  if (models.atlas && atlasSelection) {
    const atlas = models.atlas;
    const others = [
      { id: 'model' as const, label: selectedOverview ? 'Model overview' : 'Model file' },
      ...(models.site ? [{ id: 'site' as const, label: 'Site' }] : []),
      { id: 'home' as const, label: 'Home map' },
    ];
    const open = others.find(row => row.id === other) ?? null;
    // Other sources stay in the row above the stage.
    if (!open) return workspace('map', <OptionalViewerBoundary key="atlas" label="The Atlas">
      <Suspense fallback={<p className="source-model-pane" role="status">Loading Atlas…</p>}>
        <UnifiedAtlas port={atlas} onOpenModel={() => openOther('model')}
          otherSources={others.map(row => ({ id: row.id, label: row.label, open: () => openOther(row.id) }))}
          lens={{ value: lens, set: setLens, target: nativeTarget, panelId }} />
      </Suspense>
    </OptionalViewerBoundary>, true, <details className="atlas-source-details" onBlur={event => {
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
    </details>);
    return <>
      <div className="atlas-sources is-open">
        <button type="button" className="text-btn" onClick={() => setOther(null)}><Icon name="back" size={16} />Back to Atlas</button>
        <h2>{open.label}</h2>
      </div>
      {open.id === 'model'
        ? <OptionalViewerBoundary key="model" label="The model viewer">
          <Suspense fallback={<p className="source-model-pane" role="status">Loading model viewer…</p>}><SourceModelView port={models} /></Suspense>
        </OptionalViewerBoundary>
        : open.id === 'site' && models.site
        ? <OptionalViewerBoundary key="site" label="The site viewer">
          <Suspense fallback={<p className="source-model-pane" role="status">Loading site viewer…</p>}>
            <div className="source-model-pane"><SiteArtifactView port={models.site} /></div></Suspense>
        </OptionalViewerBoundary>
        : <HomeAtlas />}
    </>;
  }
  const preferred = source ?? (selectedOverview ? 'model' : 'home');
  const shown = preferred === 'site' && !models.site ? 'home' : preferred;
  return workspace(shown === 'home' ? homeKind : 'map', <>
    <div className="seg source-switch" role="group" aria-label="Atlas source">
      <button type="button" aria-pressed={shown === 'home'} onClick={() => setSource('home')}>Home atlas</button>
      <button type="button" aria-pressed={shown === 'model'} onClick={() => setSource('model')}>{selectedOverview ? 'Model' : 'Model file'}</button>
      {models.site && <button type="button" aria-pressed={shown === 'site'} onClick={() => setSource('site')}>Site</button>}
    </div>
    {/* Keys keep each viewer's failure state with its own source. */}
    {shown === 'model'
      ? <OptionalViewerBoundary key="model" label="The model viewer">
        <Suspense fallback={<p className="source-model-pane" role="status">Loading model viewer…</p>}><SourceModelView port={models} /></Suspense>
      </OptionalViewerBoundary>
      : shown === 'site' && models.site
      ? <OptionalViewerBoundary key="site" label="The site viewer">
        <Suspense fallback={<p className="source-model-pane" role="status">Loading site viewer…</p>}>
          <div className="source-model-pane"><SiteArtifactView port={models.site} /></div></Suspense>
      </OptionalViewerBoundary>
      : <HomeAtlas />}
  </>);
}

const LENS_TITLE = { places: 'Rooms & places', network: 'Network' } as const;
/** Said in the lens in place of the unified Atlas's own part, its model rooms
 * or network graph, when no unified model publication is selected. */
const NO_ROOM_MAP = {
  places: 'No unified model publication is selected, so its model rooms are not listed here.',
  network: 'No unified model publication is selected, so its logical network graph is not shown here.',
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
  const mapButton = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null);
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
  // returns focus to what opened it when that is still shown, else to Map.
  const shownBefore = useRef<string | null>(null);
  useLayoutEffect(() => {
    const before = shownBefore.current; shownBefore.current = kindOpen;
    if (kindOpen === before) return;
    // An explicit lens change ends any reading the record began.
    byRecord.current = null;
    if (kindOpen) {
      const active = document.activeElement;
      if (before === null) opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      heading.current?.focus({ preventScroll: true });
      return;
    }
    const back = opener.current; opener.current = null;
    const active = document.activeElement;
    // Focus already placed elsewhere, such as Map itself, stays.
    if (active && active !== document.body) return;
    (back && back.isConnected && back.getClientRects().length > 0 && !back.closest('[inert]') ? back : mapButton.current)?.focus({ preventScroll: true });
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
        <div className="atlas-lens-body">
          {/* The unified Atlas renders its own model rooms or network graph here;
              without one, the lens says so before the home's own records. */}
          {native ? <div ref={nativeTarget} className="atlas-lens-native" />
            : <p className="atlas-lens-status">{NO_ROOM_MAP[lens.kind]}</p>}
          {lens.kind === 'places' ? <PlacesLens /> : <NetworkLens />}
        </div>
      </section>}
      {/* Inset while read wide: drawn and kept current, out of the tab order.
          A document replaced by the lens is not kept mounted behind it. */}
      <div className={`atlas-map${reading ? ' is-inset' : ''}`} inert={reading || replaced}>{replaced ? null : children}</div>
      {reading && <button ref={showMapButton} type="button" className="btn atlas-show-map" onClick={() => setReading(false)}>
        <Icon name="atlas" size={16} />Show map</button>}
    </div>
  </div>;
}

function HomeAtlas() {
  const { house } = useStore();
  const nativeGeometry = useNativeGeometryClient();
  if (house.geometry === 'none' && nativeGeometry) return <NativeScanAtlas client={nativeGeometry} />;
  if (house.geometry === 'none') return <NoGeometryAtlas />;
  return <Stage />;
}

function NoGeometryAtlas() {
  return <BuildingSection />;
}

function Stage() {
  const { state, dispatch, house } = useStore();
  const select = useSelect();
  const reduced = useReducedMotion();
  const geoms = useMemo(() => buildHouseGeom(house), [house.spaces, house.openings, house.floors]);
  const furniture = useMemo(() => buildFurniture(house), [house.items, house.spaces]);
  const pins = useMemo(
    () => buildPins(house, state.overlay, state.focusCircuit, state.selection, furniture),
    [house, state.overlay, state.focusCircuit, state.selection, furniture],
  );

  const [yaw, setYaw] = useState(camPrefs.yaw);
  const [tilt, setTilt] = useState(camPrefs.tilt);
  const [zoom, setZoom] = useState(camPrefs.zoom);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const dragMoved = useRef(false);
  const drag = useRef<{ x: number; y: number; yaw: number; tilt: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 640 });

  useEffect(() => {
    camPrefs.yaw = yaw;
    camPrefs.tilt = tilt;
    camPrefs.zoom = zoom;
  }, [yaw, tilt, zoom]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => { if (entry) setSize({ w: Math.max(1, entry.contentRect.width), h: Math.max(1, entry.contentRect.height) }); });
    ro.observe(el);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => clamp(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 1, 3.2));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  const planned = plannedFloors(house);
  const { idx, noPlan } = focusIndex(house, state.floorId);
  const is2d = state.mode === '2d';
  const explodeT = !is2d && state.exploded ? 1 : 0;
  const top = is2d ? idx : state.exploded ? planned.length - 1 : idx;
  const plate = plateOf(geoms);

  // Zoom centres on whatever is selected, or on the current floor.
  let fx = plate.center[0];
  let fy = plate.center[1];
  let fz = floorZ(idx, explodeT) + 0.5;
  if (state.selection) {
    const loc = locate(house, state.selection.id);
    const fi = planned.findIndex((f) => f.id === loc.floorId);
    const sp = findSpace(house, loc.spaceId);
    const pt = loc.pos ?? (sp?.shape ? centroid(sp.shape) : undefined);
    if (fi >= 0 && pt) {
      fx = pt[0];
      fy = pt[1];
      fz = floorZ(fi, explodeT) + 0.8;
    }
  }

  const target: ModelCam = {
    yaw: is2d ? Math.round(yaw / 90) * 90 : yaw,
    pitch: is2d ? 90 : tilt,
    explode: explodeT,
    top,
    zoom,
    fx,
    fy,
    fz,
  };
  const intro = camPrefs.introDone ? undefined : { yaw: yaw - 30, pitch: 60, explode: 0 };
  const cam = useEased(target, { reduced, snap: dragging ? ['yaw', 'pitch'] : [], intro, tau: 140 });
  useEffect(() => {
    camPrefs.introDone = true;
  }, []);

  const vb = computeViewBox(cam, geoms, !is2d && state.exploded);
  const ui = Math.max(vb.w / size.w, vb.h / size.h);
  const north = vb.P.dir(0, -1);
  const northDeg = (Math.atan2(north[0], -north[1]) * 180) / Math.PI;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || is2d) return;
    if ((e.target as Element).closest('.stage-ui')) return;
    drag.current = { x: e.clientX, y: e.clientY, yaw, tilt };
    dragMoved.current = false;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!dragMoved.current && Math.abs(dx) + Math.abs(dy) < 5) return;
    if (!dragMoved.current) {
      dragMoved.current = true;
      setDragging(true);
      setHover(null);
    }
    setYaw(d.yaw + dx * 0.4);
    if (e.pointerType === 'mouse') setTilt(clamp(d.tilt - dy * 0.2, 18, 64));
  };
  const endDrag = () => {
    drag.current = null;
    if (dragging) setDragging(false);
    // Let the click that ends a drag see dragMoved, then reset.
    window.setTimeout(() => (dragMoved.current = false), 0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const map: Record<string, () => void> = {
      ArrowLeft: () => !is2d && setYaw((y) => y - 15),
      ArrowRight: () => !is2d && setYaw((y) => y + 15),
      ArrowUp: () => !is2d && setTilt((t) => clamp(t + 6, 18, 64)),
      ArrowDown: () => !is2d && setTilt((t) => clamp(t - 6, 18, 64)),
      '+': () => setZoom((z) => clamp(z * 1.25, 1, 3.2)),
      '=': () => setZoom((z) => clamp(z * 1.25, 1, 3.2)),
      '-': () => setZoom((z) => clamp(z / 1.25, 1, 3.2)),
    };
    const fn = map[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };

  const resetView = () => {
    setYaw(DEFAULT_YAW);
    setTilt(DEFAULT_TILT);
    setZoom(1);
  };

  const onBackgroundClick = (e: MouseEvent) => {
    if (dragMoved.current) return;
    const t = e.target as Element;
    if (t.closest('.room, .pin, .furniture, .floor-tag, .stage-ui')) return;
    if (state.selection) select(null);
  };

  const floorsDesc = [...house.floors].sort((a, b) => b.order - a.order);
  const selFloor = house.floors.find((f) => f.id === state.floorId);

  return (
    <div className="stage-shell">
      <div
        ref={wrapRef}
        className={`stage${dragging ? ' is-dragging' : ''}${is2d ? ' is-plan' : ''}`}
        tabIndex={0}
        aria-label="House model. Arrow keys turn and tilt, plus and minus zoom. Tab to reach rooms and markers."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onClick={onBackgroundClick}
      >
        <Model
          house={house}
          geoms={geoms}
          cam={cam}
          mode={state.mode}
          exploded={state.exploded}
          floorId={state.floorId}
          overlay={state.overlay}
          selection={state.selection}
          pins={pins}
          furniture={furniture}
          hover={hover}
          setHover={setHover}
          onPick={(id) => select(id, { keepOverlay: true })}
          onFloor={(id) => dispatch({ type: 'floor', id })}
          dragMoved={dragMoved}
          ui={ui}
          reduced={reduced}
        />
      </div>

      <nav className="stage-ui floor-rail" aria-label="Floors">
        {floorsDesc.map((f) => {
          const n = house.spaces.filter((s) => s.floorId === f.id && s.kind !== 'stair').length;
          return (
            <button
              key={f.id}
              type="button"
              className={`floor-btn${f.id === state.floorId ? ' is-current' : ''}${f.hasPlan ? '' : ' is-noplan'}`}
              aria-pressed={f.id === state.floorId}
              onClick={() => dispatch({ type: 'floor', id: f.id })}
            >
              <span className="floor-short">{f.short}</span>
              <span className="floor-meta">
                <span className="floor-name">{f.name}</span>
                <span className="floor-sub">{f.hasPlan ? `${n} ${n === 1 ? 'room' : 'rooms'}` : `No plan, ${n} listed`}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="stage-ui view-ctrl">
        <div className="seg" role="group" aria-label="Model view">
          <button type="button" aria-pressed={!is2d} onClick={() => dispatch({ type: 'mode', mode: '3d' })}>
            3D
          </button>
          <button type="button" aria-pressed={is2d} onClick={() => dispatch({ type: 'mode', mode: '2d' })}>
            Plan
          </button>
        </div>
        {!is2d && (
          <button type="button" className="ctrl-btn ctrl-wide" aria-pressed={state.exploded} onClick={() => dispatch({ type: 'explode', on: !state.exploded })}>
            <Icon name="explode" size={17} />
            <span>{state.exploded ? 'Exploded' : 'Stacked'}</span>
          </button>
        )}
        <div className="ctrl-group" role="group" aria-label="Camera">
          {!is2d && (
            <>
              <button type="button" className="ctrl-btn" aria-label="Turn model left" onClick={() => setYaw((y) => y - 45)}>
                <Icon name="rotl" size={17} />
              </button>
              <button type="button" className="ctrl-btn" aria-label="Turn model right" onClick={() => setYaw((y) => y + 45)}>
                <Icon name="rotr" size={17} />
              </button>
            </>
          )}
          <button type="button" className="ctrl-btn" aria-label="Zoom in" onClick={() => setZoom((z) => clamp(z * 1.3, 1, 3.2))} disabled={zoom >= 3.2}>
            <Icon name="plus" size={17} />
          </button>
          <button type="button" className="ctrl-btn" aria-label="Zoom out" onClick={() => setZoom((z) => clamp(z / 1.3, 1, 3.2))} disabled={zoom <= 1}>
            <Icon name="minus" size={17} />
          </button>
          <button type="button" className="compass" aria-label="Reset turn, tilt and zoom" title="Reset view" onClick={resetView}>
            <svg viewBox="0 0 32 32" aria-hidden="true" style={{ transform: `rotate(${northDeg}deg)` }}>
              <path d="M16 4 20 16H12Z" className="compass-n" />
              <path d="M16 28 12 16h8Z" className="compass-s" />
            </svg>
            <span aria-hidden="true">N</span>
          </button>
        </div>
        {!is2d && (
          <label className="tilt">
            <span>Tilt</span>
            <input type="range" min={18} max={64} step={1} value={Math.round(tilt)} onChange={(e) => setTilt(Number(e.target.value))} />
          </label>
        )}
      </div>

      {noPlan && selFloor && <NoPlanFloor floorId={selFloor.id} />}

      <div className="stage-ui stage-bottom">
        <Legend />
        <div className="layer-bar" role="radiogroup" aria-label="Overlay">
          {OVERLAYS.map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={state.overlay === o}
              className="layer-chip"
              style={{ '--layer': LAYER[o].color } as CSSProperties}
              onClick={() => dispatch({ type: 'overlay', overlay: o })}
            >
              <span className="layer-swatch" aria-hidden="true" />
              {LAYER[o].short}
            </button>
          ))}
        </div>
      </div>
      <p className="stage-ui demo-note">
        {is2d ? 'Plan view.' : 'Drag to turn.'}
      </p>
    </div>
  );
}

function NoPlanFloor({ floorId }: { floorId: string }) {
  const { house } = useStore();
  const floor = house.floors.find((f) => f.id === floorId)!;
  const rooms = house.spaces.filter((s) => s.floorId === floorId);
  return (
    <aside className="stage-ui noplan-card" aria-label={`${floor.name} rooms`}>
      <h2>{floor.name} has no reviewed plan</h2>
      <p>{floor.note ?? 'Nothing here has been measured yet.'} The model above shows the drawn floors only.</p>
      <ul className="noplan-rooms">
        {rooms.map((r) => {
          const c = roomContents(house, r.id);
          return (
            <li key={r.id}>
              <EntityLink id={r.id} sub={`${c.items.length} belongings, ${c.tasks.filter((t) => t.status !== 'done').length} upkeep, no shape`} />
            </li>
          );
        })}
        {rooms.length === 0 && <li className="empty">No rooms recorded on this floor.</li>}
      </ul>
    </aside>
  );
}

// On phones the key starts collapsed so the model keeps most of the screen.
const compactStage = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 759px)').matches === true;

function Legend() {
  const { state, dispatch, house } = useStore();
  const select = useSelect();
  const [open, setOpen] = useState(() => !compactStage());
  const un = unplaced(house);
  const o = state.overlay;
  let body: ReactNode = null;

  if (o === 'spaces') {
    const kinds = Array.from(new Set(house.spaces.filter((s) => s.floorId === state.floorId && s.shape).map((s) => s.kind)));
    body = (
      <>
        <ul className="legend-swatches">
          {kinds.map((k) => (
            <li key={k}>
              <span className="swatch" style={{ background: ROOM_TINT[k] }} aria-hidden="true" />
              {ROOM_KIND_LABEL[k]}
            </li>
          ))}
        </ul>
        <p className="legend-foot">Select a room to light it up. Storage furniture is shown as white blocks and is never treated as a room.</p>
      </>
    );
  } else if (o === 'belongings') {
    const placed = house.items.filter((i) => i.pos && !i.containerId).length;
    const inStorage = house.items.filter((i) => i.containerId).length;
    body = (
      <>
        <ul className="legend-stats">
          <li>
            <strong>{placed}</strong> placed on the plan
          </li>
          <li>
            <strong>{inStorage}</strong> inside storage, counted on the cupboard
          </li>
          <li>
            <strong>{un.roomOnlyItems.length}</strong> known by room only
          </li>
          <li>
            <strong>{un.noRoomItems.length}</strong> with no known location
          </li>
        </ul>
        <RingKey />
        <button type="button" className="text-btn" onClick={() => dispatch({ type: 'view', view: 'rooms' })}>
          See unplaced records
        </button>
      </>
    );
  } else if (o === 'electrical') {
    const circuits = house.circuits;
    body = (
      <>
        <ul className="legend-circuits">
          {circuits.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-pressed={state.focusCircuit === c.id}
                className="circuit-row"
                onClick={() => {
                  if (state.focusCircuit === c.id) dispatch({ type: 'focusCircuit', id: undefined });
                  else select(c.id, { keepOverlay: true });
                }}
              >
                <span className="swatch round" style={{ background: c.color }} aria-hidden="true" />
                <span className="circuit-ref">{c.ref}</span>
                <span className="circuit-label">{c.label}</span>
                <span className={`mini-claim claim-${c.claim}`}>{CLAIM_LABEL[c.claim]}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="legend-foot">Colours show circuit membership as documented. Cable routes are never drawn or guessed. Grey outlets have no documented circuit.</p>
      </>
    );
  } else if (o === 'water') {
    body = (
      <>
        <p className="legend-foot">Diamonds mark valves at their documented positions. Nothing here traces where water flows.</p>
        {un.valves.length > 0 && (
          <div className="legend-unplaced">
            <span>Not placed:</span>
            {un.valves.map((v) => (
              <EntityLink key={v.id} id={v.id} />
            ))}
          </div>
        )}
        <RingKey />
      </>
    );
  } else if (o === 'network') {
    body = (
      <>
        <p className="legend-foot">Where observed devices physically sit. Hollow markers were not in the latest export, which does not mean removed or switched off.</p>
        {un.devices.length > 0 && (
          <div className="legend-unplaced">
            <span>No location:</span>
            {un.devices.map((d) => (
              <EntityLink key={d.id} id={d.id} />
            ))}
          </div>
        )}
        <button type="button" className="text-btn" onClick={() => dispatch({ type: 'view', view: 'network' })}>
          Open logical topology
        </button>
      </>
    );
  } else if (o === 'upkeep') {
    const sched = house.tasks.filter((t) => t.status === 'scheduled');
    const counts = { overdue: 0, soon: 0, later: 0 };
    sched.forEach((t) => {
      const s = dueState(t, house.displayNow);
      if (s !== 'done') counts[s]++;
    });
    body = (
      <>
        <ul className="legend-stats">
          <li>
            <strong className="tone-alert">{counts.overdue}</strong> overdue
          </li>
          <li>
            <strong>{counts.soon}</strong> due in the next 14 days
          </li>
          <li>
            <strong>{counts.later}</strong> later
          </li>
        </ul>
        <button type="button" className="text-btn" onClick={() => dispatch({ type: 'view', view: 'upkeep' })}>
          Open upkeep list
        </button>
      </>
    );
  }

  return (
    <section className={`legend${open ? '' : ' is-closed'}`} style={{ '--layer': LAYER[o].color } as CSSProperties} aria-label={`${LAYER[o].label} key`}>
      <button type="button" className="legend-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="layer-swatch" aria-hidden="true" />
        <span>{LAYER[o].label}</span>
        <Icon name="chevronDown" size={16} className="legend-chevron" />
      </button>
      {open && <div className="legend-body">{body}</div>}
    </section>
  );
}

function RingKey() {
  return (
    <ul className="ring-key" aria-label="Marker rings">
      <li>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="5" fill="currentColor" />
        </svg>
        Confirmed
      </li>
      <li>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="5" fill="currentColor" />
          <circle cx="9" cy="9" r="7.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        Reported
      </li>
      <li>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="5" fill="currentColor" />
          <circle cx="9" cy="9" r="7.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.4 2" />
        </svg>
        Disputed or unknown
      </li>
    </ul>
  );
}
