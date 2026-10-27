import { useEffect } from 'react';
import { NativePlaceEditor } from './NativePlaceEditor';
import { NativePlaceEvidence } from './NativePlaceEvidence';
import { useTopology } from './TopologyProvider';
import { metres, type Access, type BuildingModel, type Location, type Membership, type TopologyIndex, type LevelGroup } from './model';
import { useSelect, useStore } from '../state/store';
import { LinkedEvidence } from '../components/LinkedEvidence';
import { Icon } from '../components/Icon';

const messages = {
  loading: 'Loading building records…', unavailable: 'Building records could not be loaded. Reload the saved view to retry.',
  denied: 'Access to building records is denied.', expired: 'The session for this read has expired.',
  timedOut: 'Building records could not be loaded within the read deadline.', tooLarge: "Building records exceed this list’s read limit.",
  continuationUnavailable: 'Building records could not be continued. Reload the saved view.',
  changed: 'Building records differ between reads. Reload the saved view.', ready: '',
};
function Evidence({ ids }: { ids: readonly string[] }) {
  return <div className="topology-evidence">{ids.length ? ids.map(id => <div key={id}><span>Evidence ID: {id}</span><LinkedEvidence evidenceId={id} /></div>) : <p>No evidence IDs supplied.</p>}</div>;
}
function Facts({ location, index, selected }: { location: Location; index: TopologyIndex; selected: ReadonlySet<string> }) {
  const memberships = index.membership.filter(r => r.payload.to.ref.recordId === location.id || r.payload.from.ref.recordId === location.id);
  const access = index.access.filter(r => r.payload.from.ref.recordId === location.id || r.payload.to.ref.recordId === location.id);
  const name = (id: string) => index.locations.get(id)?.label ?? `Atlas location ${id}`;
  const edge = (r: Membership | Access) => <div key={r.target.recordId} className="topology-fact">
    <p>{r.payload.kind === 'location-membership' ? `${r.payload.membershipKind} membership` : `${r.payload.accessKind} · ${r.payload.assertion}`} · {r.payload.reviewStatus}</p>
    <p>{name(r.payload.from.ref.recordId)} {r.payload.kind === 'physical-access' && r.payload.direction === 'bidirectional' ? '↔' : '→'} {name(r.payload.to.ref.recordId)}
      <span className="sr-only">{r.payload.kind === 'physical-access' && r.payload.direction === 'bidirectional' ? ', both directions' : ', from first to second'}</span></p>
    <p>Record ID: {r.target.recordId} · revision {r.revision}</p>
    <p>Uncertainty: {r.payload.uncertainty.status}{r.payload.uncertainty.explanation ? ` · ${r.payload.uncertainty.explanation}` : ''}</p>
    <Evidence ids={r.payload.evidenceIds} />
  </div>;
  return <details className="topology-facts"><summary>Physical facts</summary>
    <p>Atlas identity: {location.id}</p>
    {location.entry && <p>HomeBox name: {location.entry.entity.name}</p>}
    {location.entry && <p>HomeBox source updated: {location.entry.sourceUpdatedAt ?? 'Not supplied'} · retrieved: {location.entry.retrievedAt}</p>}
    {location.bindings.map(b => <div key={b.target.recordId}><p>HomeBox binding: {b.target.recordId} · {b.payload.reviewStatus} · source {b.payload.sourceState}</p>
      <p>Source key: {b.payload.source.sourceInstanceId} / {b.payload.source.collectionId} / {b.payload.source.sourceKind} / {b.payload.source.externalId}</p>
      <Evidence ids={b.payload.evidenceIds} /></div>)}
    {location.semantics.map(s => <div key={s.target.recordId}><p>Classification: {s.payload.semanticKind} · {s.payload.reviewStatus} · {s.target.recordId}</p>
      {s.payload.semanticKind === 'floor' && <p>{s.payload.elevation?.status === 'known'
        ? `Elevation: ${metres(s.payload.elevation.metres)}, measured from ${name(s.payload.elevation.datumAtlasId)} (${s.payload.elevation.datumAtlasId})`
        : s.payload.elevation?.status === 'unknown' ? 'Elevation recorded as unknown' : 'Elevation not recorded'}</p>}
      {s.payload.label !== undefined && <p>Atlas name: {s.payload.label}</p>}
      <Evidence ids={s.payload.evidenceIds} /></div>)}
    <h4>Membership</h4>{memberships.length ? memberships.map(edge) : <p>No reviewed membership recorded.</p>}
    <h4>Access</h4><p>Recorded access is evidence, not a route or safety check.</p>
    {access.length ? access.map(edge) : <p>No access facts recorded.</p>}
    {access.some(a => !selected.has(a.payload.from.ref.recordId) || !selected.has(a.payload.to.ref.recordId)) && <p>Access may reference locations outside this building.</p>}
  </details>;
}
/** Per-row qualifiers; a list states qualifiers shared by every row once. */
function rowFacts(location: Location, note?: string): string[] {
  const classifications = location.semantics.map(s => s.payload.semanticKind);
  return [location.labelOwner === 'atlas' ? 'Atlas name' : location.labelOwner === 'homebox' ? 'HomeBox name' : location.labelOwner === 'conflict' ? 'Naming withheld: multiple reviewed classifications' : 'Name not supplied',
    classifications.length ? `Reviewed: ${classifications.join(', ')}` : 'Classification not reviewed',
    location.entry ? `HomeBox source: ${location.entry.sourceState}; cache: ${location.entry.cacheStatus}` : 'No bound HomeBox record in this view',
    ...(location.entry && !location.selectId ? ['Not in the current place list'] : []), ...(note ? [note] : [])];
}
function sharedFacts(rows: readonly { location: Location; note?: string | undefined }[]): ReadonlySet<string> {
  if (rows.length < 2) return new Set();
  const [first, ...rest] = rows.map(row => new Set(rowFacts(row.location, row.note)));
  return new Set([...first!].filter(fact => rest.every(set => set.has(fact))));
}
export function Rows({ rows, index, selected }: { rows: readonly { location: Location; note?: string | undefined }[]; index: TopologyIndex; selected: ReadonlySet<string> }) {
  const shared = sharedFacts(rows);
  return <>
    {shared.size > 0 && <p className="ledger-shared"><span className="ledger-shared-label">All {rows.length}</span>
      <span className="ledger-facts">{[...shared].map(fact => <span key={fact}>{fact}</span>)}</span></p>}
    <ul className="ledger-rows">{rows.map(({ location, note }) => <Row key={location.id} location={location} index={index} selected={selected} note={note} shared={shared} />)}</ul>
  </>;
}
function Row({ location, index, selected, note, shared }: { location: Location; index: TopologyIndex; selected: ReadonlySet<string>; note?: string | undefined; shared: ReadonlySet<string> }) {
  const select = useSelect(), { state } = useStore();
  const topology = useTopology();
  const facts = rowFacts(location, note).filter(fact => !shared.has(fact));
  const content = <><span className="ledger-name" title={location.id}>{location.label}</span>
    {facts.length > 0 && <span className="ledger-facts">{facts.map(fact => <span key={fact}>{fact}</span>)}</span>}</>;
  return <li className={`ledger-row${state.selection?.id === location.selectId && location.selectId ? ' is-selected' : ''}`}>
    {location.selectId ? <button type="button" className="ledger-main topology-row" aria-label={`${location.label}, Atlas identity ${location.id}`} onClick={() => select(location.selectId!)}>{content}</button>
      : <div className="ledger-main topology-row">{content}</div>}
    {topology.nativePlaces && topology.nativeBinding && <NativePlaceEditor key={location.id} client={topology.nativePlaces} binding={topology.nativeBinding} index={index} location={location} refresh={topology.reload} />}
    {topology.nativePlaces && topology.nativeBinding && <NativePlaceEvidence client={topology.nativePlaces.evidence} binding={topology.nativeBinding} location={location} index={index} refresh={topology.reload} />}
    <Facts location={location} index={index} selected={selected} />
  </li>;
}
function Level({ group, index, selected }: { group: LevelGroup; index: TopologyIndex; selected: ReadonlySet<string> }) {
  const elevation = group.elevation;
  const text = elevation.status === 'known' ? metres(elevation.elevation.metres) : '?';
  // Known elevations sit under their "Measured from" band heading.
  const note = elevation.status === 'known' ? null
    : elevation.status === 'multiple' ? 'Multiple recorded elevations' : elevation.status === 'unknown' ? 'Elevation recorded as unknown' : 'Elevation not recorded';
  return <section className="ledger topology-level" aria-label={group.location.label}>
    <div className={`ledger-floor topology-glyph${elevation.status === 'known' ? '' : ' topology-unknown'}`} aria-hidden="true">{text}</div>
    <div className="ledger-body"><h3 className="ledger-title">{group.location.label}</h3>{note && <p className="body-text muted">{note}</p>}
      <Rows rows={[group.location, ...group.members].map(location => ({ location }))} index={index} selected={selected} />
      {!group.members.length && <p className="body-text muted">No locations recorded on this level.</p>}
    </div>
  </section>;
}
export function BuildingScope() {
  const topology = useTopology();
  useEffect(() => topology.activate(), [topology.activate]);
  const { index, status, buildingId, model, memberStatus, levelId } = topology;
  const selection = model ? new Set([model.building.id, ...model.levels.flatMap(l => [l.location.id, ...l.members.map(m => m.id)]), ...model.direct.map(m => m.id)]) : new Set<string>();
  let priorDatum: string | null = null;
  const shown = model?.levels.filter(group => levelId === 'all' || levelId === group.location.id) ?? [];
  return <div className="topology-scope">
    <div className="topology-bar"><span className="topology-label">Building</span><span className="muted">Applies to this list only</span>
      {index && <span className="muted">Atlas records: {[...new Set(index.data.sourceStatuses)].join(', ')}</span>}</div>
    <div className="filter-row topology-chips" role="group" aria-label="Building">
      <button type="button" className="chip-btn" aria-pressed={buildingId === null} onClick={() => topology.chooseBuilding(null)}>Whole home</button>
      {index?.buildings.map(b => <button key={b.id} type="button" className="chip-btn" title={b.id} aria-label={`${b.label}, Atlas identity ${b.id}`}
        aria-pressed={buildingId === b.id} onClick={() => topology.chooseBuilding(b.id)}>{b.label}</button>)}
    </div>
    <p className="body-text" role="status">{status !== 'ready' ? messages[status] : buildingId && memberStatus !== 'ready' ? messages[memberStatus] : topology.notice || (model ? `${model.building.label}: ${model.memberCount} locations in reviewed membership` : index?.buildings.length ? '' : 'No reviewed buildings in this home.')}</p>
    {status === 'ready' && index && topology.nativePlaces && topology.nativeBinding && <NativePlaceEditor client={topology.nativePlaces} binding={topology.nativeBinding} index={index} refresh={topology.reload} />}
    {buildingId === null && index && <Rows rows={[...index.locations.values()].map(location => ({ location }))} index={index} selected={new Set()} />}
    {buildingId && model && index && <>
      <p className="body-text muted">Selected membership read: {topology.memberSourceStatus}</p>
      <section className="ledger topology-building"><div className="ledger-floor topology-glyph" aria-hidden="true"><Icon name="building" size={30} /></div><div className="ledger-body">
        <h2 className="ledger-title">{model.building.label}</h2><p className="body-text muted">Building · reviewed · {model.levels.length} levels · {model.direct.length} without level</p>
        <Rows rows={[{ location: model.building }]} index={index} selected={selection} />
      </div></section>
      <div className="filter-row topology-chips" role="group" aria-label="Level">
        <button type="button" className="chip-btn" aria-pressed={levelId === 'all'} onClick={() => topology.chooseLevel('all')}>All levels</button>
        {model.levels.map(l => <button key={l.location.id} type="button" className="chip-btn level-chip" title={l.location.id} aria-pressed={levelId === l.location.id} onClick={() => topology.chooseLevel(l.location.id)}>
          {l.location.label}<span className={`level-datum${l.elevation.status === 'known' ? '' : ' is-unknown'}`}>{l.elevation.status === 'known' ? metres(l.elevation.elevation.metres) : l.elevation.status === 'unknown' ? 'elevation unknown' : l.elevation.status === 'multiple' ? 'multiple elevations' : 'elevation not recorded'}</span></button>)}
        <button type="button" className="chip-btn" aria-pressed={levelId === 'direct'} onClick={() => topology.chooseLevel('direct')}>Level not recorded</button>
      </div>
      {model.levels.some(l => l.elevation.status === 'known') && <p className="body-text muted">Order uses recorded elevation within one datum; labels set no order.</p>}
      {shown.map(group => {
        const datum = group.elevation.status === 'known' ? group.elevation.elevation.datumAtlasId : 'unknown';
        const heading = datum !== priorDatum; priorDatum = datum;
        return <div key={group.location.id}>{heading && <h2 className="topology-band-title">{datum === 'unknown' ? 'Levels, elevation unknown' : `Measured from ${index.locations.get(datum)?.label ?? datum}`}</h2>}<Level group={group} index={index} selected={selection} /></div>;
      })}
      {(levelId === 'all' || levelId === 'direct') && <section className="ledger"><div className="ledger-floor topology-glyph topology-unknown" aria-hidden="true">?</div><div className="ledger-body">
        <h2 className="ledger-title">In {model.building.label}, level not recorded</h2>
        {model.direct.length ? <Rows rows={model.direct.map(location => ({ location, note: 'Building member, level not recorded' }))} index={index} selected={selection} /> : <p className="body-text muted">No members without a recorded level.</p>}
      </div></section>}
      <details className="topology-outside"><summary>Not in {model.building.label} ({model.outsideUnassigned.length + model.outsideElsewhere.length})</summary>
        <h3>No reviewed building or level membership</h3><Rows rows={model.outsideUnassigned.map(location => ({ location }))} index={index} selected={selection} />
        <h3>Reviewed membership elsewhere</h3><Rows rows={model.outsideElsewhere.map(l => ({ location: l,
          note: index.membership.filter(e => e.payload.to.ref.recordId === l.id).map(e => `Direct container: ${index.locations.get(e.payload.from.ref.recordId)?.label ?? e.payload.from.ref.recordId}`).join('; ') }))} index={index} selected={selection} />
      </details>
    </>}
  </div>;
}

