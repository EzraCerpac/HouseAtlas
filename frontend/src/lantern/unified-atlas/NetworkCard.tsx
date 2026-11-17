import type { ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { InlineTime } from '../components/ui';
import type { NetworkLiveFacts, NetworkObservationValue, NetworkOverlaySource } from '../overlays/network/types';
import type { NetworkConnection, NetworkConnectionEnd, NetworkConnectionNode, NetworkConnections } from './network-connections';
import { NETWORK_UNPLACED_LABEL, networkLinkStyle, networkUnplacedReason, type NetworkLinkStyle } from './network-map';
import { plural } from './atlas-text';

/** What the Network layer has chosen on the map: a device, a reported link, or
 * one room's devices (its +n chip). Choosing never moves the camera. */
export type NetworkFocus = { readonly kind: 'device' | 'link'; readonly key: string } | { readonly kind: 'room'; readonly occurrenceId: string };

/** The inspector card for a network choice: its head and body. */
export interface NetworkCardContent {
  readonly key: string; readonly title: string; readonly sub: string; readonly label: string; readonly body: ReactNode;
}

export const LINK_STYLE_LABEL: Record<NetworkLinkStyle, string> = { wired: 'Wired', wireless: 'Wireless', unknown: 'Medium unknown, unresolved or hypothesis' };
const LINK_KIND: Record<NetworkConnection['link']['kind'], string | null> = {
  connection: null, 'segment-membership': 'Segment membership', 'unresolved-path': 'Unresolved path', hypothesis: 'Hypothesis',
};

/** A link's ends as the device each one resolves to, when it does. */
const endDevice = (end: NetworkConnectionEnd) => end.ownerDeviceKey ?? end.nodeKey;
export const linkTouches = (row: NetworkConnection, nodeKey: string) => endDevice(row.from) === nodeKey || endDevice(row.to) === nodeKey;

const Stamp = ({ value }: { readonly value: string | null }) => value ? <InlineTime value={value} /> : <>Not supplied</>;
function SourceFacts({ source, qualification }: { readonly source: NetworkOverlaySource; readonly qualification: string }) {
  return <dl className="ua-facts ua-net-source">
    <div><dt>Source</dt><dd>{source.label}<span className="ua-note">{qualification}</span></dd></div>
    <div><dt>Source date</dt><dd><Stamp value={source.recordedAt} /></dd></div>
    <div><dt>Retrieved</dt><dd><Stamp value={source.retrievedAt} /></dd></div>
  </dl>;
}

const FRESHNESS: Record<NetworkLiveFacts['freshness'], string> = { recent: 'Recent', stale: 'Stale', invalidated: 'Invalidated', unknown: 'Unknown' };
const STATUS: Record<NetworkLiveFacts['status'], string> = {
  available: 'Listed by the Network source', stale: 'Listed by the Network source, stale', unknown: 'Unknown to the Network source',
  absent: 'Not listed in the Network source’s latest read',
};
const observed = (value: NetworkObservationValue): string => value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value);
/** What the Network source reports for this device now, with its own dates
 * and freshness. Shown only when the server joined such facts to the device. */
