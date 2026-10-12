import { useEffect, useId, useState } from 'react';
import type { CSSProperties } from 'react';
import type { NetworkOverlayDevice, NetworkOverlayPanelProps, NetworkSceneInspectorProps } from './types';
import { devicePlacement, endpointDeviceId, networkDevicePlace, networkEndpointLabel, networkLinkLabel,
  networkPlanReferences, networkReviewedPlaces, networkSceneSelection } from './model';
import { Icon } from '../../components/Icon';
import { LAYER } from '../../atlas/palette';
import './scene.css';

/** Secondary records/details surface. Source metadata stays behind disclosure. */
export function NetworkSceneInspector({ active, viewKey, data, selection, records = null, placedDeviceIds = [],
  selectedPackagePlaces = null, onSelectionChange, onClose }: NetworkSceneInspectorProps) {
  const id = useId();
  const [tab, setTab] = useState<'devices' | 'links' | 'unplaced' | null>(null);
  useEffect(() => setTab(null), [records, viewKey, active]);
  const close = () => { setTab(null); onClose(); };
  const current = active && data?.viewKey === viewKey ? data : null;
  if (!active || (!selection && records === null)) return null;
  if (!current) return <aside className="network-scene-inspector" aria-label="Network records">
    <button className="network-scene-close" aria-label="Close network details" onClick={close}><Icon name="close" /></button>
    <p role="status">Network records unavailable for this view.</p>
  </aside>;
  const chosen = networkSceneSelection(current, selection, placedDeviceIds, selectedPackagePlaces);
  const reviewed = networkReviewedPlaces(current, selectedPackagePlaces);
  const showRoom = (device: NetworkOverlayDevice) => reviewed === null || reviewed.devices.some(entry => entry.id === device.id);
  const placement = (device: NetworkOverlayDevice) => networkDevicePlace(device) === null ? devicePlacement(device)
    : showRoom(device) ? device.place!.roomLabel : 'Outside selected room context';
  const placeIds = new Set(placedDeviceIds);
  const mode = tab ?? records ?? 'devices';
  const devices = mode === 'unplaced' ? current.devices.filter(device => !placeIds.has(device.id)) : current.devices;
  const title = chosen?.kind === 'device' ? chosen.device.label : chosen?.kind === 'link' || chosen?.kind === 'shared-medium' ? 'Network connection' : 'Network';
  const linkRow = (link: typeof current.links[number]) => <button key={link.id} type="button" className="network-scene-record"
    onClick={() => onSelectionChange({ kind: 'link', id: link.id })}>
    <Icon name="link" size={16} /><span><strong>{networkLinkLabel(current, link)}</strong><small>{link.medium === 'unknown' ? 'Type not recorded' : link.medium}</small></span><Icon name="chevron" size={14} />
  </button>;
  const deviceRow = (device: NetworkOverlayDevice) => <button key={device.id} type="button" className="network-scene-record"
    onClick={() => onSelectionChange({ kind: 'device', id: device.id })}>
    <Icon name="wifi" size={16} /><span><strong>{device.label}</strong><small>{placement(device)}{placeIds.has(device.id) ? ' · Room marker' : ''}</small></span><Icon name="chevron" size={14} />
  </button>;
  return <aside className="network-scene-inspector stage-ui" aria-labelledby={`${id}-title`}>
    <header><span className="network-scene-overline"><span className="network-scene-swatch" /> Network</span>
      <button type="button" className="network-scene-close" aria-label="Close network details" onClick={close}><Icon name="close" /></button>
      <h3 id={`${id}-title`}>{title}</h3>
    </header>
    <div className="network-scene-inspector-body">
      {chosen ? <>
        <button type="button" className="network-scene-back" onClick={() => onSelectionChange(null)}><Icon name="back" size={16} /> Clear selection</button>
        {chosen.kind === 'device' ? <>
          <p className="network-scene-location"><Icon name="rooms" size={16} /> {placement(chosen.device)}</p>
          <p className="network-scene-sub">{chosen.device.kind} · {placeIds.has(chosen.device.id) ? 'Room-level schematic marker' : 'Unplaced on shown plans'}</p>
          <h4>Connections</h4>
          {current.links.filter(link => endpointDeviceId(current, link.fromEndpointId) === chosen.device.id
            || endpointDeviceId(current, link.toEndpointId) === chosen.device.id).map(linkRow)}
        </> : chosen.kind === 'shared-medium' ? <>
          <p className="network-scene-sub">Shared {chosen.association.medium} network · {chosen.association.segment.label}</p>
          {chosen.association.devices.map(deviceRow)}
          <p>Logical connection through the shared medium. Physical route unknown.</p>
          <h4>Recorded memberships</h4>
          {chosen.association.memberships.map(linkRow)}
        </> : <>
          <p className="network-scene-sub">{chosen.link.kind === 'segment-membership' ? 'Segment membership' : 'Logical connection'} · {chosen.link.medium === 'unknown' ? 'Type not recorded' : chosen.link.medium}</p>
          {[chosen.link.fromEndpointId, chosen.link.toEndpointId].map((endpoint, index) => {
            const device = current.devices.find(entry => entry.id === endpointDeviceId(current, endpoint));
            return <div key={index} className="network-scene-endpoint"><span>{index === 0 ? 'From' : 'To'}</span>
              {device ? deviceRow(device) : <p>{networkEndpointLabel(current, endpoint)}<small>Unplaced endpoint</small></p>}</div>;
          })}
        </>}
      </> : <>
        <p className="network-scene-sub">{current.devices.length} devices · {current.links.length} connections</p>
        <div className="network-scene-tabs" role="group" aria-label="Network records">
          {(['devices', 'links', 'unplaced'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value}
            onClick={() => setTab(value)}>{value === 'devices' ? 'Devices' : value === 'links' ? 'Connections' : 'Unplaced'}</button>)}
        </div>
        {mode === 'links' ? current.links.map(linkRow) : devices.map(deviceRow)}
      </>}
      <details className="network-scene-provenance"><summary>Source &amp; placement</summary>
        <dl><dt>Source</dt><dd>{current.source.label}</dd><dt>Revision</dt><dd>{current.source.revision ?? 'Unknown'}</dd>
          <dt>Recorded</dt><dd>{current.source.recordedAt ?? 'Unknown'}</dd><dt>Retrieved</dt><dd>{current.source.retrievedAt ?? 'Unknown'}</dd>
          {current.source.acceptedAt && <><dt>Accepted</dt><dd>{current.source.acceptedAt}</dd></>}
          <dt>Configuration</dt><dd>{current.source.status === 'accepted' ? 'User-accepted configuration' : current.source.status === 'stale' ? 'Stale recorded data' : 'Recorded data'}</dd>
          {chosen?.kind === 'link' && <><dt>Relation recorded</dt><dd>{chosen.link.recordedAt ?? 'Not recorded'}</dd><dt>Date precision</dt><dd>{chosen.link.recordedAtPrecision ?? 'Not recorded'}</dd></>}
          {chosen?.kind === 'shared-medium' && chosen.association.memberships.map(link => <div key={link.id}><dt>Membership {link.id}</dt><dd>{link.recordedAt ?? 'Not recorded'} · {link.recordedAtPrecision ?? 'Precision not recorded'}</dd></div>)}
          </dl>
        {chosen?.kind === 'device' && showRoom(chosen.device) && networkPlanReferences(current, chosen.device, selectedPackagePlaces).length > 0 && <p>
          Reviewed room references: {networkPlanReferences(current, chosen.device, selectedPackagePlaces).map(reference => `${reference.sourceFloorLabel} ${reference.sourceReference}`).join(' · ')}
        </p>}
        <p>Markers identify rooms schematically. Device positions, cable routes and wireless coverage are unknown.</p>
      </details>
    </div>
  </aside>;
}