/** A member place on a level slab. Only current place-list records are selectable. */
function Place({ location }: { location: Location }) {
  const select = useSelect(), { state } = useStore();
  if (!location.selectId) return <span className="section-place is-static" title={location.id}>{location.label}</span>;
  return <button type="button" className={`section-place${state.selection?.id === location.selectId ? ' is-selected' : ''}`}
    aria-label={`${location.label}, Atlas identity ${location.id}`} onClick={() => select(location.selectId!)}>{location.label}</button>;
}

function Slab({ group }: { group: LevelGroup }) {
  const known = group.elevation.status === 'known';
  const note = group.elevation.status === 'known' ? null : group.elevation.status === 'multiple' ? 'Multiple recorded elevations'
    : group.elevation.status === 'unknown' ? 'Elevation recorded as unknown' : 'Elevation not recorded';
  return <li className={`section-slab${known ? '' : ' is-unknown'}`}>
    <span className="section-datum" aria-hidden={known ? undefined : true}>
      {group.elevation.status === 'known' ? metres(group.elevation.elevation.metres) : '?'}
    </span>
    <div className="section-floor">
      <h3 className="section-level"><Place location={group.location} /></h3>
      {note && <p className="section-note">{note}</p>}
      {group.members.length ? <ul className="section-places" aria-label={`Places on ${group.location.label}`}>
        {group.members.map(location => <li key={location.id}><Place location={location} /></li>)}
      </ul> : <p className="section-note">No locations recorded on this level.</p>}
    </div>
  </li>;
}

