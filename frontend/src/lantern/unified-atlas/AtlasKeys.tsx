import { useId, useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { BIRCH, BIRCH_DARK } from '../atlas/palette';
import { TONE_COLOR } from '../canonical-ifc/tones';
import { unplacedByReason, type OverlayLayerIndex } from './scene';
import { PublishedUnplacedBinding } from './PublishedOverlayDetails';
import type { BuildingCoverage, DocumentaryRecord, PropertyRecords } from './runtime-overlays';
import { MEASURED_BASIS, MEASUREMENT_BASIS } from './measurements';
import type { OverlayFeedSnapshot } from './overlay-feed';
import { LINK_STYLE_LABEL, LinkSwatch } from './NetworkCard';
import { NETWORK_UNPLACED_LABEL, type NetworkUnplacedReason } from './network-map';
import { OVERLAY_ICON, OVERLAY_LABEL, plural, stampTime, UNPLACED_LABEL } from './atlas-text';

export function DocumentaryRecords({ records, openDocuments, onElectricalGroup, canElectricalGroup }: { readonly records: readonly DocumentaryRecord[]; readonly openDocuments: (() => void) | undefined; readonly onElectricalGroup?: ((recordKey: string) => void) | undefined; readonly canElectricalGroup?: ((recordKey: string) => boolean) | undefined }) {
  // Short type names and glyphs for the categories the source names; any other
  // category shows its original string. The full category stays in the details.
  const types: Readonly<Record<string, { readonly short: string; readonly icon: string }>> = {
    'Electrical drawing': { short: 'Drawing', icon: 'file' },
    'Historical symbol': { short: 'Historic symbol', icon: 'symbol' },
    'Recorded device': { short: 'Device', icon: 'box' },
    'Recorded connection': { short: 'Connection', icon: 'link' },
    'Network endpoint': { short: 'Endpoint', icon: 'network' },
  };
  if (!records.length) return <p>No linked records in the available source.</p>;
  // Collapsed, each row names the record, its type and its qualification;
  // opened, its category and detail, dates, connections and sources.
  return <div className="ua-docs">{records.map(record => {
    const type = Object.prototype.hasOwnProperty.call(types, record.category) ? types[record.category]! : null;
    return <details className="ua-refs ua-doc" key={record.key}>
      <summary>
        <Icon name={type?.icon ?? 'record'} size={16} className="ua-doc-glyph" />
        <span className="ua-doc-head">
          <span className="ua-doc-label">{record.label}</span>
          <span className="ua-doc-type">{type?.short ?? record.category}</span>
        </span>
        <span className="ua-doc-qual">{record.qualification}</span>
      </summary>
      {/* Opened: the record's own facts, labelled, with every connection. */}
      <dl className="ua-doc-facts">
        <div><dt>Category</dt><dd>{record.category}</dd></div>
        {record.detail && <div><dt>Detail</dt><dd>{record.detail}</dd></div>}
        <div><dt>Source date</dt><dd>{record.sourceDate ?? 'unknown'}</dd></div>
        <div><dt>Retrieved</dt><dd>{record.retrievedAt ?? 'unknown'}</dd></div>
        {record.connections.length > 0 && <div><dt>Connections</dt><dd><ul>{record.connections.map((connection, at) => <li key={at}>{connection}</li>)}</ul></dd></div>}
      </dl>
      {onElectricalGroup && canElectricalGroup?.(record.key) && <button type="button" className="text-btn" onClick={() => onElectricalGroup(record.key)}>Show drawing group</button>}
      {openDocuments && (record.category === 'Electrical drawing' || record.category === 'Historical symbol') && <button type="button" className="text-btn" onClick={openDocuments}>Open Documents</button>}
      <details className="ua-source"><summary>Source</summary><dl><div><dt>Source record</dt><dd>{record.id}</dd></div>
        {record.sourceFacts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value ?? 'unknown'}</dd></div>)}
      </dl></details>
      {record.observations && record.observations.length > 0 && <details className="ua-source">
        <summary>Other source observations ({record.observations.length})</summary>
        <DocumentaryRecords records={record.observations} openDocuments={openDocuments} />
      </details>}
    </details>;
  })}</div>;
}

const COVERAGE_TEXT = { available: 'Available', partial: 'Partial', unavailable: 'Unavailable' } as const;

/** The Network layer's map key, where the source supplies a network: what the
 * line styles mean, devices without a room, and the graph. */
