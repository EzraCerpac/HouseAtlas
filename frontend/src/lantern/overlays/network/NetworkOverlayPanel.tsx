import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { NetworkOverlayData, NetworkOverlayDevice, NetworkOverlayPanelProps, NetworkOverlaySelection } from './types';
import { devicePlacement, endpointDeviceId, groupNetworkDevices, networkDevicePlace, networkEndpointLabel, networkLinkLabel, networkPlanReferences, networkReviewedPlaces, networkSelection } from './model';
import { Icon } from '../../components/Icon';
import { ClaimBadge, Note } from '../../components/ui';
import { LAYER } from '../../atlas/palette';
import { NetworkTopology } from './NetworkTopology';
import './network.css';

const stamp = (value: string | null) => value ?? 'Unknown';

/** Pure documentary panel beside the scan. No reads, source writes or mesh placement. */
export function NetworkOverlayPanel(props: NetworkOverlayPanelProps) {
  const { active, viewKey, data, selectedFloor = null, selectedPlaceId = null, selectedPackagePlaces = null } = props;
  const id = useId();
  const detail = useRef<HTMLDivElement>(null);
  const [stored, setStored] = useState<{ data: NetworkOverlayData; placeId: typeof selectedPlaceId;
    packageSelection: typeof selectedPackagePlaces; selection: NetworkOverlaySelection } | null>(null);
  const currentProps = useRef(props); currentProps.current = props;
  const current = active && data?.viewKey === viewKey ? data : null;
  const selection = stored !== null && stored.data === current && stored.placeId === selectedPlaceId
    && stored.packageSelection === selectedPackagePlaces ? stored.selection : null;
  const chosen = current ? networkSelection(current, selection) : null;
  const live = () => currentProps.current.active && currentProps.current.viewKey === viewKey
    && currentProps.current.data === current && (currentProps.current.selectedPlaceId ?? null) === selectedPlaceId
    && (currentProps.current.selectedPackagePlaces ?? null) === selectedPackagePlaces && current?.viewKey === viewKey;
  useLayoutEffect(() => {
    if (stored !== null && (current === null || stored.data !== current || stored.placeId !== selectedPlaceId
      || stored.packageSelection !== selectedPackagePlaces || !networkSelection(current, stored.selection))) {
      setStored(null);
      currentProps.current.onSelectionChange?.(null);
    }
  }, [current, selectedPlaceId, selectedPackagePlaces, stored]);
  if (!active) return null;
  const select = (next: NetworkOverlaySelection | null) => {
    if (!current || !live() || (next !== null && !networkSelection(current, next))) return;
    setStored(next ? { data: current, placeId: selectedPlaceId, packageSelection: selectedPackagePlaces, selection: next } : null);
    currentProps.current.onSelectionChange?.(next);
    if (next) requestAnimationFrame(() => { if (live()) detail.current?.focus(); });
  };
  if (current === null) return <section className="network-overlay" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>Internet network</h3><p role="status">Network overlay unavailable for this view.</p>
  </section>;
  const reviewed = networkReviewedPlaces(current, selectedPackagePlaces);
  const groups = groupNetworkDevices(current.devices);
  const rooms = reviewed !== null ? groupNetworkDevices(reviewed.devices).rooms : selectedPlaceId === null ? groups.rooms
    : groupNetworkDevices(current.devices.filter(device => networkDevicePlace(device)?.placeId === selectedPlaceId)).rooms;
  const roomDeviceIds = reviewed !== null || selectedPlaceId !== null
    ? new Set(rooms.flatMap(room => room.devices.map(device => device.id))) : null;
  const showRoom = (device: NetworkOverlayDevice) => roomDeviceIds === null || roomDeviceIds.has(device.id);
  const placement = (device: NetworkOverlayDevice) => showRoom(device) || networkDevicePlace(device) === null
    ? devicePlacement(device) : 'Outside selected room context';
  const planReferences = (device: NetworkOverlayDevice) => showRoom(device)
    ? networkPlanReferences(current, device, selectedPackagePlaces) : [];
  const source = current.source;
  const accepted = source.status === 'accepted';
  const deviceButton = (device: NetworkOverlayDevice) => <button key={device.id} type="button"
    className="network-overlay-record" aria-pressed={selection?.kind === 'device' && selection.id === device.id}
    onClick={() => select({ kind: 'device', id: device.id })}>
    <strong><Icon name="wifi" size={16} /> {device.label}</strong><span>{device.kind} · {device.confidence === 'accepted' ? 'Saved configuration' : device.confidence} {device.confidence !== 'accepted' && <ClaimBadge claim={device.confidence === 'recorded' ? 'source' : device.confidence === 'conflicting' ? 'disputed' : 'unknown'} />} </span>
    <span>{placement(device)}</span>
    {device.place && networkDevicePlace(device) && <span>{!accepted && <>Room association: {device.place.confidence} · </>}Scan mapping: {device.place.mappingStatus}
      {device.place.floorKey === null ? ' · Scan floor unbound' : ' · Recorded scan floor association'}</span>}
    {planReferences(device).length ? <span>Reviewed plan: {planReferences(device).map(reference => `${reference.sourceFloorLabel} ${reference.sourceReference}`).join(' · ')}</span> : null}
  </button>;
  return <section className="network-overlay" aria-labelledby={`${id}-title`}>
    <header style={{ color: LAYER.network.color }}><Icon name="network" /><h3 id={`${id}-title`}>Internet network</h3><span className="network-overlay-badge">{accepted ? 'User-accepted configuration' : source.status === 'stale' ? 'Stale recorded data' : 'Recorded data'}</span></header>
    <dl className="network-overlay-source"><dt>Source</dt><dd>{source.label}</dd><dt>Revision</dt><dd>{stamp(source.revision)}</dd>
      <dt>Recorded</dt><dd>{stamp(source.recordedAt)}</dd><dt>Retrieved</dt><dd>{stamp(source.retrievedAt)}</dd>
      <dt>Inventory coverage</dt><dd>{source.coverage}</dd>{source.acceptedAt && <><dt>Configuration accepted</dt><dd>{source.acceptedAt}</dd></>}</dl>
    {!accepted && source.notes && <p>{source.notes}</p>}
    <Note>Room associations have no scan positions. Links describe topology; cable routes and wireless coverage are unknown.</Note>
    {selectedFloor !== null && <p>Exported floor selection does not establish device placement. Connections across floors remain visible.</p>}
    {reviewed === null && selectedPlaceId !== null && <p>{current.devices.filter(device => device.mobility !== 'mobile' && device.mobility !== 'nonspatial'
      && device.place?.placeId === selectedPlaceId).length} device associations with the selected Atlas place. All logical connections remain visible.</p>}
    {reviewed !== null && <p>{reviewed.eligible ? `${reviewed.devices.length} device associations with the reviewed room selection.` : 'Room-specific associations unavailable for this selection.'} All logical connections remain visible.</p>}
    {reviewed?.eligible && selectedPackagePlaces!.unresolvedLabels.length > 0 && <p>Unresolved parts of the selected area: {selectedPackagePlaces!.unresolvedLabels.join(' · ')}</p>}
    <NetworkTopology data={current} selection={selection} onSelect={select} roomDeviceIds={roomDeviceIds} />
    <div className="network-overlay-layout"><div>
      <h4>Room associations ({rooms.reduce((sum, room) => sum + room.devices.length, 0)})</h4>
      {rooms.length === 0 && <p>No fixed room associations available for this context.</p>}
      {rooms.map(room => <section key={room.key} className="network-overlay-room"><h5>{room.label}</h5>{room.devices.map(deviceButton)}</section>)}
      <h4>Unsited ({groups.unsited.length})</h4>{groups.unsited.map(deviceButton)}
      <details><summary>Excluded from floor placement ({groups.excluded.length})</summary>{groups.excluded.map(deviceButton)}</details>
      {(accepted ? ['source'] as const : ['source', 'hypothesis'] as const).map(category => {
        const links = accepted ? current.links : current.links.filter(link => (link.kind === 'hypothesis') === (category === 'hypothesis'));
        return <section key={category}><h4>{category === 'source' ? accepted ? 'Saved connections' : 'Topology links' : 'Owner hypotheses'} ({links.length})</h4>
          {category === 'hypothesis' && links.length > 0 && <p>Unverified and excluded from the source link count.</p>}
          {category === 'source' && links.length === 0 && <p>No topology links recorded.</p>}
          {links.map(link => <button key={link.id} type="button" className="network-overlay-record"
            aria-pressed={selection?.kind === 'link' && selection.id === link.id} onClick={() => select({ kind: 'link', id: link.id })}>
            <strong><Icon name="link" size={16} /> {networkLinkLabel(current, link)}</strong>
            <span>{link.confidence === 'accepted' ? 'Saved connection' : link.kind === 'hypothesis' ? 'Owner hypothesis' : link.kind} · {link.medium === 'unknown' && accepted ? 'Type not recorded' : link.medium}{!accepted && ` · ${link.confidence} · ${link.temporalStatus}`}</span>
          </button>)}
        </section>;
      })}
    </div><div className="network-overlay-detail" ref={detail} tabIndex={-1} role="region" aria-labelledby={`${id}-selection`}>
      {chosen ? <><h4 id={`${id}-selection`}>{chosen.kind === 'device' ? chosen.device.label : networkLinkLabel(current, chosen.link)}</h4>
        <button type="button" onClick={() => select(null)}>Clear network selection</button>
        {chosen.kind === 'device' ? <><dl><dt>Type</dt><dd>{chosen.device.kind}</dd><dt>Placement</dt><dd>{placement(chosen.device)}</dd>
          {!accepted && <><dt>Confidence</dt><dd>{chosen.device.confidence}</dd></>}
          {showRoom(chosen.device) && chosen.device.place && networkDevicePlace(chosen.device) && <>{!accepted && <><dt>Room evidence</dt><dd>{chosen.device.place.basis || 'Unknown'}</dd><dt>Room confidence</dt><dd>{chosen.device.place.confidence}</dd></>}<dt>Scan floor</dt><dd>{chosen.device.place.floorKey === null ? 'Unbound' : 'Recorded association; no scan position'}</dd>
            <dt>Scan mapping</dt><dd>{chosen.device.place.mappingStatus}</dd>
            {planReferences(chosen.device).length ? <><dt>Reviewed room plans</dt><dd>{planReferences(chosen.device).map((reference, index) => <p key={index}>{reference.sourceFloorLabel} · {reference.sourceReference}</p>)}Room references do not establish a device position.</dd></> : null}</>}
          <dt>Scan position</dt><dd>Unavailable</dd></dl>{!accepted && chosen.device.notes && <p>{chosen.device.notes}</p>}
          <h5>Connected topology links</h5>{current.links.filter(link => endpointDeviceId(current, link.fromEndpointId) === chosen.device.id || endpointDeviceId(current, link.toEndpointId) === chosen.device.id)
            .map(link => <button key={link.id} type="button" className="network-overlay-record" onClick={() => select({ kind: 'link', id: link.id })}>
              {networkLinkLabel(current, link)}{link.confidence !== 'accepted' && ` · ${link.confidence}`}</button>)}</>
          : <><dl><dt>Relation</dt><dd>{accepted ? chosen.link.kind === 'segment-membership' ? 'Segment membership' : 'Connection' : chosen.link.kind === 'hypothesis' ? 'Owner hypothesis; not a source link' : chosen.link.kind}</dd><dt>Medium</dt><dd>{accepted && chosen.link.medium === 'unknown' ? 'Type not recorded' : chosen.link.medium}</dd>{!accepted && <><dt>Confidence</dt><dd>{chosen.link.confidence}</dd><dt>Source confidence</dt><dd>{stamp(chosen.link.sourceConfidence)}</dd><dt>Temporal status</dt><dd>{chosen.link.temporalStatus}</dd></>}<dt>Recorded</dt><dd>{stamp(chosen.link.recordedAt)}</dd><dt>Date precision</dt><dd>{stamp(chosen.link.recordedAtPrecision)}</dd>
            {!accepted && <><dt>Evidence</dt><dd>{chosen.link.basis || 'Unknown'}</dd></>}<dt>Physical route</dt><dd>Unknown</dd></dl>
            {!accepted && chosen.link.notes && <p>{chosen.link.notes}</p>}
            {[chosen.link.fromEndpointId, chosen.link.toEndpointId].map((endpoint, index) => {
              const endpointRecord = current.endpoints.find(entry => entry.id === endpoint);
              const deviceId = endpointDeviceId(current, endpoint);
              const device = current.devices.find(entry => entry.id === deviceId);
              return <div key={index}><p>{accepted && endpointRecord?.kind === 'unresolved' ? 'Saved endpoint' : endpointRecord?.kind ?? (device ? 'device' : 'saved endpoint')} · {networkEndpointLabel(current, endpoint)}</p>
                {!accepted && endpointRecord?.notes && <p>{endpointRecord.notes}</p>}{device ? <button type="button" className="network-overlay-record" onClick={() => select({ kind: 'device', id: device.id })}>
                {networkEndpointLabel(current, endpoint)} · {placement(device)}</button> : <p>No physical position</p>}</div>;
            })}</>}
      </> : <><h4 id={`${id}-selection`}>Network selection</h4><p>Select a device or connection to view its details.</p></>}
    </div></div>
  </section>;
}