/** Recorded elevations order levels only within one datum; unknown levels stay unordered. */
function Drawing({ model, index }: { model: BuildingModel; index: TopologyIndex }) {
  const bands: { datum: string | null; levels: LevelGroup[] }[] = [];
  for (const group of model.levels) {
    const datum = group.elevation.status === 'known' ? group.elevation.elevation.datumAtlasId : null;
    const last = bands[bands.length - 1];
    if (last && last.datum === datum) last.levels.push(group); else bands.push({ datum, levels: [group] });
  }
  return <section className="section-drawing" aria-labelledby="section-building">
    <header className="section-roof">
      <Icon name="building" size={22} />
      <h2 id="section-building"><Place location={model.building} /></h2>
      <p>{model.levels.length} levels, {model.direct.length} without level</p>
    </header>
    {bands.map(band => <div key={band.datum ?? 'unknown'} className={`section-band${band.datum ? '' : ' is-unknown'}`}>
      <h3 className="section-band-title">{band.datum ? `Measured from ${index.locations.get(band.datum)?.label ?? band.datum}` : 'Elevation unknown, not ordered'}</h3>
      <ol className="section-stack">{band.levels.map(group => <Slab key={group.location.id} group={group} />)}</ol>
    </div>)}
    {model.direct.length > 0 && <div className="section-band is-unknown">
      <h3 className="section-band-title">In {model.building.label}, level not recorded</h3>
      <ul className="section-places">{model.direct.map(location => <li key={location.id}><Place location={location} /></li>)}</ul>
    </div>}
    {model.levels.length === 0 && model.direct.length === 0 && <p className="section-note">No levels or places recorded in this building.</p>}
  </section>;
}

