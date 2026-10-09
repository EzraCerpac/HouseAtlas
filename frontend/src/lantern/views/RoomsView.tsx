import { useState } from 'react';
import { roomContents, unplaced, dueState, CLAIM_LABEL } from '../data/query';
import { useSelect, useStore } from '../state/store';
import { ROOM_TINT } from '../atlas/palette';
import { EntityLink, Empty } from '../components/ui';
import { LinkedEvidence } from '../components/LinkedEvidence';
import { BuildingScope } from '../topology/BuildingScope';
import { useTopology } from '../topology/TopologyProvider';

export function RoomsView() {
  return (
    <div className="view">
      <header className="view-head">
        <h1>Rooms &amp; places</h1>

      </header>
      <GeometryMetadata />
      <RoomIndex />
    </div>
  );
}

export function RoomIndex() {
  const { house, state, projection } = useStore();
  const select = useSelect();
  const topology = useTopology();
  const [floorFilter, setFloorFilter] = useState<string>('all');
  const floors = [...house.floors].sort((a, b) => b.order - a.order);
  const shown = floorFilter === 'all' ? floors : floors.filter((f) => f.id === floorFilter);
  const un = unplaced(house);
  const unknownRecords = house.items.filter((item) => item.id.startsWith('uk-'));
  const selectedId = state.selection?.id;

  return (
    <div className="room-index">
      <BuildingScope />
      {topology.buildingId === null && <div className="filter-row" role="group" aria-label="Filter places">
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
        return (
          <section key={f.id} className="ledger" aria-labelledby={`ledger-${f.id}`}>
            <div className="ledger-floor" aria-hidden="true">
              {f.short}
            </div>
            <div className="ledger-body">
              <h2 id={`ledger-${f.id}`} className="ledger-title">
                {f.name}
                {!f.hasPlan && <span className="mini-claim claim-unknown">No plan</span>}
              </h2>
              {!rooms.length && <Empty>No places supplied.</Empty>}
              <ul className="ledger-rows">
                {rooms.map((r) => {
                  const c = roomContents(house, r.id);
                  const due = c.tasks.filter((t) => dueState(t, house.displayNow) === 'overdue' || dueState(t, house.displayNow) === 'soon').length;
                  return (
                    <li key={r.id} className={`ledger-row${selectedId === r.id ? ' is-selected' : ''}`}>
                      <button type="button" className="ledger-main" onClick={() => select(r.id)}>
                        <span className="ledger-swatch" style={{ background: projection.entries.has(r.id) ? "#8a8f99" : ROOM_TINT[r.kind] }} aria-hidden="true" />
                        <span className="ledger-name">{r.name}</span>
                        <span className="ledger-kind">{projection.entries.get(r.id)?.semanticKind ?? 'Unknown'}</span>
                        <span className="ledger-facts">
                          {c.items.length > 0 && <span>{c.items.length} belongings recorded here</span>}
                          <span>{c.docs.length} documents</span>
                          {projection.geometryMappings.get(r.id)?.map(({ record, mapping }, index) => <span key={`${record.target.recordId}-${index}`}>Magicplan mapping: {mapping.reviewStatus}; version {record.payload.geometryVersion}; producer room {mapping.producerRoomId}</span>)}
                          {projection.entries.get(r.id) && <span>Source: {projection.entries.get(r.id)?.sourceState}; cache: {projection.entries.get(r.id)?.cacheStatus}</span>}
                          {c.outlets.length > 0 && <span>{c.outlets.length} outlets</span>}
                          {c.valves.length > 0 && <span>{c.valves.length} valves</span>}
                          {c.devices.length > 0 && <span>{c.devices.length} devices</span>}
                          {due > 0 && <span className="tone-alert">{due} upkeep due</span>}
                        </span>
                        <span className={`ledger-shape${r.geometry === 'reviewed' ? '' : ' is-none'}`}>{r.geometry === 'reviewed' ? 'Shape reviewed' : 'No shape'}</span>
                      </button>
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
          <h2 id="ledger-unplaced" className="ledger-title">
            No reviewed placement
          </h2>
          {topology.buildingId !== null && <p className="body-text muted">Whole home, not filtered by building</p>}
          <p className="body-text muted">These records have no reviewed position on a plan in the saved view.</p>
          <div className="unplaced-grid">
            <div>
              <h3>Belongings without a reviewed room</h3>
              {un.noRoomItems.length ? (
                <ul className="rows">
                  {un.noRoomItems.map((i) => (
                    <li key={i.id} className="link-row">
                      <EntityLink id={i.id} sub={[i.locationNote ?? CLAIM_LABEL[i.locationClaim], projection.entries.get(i.id) && `Source: ${projection.entries.get(i.id)?.sourceState}; cache: ${projection.entries.get(i.id)?.cacheStatus}`].filter(Boolean).join(' · ')} />
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>No belongings without a reviewed room in the supplied view.</Empty>
              )}
            </div>
            <div>
              <h3>Known by room, spot not recorded</h3>
              {un.roomOnlyItems.length ? (
                <ul className="rows">
                  {un.roomOnlyItems.map((i) => (
                    <li key={i.id} className="link-row">
                      <EntityLink id={i.id} />
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Reviewed room placement is unavailable.</Empty>
              )}
            </div>
            <div>
              <h3>Valves without a position</h3>
              {un.valves.length ? (
                <ul className="rows">
                  {un.valves.map((v) => (
                    <li key={v.id} className="link-row">
                      <EntityLink id={v.id} sub={v.note} />
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Reviewed valve placement is unavailable.</Empty>
              )}
            </div>
            <div>
              <h3>Network devices without a location</h3>
              {un.devices.length ? (
                <ul className="rows">
                  {un.devices.map((d) => (
                    <li key={d.id} className="link-row">
                      <EntityLink id={d.id} sub={d.note} />
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Reviewed device placement is unavailable.</Empty>
              )}
            </div>
            <div>
              <h3>Unclassified records</h3>
              {unknownRecords.length ? (
                <ul className="rows">
                  {unknownRecords.map((record) => {
                    const entry = projection.entries.get(record.id);
                    return (
                      <li key={record.id} className="link-row">
                        <EntityLink id={record.id} sub={entry ? `Source: ${entry.sourceState}; cache: ${entry.cacheStatus}` : 'Classification not supplied'} />
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty>No unclassified records in the supplied view.</Empty>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function GeometryMetadata() {
  const { projection } = useStore();
  const read = projection.geometryMetadata;
  return <section className="ledger" aria-labelledby="geometry-metadata-heading" style={{ overflowWrap: 'anywhere' }}>
    <div className="ledger-floor" aria-hidden="true">—</div>
    <div className="ledger-body">
      <h2 id="geometry-metadata-heading" className="ledger-title">Geometry metadata</h2>
      <p className="body-text muted">Plan unavailable: this read does not supply room shapes or positions.</p>
      {read.status === 'loading' && <p role="status" className="body-text">Loading geometry metadata…</p>}
      {read.status === 'unavailable' && <p role="status" className="body-text">Geometry metadata could not be loaded. Reload the saved view to retry.</p>}
      {read.status === 'denied' && <p role="status" className="body-text">Access to geometry metadata is denied.</p>}
      {read.status === 'expired' && <p role="status" className="body-text">The session for this geometry read has expired.</p>}
      {read.status === 'ready' && <>
        <p className="body-text muted">Source status: {read.sourceStatus}</p>
        {!read.records.length && <Empty>No geometry records returned by this read.</Empty>}
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
              <div><dt>Source scale</dt><dd>{p.scale ?? 'Not supplied'}</dd></div>
              <div><dt>Source transform</dt><dd>{p.transform?.join(', ') ?? 'Not supplied'}</dd></div>
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
                <div><dt>Saved place match</dt><dd>{place ? place.entity.name : 'No exact HomeBox place reference in this view'}</dd></div>
                <div><dt>Mapping evidence IDs</dt><dd>{mapping.evidenceIds.join(', ')}</dd></div>
              </dl>{mapping.evidenceIds.map(evidenceId => <LinkedEvidence key={evidenceId} evidenceId={evidenceId} />)}</div>;
            })}
          </details>;
        })}
      </>}
    </div>
  </section>;
}
