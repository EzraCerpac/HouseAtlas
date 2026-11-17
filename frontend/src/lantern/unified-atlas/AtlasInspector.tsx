import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { TONE_COLOR } from '../canonical-ifc/tones';
import { displayLevelIds, hasExplodableLevels, type AtlasAction, type AtlasModel, type AtlasViewState } from './scene';
import type { AtlasLevel, AtlasOccurrence, AtlasRoom } from './types';
import { PublishedOverlayDetails } from './PublishedOverlayDetails';
import { atlasBuildingName, atlasExclusionText, atlasLevelName, atlasOccurrenceName, atlasScopedLevelName } from './labels';
import type { PropertyRecords, SourceFact } from './runtime-overlays';
import { edgeSpans, MEASURED_BASIS, MEASUREMENT_BASIS, roomArea } from './measurements';
import { AreaValue } from './plan-presentation';
import { elevation, LINK_LABEL, OVERLAY_ICON, OVERLAY_KINDS, OVERLAY_LABEL, plural, UNPLACED_LABEL } from './atlas-text';
import { DocumentaryRecords } from './AtlasKeys';
import type { ElectricalGroup } from './electrical-group';
import type { ElectricalTraceSource } from './electrical-trace';
import { ElectricalTraceDetail } from './ElectricalTraceDetail';
import type { NetworkCardContent } from './NetworkCard';
import type { TopologyFailure } from '../../api/topology-client';
import type { CacheStatus, Entry } from '../../app/types';
import { RecordStatus } from '../../app/components';
import { InlineTime } from '../components/ui';

/** What saved HomeBox information lists for a selected room's reviewed
 * HomeBox place, or why nothing is listed. */
export type RoomBelongingsState =
  | { readonly status: 'loading' | 'not-readable' | 'unlinked' | 'ambiguous' | 'absent' | 'archived-hidden' }
  | { readonly status: 'failed'; readonly reason: TopologyFailure }
  | { readonly status: 'linked'; readonly place: string; readonly innerPlaces: number;
    /** The linked place's own record; `placeFlagged` when it is archived,
     * confirmed deleted, unresolved or awaiting review. */
    readonly placeEntry: Entry; readonly placeFlagged: boolean;
    /** Present and active records first; `flagged` ones are archived,
     * confirmed deleted, unresolved or awaiting review, and say so. */
    readonly belongings: readonly { readonly id: string; readonly name: string; readonly detail: string; readonly entry: Entry; readonly flagged: boolean }[];
    /** The HomeBox copy's state and last successful update for the place's
     * collection, as Sources shows them; null when no cache is known to be it. */
    readonly cache: { readonly status: CacheStatus; readonly at: string | null } | null };
/** The live host's building records for a selected room. `request` starts
 * the one read when it has not run; `read` never starts one. */
export interface RoomBelongingsSource {
  readonly request: () => void; readonly retry: () => void; readonly open: (id: string) => void;
  readonly read: (atlasPlaceId: string) => RoomBelongingsState;
}

/** Floors listed for the current scope, highest first. */
export function listedLevels(model: AtlasModel, state: AtlasViewState): readonly AtlasLevel[] {
  return state.levelId !== null ? (state.view === 'plan' ? [state.levelId] : displayLevelIds(model, state.levelId)).map(id => model.levelsById.get(id)!)
    : model.scene.buildings.filter(row => state.buildingId === null || row.buildingId === state.buildingId)
      .flatMap(row => [...model.levelsByBuilding.get(row.buildingId)!].reverse());
}

/** Beside the stage when there is room; otherwise a sheet over the stage's
 * lower edge whose head (rooms or the selected room) stays in view. */