function Counts() {
  const { house, dispatch } = useStore();
  const open = house.tasks.filter(task => task.status !== 'done').length;
  const tiles = [
    { view: 'rooms', icon: 'rooms', value: house.spaces.length, label: 'Rooms & places' },
    { view: 'library', icon: 'library', value: house.docs.length, label: 'Documents & links' },
    { view: 'upkeep', icon: 'upkeep', value: open, label: 'Open upkeep' },
  ] as const;
  return <ul className="section-counts" aria-label="Saved view">
    {tiles.map(tile => <li key={tile.view}><button type="button" onClick={() => dispatch({ type: 'view', view: tile.view })}>
      <Icon name={tile.icon} size={20} /><strong>{tile.value}</strong><span>{tile.label}</span>
    </button></li>)}
  </ul>;
}

/** The Atlas before a house model is published: what is missing and where it
 * comes from, then reviewed buildings drawn as level sections. */
export function BuildingSection() {
  const { house } = useStore();
  const topology = useTopology();
  useEffect(() => topology.activate(), [topology.activate]);
  const { index, status, buildingId, model, memberStatus } = topology;
  return <div className="atlas-section">
    <header className="atlas-section-head">
      <h1>{house.name}</h1>
    </header>
    <section className="atlas-empty" aria-labelledby="atlas-no-model-title">
      <Icon name="atlas" size={22} />
      <div>
        <h2 id="atlas-no-model-title">No house model yet</h2>
        <p>The map appears here once a house model is published to this home's server.
          Until then, building sections use reviewed membership and recorded elevations.</p>
      </div>
    </section>
    <div className="topology-scope section-scope">
      <div className="section-buildings topology-chips" role="group" aria-label="Building">
        <button type="button" className="section-building" aria-pressed={buildingId === null} onClick={() => topology.chooseBuilding(null)}>
          <Icon name="atlas" size={18} /><span>Whole home</span>
        </button>
        {index?.buildings.map(b => <button key={b.id} type="button" className="section-building" title={b.id} aria-label={`${b.label}, Atlas identity ${b.id}`}
          aria-pressed={buildingId === b.id} onClick={() => topology.chooseBuilding(b.id)}><Icon name="building" size={18} /><span>{b.label}</span></button>)}
      </div>
      <p className="section-status" role="status">{status !== 'ready' ? messages[status] : buildingId && memberStatus !== 'ready' ? messages[memberStatus] : topology.notice || (model ? `${model.building.label}: ${model.memberCount} locations in reviewed membership` : index?.buildings.length ? '' : 'No reviewed buildings in this home.')}</p>
      {buildingId && model && index ? <Drawing model={model} index={index} /> : buildingId === null && <Counts />}
    </div>
  </div>;
}