function LiveFacts({ facts }: { readonly facts: NetworkLiveFacts }) {
  return <section className="ua-records ua-net-live" aria-label="Network source facts">
    <h3 className="ua-records-head"><Icon name="wifi" size={16} />Network source facts</h3>
    <dl className="ua-facts">
      <div><dt>Status</dt><dd>{STATUS[facts.status]}</dd></div>
      {facts.status !== 'absent' && <div><dt>Addresses</dt><dd>{facts.addresses === null ? 'Not supplied'
        : facts.addresses.length === 0 ? 'No addresses supplied' : <ul className="ua-net-addresses">{facts.addresses.map(address => <li key={address}><code>{address}</code></li>)}</ul>}</dd></div>}
      {facts.status !== 'absent' && <div><dt>Last seen</dt><dd><Stamp value={facts.lastSeenAt} /></dd></div>}
      <div><dt>Freshness</dt><dd>{FRESHNESS[facts.freshness]}</dd></div>
      <div><dt>Snapshot</dt><dd><Stamp value={facts.sourceSnapshotAt} /></dd></div>
      <div><dt>Retrieved</dt><dd><Stamp value={facts.retrievedAt} /></dd></div>
    </dl>
    {facts.observedState && facts.observedState.length > 0 && <ul className="ua-net-observed">{facts.observedState.map(item =>
      <li key={item.id} className={item.freshness === 'recent' ? undefined : 'is-old'}>
        <span className="ua-belonging-name">{item.kind}: {observed(item.value)}</span>
        <span className="ua-belonging-detail">{FRESHNESS[item.freshness]} · observed <InlineTime value={item.factAt} /> from {item.vantage}
          {item.invalidatedAt && <> · invalidated <InlineTime value={item.invalidatedAt} /></>}</span></li>)}</ul>}
  </section>;
}

/** The card for the current choice, or null when it no longer resolves (its
 * source changed or went away). Only fields the source supplies are shown;
 * live facts appear only for a device the server joined them to. */
