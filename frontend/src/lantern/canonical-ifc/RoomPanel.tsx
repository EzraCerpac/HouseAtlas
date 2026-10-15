import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { fmtDate, fmtDateTime } from '../data/time';
import { isDuplicateLabel, shortId } from './model';
import type { AdmittedPresentation, SpaceOccurrence } from './model';
import type { OverlayJoin } from './overlays';
import type { RestoreNotice, ViewerAction, ViewerState } from './selection';
import { TONE_COLOR, badgeFill } from './tones';

interface Props {
  readonly model: AdmittedPresentation;
  readonly state: ViewerState;
  readonly dispatch: (action: ViewerAction) => void;
  readonly overlay: OverlayJoin | null;
  readonly notice: RestoreNotice | null;
  readonly onDismissNotice: () => void;
  readonly onReturnToModel: () => void;
}

const short = (id: string) => id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
const unknown = (value: string | null, format: (value: string) => string = v => v) => value === null ? 'Unknown' : format(value);
const FRESHNESS = { current: 'Current', stale: 'Stale', unknown: 'Freshness unknown' } as const;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function RoomPanel({ model, state, dispatch, overlay, notice, onDismissNotice, onReturnToModel }: Props) {
  const list = useRef<HTMLDivElement>(null), focusHeading = useRef<HTMLHeadingElement>(null), panelHeading = useRef<HTMLHeadingElement>(null);
  // Controls that remove themselves hand focus to a heading that persists.
  const keepFocus = (target: HTMLHeadingElement | null, action: () => void) => { target?.focus(); action(); };
  const { source } = model;
  const selected = state.occurrenceId !== null ? model.occurrences.get(state.occurrenceId) ?? null : null;
  const floor = state.floorId !== null ? model.floorsById.get(state.floorId) : undefined;
  const floorLabel = (id: string | null) => id === null ? 'Floor unknown' : model.floorsById.get(id)?.label ?? 'Floor unknown';
  const select = (occurrenceId: string | null) => dispatch({ type: 'selectOccurrence', occurrenceId });

  // Keep the selected row visible inside the panel's own scroller only; the page never scrolls.
  useEffect(() => {
    const scroller = list.current?.closest<HTMLElement>('.cifc-panel'); if (!scroller || state.occurrenceId === null) return;
    if (scroller.scrollHeight <= scroller.clientHeight + 1) return;
    const button = [...scroller.querySelectorAll<HTMLElement>('[data-occurrence]')].find(node => node.dataset.occurrence === state.occurrenceId);
    if (!button) return;
    const box = button.getBoundingClientRect(), view = scroller.getBoundingClientRect();
    if (box.top < view.top + 8) scroller.scrollTop -= view.top + 8 - box.top;
    else if (box.bottom > view.bottom - 8) scroller.scrollTop += box.bottom - view.bottom + 8;
  }, [state.occurrenceId]);

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button[data-occurrence]') ?? [])];
    const index = buttons.indexOf(event.currentTarget);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1);
    const target = buttons[Math.max(0, Math.min(buttons.length - 1, next))];
    if (target) { event.preventDefault(); target.focus(); }
  };

  const countFill = overlay ? badgeFill(overlay.layer.tone) : undefined;
  const occurrenceButton = (occurrence: SpaceOccurrence) => {
    const target = model.occurrences.get(occurrence.spaceOccurrenceId)!, room = target.room;
    const records = overlay?.byRoom.get(room.roomId)?.length ?? 0;
    const others = room.occurrences.filter(row => row.spaceOccurrenceId !== occurrence.spaceOccurrenceId).map(row => floorLabel(row.floorId));
    const hasShape = model.planShapes.has(occurrence.spaceOccurrenceId);
    const tags = [!hasShape && 'No plan shape', hasShape && !model.occurrenceMeshes.has(occurrence.spaceOccurrenceId) && 'Plan only',
      others.length > 0 && `Also on ${others.join(', ')}`].filter(Boolean);
    const isContext = selected !== null && selected.room.roomId === room.roomId && selected.occurrence !== occurrence;
    return <li key={occurrence.spaceOccurrenceId}>
      <button type="button" className={`cifc-room-btn${isContext ? ' is-context' : ''}`} data-occurrence={occurrence.spaceOccurrenceId}
        aria-pressed={occurrence.spaceOccurrenceId === state.occurrenceId} onKeyDown={moveFocus}
        onClick={() => select(occurrence.spaceOccurrenceId === state.occurrenceId ? null : occurrence.spaceOccurrenceId)}>
        <span className="cifc-room-name">{room.label}{isDuplicateLabel(model, room) && <span className="cifc-room-id"> {shortId(room.roomId)}</span>}</span>
        {tags.length > 0 && <span className="cifc-room-tags">{tags.join('. ')}</span>}
        {records > 0 && overlay && <span className="cifc-room-count" style={{ background: countFill, boxShadow: `0 0 0 2px ${TONE_COLOR[overlay.layer.tone]}33` }}
          aria-label={`${records} ${overlay.layer.label} records`}>{records}</span>}
      </button>
    </li>;
  };

  const unplaced = [...model.occurrences.values()].filter(row => row.occurrence.floorId === null).map(row => row.occurrence);
  const records = selected && overlay ? overlay.byRoom.get(selected.room.roomId) ?? [] : [];
  const facts = floor ? model.floorFacts.get(floor.floorId) : undefined;
  const issues = model.issues, pin = source.publication, coords = source.coordinates;
  const siblings = selected ? selected.room.occurrences.filter(row => row !== selected.occurrence) : [];
  const meshCount = selected ? model.occurrenceMeshes.get(selected.occurrence.spaceOccurrenceId)?.length ?? 0 : 0;
  const declared = (value: string) => value === 'unknown' ? 'Unknown' : `${value} (${coords.source.basis === 'converter-declaration' ? 'converter declaration' : 'basis unknown'})`;

  return <aside className="cifc-panel" aria-label="Model rooms and source">
    <header className="cifc-panel-head">
      <h2 ref={panelHeading} tabIndex={-1}>{source.building.label}</h2>
      <p className="cifc-pub">Publication <code title={pin.publicationId}>{short(pin.publicationId)}</code></p>
    </header>

    {notice && <div className="cifc-notice" role="status">
      <p>{notice.kind === 'carried'
        ? <>Room kept from publication <code>{short(notice.fromPublicationId)}</code> by its room and space IDs.</>
        : <>The room selected in publication <code>{short(notice.fromPublicationId)}</code> is not in this publication.</>}</p>
      <button type="button" className="text-btn" onClick={() => keepFocus(panelHeading.current, onDismissNotice)}>Dismiss</button>
    </div>}

    <section className={`cifc-focus${selected ? ' has-room' : ''}`} aria-label={selected ? 'Selected room' : 'Current floor'}>
      {selected ? <>
        <div className="cifc-focus-head">
          <h3 ref={focusHeading} tabIndex={-1}>{selected.room.label}{isDuplicateLabel(model, selected.room) && <span className="cifc-room-id"> {shortId(selected.room.roomId)}</span>}</h3>
          <button type="button" className="chip-btn" onClick={() => keepFocus(focusHeading.current, () => select(null))}>Clear room</button>
        </div>
        <p className="cifc-focus-floor">
          {floorLabel(selected.occurrence.floorId)}
          {selected.occurrence.floorId !== null && selected.occurrence.floorId !== state.floorId &&
            <button type="button" className="text-btn" onClick={() => keepFocus(focusHeading.current, () => dispatch({ type: 'showFloor', floorId: selected.occurrence.floorId! }))}>Show floor</button>}
        </p>
        <dl className="cifc-facts">
          <div><dt>Plan</dt><dd>{model.planShapes.has(selected.occurrence.spaceOccurrenceId) ? 'Shape on floor plan' : 'No plan shape'}</dd></div>
          <div><dt>3D</dt><dd>{meshCount ? plural(meshCount, 'linked mesh', 'linked meshes') : 'No linked mesh'}</dd></div>
          <div><dt>Atlas place</dt><dd>{selected.room.atlasPlaceId ? 'Linked' : 'Not reviewed'}</dd></div>
        </dl>
        {siblings.length > 0 && <div className="cifc-siblings" role="group" aria-label="Other floors of this room">
          {siblings.map(row => <button key={row.spaceOccurrenceId} type="button" className="chip-btn" onClick={() => select(row.spaceOccurrenceId)}>
            Select on {floorLabel(row.floorId)}</button>)}
        </div>}
        {overlay && <div className="cifc-records">
          <h4>{overlay.layer.label}</h4>
          {records.length ? <ul>{records.map(record => <li key={record.id}><strong>{record.label}</strong>{record.detail && <span>{record.detail}</span>}</li>)}</ul>
            : <p>{selected.room.atlasPlaceId ? 'No records linked to this room.' : 'Atlas place not reviewed; records cannot join.'}</p>}
        </div>}
      </> : floor ? <>
        <div className="cifc-focus-head"><h3 ref={focusHeading} tabIndex={-1}>{floor.label}</h3></div>
        <dl className="cifc-facts">
          <div><dt>Spaces</dt><dd>{facts?.occurrenceIds.length ?? 0}</dd></div>
          <div><dt>Geometry</dt><dd>{facts?.hasPlan ? facts.meshCount ? 'Plan and 3D' : 'Plan only' : facts?.meshCount ? '3D only' : 'None'}</dd></div>
          <div><dt>Elevation</dt><dd>{floor.elevation ? `${floor.elevation.metres} m, ${floor.elevation.basis}` : 'Unknown'}</dd></div>
        </dl>
      </> : <p>No floors in this publication.</p>}
    </section>

    <section className="cifc-rooms" aria-labelledby="cifc-rooms-title">
      <h3 id="cifc-rooms-title">Rooms <span className="cifc-count">{source.rooms.length}</span></h3>
      <div ref={list}>
        {source.floors.map(row => {
          const ids = model.floorFacts.get(row.floorId)?.occurrenceIds ?? [];
          return <div key={row.floorId} className={`cifc-room-group${row.floorId === state.floorId ? ' is-current' : ''}`}>
            <h4><span className="cifc-group-short" aria-hidden="true">{row.short}</span>{row.label}</h4>
            {ids.length ? <ul>{ids.map(id => occurrenceButton(model.occurrences.get(id)!.occurrence))}</ul> : <p className="cifc-empty">No rooms linked to this floor.</p>}
          </div>;
        })}
        {unplaced.length > 0 && <div className="cifc-room-group is-unplaced">
          <h4><span className="cifc-group-short" aria-hidden="true">?</span>Floor unknown</h4>
          <ul>{unplaced.map(occurrenceButton)}</ul>
        </div>}
      </div>
    </section>

    {overlay && <section className="cifc-overlay-facts" aria-label={`${overlay.layer.label} source`}>
      <h3><span className="layer-swatch" style={{ '--layer': TONE_COLOR[overlay.layer.tone] } as CSSProperties} aria-hidden="true" />{overlay.layer.label}</h3>
      <dl className="cifc-facts">
        <div><dt>Owner</dt><dd>{overlay.layer.owner}</dd></div>
        <div><dt>Source date</dt><dd>{unknown(overlay.layer.sourceDate, fmtDate)}</dd></div>
        <div><dt>Retrieved</dt><dd>{unknown(overlay.layer.retrievedAt, fmtDateTime)}</dd></div>
        <div><dt>Freshness</dt><dd>{FRESHNESS[overlay.layer.freshness]}</dd></div>
      </dl>
      {overlay.unplaced.length > 0 && <details>
        <summary>{overlay.unplaced.length} not linked to a reviewed room in this publication</summary>
        <ul>{overlay.unplaced.map(record => <li key={record.id}><strong>{record.label}</strong>{record.detail && <span>{record.detail}</span>}</li>)}</ul>
      </details>}
    </section>}

    <details className="cifc-source">
      <summary>Source details</summary>
      <dl className="cifc-facts is-source">
        {selected && <>
          <div><dt>Room ID</dt><dd><code>{selected.room.roomId}</code></dd></div>
          <div><dt>Space occurrence</dt><dd><code>{selected.occurrence.spaceOccurrenceId}</code></dd></div>
          <div><dt>IFC GlobalId</dt><dd>{selected.occurrence.ifcGlobalId ? <code>{selected.occurrence.ifcGlobalId}</code> : 'Unknown'}</dd></div>
          <div><dt>Atlas place</dt><dd>{selected.room.atlasPlaceId ? <code>{selected.room.atlasPlaceId}</code> : 'Not reviewed'}</dd></div>
        </>}
        <div><dt>Origin</dt><dd>{source.origin.kind === 'synthetic-fixture'
          ? source.origin.coverage === 'publisher-shaped' ? 'Synthetic fixture, publisher-shaped' : 'Synthetic fixture, generated presentation coverage; not publisher output'
          : `${source.origin.adapter} via ${source.origin.transport === 'synthetic-fixture' ? 'synthetic fixture transport; ready state is mock' : 'scoped service read'}`}</dd></div>
        <div><dt>Owner</dt><dd>{pin.owner}</dd></div>
        <div><dt>Selection</dt><dd>{pin.selection.mode === 'published' ? 'Published' : 'Preview'}{pin.selection.revision && <code>{pin.selection.revision}</code>}</dd></div>
        <div><dt>Publication</dt><dd><code>{pin.publicationId}</code></dd></div>
        <div><dt>Source revision</dt><dd><code>{pin.sourceRevisionId}</code>{pin.sourceRevisionSha256 && <code>{pin.sourceRevisionSha256}</code>}</dd></div>
        <div><dt>Source IFC</dt><dd>{pin.sourceIfcSha256 ? <code>{pin.sourceIfcSha256}</code> : 'Unknown'}</dd></div>
        <div><dt>Semantic map</dt><dd><code>{pin.semanticMapRevision}</code>{pin.semanticMapSha256 && <code>{pin.semanticMapSha256}</code>}</dd></div>
        <div><dt>Validation</dt><dd>{pin.validation ?? 'Unknown'}</dd></div>
        <div><dt>Source date</dt><dd>{unknown(pin.sourceDate, fmtDate)}</dd></div>
        <div><dt>Retrieved</dt><dd>{unknown(pin.retrievedAt, fmtDateTime)}</dd></div>
        <div><dt>Renderer frame</dt><dd>GLB metres, Y up (declared)</dd></div>
        <div><dt>Source units</dt><dd>{declared(coords.source.units)}</dd></div>
        <div><dt>Source up axis</dt><dd>{declared(coords.source.upAxis)}</dd></div>
        <div><dt>Physical alignment</dt><dd>Unknown</dd></div>
        <div><dt>Floor registration</dt><dd>{source.registration.kind === 'shared-frame' ? source.registration.basis : 'Unknown; floors shown separately'}</dd></div>
        <div><dt>Converter</dt><dd>{coords.converters.length ? <ul className="cifc-link-facts">{coords.converters.map((row, index) =>
          <li key={index}>{row.floorId ? `${floorLabel(row.floorId)}: ` : ''}{row.name} {row.version}<code>{row.configSha256}</code></li>)}</ul> : 'Unknown'}</dd></div>
        {pin.artifacts.map((artifact, index) => <div key={index}><dt>{artifact.floorId ? `${floorLabel(artifact.floorId)} ${artifact.label}` : artifact.label}</dt>
          <dd><code>{artifact.sha256}</code>{artifact.bytes !== null && <span>{artifact.bytes.toLocaleString('en')} bytes</span>}</dd></div>)}
        <div><dt>Links</dt><dd><ul className="cifc-link-facts">
          <li>{plural(issues.displayOnlyMeshes, 'display-only mesh', 'display-only meshes')}</li>
          {issues.occurrencesWithoutPlanShape > 0 && <li>{plural(issues.occurrencesWithoutPlanShape, 'space')} without plan shape</li>}
          {issues.occurrencesWithUnknownFloor > 0 && <li>{plural(issues.occurrencesWithUnknownFloor, 'space')} with unknown floor</li>}
          {issues.planFeaturesDemoted > 0 && <li>{plural(issues.planFeaturesDemoted, 'plan feature')} not matching a space on its floor, shown without identity</li>}
          {issues.meshBindingsDemoted > 0 && <li>{plural(issues.meshBindingsDemoted, 'mesh binding')} without a matching plan space, shown display-only</li>}
          {issues.overlayLayersWithheld > 0 && <li>{plural(issues.overlayLayersWithheld, 'overlay layer')} from another publication withheld</li>}
        </ul></dd></div>
      </dl>
    </details>

    <div className="cifc-return">
      <span>{selected ? selected.room.label : floor?.label ?? ''}</span>
      <button type="button" className="chip-btn" onClick={onReturnToModel}>Back to model</button>
    </div>
  </aside>;
}