export interface NetworkKey {
  /** Devices in the source's network, placed or not. */
  readonly devices: number;
  readonly unplaced: readonly { readonly key: string; readonly label: string; readonly kind: string; readonly reason: NetworkUnplacedReason }[];
  /** Opens a device's card. */
  readonly open: (key: string) => void;
  /** The logical network graph's own panel. */
  readonly graph: { readonly id: string; readonly open: boolean; readonly toggle: () => void };
}

export function OverlayKey({ layer, availability, records, stored, buildings, openDocuments, publishedOnly, network }: {
  readonly layer: OverlayLayerIndex; readonly openDocuments: (() => void) | undefined;
  readonly records: PropertyRecords | null; readonly availability: 'available' | 'partial' | 'unavailable' | 'loading';
  /** Set while some building shows the copy last loaded on this device. */
  readonly stored: OverlayFeedSnapshot['stored'];
  readonly publishedOnly: boolean;
  readonly buildings: readonly BuildingCoverage[];
  /** The Network layer drawn as devices and links, when the source supplies its network. */
  readonly network?: NetworkKey | null;
}) {
  const reasons = unplacedByReason(layer);
  const unplaced = records?.unplaced[layer.kind] ?? [];
  // Topology stays separate from physical points: connections are logical only.
  const others = layer.kind === 'network' ? unplaced.filter(record => record.category !== 'Recorded connection') : unplaced;
  const groups = (['no-reviewed-room', 'moves-around'] as const).map(reason => ({ reason, rows: network?.unplaced.filter(row => row.reason === reason) ?? [] }))
    .filter(group => group.rows.length > 0);
  // Closed, the head keeps the layer's state in view; the explanation and
  // unplaced records open on request, so the model keeps the stage.
  const [closed, setClosed] = useState(true);
  const bodyId = useId();
  return <section className={`ua-key${closed ? ' is-closed' : ''}`} aria-label={`${OVERLAY_LABEL[layer.kind]} layer`} style={{ '--layer': TONE_COLOR[layer.kind] } as CSSProperties}>
    <button type="button" className="ua-key-head" aria-expanded={!closed} aria-controls={bodyId} onClick={() => setClosed(value => !value)}>
      <Icon name={OVERLAY_ICON[layer.kind]} size={17} /><span className="ua-key-label">{OVERLAY_LABEL[layer.kind]}</span>
      {/* A count only where the source answered; unavailable is not zero. */}
      <span className={`ua-key-count${availability === 'unavailable' || availability === 'partial' ? ' is-warn' : ''}`}>
        {availability === 'loading' ? 'Loading' : availability === 'unavailable' ? 'Unavailable'
          // Drawn as devices, the Network layer counts devices, as its Not placed list does.
          : network ? `${plural(network.devices, 'device')}${availability === 'partial' ? ', partial' : ''}${network.unplaced.length > 0 ? `, ${network.unplaced.length.toLocaleString()} not placed` : ''}${stored ? ', stored' : ''}`
          : `${plural(layer.records, 'record')}${availability === 'partial' ? ', partial' : ''}${layer.unplacedRecords > 0 ? `, ${layer.unplacedRecords.toLocaleString()} not placed` : ''}${stored ? ', stored' : ''}`}
      </span>
      <Icon name="chevronDown" size={16} />
    </button>
    <div className="ua-key-body" id={bodyId} hidden={closed}>
      {stored && <p className="ua-key-stored" role="status" aria-busy={stored.refreshing}><Icon name="history" size={15} />
        <span>Copy last loaded on this device, <time dateTime={stored.storedAt} title={stored.storedAt}>{stampTime(stored.storedAt)}</time>
          {stored.refreshing ? '; updating.' : '; not updated, the source is unreachable.'}</span></p>}
      {(!network || availability !== 'available') && <p>{availability === 'loading' ? 'Loading room sources…' : availability === 'unavailable' ? 'Current room sources are unavailable.'
        : availability === 'partial' ? 'Some buildings or sources are unavailable; their records are not counted.'
        : publishedOnly && layer.records === 0 ? 'No source references in this publication.'
        : layer.records === 0 ? 'No linked records in the available source.'
        : 'Counts show source records per room across the property, not device positions.'}</p>}
      {buildings.length > 0 && <ul className="ua-coverage-list" aria-label="Coverage by building">
        {buildings.map((row: BuildingCoverage) => <li key={row.buildingId} className={`is-${row[layer.kind]}`}>
          <span className="ua-coverage-name">{row.label}</span>
          <span className="ua-coverage-state">{COVERAGE_TEXT[row[layer.kind]]}{row.reason !== 'available' ? `: ${row.reason}` : ''}</span></li>)}
      </ul>}
      {network && <>
        <p className="ua-net-says">Devices are shown by reviewed room; lines are reported logical connections, not cable routes.</p>
        <ul className="ua-net-legend" aria-label="Line styles">
          {(['wired', 'wireless', 'unknown'] as const).map(style => <li key={style}><LinkSwatch style={style} />{LINK_STYLE_LABEL[style]}</li>)}
          <li><LinkSwatch style="wired" uncertain />Fainter: not confirmed</li>
        </ul>
        {groups.length > 0 && <details className="ua-net-unplaced">
          <summary>Not placed ({network.unplaced.length.toLocaleString()})</summary>
          {groups.map(group => <section key={group.reason} aria-label={NETWORK_UNPLACED_LABEL[group.reason]}>
            <h4>{NETWORK_UNPLACED_LABEL[group.reason]}</h4>
            <ul className="ua-net-list">{group.rows.map(row => <li key={row.key}>
              <button type="button" className="ua-belonging" onClick={() => network.open(row.key)}>
                <span className="ua-net-dot" aria-hidden="true" /><span><span className="ua-belonging-name">{row.label}</span>
                  {row.kind && <span className="ua-belonging-detail">{row.kind}</span>}</span></button></li>)}</ul>
          </section>)}
        </details>}
        <button type="button" className="ua-graph-open" aria-expanded={network.graph.open} aria-controls={network.graph.id} onClick={network.graph.toggle}>
          <span className="ua-logical-swatch" aria-hidden="true" /><span>Graph</span><Icon name="network" size={16} />
        </button>
      </>}
      {!network && (layer.unplacedRecords > 0 || layer.unplaced.length > 0) && <details>
        <summary>{others.length > 0 ? `${plural(others.length, 'record')} not placed` : layer.unplacedRecords > 0 ? `${plural(layer.unplacedRecords, 'record')} not placed` : 'Unplaced source bindings'}</summary>
        {others.length > 0 ? <DocumentaryRecords records={others} openDocuments={openDocuments} />
          : <><ul>{[...reasons].map(([reason, count]) => <li key={reason}>{plural(count, 'record')}: {UNPLACED_LABEL[reason]}</li>)}</ul>
            {!closed && layer.unplaced.map((row, at) => <PublishedUnplacedBinding key={at} binding={row.binding} reason={UNPLACED_LABEL[row.reason]} />)}</>}
      </details>}
    </div>
  </section>;
}