export function networkCardContent({ focus, connections, roomName, choose, showInGraph }: {
  readonly focus: NetworkFocus; readonly connections: NetworkConnections;
  /** A room part's name and its floor's name. */
  readonly roomName: (occurrenceId: string) => { readonly room: string; readonly floor: string };
  readonly choose: (next: NetworkFocus) => void;
  readonly showInGraph: (graphKey: string, choice: { readonly kind: 'device' | 'link'; readonly id: string }) => void;
}): NetworkCardContent | null {
  const nodes = new Map(connections.nodes.map(node => [node.key, node]));
  const deviceButton = (key: string | null, fallback: string) => {
    const node = key === null ? undefined : nodes.get(key);
    return node?.device ? <button type="button" className="text-btn ua-net-end" onClick={() => choose({ kind: 'device', key: node.key })}>{node.device.label}</button>
      : <span>{fallback}</span>;
  };
  const placement = (node: NetworkConnectionNode) => {
    const rooms = [...new Set(node.anchors.map(anchor => anchor.occurrenceId))];
    return rooms.length > 0 ? `${rooms.map(id => { const { room, floor } = roomName(id); return `${room}, ${floor}`; }).join('; ')} · reviewed room mapping`
      : `Not placed · ${NETWORK_UNPLACED_LABEL[networkUnplacedReason(node.device!)]}`;
  };
  if (focus.kind === 'room') {
    const devices = connections.nodes.filter(node => node.device && node.anchors.some(anchor => anchor.occurrenceId === focus.occurrenceId));
    if (devices.length === 0) return null;
    const { room, floor } = roomName(focus.occurrenceId);
    return { key: `room:${focus.occurrenceId}`, title: room, sub: `${floor} · ${plural(devices.length, 'network device')}`,
      label: 'Network devices in this room',
      body: <ul className="ua-net-list">{devices.map(node => <li key={node.key}>
        <button type="button" className="ua-belonging" onClick={() => choose({ kind: 'device', key: node.key })}>
          <span className="ua-net-dot" aria-hidden="true" /><span><span className="ua-belonging-name">{node.device!.label}</span>
            {node.device!.kind && <span className="ua-belonging-detail">{node.device!.kind}</span>}</span></button></li>)}</ul> };
  }
  if (focus.kind === 'device') {
    const node = nodes.get(focus.key);
    if (!node?.device) return null;
    const device = node.device;
    const links = connections.connections.filter(row => linkTouches(row, node.key));
    const source = connections.connections.find(row => row.graphKey === node.graphKey);
    return { key: `device:${node.key}`, title: device.label, sub: [device.kind || 'Kind not supplied', device.sourceRoot ? 'Network root' : null].filter(Boolean).join(' · '),
      label: 'Selected network device',
      body: <>
        <dl className="ua-facts">
          <div><dt>Placement</dt><dd>{placement(node)}{device.place?.basis && <span className="ua-note">{device.place.basis}</span>}</dd></div>
          <div><dt>Confidence</dt><dd>{device.confidence}</dd></div>
          {device.notes && <div><dt>Notes</dt><dd>{device.notes}</dd></div>}
        </dl>
        {links.length > 0 && <section className="ua-records" aria-label="Reported links">
          <h3 className="ua-records-head"><Icon name="link" size={16} />Reported links<span className="ua-records-count">{links.length.toLocaleString()}</span></h3>
          <ul className="ua-net-list">{links.map(row => {
            const far = endDevice(row.from) === node.key ? row.to : row.from;
            return <li key={row.key} className="ua-net-link-row">
              <button type="button" className="ua-belonging" onClick={() => choose({ kind: 'link', key: row.key })}>
                <LinkSwatch style={networkLinkStyle(row.link, [row.from, row.to])} uncertain={row.link.confidence !== 'accepted' && row.link.confidence !== 'recorded'} />
                <span><span className="ua-belonging-name">{nodes.get(endDevice(far) ?? '')?.device?.label ?? far.label}</span>
                  <span className="ua-belonging-detail">{[row.link.medium || 'Medium not supplied', LINK_KIND[row.link.kind], row.link.confidence].filter(Boolean).join(' · ')}</span></span>
              </button></li>;
          })}</ul>
        </section>}
        {device.liveFacts && <LiveFacts facts={device.liveFacts} />}
        {source && <SourceFacts source={source.source} qualification={source.qualification} />}
        <button type="button" className="text-btn ua-net-graph-link" onClick={() => showInGraph(node.graphKey, { kind: 'device', id: device.id })}>
          <Icon name="network" size={16} />Show in graph</button>
      </> };
  }
  const row = connections.connections.find(item => item.key === focus.key);
  if (!row) return null;
  const { link } = row, from = nodes.get(endDevice(row.from) ?? '')?.device?.label ?? row.from.label, to = nodes.get(endDevice(row.to) ?? '')?.device?.label ?? row.to.label;
  return { key: `link:${row.key}`, title: `${from} – ${to}`, sub: [link.medium || 'Medium not supplied', LINK_KIND[link.kind]].filter(Boolean).join(' · '),
    label: 'Selected network link',
    body: <>
      <dl className="ua-facts">
        <div><dt>Ends</dt><dd className="ua-net-ends">{deviceButton(endDevice(row.from), row.from.label)}{deviceButton(endDevice(row.to), row.to.label)}</dd></div>
        <div><dt>Medium</dt><dd>{link.medium || 'Not supplied'}</dd></div>
        <div><dt>Confidence</dt><dd>{[link.confidence, link.sourceConfidence && `source: ${link.sourceConfidence}`].filter(Boolean).join(' · ')}</dd></div>
        {link.temporalStatus && <div><dt>Status</dt><dd>{link.temporalStatus}</dd></div>}
        {link.basis && <div><dt>Basis</dt><dd>{link.basis}</dd></div>}
        <div><dt>Link date</dt><dd><Stamp value={link.recordedAt} /></dd></div>
        {link.notes && <div><dt>Notes</dt><dd>{link.notes}</dd></div>}
      </dl>
      <SourceFacts source={row.source} qualification={row.qualification} />
      <button type="button" className="text-btn ua-net-graph-link" onClick={() => showInGraph(row.graphKey, { kind: 'link', id: link.id })}>
        <Icon name="network" size={16} />Show in graph</button>
    </> };
}

/** A line sample in the link's own style, as the key draws it. */
export function LinkSwatch({ style, uncertain = false }: { readonly style: NetworkLinkStyle; readonly uncertain?: boolean }) {
  return <svg className={`ua-net-swatch is-${style}${uncertain ? ' is-uncertain' : ''}`} width={22} height={10} viewBox="0 0 22 10" aria-hidden="true">
    <line x1={1} y1={5} x2={21} y2={5} /></svg>;
}