export function Inspector({ model, state, dispatch, context, network = null, openDocuments, openPlaces, belongings, renderFailure, runtime, runtimeReason, runtimeConfigured, open, setOpen, unnamed, shownLevel, electricalGroup, canElectricalGroup, onElectricalGroup, clearElectricalGroup, electricalData }: {
  readonly model: AtlasModel; readonly state: AtlasViewState; readonly dispatch: (action: AtlasAction) => void;
  readonly context: readonly string[];
  /** A device, link or room's devices chosen on the Network layer, shown in place of the room card. */
  readonly network?: (NetworkCardContent & { readonly close: () => void }) | null;
  readonly renderFailure: string | null;
  readonly runtime: PropertyRecords | null; readonly runtimeReason: string; readonly runtimeConfigured: boolean;
  readonly openDocuments: (() => void) | undefined;
  /** Opens the host's places lens; absent in a saved copy. */
  readonly openPlaces?: (() => void) | undefined;
  /** The live host's building records; absent in a saved copy, whose card lists none. */
  readonly belongings?: RoomBelongingsSource | undefined;
  readonly open: boolean; readonly setOpen: (open: boolean) => void;
  /** Rooms in view that the model or plan leaves unnamed because their names do not fit. */
  readonly unnamed?: ReadonlySet<string>;
  /** The one floor Plan draws of a whole building, else null. */
  readonly shownLevel: string | null;
  readonly electricalGroup: ElectricalGroup | null; readonly canElectricalGroup: (key: string) => boolean; readonly onElectricalGroup: (key: string) => void; readonly clearElectricalGroup: () => void;
  /** Reviewed breaker/panel data from the current frame owner; absent when none is supplied. */
  readonly electricalData: ElectricalTraceSource | undefined;
}) {
  const bodyId = useId();
  const occurrence = state.occurrenceId === null ? null : model.occurrencesById.get(state.occurrenceId)!;
  // A choice made inside the panel replaces its content, so focus follows to the new heading.
  const heading = useRef<HTMLHeadingElement>(null);
  const refocus = useRef(false);
  const choose = (occurrenceId: string | null) => { refocus.current = true; dispatch({ type: 'select', occurrenceId }); };
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false; heading.current?.focus();
  }, [state.occurrenceId]);
  // A network card replaced by another, or closed, takes focus left on the page to the new heading.
  const networkKey = network?.key ?? null, shownNetwork = useRef(networkKey);
  useLayoutEffect(() => {
    if (shownNetwork.current === networkKey) return;
    shownNetwork.current = networkKey;
    if (document.activeElement === document.body || document.activeElement === null) heading.current?.focus({ preventScroll: true });
  }, [networkKey]);
  // The chosen building is already named by the scope control.
  const levelName = (levelId: string) => atlasScopedLevelName(model, levelId, state.buildingId);
  // Where a press on the whole-head opener began, and whether it became a swipe.
  const press = useRef<{ y: number; swiped: boolean } | null>(null);
  // Shown only while the panel is a sheet. A whole-head opener spans the head
  // under its grabber: a tap opens or closes it, a swipe up opens and down closes.
  // The sheet's opener is where focus returns from a lens whose opener is no longer shown.
  const toggle = (noun: string, whole = false) => <button type="button" className={`ua-sheet-toggle${whole ? ' is-whole' : ''}`}
    aria-expanded={open} aria-controls={bodyId} data-lens-return=""
    onPointerDown={whole ? event => { event.currentTarget.setPointerCapture(event.pointerId); press.current = { y: event.clientY, swiped: false }; } : undefined}
    onPointerUp={whole ? event => {
      const dy = press.current ? event.clientY - press.current.y : 0;
      if (press.current && Math.abs(dy) >= 24) { press.current.swiped = true; setOpen(dy < 0); }
    } : undefined}
    onClick={() => {
      const swiped = press.current?.swiped ?? false;
      press.current = null;
      if (!swiped) setOpen(!open);
    }}><Icon name="chevronDown" size={18} /><span>{open ? `Hide ${noun}` : `Show ${noun}`}</span></button>;
  const kinds = OVERLAY_KINDS.filter(kind => state.layers[kind]);

  if (network) return <aside className={`ua-inspector is-room is-network${open ? ' is-open' : ''}`} aria-label={network.label}>
    <div className="ua-sheet-head">
      <div className="ua-sheet-title">
        <h2 ref={heading} tabIndex={-1}>{network.title}</h2>
        <p className="ua-room-floor">{network.sub}</p>
      </div>
      {toggle('details')}
      <button type="button" className="ctrl-btn" aria-label="Close network card" onClick={network.close}><Icon name="close" size={17} /></button>
    </div>
    <div className="ua-sheet-body" id={bodyId} key={network.key}>{network.body}</div>
  </aside>;

  if (!occurrence) {
    const listed = listedLevels(model, state);
    const count = listed.reduce((sum, level) => sum + level.occurrenceIds.filter(key => model.selectable.has(key)).length, 0);
    // Plan of a whole building draws one floor: its rooms come first, the other floors follow.
    const shown = shownLevel !== null && listed.length > 1 && listed.some(level => level.levelId === shownLevel) ? shownLevel : null;
    const levels = shown === null ? listed : [...listed.filter(level => level.levelId === shown), ...listed.filter(level => level.levelId !== shown)];
    return <aside className={`ua-inspector${open ? ' is-open' : ''}`} aria-label="Rooms">
      <div className="ua-sheet-head">
        <div className="ua-sheet-title">
          <h2 ref={heading} tabIndex={-1}>Rooms</h2>
          {/* Plan draws one floor: its own count leads; the list below still holds every floor. */}
          <p className="ua-sheet-sub"><span>{shown !== null
            ? `${levelName(shown)} · ${plural(model.levelsById.get(shown)!.occurrenceIds.filter(key => model.selectable.has(key)).length, 'room')}`
            : `${plural(count, 'room')}${levels.length === 1 ? `, ${levelName(levels[0]!.levelId)}` : ` on ${plural(levels.length, 'floor')}`}`}</span></p>
        </div>
        {toggle('rooms', true)}
      </div>
      <div className="ua-sheet-body" id={bodyId}>
        {/* Stacked under its roof veil, a building's model names its top floor's rooms only. */}
        {state.view === '3d' && !state.exploded && state.levelId === null && state.buildingId !== null && hasExplodableLevels(model, state.buildingId)
          && <p className="ua-coverage ua-stacked-note">Floors stacked: only top-floor rooms are named on the model. Spread floors shows each floor separately; every room is listed here.</p>}
        {/* Choosing from the list hands the stage back to the model. Names that would not
            fit (on touch, without a full target) are left off the model and marked here. */}
        <RoomList model={model} levels={levels} shownLevel={shown} choose={key => { setOpen(false); choose(key); }} buildingId={state.buildingId}
          unnamed={unnamed} unnamedOn={state.view === 'plan' ? 'plan' : 'model'} />
        {openPlaces && <button type="button" className="text-btn ua-place-records" data-lens-return="" onClick={openPlaces}>
          <Icon name="rooms" size={16} />Place records</button>}
        <SourceDetails model={model} renderFailure={renderFailure} overlayReason={runtimeReason} runtimeSource={runtime?.sourceFacts ?? []} />
      </div>
    </aside>;
  }

  const room = model.roomsById.get(occurrence.roomId)!;
  const basis = occurrence.geometryBasis;
  const area = state.layers.measurements ? roomArea(model, occurrence.spaceOccurrenceId) : null;
  const spans = state.layers.measurements ? edgeSpans(model, occurrence.spaceOccurrenceId) : [];
  const overlays = OVERLAY_KINDS.map(kind => {
    const index = model.overlays.get(kind)!;
    return { kind, placement: index.placed.get(occurrence.spaceOccurrenceId) ?? null,
      unplaced: index.unplaced.filter(row => row.binding.roomId === room.roomId
        && (row.binding.spaceOccurrenceId === null || row.binding.spaceOccurrenceId === occurrence.spaceOccurrenceId)) };
  }).filter(row => !runtimeConfigured && (row.placement || row.unplaced.length > 0));
  return <aside className={`ua-inspector is-room${open ? ' is-open' : ''}`} aria-label="Selected room">
    <div className="ua-sheet-head">
      <div className="ua-sheet-title">
        <h2 ref={heading} tabIndex={-1}>{room.label}</h2>
        <p className="ua-room-floor">{levelName(occurrence.levelId)}</p>
      </div>
      {toggle('details')}
      <button type="button" className="ctrl-btn" aria-label="Clear room" onClick={() => choose(null)}><Icon name="close" size={17} /></button>
    </div>
    {/* Keyed by room part: the new room's facts settle in. */}
    <div className="ua-sheet-body" id={bodyId} key={occurrence.spaceOccurrenceId}>
      {context.length > 0 && <div className="ua-also" role="group" aria-label="Also on">
        <span>Also on</span>
        {context.map(key => <button key={key} type="button" className="chip-btn" onClick={() => choose(key)}>
          {levelName(model.occurrencesById.get(key)!.levelId)}</button>)}
      </div>}

      {/* The room's standing facts: one line of labelled chips under the head. */}
      <dl className="ua-facts ua-room-facts">
        <div><dt>Layout</dt><dd>{basis.kind === 'owner-estimated-pick-proxy' ? 'Estimated layout' : 'From the model'}</dd></div>
        <div><dt>Home place</dt><dd className={`ua-link is-${room.nativeBinding.status}`}>{runtime?.rooms.has(room.roomId) ? 'Linked for these sources' : room.nativeBinding.status === 'historical' ? 'Link needs review' : LINK_LABEL[room.nativeBinding.status]}</dd></div>
        {state.layers.measurements && <div><dt>Area</dt><dd><AreaValue geometryBasis={basis} area={area} />
          {area?.measured && <span className="ua-measured">Measured</span>}</dd></div>}
      </dl>

      {(runtime || runtimeConfigured) && <RoomContentsSummary runtime={runtime} reason={runtimeReason} roomId={room.roomId} layers={state.layers} />}

      <RoomBelongings room={room} source={belongings} />

      {/* Open while Measurements is on; it folds away when a long list of
          spans would push the records down. */}
      {spans.length > 0 && <section aria-label="Model outline dimensions" className="ua-records ua-spans-section">
        <details className="ua-spans" open>
          <summary><Icon name="ruler" size={16} className="ua-spans-glyph" />
            <span className="ua-spans-title">Outline spans{area?.partial ? ' for this room part' : ''}</span></summary>
          <p>{area?.measured || spans.some(span => span.measured) ? MEASURED_BASIS : MEASUREMENT_BASIS}</p>
          <dl className="ua-facts">{spans.map((span, at) =>
            <div key={span.key}><dt>Outline span {at + 1}</dt><dd>{span.text}
              {span.measured && <span className="ua-measured">Measured</span>}</dd></div>)}</dl>
        </details>
      </section>}

      {/* One group per layer that is on: its glyph, name and how many records
          this room's source supplies, the source state before the rows, then
          the records in source order. */}
      {electricalGroup && <section className="ua-records" aria-label="Historic drawing group">
        <h3>Historic drawing group, unverified</h3><p>{electricalGroup.label}</p>
        <ul>{electricalGroup.members.map(({ record, rooms }) => <li key={record.key}>{record.label}{rooms.length === 0 ? ' — room unknown' : ` — ${rooms.map(id => model.roomsById.get(id)?.label ?? 'Room unavailable').join(', ')}`}</li>)}</ul>
        {electricalGroup.missing > 0 && <p>{electricalGroup.missing} group members unavailable.</p>}
        {electricalData && <ElectricalTraceDetail group={electricalGroup} source={electricalData} model={model}
          onRoom={roomId => { const id = model.roomsById.get(roomId)?.occurrenceIds.find(at => model.selectable.has(at)); if (id) choose(id); }} />}
        <button type="button" className="text-btn" onClick={clearElectricalGroup}>Clear drawing group</button>
      </section>}
      {runtime && kinds.map(kind => {
        const records = runtime.rooms.has(room.roomId) && runtime[kind] !== 'unavailable' ? runtime.rooms.get(room.roomId)![kind] : null;
        return <section key={kind} className="ua-records" aria-label={`${OVERLAY_LABEL[kind]} in this room`}>
          <h3 className="ua-records-head"><Icon name={OVERLAY_ICON[kind]} size={16} />{OVERLAY_LABEL[kind]}
            {records && records.length > 0 && <span className="ua-records-count">{plural(records.length, 'record')}</span>}</h3>
          {runtime[kind] === 'partial' && <p className="ua-records-state">{kind === 'electrical' ? 'Some electrical sources or buildings are unavailable.' : 'The network source is unavailable for some buildings.'}</p>}
          {!runtime.rooms.has(room.roomId) ? <p className="ua-records-state">Room source link unavailable.</p>
            : runtime[kind] === 'unavailable' ? <p className="ua-records-state">Source unavailable.</p>
            : <DocumentaryRecords records={records!} openDocuments={openDocuments} onElectricalGroup={kind === 'electrical' ? onElectricalGroup : undefined} canElectricalGroup={canElectricalGroup} />}
        </section>;
      })}

      {overlays.length > 0 && <section className="ua-records" aria-label="Records in this room">
        {overlays.map(({ kind, placement, unplaced }) => <div key={kind} className="ua-record" style={{ '--layer': TONE_COLOR[kind] } as CSSProperties}>
          <h3><Icon name={OVERLAY_ICON[kind]} size={16} />{OVERLAY_LABEL[kind]}</h3>
          {placement && <PublishedOverlayDetails placement={placement} />}
          {unplaced.length > 0 && <p className="ua-unplaced">
            {plural(new Set(unplaced.flatMap(row => row.binding.recordIds)).size, 'record')} not placed: {[...new Set(unplaced.map(row => UNPLACED_LABEL[row.reason]))].join('; ')}.</p>}
        </div>)}
      </section>}
      <SourceDetails model={model} occurrence={occurrence} room={room} renderFailure={renderFailure} overlayReason={runtimeReason} runtimeSource={runtime?.sourceFacts ?? []} />
    </div>
  </aside>;
}

