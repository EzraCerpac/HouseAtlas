import { useEffect } from 'react';
import { useTopology } from './TopologyProvider';
import { metres, type Access, type Location, type Membership, type TopologyIndex, type LevelGroup } from './model';
import { useSelect, useStore } from '../state/store';
import { LinkedEvidence } from '../components/LinkedEvidence';

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
    {location.entry && <p>HomeBox source updated: {location.entry.sourceUpdatedAt ?? 'Not supplied'} · retrieved: {location.entry.retrievedAt}</p>}
    {location.bindings.map(b => <div key={b.target.recordId}><p>HomeBox binding: {b.target.recordId} · {b.payload.reviewStatus} · source {b.payload.sourceState}</p>
      <p>Source key: {b.payload.source.sourceInstanceId} / {b.payload.source.collectionId} / {b.payload.source.sourceKind} / {b.payload.source.externalId}</p>
      <Evidence ids={b.payload.evidenceIds} /></div>)}
    {location.semantics.map(s => <div key={s.target.recordId}><p>Classification: {s.payload.semanticKind} · {s.payload.reviewStatus} · {s.target.recordId}</p>
      {s.payload.semanticKind === 'floor' && <p>{s.payload.elevation?.status === 'known'
        ? `Elevation: ${metres(s.payload.elevation.metres)}, measured from ${name(s.payload.elevation.datumAtlasId)} (${s.payload.elevation.datumAtlasId})`
        : s.payload.elevation?.status === 'unknown' ? 'Elevation recorded as unknown' : 'Elevation not recorded'}</p>}
      <Evidence ids={s.payload.evidenceIds} /></div>)}
    <h4>Membership</h4>{memberships.length ? memberships.map(edge) : <p>No reviewed membership recorded.</p>}
    <h4>Access</h4><p>Recorded access is evidence, not a route or safety check.</p>
    {access.length ? access.map(edge) : <p>No access facts recorded.</p>}
    {access.some(a => !selected.has(a.payload.from.ref.recordId) || !selected.has(a.payload.to.ref.recordId)) && <p>Access may reference locations outside this building.</p>}
  </details>;
}
function Row({ location, index, selected, note }: { location: Location; index: TopologyIndex; selected: ReadonlySet<string>; note?: string }) {
  const select = useSelect(), { state } = useStore();
  const classifications = location.semantics.map(s => s.payload.semanticKind);
  const content = <><span className="ledger-name" title={location.id}>{location.label}</span>
    <span className="ledger-facts"><span>{classifications.length ? `Reviewed: ${classifications.join(', ')}` : 'Classification not reviewed'}</span>
      {location.entry ? <span>HomeBox source: {location.entry.sourceState}; cache: {location.entry.cacheStatus}</span> : <span>No bound HomeBox record in this view</span>}
      {location.entry && !location.selectId && <span>Not in the current place list</span>}{note && <span>{note}</span>}</span></>;
  return <li className={`ledger-row${state.selection?.id === location.selectId && location.selectId ? ' is-selected' : ''}`}>
    {location.selectId ? <button type="button" className="ledger-main topology-row" aria-label={`${location.label}, Atlas identity ${location.id}`} onClick={() => select(location.selectId!)}>{content}</button>
      : <div className="ledger-main topology-row">{content}</div>}
    <Facts location={location} index={index} selected={selected} />
  </li>;
}
function Level({ group, index, selected }: { group: LevelGroup; index: TopologyIndex; selected: ReadonlySet<string> }) {
  const elevation = group.elevation;
  const text = elevation.status === 'known' ? metres(elevation.elevation.metres) : '?';
  const note = elevation.status === 'known' ? `Measured from ${index.locations.get(elevation.elevation.datumAtlasId)?.label ?? elevation.elevation.datumAtlasId}`
    : elevation.status === 'multiple' ? 'Multiple recorded elevations' : elevation.status === 'unknown' ? 'Elevation recorded as unknown' : 'Elevation not recorded';
  return <section className="ledger topology-level" aria-label={group.location.label}>
    <div className={`ledger-floor topology-glyph${elevation.status === 'known' ? '' : ' topology-unknown'}`} aria-hidden="true">{text}</div>
    <div className="ledger-body"><h3 className="ledger-title">{group.location.label}</h3><p className="body-text muted">{note}</p>
      <ul className="ledger-rows"><Row location={group.location} index={index} selected={selected} />
        {group.members.map(location => <Row key={location.id} location={location} index={index} selected={selected} />)}</ul>
      {!group.members.length && <p className="body-text muted">No locations recorded on this level.</p>}
    </div>
  </section>;
}
export function BuildingScope() {
  const topology = useTopology();
  useEffect(() => { topology.activate(); }, [topology.activate]);
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
    {buildingId && model && index && <>
      <p className="body-text muted">Selected membership read: {topology.memberSourceStatus}</p>
      <section className="ledger topology-building"><div className="ledger-floor topology-glyph" aria-hidden="true">BLD</div><div className="ledger-body">
        <h2 className="ledger-title">{model.building.label}</h2><p className="body-text muted">Building · reviewed · {model.levels.length} levels · {model.direct.length} without level</p>
        <ul className="ledger-rows"><Row location={model.building} index={index} selected={selection} /></ul>
      </div></section>
      <div className="filter-row topology-chips" role="group" aria-label="Level">
        <button type="button" className="chip-btn" aria-pressed={levelId === 'all'} onClick={() => topology.chooseLevel('all')}>All levels</button>
        {model.levels.map(l => <button key={l.location.id} type="button" className="chip-btn" title={l.location.id} aria-pressed={levelId === l.location.id} onClick={() => topology.chooseLevel(l.location.id)}>{l.location.label}</button>)}
        <button type="button" className="chip-btn" aria-pressed={levelId === 'direct'} onClick={() => topology.chooseLevel('direct')}>Level not recorded</button>
      </div>
      {model.levels.some(l => l.elevation.status === 'known') && <p className="body-text muted">Order uses recorded elevation within one datum; labels set no order.</p>}
      {shown.map(group => {
        const datum = group.elevation.status === 'known' ? group.elevation.elevation.datumAtlasId : 'unknown';
        const heading = datum !== priorDatum; priorDatum = datum;
        return <div key={group.location.id}>{heading && <h2 className="topology-band-title">{datum === 'unknown' ? 'Levels, elevation unknown' : `Measured from ${index.locations.get(datum)?.label ?? datum}`}</h2>}<Level group={group} index={index} selected={selection} /></div>;
      })}
      {(levelId === 'all' || levelId === 'direct') && <section className="ledger"><div className="ledger-floor topology-glyph" aria-hidden="true">—</div><div className="ledger-body">
        <h2 className="ledger-title">In {model.building.label}, level not recorded</h2>
        {model.direct.length ? <ul className="ledger-rows">{model.direct.map(l => <Row key={l.id} location={l} index={index} selected={selection} note="Building member, level not recorded" />)}</ul> : <p className="body-text muted">No members without a recorded level.</p>}
      </div></section>}
      <details className="topology-outside"><summary>Not in {model.building.label} ({model.outsideUnassigned.length + model.outsideElsewhere.length})</summary>
        <h3>No reviewed building or level membership</h3><ul className="ledger-rows">{model.outsideUnassigned.map(l => <Row key={l.id} location={l} index={index} selected={selection} />)}</ul>
        <h3>Reviewed membership elsewhere</h3><ul className="ledger-rows">{model.outsideElsewhere.map(l => <Row key={l.id} location={l} index={index} selected={selection}
          note={index.membership.filter(e => e.payload.to.ref.recordId === l.id).map(e => `Direct container: ${index.locations.get(e.payload.from.ref.recordId)?.label ?? e.payload.from.ref.recordId}`).join('; ')} />)}</ul>
      </details>
    </>}
  </div>;
}
