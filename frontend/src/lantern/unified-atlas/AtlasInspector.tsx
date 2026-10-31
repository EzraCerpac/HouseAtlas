import { useEffect, useId, useRef, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { TONE_COLOR } from '../canonical-ifc/tones';
import { displayLevelIds, type AtlasAction, type AtlasModel, type AtlasViewState } from './scene';
import type { AtlasLevel, AtlasOccurrence, AtlasRoom } from './types';
import { PublishedOverlayDetails } from './PublishedOverlayDetails';
import { atlasBuildingName, atlasExclusionText, atlasLevelName, atlasOccurrenceName } from './labels';
import type { PropertyRecords, SourceFact } from './runtime-overlays';
import { edgeSpans, MEASURED_BASIS, MEASUREMENT_BASIS, roomArea } from './measurements';
import { AreaValue } from './plan-presentation';
import { elevation, LINK_LABEL, OVERLAY_ICON, OVERLAY_KINDS, OVERLAY_LABEL, plural, UNPLACED_LABEL } from './atlas-text';
import { DocumentaryRecords } from './AtlasKeys';

/** Floors listed for the current scope, highest first. */
export function listedLevels(model: AtlasModel, state: AtlasViewState): readonly AtlasLevel[] {
  return state.levelId !== null ? (state.view === 'plan' ? [state.levelId] : displayLevelIds(model, state.levelId)).map(id => model.levelsById.get(id)!)
    : model.scene.buildings.filter(row => state.buildingId === null || row.buildingId === state.buildingId)
      .flatMap(row => [...model.levelsByBuilding.get(row.buildingId)!].reverse());
}

/** Beside the stage when there is room; otherwise a sheet over the stage's
 * lower edge whose head (rooms or the selected room) stays in view. */
export function Inspector({ model, state, dispatch, context, openNetwork, openDocuments, renderFailure, runtime, runtimeReason, runtimeConfigured, open, setOpen }: {
  readonly model: AtlasModel; readonly state: AtlasViewState; readonly dispatch: (action: AtlasAction) => void;
  readonly context: readonly string[]; readonly openNetwork: (() => void) | undefined;
  readonly renderFailure: string | null;
  readonly runtime: PropertyRecords | null; readonly runtimeReason: string; readonly runtimeConfigured: boolean;
  readonly openDocuments: (() => void) | undefined;
  readonly open: boolean; readonly setOpen: (open: boolean) => void;
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
  const levelName = (levelId: string) => {
    return atlasLevelName(model, levelId, model.floorBuildings.length > 1);
  };
  // Where a press on the whole-head opener began, and whether it became a swipe.
  const press = useRef<{ y: number; swiped: boolean } | null>(null);
  // Shown only while the panel is a sheet. A whole-head opener spans the head
  // under its grabber: a tap opens or closes it, a swipe up opens and down closes.
  const toggle = (noun: string, whole = false) => <button type="button" className={`ua-sheet-toggle${whole ? ' is-whole' : ''}`}
    aria-expanded={open} aria-controls={bodyId}
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

  if (!occurrence) {
    const levels = listedLevels(model, state);
    const count = levels.reduce((sum, level) => sum + level.occurrenceIds.filter(key => model.selectable.has(key)).length, 0);
    return <aside className={`ua-inspector${open ? ' is-open' : ''}`} aria-label="Rooms">
      <div className="ua-sheet-head">
        <div className="ua-sheet-title">
          <h2 ref={heading} tabIndex={-1}>Rooms</h2>
          <p className="ua-sheet-sub">{plural(count, 'room')}{levels.length === 1 ? `, ${levelName(levels[0]!.levelId)}` : ` on ${plural(levels.length, 'floor')}`}</p>
        </div>
        {toggle('rooms', true)}
      </div>
      <div className="ua-sheet-body" id={bodyId}>
        {/* Choosing from the list hands the stage back to the model. */}
        <RoomList model={model} levels={levels} choose={key => { setOpen(false); choose(key); }} levelName={levelName} />
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

      {runtime && <RoomContentsSummary runtime={runtime} roomId={room.roomId} layers={state.layers} />}

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
      {runtime && kinds.map(kind => {
        const records = runtime.rooms.has(room.roomId) && runtime[kind] !== 'unavailable' ? runtime.rooms.get(room.roomId)![kind] : null;
        return <section key={kind} className="ua-records" aria-label={`${OVERLAY_LABEL[kind]} in this room`}>
          <h3 className="ua-records-head"><Icon name={OVERLAY_ICON[kind]} size={16} />{OVERLAY_LABEL[kind]}
            {records && records.length > 0 && <span className="ua-records-count">{plural(records.length, 'record')}</span>}</h3>
          {runtime[kind] === 'partial' && <p className="ua-records-state">{kind === 'electrical' ? 'Some electrical sources or buildings are unavailable.' : 'The network source is unavailable for some buildings.'}</p>}
          {!runtime.rooms.has(room.roomId) ? <p className="ua-records-state">Room source link unavailable.</p>
            : runtime[kind] === 'unavailable' ? <p className="ua-records-state">Source unavailable.</p>
            : <DocumentaryRecords records={records!} openDocuments={openDocuments} />}
        </section>;
      })}

      {overlays.length > 0 && <section className="ua-records" aria-label="Records in this room">
        {overlays.map(({ kind, placement, unplaced }) => <div key={kind} className="ua-record" style={{ '--layer': TONE_COLOR[kind] } as CSSProperties}>
          <h3><Icon name={OVERLAY_ICON[kind]} size={16} />{OVERLAY_LABEL[kind]}</h3>
          {placement && <PublishedOverlayDetails placement={placement} />}
          {unplaced.length > 0 && <p className="ua-unplaced">
            {plural(new Set(unplaced.flatMap(row => row.binding.recordIds)).size, 'record')} not placed: {[...new Set(unplaced.map(row => UNPLACED_LABEL[row.reason]))].join('; ')}.</p>}
          {kind === 'network' && openNetwork && <button type="button" className="text-btn" onClick={openNetwork}>Open Network</button>}
        </div>)}
      </section>}
      <SourceDetails model={model} occurrence={occurrence} room={room} renderFailure={renderFailure} overlayReason={runtimeReason} runtimeSource={runtime?.sourceFacts ?? []} />
    </div>
  </aside>;
}

/** What the loaded sources hold for this room, one line per layer: the
 * supplied list's length and the source's own state, or why there is none.
 * A layer that is off still lists what is already loaded, marked off; nothing
 * here toggles a layer, fetches or counts beyond the supplied list. */
function RoomContentsSummary({ runtime, roomId, layers }: {
  readonly runtime: PropertyRecords; readonly roomId: string; readonly layers: AtlasViewState['layers'];
}) {
  const linked = runtime.rooms.get(roomId);
  return <section className="ua-contents" aria-label="In this room">
    <h3 className="ua-contents-title">In this room</h3>
    <ul>{OVERLAY_KINDS.map(kind => {
      const records = linked && runtime[kind] !== 'unavailable' ? linked[kind] : null;
      const source = !linked ? 'Room source link unavailable' : runtime[kind] === 'unavailable' ? 'Source unavailable'
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

export function RoomList({ model, levels, choose, levelName }: {
  readonly model: AtlasModel; readonly levels: readonly AtlasLevel[]; readonly choose: (occurrenceId: string) => void;
  readonly levelName: (levelId: string) => string;
}) {
  const coverage = model.scene.coverage;
  return <div className="ua-rooms">
    {levels.map(level => {
      const keys = level.occurrenceIds.filter(key => model.selectable.has(key));
      return <section key={level.levelId} aria-label={levelName(level.levelId)}>
        <h3>{levelName(level.levelId)}</h3>
        {keys.length === 0 ? <p className="ua-empty">No selectable rooms.</p>
          : <ul>{keys.map(key => {
            const occurrence = model.occurrencesById.get(key)!;
            return <li key={key}><button type="button" className="ua-room-btn" onClick={() => choose(key)}>
              <span>{atlasOccurrenceName(model, key)}</span>
              {occurrence.geometryBasis.kind === 'owner-estimated-pick-proxy' && <span className="ua-tag">Preliminary</span>}
            </button></li>;
          })}</ul>}
      </section>;
    })}
    {coverage.unselectableCount > 0 && <p className="ua-coverage">{plural(coverage.unselectableCount, 'room part')} in this model cannot be selected yet.</p>}
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