/** Small original-style legend trigger; the house remains the primary surface. */
export function NetworkSceneSummary({ active, viewKey, data, placedDeviceIds = [], onOpen }: Pick<NetworkOverlayPanelProps, 'active' | 'viewKey' | 'data'>
  & { readonly placedDeviceIds?: readonly string[]; readonly onOpen: () => void }) {
  const summaryId = useId();
  const current = active && data?.viewKey === viewKey ? data : null;
  if (!active) return null;
  const placed = current ? current.devices.filter(device => placedDeviceIds.includes(device.id)).length : 0;
  return <button type="button" className="network-scene-summary legend stage-ui" style={{ '--layer': LAYER.network.color } as CSSProperties}
    aria-label="Open network records" aria-describedby={current ? `${summaryId}-route-note` : undefined} onClick={onOpen}>
    <span className="legend-head"><span className="network-scene-swatch" /> Network <Icon name="chevron" size={16} /></span>
    <span className="network-scene-summary-counts">{current ? `${current.devices.length} devices · ${current.links.length} connections` : 'Unavailable for this view'}</span>
    {current && <span className="network-scene-summary-note">{placed} room markers · {current.devices.length - placed} unplaced</span>}
    {current && <span id={`${summaryId}-route-note`} className="network-scene-summary-note">Logical connections; cable routes unknown.</span>}
  </button>;
}