/** What the loaded sources hold for this room, one line per layer: the
 * supplied list's length and the source's own state, or why there is none.
 * A layer that is off still lists what is already loaded, marked off; nothing
 * here toggles a layer, fetches or counts beyond the supplied list. Before
 * anything is loaded (no layer on yet) or while it loads, one quiet line says
 * so, never that the room is empty. */
function RoomContentsSummary({ runtime, reason, roomId, layers }: {
  readonly runtime: PropertyRecords | null; readonly reason: string; readonly roomId: string; readonly layers: AtlasViewState['layers'];
}) {
  if (!runtime && (reason === 'not-loaded' || reason === 'loading')) return <p className="ua-contents-pending">
    {reason === 'loading' ? 'Electrical and network records for this room are loading.' : 'Electrical and network records are not loaded while their layers are off.'}</p>;
  const linked = runtime?.rooms.get(roomId);
  return <section className="ua-contents" aria-label="In this room">
    <h3 className="ua-contents-title">In this room</h3>
    <ul>{OVERLAY_KINDS.map(kind => {
      const records = runtime && linked && runtime[kind] !== 'unavailable' ? linked[kind] : null;
      const source = !runtime ? 'Source unavailable' : !linked ? 'Room source link unavailable' : runtime[kind] === 'unavailable' ? 'Source unavailable'
        : runtime[kind] === 'partial' ? 'Partial source' : null;
      return <li key={kind} className={`ua-contents-row${layers[kind] ? '' : ' is-off'}${source ? ' is-qualified' : ''}`}>
        <Icon name={OVERLAY_ICON[kind]} size={16} />
        <span className="ua-contents-name">{OVERLAY_LABEL[kind]}</span>
        {records && <span className="ua-contents-count">{plural(records.length, 'record')}</span>}
        {source && <span className="ua-contents-state">{source}</span>}
        {!layers[kind] && <span className="ua-contents-off">Layer off</span>}
      </li>;
    })}</ul>
  </section>;
}

