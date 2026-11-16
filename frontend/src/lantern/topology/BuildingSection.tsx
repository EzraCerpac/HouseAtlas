import { useEffect, useSyncExternalStore } from 'react';
import { useTopology } from './TopologyProvider';
import { metres, type BuildingModel, type Location, type TopologyIndex, type LevelGroup } from './model';
import { useSelect, useStore } from '../state/store';
import { Icon } from '../components/Icon';

// The default Atlas without a house model draws only this section; the full
// building ledger with its native place tools loads with the Rooms & places lens.
export const messages = {
  loading: 'Loading building records…', unavailable: 'Building records could not be loaded. Reload saved information in Settings to retry.',
  denied: 'Access to building records is denied.', expired: 'The session for this read has expired.',
  timedOut: 'Building records could not be loaded within the read deadline.', tooLarge: "Building records exceed this list’s read limit.",
  continuationUnavailable: 'Building records could not be continued. Reload saved information in Settings.',
  changed: 'Building records differ between reads. Reload saved information in Settings.', ready: '',
};

// Offline, a failed live read is not a fault to retry: no reload repeats it until the
// device is online. The offline host says the same for a held copy saved without them.
export const offlineMessage = 'Offline: building records are not held in this saved copy. Connect and open live to read them.';
const watchOnline = (notify: () => void) => { addEventListener('online', notify); addEventListener('offline', notify); return () => { removeEventListener('online', notify); removeEventListener('offline', notify); }; };
/** The text for a building-record read status; an unavailable read while the browser reports offline names the limitation. */
export function useBuildingMessages(): (key: keyof typeof messages) => string {
  const offline = useSyncExternalStore(watchOnline, () => navigator.onLine === false, () => false);
  return key => key === 'unavailable' && offline ? offlineMessage : messages[key];
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
  const say = useBuildingMessages();
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
      <p className="section-status" role="status">{status !== 'ready' ? say(status) : buildingId && memberStatus !== 'ready' ? say(memberStatus) : topology.notice || (model ? `${model.building.label}: ${model.memberCount} locations in reviewed membership` : index?.buildings.length ? '' : 'No reviewed buildings in this home.')}</p>
      {buildingId && model && index ? <Drawing model={model} index={index} /> : buildingId === null && <Counts />}
    </div>
  </div>;
}
