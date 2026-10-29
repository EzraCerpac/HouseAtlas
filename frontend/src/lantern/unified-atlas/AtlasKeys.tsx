import { useId, useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { BIRCH, BIRCH_DARK } from '../atlas/palette';
import { TONE_COLOR } from '../canonical-ifc/tones';
import { unplacedByReason, type OverlayLayerIndex } from './scene';
import { PublishedUnplacedBinding } from './PublishedOverlayDetails';
import type { BuildingCoverage, DocumentaryRecord, PropertyRecords } from './runtime-overlays';
import { MEASURED_BASIS, MEASUREMENT_BASIS } from './measurements';
import type { OverlayFeedSnapshot } from './overlay-feed';
import { NetworkGraph } from './NetworkGraph';
import type { NetworkConnections } from './network-connections';
import { OVERLAY_ICON, OVERLAY_LABEL, plural, stampTime, UNPLACED_LABEL } from './atlas-text';

/** The model's network in the Network lens. Its graph is read with the
 * Network layer, as on the stage; the lens offers that layer alone and never
 * changes another. */
export function NetworkLensSection({ graphs, networkOn, published, availability, headingId, showLayer }: {
  readonly graphs: NonNullable<PropertyRecords['networkGraphs']>; readonly networkOn: boolean; readonly published: boolean;
  readonly availability: 'available' | 'partial' | 'unavailable' | 'loading'; readonly headingId: string; readonly showLayer: () => void;
}) {
  return <section className="ua-lens-section" aria-labelledby={headingId} style={{ '--layer': TONE_COLOR.network } as CSSProperties}>
    <h3 id={headingId}><span className="ua-logical-swatch" aria-hidden="true" />Logical network graph</h3>
    {!networkOn ? <>
      <p>The model's network records are read with the Network layer.</p>
      <button type="button" className="btn btn-small" onClick={showLayer}>Show Network layer</button>
    </> : <>
      {availability === 'partial' && <p className="ua-unplaced">Some buildings or sources are unavailable; their records are not counted.</p>}
      {graphs.length > 0 ? graphs.map(graph => <NetworkGraph key={graph.key} graph={graph} />)
        : <p role="status">{availability === 'loading' ? 'Loading room sources…' : availability === 'unavailable' ? 'Current room sources are unavailable.'
          : published ? 'No logical network graph in this publication.' : 'No logical network graph in the available source.'}</p>}
    </>}
  </section>;
}

export function DocumentaryRecords({ records, openDocuments }: { readonly records: readonly DocumentaryRecord[]; readonly openDocuments: (() => void) | undefined }) {
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

export function OverlayKey({ layer, openNetwork, availability, records, stored, buildings, openDocuments, publishedOnly, graph, connectionCoverage }: {
  readonly layer: OverlayLayerIndex; readonly openNetwork: (() => void) | undefined; readonly openDocuments: (() => void) | undefined;
  readonly records: PropertyRecords | null; readonly availability: 'available' | 'partial' | 'unavailable' | 'loading';
  /** Set while some building shows the copy last loaded on this device. */
  readonly stored: OverlayFeedSnapshot['stored'];
  readonly publishedOnly: boolean;
  readonly buildings: readonly BuildingCoverage[];
  readonly connectionCoverage: NetworkConnections['coverage'] | null;
  /** The logical network graph's own panel, when the source has one. */
  readonly graph: { readonly id: string; readonly open: boolean; readonly toggle: () => void } | null;
}) {
  const reasons = unplacedByReason(layer);
  const unplaced = records?.unplaced[layer.kind] ?? [];
  // Topology stays separate from physical points: connections are logical only.
  const connections = layer.kind === 'network' ? unplaced.filter(record => record.category === 'Recorded connection') : [];
  const others = layer.kind === 'network' ? unplaced.filter(record => record.category !== 'Recorded connection') : unplaced;
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
          : `${plural(layer.records, 'record')}${availability === 'partial' ? ', partial' : ''}${layer.unplacedRecords > 0 ? `, ${layer.unplacedRecords.toLocaleString()} not placed` : ''}${stored ? ', stored' : ''}`}
      </span>
      <Icon name="chevronDown" size={16} />
    </button>
    <div className="ua-key-body" id={bodyId} hidden={closed}>
      {stored && <p className="ua-key-stored" role="status" aria-busy={stored.refreshing}><Icon name="history" size={15} />
        <span>Copy last loaded on this device, <time dateTime={stored.storedAt} title={stored.storedAt}>{stampTime(stored.storedAt)}</time>
          {stored.refreshing ? '; updating.' : '; not updated, the source is unreachable.'}</span></p>}
      <p>{availability === 'loading' ? 'Loading room sources…' : availability === 'unavailable' ? 'Current room sources are unavailable.'
        : availability === 'partial' ? 'Some buildings or sources are unavailable; their records are not counted.'
        : publishedOnly && layer.records === 0 ? 'No source references in this publication.'
        : layer.records === 0 ? 'No linked records in the available source.' : 'Counts show source records per room across the property, not device positions.'}</p>
      {buildings.length > 0 && <ul className="ua-coverage-list" aria-label="Coverage by building">
        {buildings.map((row: BuildingCoverage) => <li key={row.buildingId} className={`is-${row[layer.kind]}`}>
          <span className="ua-coverage-name">{row.label}</span>
          <span className="ua-coverage-state">{COVERAGE_TEXT[row[layer.kind]]}{row.reason !== 'available' ? `: ${row.reason}` : ''}</span></li>)}
      </ul>}
      {graph && <button type="button" className="ua-graph-open" aria-expanded={graph.open} aria-controls={graph.id} onClick={graph.toggle}>
        <span className="ua-logical-swatch" aria-hidden="true" /><span>Logical network graph</span><Icon name="network" size={16} />
      </button>}
      {connectionCoverage && <p>3D lines show {connectionCoverage.links.anchored} of {connectionCoverage.links.total} logical connections at reviewed room summaries;
        {' '}{connectionCoverage.links.unplaced} have no complete room association. They do not show device positions or cable routes.
        {connectionCoverage.sharedMediumAssociations.anchored > 0 && ` ${connectionCoverage.sharedMediumAssociations.anchored} shared-medium associations are shown separately.`}</p>}
      {connections.length > 0 && <details className="ua-logical">
        <summary><span className="ua-logical-swatch" aria-hidden="true" />{plural(connections.length, 'logical connection')}, no cable routes</summary>
        <DocumentaryRecords records={connections} openDocuments={openDocuments} />
      </details>}
      {(layer.unplacedRecords > 0 || layer.unplaced.length > 0) && <details>
        <summary>{others.length > 0 ? `${plural(others.length, 'record')} not placed` : layer.unplacedRecords > 0 ? `${plural(layer.unplacedRecords, 'record')} not placed` : 'Unplaced source bindings'}</summary>
        {others.length > 0 ? <DocumentaryRecords records={others} openDocuments={openDocuments} />
          : <><ul>{[...reasons].map(([reason, count]) => <li key={reason}>{plural(count, 'record')}: {UNPLACED_LABEL[reason]}</li>)}</ul>
            {!closed && layer.unplaced.map((row, at) => <PublishedUnplacedBinding key={at} binding={row.binding} reason={UNPLACED_LABEL[row.reason]} />)}</>}
      </details>}
      {layer.kind === 'network' && openNetwork && <button type="button" className="text-btn" onClick={openNetwork}>Open Network</button>}
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