/** The measurement qualifier on one line: approximate, and how many outlines
 * are estimated; the basis opens below it. */
export function MeasurementKey({ estimated, shown, exact }: { readonly estimated: number; readonly shown: number; readonly exact: number }) {
  const [closed, setClosed] = useState(true);
  const bodyId = useId();
  return <section className={`ua-key ua-measure-key${closed ? ' is-closed' : ''}`} aria-label="Measurements layer"
    style={{ '--layer': BIRCH_DARK, '--plate': BIRCH } as CSSProperties}>
    <button type="button" className="ua-key-head" aria-expanded={!closed} aria-controls={bodyId} onClick={() => setClosed(value => !value)}>
      <svg className="ua-rule-glyph" width={17} height={17} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.5 15.5 15.5 3.5l5 5-12 12Z M7 12l2 2 M10 9l2.5 2.5 M13 6l2 2" /></svg>
      <span className="ua-key-label">Measurements</span>
      <span className="ua-key-count">{shown === 0 ? 'Choose a floor or room' : `${exact > 0 ? `${plural(exact, 'room part')} measured, the rest approximate` : 'Approximate'}${estimated > 0 ? `, ${plural(estimated, 'estimated outline')}` : ''}`}</span>
      <Icon name="chevronDown" size={16} />
    </button>
    <div className="ua-key-body" id={bodyId} hidden={closed}>
      <p>{exact > 0 ? MEASURED_BASIS : MEASUREMENT_BASIS}</p>
      {shown === 0 && <p className="ua-key-note">Choose a floor or room to see its dimensions.</p>}
      {estimated > 0 && <p className="ua-key-note">{plural(estimated, 'room part')} with an estimated outline not measured.</p>}
    </div>
  </section>;
}
