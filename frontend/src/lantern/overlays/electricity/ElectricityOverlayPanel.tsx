import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { ClaimBadge, Note, Section } from '../../components/ui';
import { LAYER } from '../../atlas/palette';
import { electricityLabels, electricitySheets, hasAcceptedPackageSelection } from './documentary-adapter';
import type { ElectricityOverlayPanelProps, ElectricitySheet } from './types';
import './electricity.css';

/** Adapts Lantern's original electrical legend/list, retaining its real palette,
 * Icon, ClaimBadge, Note and Section. It does not call mock buildPins or a port. */
export function ElectricityOverlayPanel(props: ElectricityOverlayPanelProps) {
  const { active, viewKey, data, selectedFloor = null, selectedPlaceId = null, selectedPackagePlaces = null, onOpenSource } = props;
  const headingId = useId();
  const [choice, setChoice] = useState<{ data: typeof data; placeId: typeof selectedPlaceId;
    packageSelection: typeof selectedPackagePlaces; label: string | null; sheetId: string | null } | null>(null);
  const current = useRef(props); current.current = props;
  const available = active && data !== null && data.viewKey === viewKey;
  const live = () => current.current.active && current.current.viewKey === viewKey && current.current.data === data
    && (current.current.selectedPlaceId ?? null) === selectedPlaceId
    && (current.current.selectedPackagePlaces ?? null) === selectedPackagePlaces && data?.viewKey === viewKey;
  useLayoutEffect(() => {
    if (choice !== null && (!available || choice.data !== data || choice.placeId !== selectedPlaceId
      || choice.packageSelection !== selectedPackagePlaces)) {
      setChoice(null);
      current.current.onSelectionChange?.(null);
    }
  }, [available, data, selectedPlaceId, selectedPackagePlaces, choice]);
  if (!active) return null;
  if (!available || !data) return <section aria-labelledby={headingId} className="electricity-overlay legend">
    <h3 id={headingId} className="legend-head"><Icon name="plug" />Electrical drawings</h3>
    <p className="legend-body" role="status">Electrical evidence is unavailable for the current view.</p>
  </section>;
  const chosen = choice?.data === data && choice.placeId === selectedPlaceId && choice.packageSelection === selectedPackagePlaces ? choice : null;
  const label = chosen?.label ?? null, selected = chosen?.sheetId ?? null;
  const sheets = electricitySheets(data, selectedPlaceId, label, selectedPackagePlaces);
  const acceptedPackageSelection = selectedPackagePlaces !== null && hasAcceptedPackageSelection(data, selectedPackagePlaces);
  const visibleRoomAssociations = (sheet: ElectricitySheet) => acceptedPackageSelection && selectedPackagePlaces !== null
    ? sheet.roomAssociations.filter(room => selectedPackagePlaces.targets.some(target =>
      room.packagePlaceKey === target.packagePlaceKey && room.packagePlaceUuid === target.packagePlaceUuid))
    : sheet.roomAssociations;
  const select = (sheet: ElectricitySheet) => {
    if (!live()) return;
    const id = selected === sheet.id ? null : sheet.id;
    setChoice({ data, placeId: selectedPlaceId, packageSelection: selectedPackagePlaces, label, sheetId: id });
    current.current.onSelectionChange?.(id === null ? null : { kind: 'electricity-evidence', id });
  };
  const filter = (next: string | null) => {
    if (!live()) return;
    setChoice({ data, placeId: selectedPlaceId, packageSelection: selectedPackagePlaces, label: next, sheetId: null }); current.current.onSelectionChange?.(null);
  };
  return <section aria-labelledby={headingId} className="electricity-overlay legend" style={{ '--layer': LAYER.electrical.color } as CSSProperties}>
    <h3 id={headingId} className="legend-head"><Icon name="plug" />Electrical drawings<span className="section-count">{data.sheets.length}</span></h3>
    <div className="legend-body">
      <Note>Historical drawings. Current wiring and circuit continuity are unverified; positions and cable routes are unknown.</Note>
      {selectedFloor && <p className="legend-foot">Export context: {selectedFloor.label}. Electrical positions remain unmatched.</p>}
      {selectedPackagePlaces && (acceptedPackageSelection ? <div className="legend-foot">
        <p>Owner-matched plan selection filters documentary room associations. Their original confidence is unchanged.</p>
        {selectedPackagePlaces.unresolvedLabels.length > 0 && <p>Unresolved parts: {selectedPackagePlaces.unresolvedLabels.join(' · ')}. Only matched parts filter drawings.</p>}
        <details>
          <summary>Source selection provenance</summary>
          <dl className="facts">
            <div><dt>Mapping receipt</dt><dd>{selectedPackagePlaces.receiptId}</dd></div>
            <div><dt>Receipt SHA256</dt><dd><code>{selectedPackagePlaces.receiptSha256}</code></dd></div>
            <div><dt>Source anchors</dt><dd><code>{selectedPackagePlaces.sourceAnchorIds.join(' · ')}</code></dd></div>
          </dl>
        </details>
      </div> : <p className="legend-foot" role="status">A reviewed room association is unavailable for this plan selection.</p>)}
      <Section title="Labels on drawings">
        <button type="button" className="text-btn" aria-pressed={label === null} onClick={() => filter(null)}>All labels</button>
        <ul className="legend-circuits" aria-label="Documentary label filters">
          {electricityLabels(data).map(entry => <li key={entry.label}>
            <button type="button" aria-pressed={label === entry.label} className="circuit-row" onClick={() => filter(label === entry.label ? null : entry.label)}>
              <span className="swatch round" style={{ background: LAYER.electrical.color }} aria-hidden="true" />
              <span className="circuit-ref">{entry.label}</span>
              <span className="circuit-label">{entry.sheetCount} {entry.sheetCount === 1 ? 'drawing' : 'drawings'}</span>
              <span className="mini-claim claim-source">Documentary</span>
            </button>
          </li>)}
        </ul>
        <p className="legend-foot">Labels filter source sheets. They do not establish circuit membership.</p>
      </Section>
      <Section title="Source sheets" count={sheets.length}>
        {sheets.length === 0 ? <p className="empty">No documentary association with this selection.</p> : <ul className="rows electricity-sheets">
          {sheets.map(sheet => <li className="electricity-sheet" key={sheet.id}>
            <button type="button" className="electricity-sheet-title row-title" aria-pressed={selected === sheet.id} onClick={() => select(sheet)}>
              <Icon name="file" size={16} /><span>{sheet.titleAsRead}</span><span className="row-meta">PDF p. {sheet.source.pdfPage}</span>
            </button>
            <p className="row-meta">{sheet.documentaryLabels.join(' · ') || 'No group label read'}</p>
            {visibleRoomAssociations(sheet).length === 0 ? <p className="legend-foot">Room association unknown.</p> : <ul className="electricity-rooms">
              {visibleRoomAssociations(sheet).map(room => <li key={room.packagePlaceKey}>
                <span>{room.historicalLabel ? `${room.historicalLabel} → ${room.label}` : room.label}</span>{' '}
                <ClaimBadge claim={room.status === 'owner-reported' ? 'owner' : 'unknown'} {...(room.status === 'inferred' ? { prefix: 'Inferred association' } : {})} />
                {room.statement && <p className="legend-foot">{room.statement}</p>}
                {room.aliases.length > 0 && <p className="legend-foot">Owner-confirmed names: {room.aliases.map(alias => alias.label).join(' · ')}</p>}
              </li>)}
            </ul>}
            <details>
              <summary>Reading and source details</summary>
              <h4>Direct reading</h4><p>{sheet.directReading.text}</p>
              <p className="legend-foot">{sheet.directReading.uncertainty.explanation}</p>
              <h4>Drawing associations <span className="mini-claim claim-unknown">Inferred</span></h4><p>{sheet.drawingAssociation.text}</p>
              <p className="legend-foot">{sheet.drawingAssociation.uncertainty.explanation}</p>
              <h4>Uncertainty</h4><p>{sheet.openUncertainty}</p>
              <dl className="facts">
                <div><dt>Source photo</dt><dd>{sheet.source.photo}</dd></div>
                <div><dt>Original SHA256</dt><dd><code>{sheet.source.sha256}</code></dd></div>
                <div><dt>Source date</dt><dd>{sheet.source.sourceDate ?? 'Unknown'}</dd></div>
                <div><dt>Fact time</dt><dd>{sheet.source.factAt ?? 'Unknown'}</dd></div>
                <div><dt>Retrieved</dt><dd>{sheet.source.retrievedAt ?? 'Not supplied'}</dd></div>
                <div><dt>Interpreted</dt><dd>{sheet.source.interpretationDate}</dd></div>
                <div><dt>Placement</dt><dd>Unmatched · coordinates unknown</dd></div>
              </dl>
              {onOpenSource && <button type="button" className="btn btn-small" onClick={() => { if (live()) onOpenSource(sheet.id, sheet.source.pdfPage); }}>
                <Icon name="file" size={15} />Open source page {sheet.source.pdfPage}
              </button>}
            </details>
          </li>)}
        </ul>}
      </Section>
      {!onOpenSource && <p className="legend-foot">Source opening is unavailable in this view.</p>}
      <p className="legend-foot">{data.preparationSnapshot.status === 'prepared-locally-not-imported'
        ? 'Prepared locally. Native original intake is unconfirmed.'
        : `Preparation status: ${data.preparationSnapshot.status}. Native original intake is unconfirmed.`}</p>
      {data.sheets.some(sheet => sheet.roomAssociations.some(room => room.nativePlaceId === null))
        && <p className="legend-foot">Package room associations are not yet reconciled with native room identities.</p>}
    </div>
  </section>;
}