const BELONGINGS_SHOWN = 5;
const RETRY: ReadonlySet<TopologyFailure> = new Set(['unavailable', 'timedOut', 'continuationUnavailable', 'changed']);
const FAILURE: Partial<Record<TopologyFailure, string>> = { denied: 'Access to building records is denied',
  expired: 'The session for this read has expired', tooLarge: 'Building records exceed this list’s read limit',
  timedOut: 'Building records could not be loaded within the read deadline' };
/** Belongings HomeBox records directly in the room's HomeBox place, reached
 * only through the room's reviewed Atlas place and that place's reviewed
 * HomeBox binding. A read-only projection of HomeBox; it never places a
 * belonging in the drawn room. */
function RoomBelongings({ room, source }: { readonly room: AtlasRoom; readonly source: RoomBelongingsSource | undefined }) {
  const placeId = room.nativeBinding.status === 'reviewed' ? room.nativePlaceId : null;
  const request = source?.request;
  useEffect(() => { if (placeId !== null) request?.(); }, [placeId, request]);
  const [all, setAll] = useState(false), [retrying, setRetrying] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), list = useRef<HTMLUListElement>(null), headingId = useId();
  const state: RoomBelongingsState = !source ? { status: 'not-readable' } : placeId === null ? { status: 'unlinked' } : source.read(placeId);
  const canRetryNow = state.status === 'failed' && RETRY.has(state.reason);
  // A retry stays mounted until its read settles; whenever the settled state
  // removes it (success or a failure that offers no retry), focus left on the
  // page body goes to the card heading.
  useEffect(() => {
    if (!retrying || state.status === 'loading') return;
    setRetrying(false);
    if (!canRetryNow && document.activeElement === document.body) heading.current?.focus();
  }, [retrying, state.status, canRetryNow]);
  const unknown = "so this room's HomeBox place is not known.";
  const text = state.status === 'loading' ? "Loading building records for this room's HomeBox place…"
    : state.status === 'not-readable' ? source ? `Building records cannot be read here, ${unknown}` : 'Belongings are listed only in the live app, not in a saved copy.'
    : state.status === 'failed' ? `${FAILURE[state.reason] ?? 'Building records could not be loaded'}, ${unknown}`
    : state.status === 'unlinked' ? 'No reviewed HomeBox place link for this room.'
    : state.status === 'ambiguous' ? 'Reviewed links name more than one HomeBox place for this room, so none is listed.'
    : state.status === 'absent' ? 'The linked HomeBox place is not in saved HomeBox information.'
    : state.status === 'archived-hidden' ? 'The linked HomeBox place is archived. Include archived records to list its belongings.'
    : state.status === 'linked' && state.belongings.length === 0 ? 'None listed in saved HomeBox information.' : null;
  const canRetry = canRetryNow || (retrying && state.status === 'loading');
  const shown = state.status === 'linked' ? all ? state.belongings : state.belongings.slice(0, BELONGINGS_SHOWN) : [];
  const flagged = state.status === 'linked' ? state.belongings.filter(row => row.flagged).length : 0;
  return <section className="ua-contents ua-belongings" aria-labelledby={headingId}>
    <h3 className="ua-contents-title" id={headingId} ref={heading} tabIndex={-1}>Belongings</h3>
    {state.status === 'linked' && <p className="ua-belongings-scope">Recorded directly in HomeBox place {state.place}
      {flagged > 0 && `; ${flagged === state.belongings.length ? flagged === 1 ? 'the only belonging is' : `all ${flagged} are` : `${flagged} of ${state.belongings.length} ${flagged === 1 ? 'is' : 'are'}`} archived, deleted, unresolved or awaiting review`}
      {state.innerPlaces > 0 && `; belongings in its ${plural(state.innerPlaces, 'inner place')} are not listed`}</p>}
    {/* The linked place's own HomeBox state, as other record views show it. */}
    {state.status === 'linked' && state.placeFlagged && <div className="ua-belonging-state"><RecordStatus entry={state.placeEntry} compact /></div>}
    {text && <p className="ua-contents-pending" role={state.status === 'loading' || state.status === 'failed' ? 'status' : undefined}>{text}</p>}
    {canRetry && <button type="button" className="text-btn ua-belongings-more" aria-disabled={state.status === 'loading' || undefined}
      onClick={() => { if (state.status === 'loading') return; setRetrying(true); source?.retry(); }}>Retry</button>}
    {shown.length > 0 && <ul ref={list}>{shown.map(row => <li key={row.id}>
      <button type="button" className="ua-belonging" onClick={() => source?.open(row.id)}>
        <Icon name="box" size={15} /><span><span className="ua-belonging-name">{row.name}</span>
          {row.detail && <span className="ua-belonging-detail">{row.detail}</span>}
          {row.flagged && <span className="ua-belonging-state"><RecordStatus entry={row.entry} compact /></span>}</span></button></li>)}</ul>}
    {state.status === 'linked' && state.belongings.length > shown.length && <button type="button" className="text-btn ua-belongings-more"
      onClick={() => { setAll(true); requestAnimationFrame(() => list.current?.querySelectorAll('button')[BELONGINGS_SHOWN]?.focus()); }}>
      Show all {state.belongings.length.toLocaleString()}{flagged > 0 && `, ${flagged.toLocaleString()} flagged`}</button>}
    {state.status === 'linked' && <p className="ua-belongings-source">Read-only from HomeBox · {state.cache
      ? <>{state.cache.status.replace(/-/g, ' ')}, last successful update {state.cache.at ? <InlineTime value={state.cache.at} /> : 'unknown'}</>
      : 'update state for this collection not supplied'}</p>}
  </section>;
}

