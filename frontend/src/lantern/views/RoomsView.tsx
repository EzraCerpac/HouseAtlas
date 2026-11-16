import { useEffect, useRef, useState } from 'react';
import { roomContents, unplaced, dueState, CLAIM_LABEL } from '../data/query';
import { useReducedMotion, useSelect, useStore } from '../state/store';
import { ROOM_TINT } from '../atlas/palette';
import { EntityLink, Empty } from '../components/ui';
import { Icon } from '../components/Icon';
import { LinkedEvidence } from '../components/LinkedEvidence';
import { BuildingScope } from '../topology/BuildingScope';
import { useTopology } from '../topology/TopologyProvider';

/** Everything the former Rooms & places view held, for the Atlas Places lens:
 * buildings and levels with native place actions, the HomeBox place ledger,
 * records without a reviewed placement and geometry records. Mounted only
 * while shown, so its topology reads start and stop with it. */
export function PlacesContent() {
  return <>
    <RoomIndex />
    <GeometryMetadata />
  </>;
}

export function RoomsView() {
  return (
    <div className="view">
      <header className="view-head">
        <h1>Rooms &amp; places</h1>
      </header>
      <PlacesContent />
    </div>
  );
}

export function RoomIndex() {
  const { house, state, dispatch, projection, actions } = useStore();
  const select = useSelect();
  const unplacedHeading = useRef<HTMLHeadingElement>(null), reducedMotion = useReducedMotion();
  // Sent here from the Overview's count: land on the records it counted. A
  // passive effect, so it runs after the lens has put focus on its own title.
  useEffect(() => {
    if (state.viewFocus !== 'unplaced') return;
    const heading = unplacedHeading.current;
    dispatch({ type: 'viewFocusDone' });
    if (!heading) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [state.viewFocus]);
  const topology = useTopology();
  const [chosenFloor, setFloorFilter] = useState<string>('all');
  const floors = [...house.floors].sort((a, b) => b.order - a.order);
  // A chosen floor that leaves the home no longer filters: every floor shows.
  const floorFilter = floors.some((f) => f.id === chosenFloor) ? chosenFloor : 'all';
  const shown = floorFilter === 'all' ? floors : floors.filter((f) => f.id === floorFilter);
  const un = unplaced(house);
  const unknownRecords = house.items.filter((item) => item.id.startsWith('uk-'));
  const selectedId = state.selection?.id;
  const status = (id: string) => { const e = projection.entries.get(id); return e && `HomeBox source: ${e.sourceState}; cache: ${e.cacheStatus}`; };

  return (
    <div className="room-index">
      <BuildingScope />
      {topology.buildingId === null && floors.length > 1 && <div className="filter-row" role="group" aria-label="Filter places">
        <button type="button" className="chip-btn" aria-pressed={floorFilter === 'all'} onClick={() => setFloorFilter('all')}>
          All places
        </button>
        {floors.map((f) => (
          <button key={f.id} type="button" className="chip-btn" aria-pressed={floorFilter === f.id} onClick={() => setFloorFilter(f.id)}>
            {f.name}
          </button>
        ))}
      </div>}

      {topology.buildingId === null && shown.map((f) => {
        const rooms = house.spaces.filter((s) => s.floorId === f.id && s.kind !== 'stair');
        // Stated once on the heading when no place in the list has a reviewed shape.
        const noShapes = rooms.every((r) => r.geometry !== 'reviewed');
        // A source state every place shares is stated once under the heading; a row shows its own only where it differs.
        const statuses = new Set(rooms.map((r) => status(r.id)));
        const shared = rooms.length > 1 && statuses.size === 1 ? [...statuses][0] : undefined;
        return (
          <section key={f.id} className="ledger" aria-labelledby={`ledger-${f.id}`}>
            <div className="ledger-floor" aria-hidden="true">
              {f.short}
            </div>
            <div className="ledger-body">
              <h3 id={`ledger-${f.id}`} className="ledger-title">
                {f.name}
                {noShapes ? <span className="mini-claim claim-unknown">No reviewed shapes</span>
                  : !f.hasPlan && <span className="mini-claim claim-unknown">No plan</span>}
              </h3>
              {!rooms.length && <Empty>No places supplied.</Empty>}
              {shared && shared !== 'HomeBox source: present; cache: fresh' && <p className="ledger-shared"><span className="ledger-shared-label">All {rooms.length}</span><span className="ledger-facts"><span>{shared}</span></span></p>}
              <ul className="ledger-rows">
                {rooms.map((r) => {
                  const c = roomContents(house, r.id);
                  const due = c.tasks.filter((t) => dueState(t, house.displayNow) === 'overdue' || dueState(t, house.displayNow) === 'soon').length;
                  // First glance: what the place holds, then only what changes a
                  // decision now. Its classification, shape review, geometry
                  // mappings and a normal source state are on its record sheet.
                  const entry = projection.entries.get(r.id);
                  // Two independent facts: the entity's own archive flag shows as
                  // Archived whatever the source state; an archived source state
                  // shows in the source flag, never as the entity's archival.
                  const archived = entry !== undefined && entry.entity.archived === true;
                  const sourceException = entry !== undefined && (entry.sourceState !== 'present' || entry.cacheStatus !== 'fresh') && !shared;
                  const holds: { icon: string; count: number; one: string; many: string }[] = [
                    { icon: 'box', count: c.items.length, one: 'belonging', many: 'belongings' },
                    { icon: 'file', count: c.docs.length, one: 'document', many: 'documents' },
                    { icon: 'plug', count: c.outlets.length, one: 'outlet', many: 'outlets' },
                    { icon: 'valve', count: c.valves.length, one: 'valve', many: 'valves' },
                    { icon: 'wifi', count: c.devices.length, one: 'device', many: 'devices' },
                  ];
                  const content = <>
                        <span className="ledger-swatch" style={{ background: entry ? "#8a8f99" : ROOM_TINT[r.kind] }} aria-hidden="true" />
                        <span className="ledger-name">{r.name}</span>
                        <span className="ledger-facts">
                          {holds.filter((row) => row.count > 0).map((row) => <span key={row.one} className="ledger-count">
                            <Icon name={row.icon} size={14} />{row.count} {row.count === 1 ? row.one : row.many}</span>)}
                          {due > 0 && <span className="ledger-count tone-alert"><Icon name="upkeep" size={14} />{due} upkeep due</span>}
                        </span>
                        {(archived || sourceException || (r.geometry !== 'reviewed' && !noShapes)) && <span className="ledger-flags">
                          {archived && <span className="ledger-flag">Archived</span>}
                          {entry && sourceException && <span className="ledger-flag">{status(r.id)}</span>}
                          {r.geometry !== 'reviewed' && !noShapes && <span className="ledger-flag is-quiet">No shape</span>}
                        </span>}
                  </>;
                  return (
                    <li key={r.id} className={`ledger-row${selectedId === r.id ? ' is-selected' : ''}`}>
                      {/* A held copy has no record details to open. */}
                      {actions.heldCopy ? <div className="ledger-main">{content}</div>
                        : <button type="button" className="ledger-main" onClick={() => select(r.id)}>{content}</button>}
                      {c.containers.length > 0 && (
                        <ul className="ledger-storage" aria-label={`Storage in ${r.name}`}>
                          {c.containers.map((ct) => (
                            <li key={ct.id}>
                              <EntityLink id={ct.id} sub={`${ct.kind}, ${house.items.filter((i) => i.containerId === ct.id).length} inside. Storage, not a room.`} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        );
      })}

      <section className="ledger ledger-unplaced" aria-labelledby="ledger-unplaced">
        <div className="ledger-floor" aria-hidden="true">
          ?
        </div>
        <div className="ledger-body">
          <h3 id="ledger-unplaced" ref={unplacedHeading} tabIndex={-1} className="ledger-title">
            No reviewed placement
          </h3>
          {topology.buildingId !== null && <p className="body-text muted">Whole home, not filtered by building</p>}
          <p className="body-text muted">In saved information, these records have no reviewed position on a plan.</p>
          {(() => {
            // Groups with records list them; the empty ones share one statement.
            // A source state every listed belonging shares is stated once above them.
            const itemStatuses = new Set(un.noRoomItems.map((i) => status(i.id)));
            const itemsShared = un.noRoomItems.length > 1 && itemStatuses.size === 1 ? [...itemStatuses][0] : undefined;
            const groups: { title: string; empty: string; shared?: string | undefined; rows: { id: string; sub?: string | undefined }[] }[] = [
              { title: 'Belongings without a reviewed room', empty: 'belongings without a reviewed room', shared: itemsShared, rows: un.noRoomItems.map((i) => ({
                // The heading states the missing placement; a row adds only a note or a claim other than unknown.
                id: i.id, sub: [i.locationNote ?? (i.locationClaim === 'unknown' ? undefined : CLAIM_LABEL[i.locationClaim]), !itemsShared && status(i.id)].filter(Boolean).join(' · ') || undefined,
              })) },
              { title: 'Known by room, spot not recorded', empty: 'belongings known by room only', rows: un.roomOnlyItems.map((i) => ({ id: i.id })) },
              { title: 'Valves without a position', empty: 'valves without a position', rows: un.valves.map((v) => ({ id: v.id, sub: v.note })) },
              { title: 'Network devices without a location', empty: 'network devices without a location', rows: un.devices.map((d) => ({ id: d.id, sub: d.note })) },
              { title: 'Unclassified records', empty: 'unclassified records', rows: unknownRecords.map((record) => {
                const entry = projection.entries.get(record.id);
                return { id: record.id, sub: entry ? `Source: ${entry.sourceState}; cache: ${entry.cacheStatus}` : 'Classification not supplied' };
              }) },
            ];
            const listed = groups.filter((g) => g.rows.length), empty = groups.filter((g) => !g.rows.length).map((g) => g.empty);
            return <>
              {listed.length > 0 && <div className="unplaced-grid">
                {listed.map((g) => (
                  <div key={g.title}>
                    <h4>{g.title}</h4>
                    {g.shared && <p className="ledger-shared"><span className="ledger-shared-label">All {g.rows.length}</span><span className="ledger-facts"><span>{g.shared}</span></span></p>}
                    <ul className="rows">
                      {g.rows.map((row) => (
                        <li key={row.id} className="link-row">
                          <EntityLink id={row.id} sub={row.sub} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>}
              {empty.length > 0 && <Empty>None supplied in this view: {empty.join(', ')}.</Empty>}
            </>;
          })()}
        </div>
      </section>
    </div>
  );
}

function GeometryMetadata() {
  const { projection } = useStore();
  const read = projection.geometryMetadata;
  return <section className="ledger" aria-labelledby="geometry-metadata-heading" style={{ overflowWrap: 'anywhere' }}>
    <div className="ledger-floor ledger-icon" aria-hidden="true"><Icon name="layers" size={28} /></div>
    <div className="ledger-body">
      <h3 id="geometry-metadata-heading" className="ledger-title">Geometry imports</h3>
      {read.status === 'not-supplied' && <p role="status" className="body-text">Geometry imports were not supplied in this view.</p>}
      {read.status === 'loading' && <p role="status" className="body-text">Loading geometry imports…</p>}
      {read.status === 'unavailable' && <p role="status" className="body-text">Geometry imports could not be loaded. Reload saved information in Settings to retry.</p>}
      {read.status === 'denied' && <p role="status" className="body-text">Access to geometry imports is denied.</p>}
      {read.status === 'expired' && <p role="status" className="body-text">The session for this geometry read has expired.</p>}
      {read.status === 'ready' && <>
        <p className="body-text muted">Source status: {read.sourceStatus}</p>
        {!read.records.length && <Empty>No geometry imports returned by this read.</Empty>}
        {read.records.map((record) => {
          const p = record.payload;
          return <details key={record.target.recordId}>
            <summary>Magicplan version {p.geometryVersion} · {record.lifecycle} · {record.target.recordId}</summary>
            <dl className="facts">
              <div><dt>Record revision</dt><dd>{record.revision}</dd></div>
              <div><dt>Producer version</dt><dd>{p.producerVersion ?? 'Not supplied'}</dd></div>
              <div><dt>Export format</dt><dd>{p.exportFormat}</dd></div>
              <div><dt>Imported</dt><dd>{p.importedAt}</dd></div>
              <div><dt>Original asset ID</dt><dd>{p.originalAssetId} · file availability not supplied by this read</dd></div>
              <div><dt>Previous geometry ID</dt><dd>{p.previousGeometryId ?? 'Not supplied'}</dd></div>
              <div><dt>Coordinate units</dt><dd>{p.coordinateUnits}</dd></div>
              <div><dt>Source scale</dt><dd>{p.scale?.toString() ?? 'Not supplied'}</dd></div>
              <div><dt>Source transform</dt><dd>{p.transform?.map(value => value.toString()).join(', ') ?? 'Not supplied'}</dd></div>
              <div><dt>Evidence IDs</dt><dd>{p.evidenceIds.join(', ')}</dd></div>
            </dl>
            <div data-evidence-context="geometry">{p.evidenceIds.map(evidenceId => <LinkedEvidence key={evidenceId} evidenceId={evidenceId} />)}</div>
            <h3>Producer room mappings</h3>
            {!p.mappings.length && <Empty>No producer room mappings supplied.</Empty>}
            {p.mappings.map((mapping, index) => {
              const ref = mapping.homeboxEntity;
              const matched = [...projection.geometryMappings.entries()].find(([, matches]) => matches.some((match) => match.record === record && match.mapping === mapping));
              const place = matched ? projection.entries.get(matched[0]) : undefined;
              return <div key={index} data-evidence-context="mapping"><dl className="facts">
                <div><dt>Producer room</dt><dd>{mapping.producerRoomId}</dd></div>
                <div><dt>Mapping status</dt><dd>{mapping.reviewStatus}</dd></div>
                <div><dt>Atlas identity ID</dt><dd>{mapping.atlasId}</dd></div>
                <div><dt>HomeBox source reference</dt><dd>{ref ? `${ref.workspaceId} / ${ref.homeId} / ${ref.key.sourceInstanceId} / ${ref.key.collectionId} / ${ref.key.sourceKind} / ${ref.key.externalId}` : 'Not supplied'}</dd></div>
                <div><dt>Saved place match</dt><dd>{place ? place.entity.name : 'No exact match among the HomeBox places listed here'}</dd></div>
                <div><dt>Mapping evidence IDs</dt><dd>{mapping.evidenceIds.join(', ')}</dd></div>
              </dl>{mapping.evidenceIds.map(evidenceId => <LinkedEvidence key={evidenceId} evidenceId={evidenceId} />)}</div>;
            })}
          </details>;
        })}
      </>}
    </div>
  </section>;
}
