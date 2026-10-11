import { useId, useRef, type CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { ClaimBadge, Note, Section } from '../../components/ui';
import { LAYER } from '../../atlas/palette';
import { electricitySceneProjection } from './scene';
import { hasAcceptedPackageSelection } from './documentary-adapter';
import type { ElectricitySceneInspectorProps } from './scene-types';
import './scene.css';

/** Secondary DOM details slot; no independent scene shell or source fetching. */
export function ElectricitySceneInspector(props: ElectricitySceneInspectorProps) {
  const id = useId(), current = useRef(props); current.current = props;
  const { active, viewKey, data, mapping, anchors, ui, unplacedDock, selection,
    selectedPackagePlaces = null, selectedPlaceId = null } = props;
  if (!active || !data || data.viewKey !== viewKey) return null;
  const scene = electricitySceneProjection(data, mapping, anchors, unplacedDock, ui, selectedPackagePlaces, selectedPlaceId);
  if (!scene) return null;
  const group = selection?.kind === 'electricity-room' ? scene.groups.find(entry => entry.anchor.id === selection.anchorId) : null;
  const selectedSheet = selection?.kind === 'electricity-evidence' ? scene.sheets.find(sheet => sheet.id === selection.id) : null;
  const sheets = group?.sheets ?? (selectedSheet ? [selectedSheet] : selection?.kind === 'electricity-unplaced' ? scene.unplaced : selection?.kind === 'electricity-records' ? scene.sheets : []);
  const acceptedSelection = selectedPackagePlaces !== null && hasAcceptedPackageSelection(data, selectedPackagePlaces)
    && mapping?.viewKey === viewKey && mapping.receiptId === selectedPackagePlaces.receiptId && mapping.receiptSha256 === selectedPackagePlaces.receiptSha256;
  const live = () => current.current.active && current.current.viewKey === viewKey && current.current.data === data
    && current.current.mapping === mapping && current.current.selection === selection
    && (current.current.selectedPackagePlaces ?? null) === selectedPackagePlaces && (current.current.selectedPlaceId ?? null) === selectedPlaceId;
  if (!selection) return <button type="button" className="electricity-scene-summary legend stage-ui"
    style={{ '--layer': LAYER.electrical.color } as CSSProperties} aria-label="Open electrical drawing records"
    onClick={() => { if (live()) current.current.onSelectionChange({ kind: 'electricity-records' }); }}>
    <span className="legend-head"><Icon name="file" />Electrical drawings<Icon name="chevron" size={16} /></span>
    <span>{scene.drawingCount} drawings · {scene.groups.length} room markers</span><small>Historical associations · positions unknown</small>
  </button>;
  return <aside className="electricity-scene-inspector stage-ui" aria-labelledby={id} style={{ '--layer': LAYER.electrical.color } as CSSProperties}>
    <h3 id={id}><Icon name="file" />{group?.label ?? (selection?.kind === 'electricity-unplaced' ? 'Outside shown room markers' : selectedSheet ? 'Electrical drawing' : 'Electrical drawings')}
      {selection && <button type="button" className="icon-btn" aria-label="Close electrical details" onClick={() => { if (live()) current.current.onSelectionChange(null); }}><Icon name="close" /></button>}</h3>
    <p className="legend-foot">{scene.drawingCount} distinct drawings · {scene.associationCount} documentary room associations across these drawings</p>
    <Note>Historical evidence. Current wiring is unverified. Room markers are schematic; fixture positions and wire routes are unknown.</Note>
    {acceptedSelection && selectedPackagePlaces!.unresolvedLabels.length > 0 ? <p className="legend-foot">Unresolved parts: {selectedPackagePlaces!.unresolvedLabels.join(' · ')}.</p> : null}
    {selection && sheets.length === 0 && <p className="empty">No drawings are available for this selection in the current scene.</p>}
    {sheets.length > 0 && <Section title="Historical source sheets" count={sheets.length}><ul className="rows electricity-scene-sheets">
      {sheets.map(sheet => {
        const rooms = group ? sheet.roomAssociations.filter(room => room.packagePlaceKey === group.anchor.packagePlaceKey && room.packagePlaceUuid === group.anchor.packagePlaceUuid) : sheet.roomAssociations;
        return <li key={sheet.id}>
          <button type="button" className="row-title"
            aria-label={`${props.onOpenSource ? 'Open drawing' : 'Read interpretation of'} ${sheet.titleAsRead}, PDF page ${sheet.source.pdfPage}`}
            onClick={() => {
              if (!live()) return;
              if (current.current.onOpenSource) current.current.onOpenSource(sheet.id, sheet.source.pdfPage);
              else current.current.onSelectionChange({ kind: 'electricity-evidence', id: sheet.id });
            }}>
            <Icon name="file" size={16} />{sheet.titleAsRead}<span className="row-meta">PDF p. {sheet.source.pdfPage}</span>
          </button>
          <p className="row-meta">{sheet.documentaryLabels.join(' · ') || 'No group label read'}</p>
          {rooms.map(room => <div key={room.packagePlaceKey} className="legend-foot">
            <span>{room.historicalLabel ? `${room.historicalLabel} → ${room.label}` : room.label}</span>{' '}
            <ClaimBadge claim={room.status === 'owner-reported' ? 'owner' : 'unknown'} {...(room.status === 'inferred' ? { prefix: 'Inferred association' } : {})} />
            {room.statement && <p>{room.statement}</p>}
            {room.aliases.length > 0 && <p>Owner-confirmed names: {room.aliases.map(alias => alias.label).join(' · ')}</p>}
          </div>)}
          {rooms.length === 0 && <p className="legend-foot">Room association unknown.</p>}
          <details><summary>Reading and provenance</summary>
            <h4>Direct reading</h4><p>{sheet.directReading.text}</p><p className="legend-foot">{sheet.directReading.uncertainty.explanation}</p>
            <h4>Inferred drawing associations</h4><p>{sheet.drawingAssociation.text}</p><p className="legend-foot">{sheet.drawingAssociation.uncertainty.explanation}</p>
            <h4>Uncertainty</h4><p>{sheet.openUncertainty}</p>
            <dl className="facts">
              <div><dt>Photo</dt><dd>{sheet.source.photo}</dd></div><div><dt>Original SHA256</dt><dd><code>{sheet.source.sha256}</code></dd></div>
              <div><dt>Source date</dt><dd>{sheet.source.sourceDate ?? 'Unknown'}</dd></div><div><dt>Fact time</dt><dd>{sheet.source.factAt ?? 'Unknown'}</dd></div>
              <div><dt>Retrieved</dt><dd>{sheet.source.retrievedAt ?? 'Not supplied'}</dd></div><div><dt>Interpreted</dt><dd>{sheet.source.interpretationDate}</dd></div>
            </dl>
            {props.onOpenSource && <button type="button" className="btn btn-small" onClick={() => { if (live()) current.current.onOpenSource?.(sheet.id, sheet.source.pdfPage); }}>Open source page {sheet.source.pdfPage}</button>}
          </details>
        </li>;
      })}
    </ul></Section>}
    <p className="legend-foot">Native original intake is unconfirmed.{!props.onOpenSource && ' Source opening is unavailable in this view.'}</p>
  </aside>;
}