/** Floor headings drop the chosen building's name; each region keeps it. */
export function RoomList({ model, levels, choose, buildingId, shownLevel = null, nested = false, unnamed, unnamedOn = 'model' }: {
  readonly model: AtlasModel; readonly levels: readonly AtlasLevel[]; readonly choose: (occurrenceId: string) => void;
  readonly buildingId: string | null;
  /** Under its own section heading (the lens's Model rooms), floors head one level down. */
  readonly nested?: boolean;
  /** The floor Plan draws, listed first and marked; the floors after it are not drawn. */
  readonly shownLevel?: string | null;
  /** Rooms whose names do not fit on the stage now, marked on their rows. */
  readonly unnamed?: ReadonlySet<string> | undefined;
  readonly unnamedOn?: 'model' | 'plan';
}) {
  const coverage = model.scene.coverage, Floor = nested ? 'h4' : 'h3';
  return <div className="ua-rooms">
    {levels.map((level, at) => {
      const keys = level.occurrenceIds.filter(key => model.selectable.has(key));
      const other = shownLevel !== null && level.levelId !== shownLevel;
      return <section key={level.levelId} className={other ? 'is-other' : undefined}
        aria-label={`${atlasLevelName(model, level.levelId, model.floorBuildings.length > 1)}${shownLevel === null ? '' : other ? ', plan not shown' : ', plan shown'}`}>
        {other && at === levels.findIndex(row => row.levelId !== shownLevel) && <p className="ua-rooms-other" aria-hidden="true">Not in this plan</p>}
        <Floor>{atlasScopedLevelName(model, level.levelId, buildingId)}</Floor>
        {keys.length === 0 ? <p className="ua-empty">No selectable rooms.</p>
          : <ul>{keys.map(key => {
            const occurrence = model.occurrencesById.get(key)!;
            return <li key={key}><button type="button" className="ua-room-btn" onClick={() => choose(key)}>
              <span>{atlasOccurrenceName(model, key)}</span>
              {(unnamed?.has(key) || occurrence.geometryBasis.kind === 'owner-estimated-pick-proxy') && <span className="ua-room-tags">
                {unnamed?.has(key) && <span className="ua-tag is-quiet">Not named on {unnamedOn}</span>}
                {occurrence.geometryBasis.kind === 'owner-estimated-pick-proxy' && <span className="ua-tag">Preliminary</span>}
              </span>}
            </button></li>;
          })}</ul>}
      </section>;
    })}
    {coverage.unselectableCount > 0 && <p className="ua-coverage">{coverage.unselectable?.every(id => model.occurrencesById.has(id))
      ? `Not selectable in this model: ${coverage.unselectable.map(id => `${atlasOccurrenceName(model, id)} (${atlasLevelName(model, model.occurrencesById.get(id)!.levelId, model.floorBuildings.length > 1)})`).join('; ')}.`
      : `${plural(coverage.unselectableCount, 'room part')} in this model cannot be selected.`}</p>}
  </div>;
}

function SourceDetails({ model, occurrence, room, renderFailure, overlayReason, runtimeSource }: {
  readonly model: AtlasModel; readonly occurrence?: AtlasOccurrence; readonly room?: AtlasRoom; readonly renderFailure: string | null;
  readonly overlayReason: string;
  readonly runtimeSource?: readonly SourceFact[];
}) {
  const { publication, coverage } = model.scene;
  const elevations = model.scene.levels.filter(level => level.elevationBasis !== null || level.sourceElevationM !== null);
  // Logical rooms the publication keeps without any occurrence: placement unknown, not selectable.
  const unpositioned = model.scene.rooms.filter(row => row.occurrenceIds.length === 0);
  return <details className="ua-source">
    <summary>Source</summary>
    <dl>
      <div><dt>Model revision</dt><dd>{publication.sourceRevisionId}</dd></div>
      <div><dt>Model file</dt><dd>{(model.scene.model.bytes / 1_048_576).toFixed(1)} MiB, SHA-256 <code className="ua-hash">{model.scene.model.sha256}</code></dd></div>
      {renderFailure && <div><dt>3D diagnostic</dt><dd>{renderFailure}</dd></div>}
      {overlayReason !== 'not-loaded' && <div><dt>Overlay source</dt><dd>{overlayReason}</dd></div>}
      {runtimeSource?.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value ?? 'unknown'}</dd></div>)}
      {occurrence && <div><dt>Room layout</dt><dd>{occurrence.geometryBasis.kind === 'owner-estimated-pick-proxy' ? 'Estimated pick area; not measured or reviewed.' : 'Source model geometry.'}
        {occurrence.geometryBasis.note && <span className="ua-note">{occurrence.geometryBasis.note}</span>}</dd></div>}
      {occurrence?.geometryBasis.sourceRef && <div><dt>Room source</dt><dd>{occurrence.geometryBasis.sourceRef}</dd></div>}
      {room && <div><dt>Place link</dt><dd>{LINK_LABEL[room.nativeBinding.status]}</dd></div>}
      <div><dt>Position</dt><dd>Model frame only. Not aligned to the physical site.</dd></div>
      {elevations.length > 0 && <div><dt>Source elevations</dt><dd><ul>{elevations.map(level => <li key={level.levelId}>{atlasLevelName(model, level.levelId, model.scene.buildings.length > 1)}: {level.sourceElevationM !== null ? `${elevation(level.sourceElevationM)}; ` : ''}{level.elevationBasis ?? 'Datum not specified.'} <code>{level.levelId}</code></li>)}</ul></dd></div>}
      {coverage.exclusions.length > 0 && <div><dt>Not selectable</dt><dd><ul>
        {coverage.exclusions.map((row, at) => <li key={at}>{atlasExclusionText(model, row)}</li>)}
      </ul></dd></div>}
      {unpositioned.length > 0 && <div><dt>No model position</dt><dd><ul>
        {unpositioned.map(row => <li key={row.roomId}>{row.label}, {atlasBuildingName(model, row.buildingId)}</li>)}
      </ul></dd></div>}
    </dl>
  </details>;
}
