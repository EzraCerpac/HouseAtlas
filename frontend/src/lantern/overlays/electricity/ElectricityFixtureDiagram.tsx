import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type {
  ElectricalFixture,
  ElectricityFixtureDiagramProps,
  FixtureBox,
  FixtureKind,
} from './fixture-types';
import './fixture.css';

// Upright portrait photographs: normalized source coordinates, not a floorplan.
const SOURCE_WIDTH = 1000;
const SOURCE_HEIGHT = SOURCE_WIDTH * 4 / 3;
const GROUP_COLORS = ['#2f56e0', '#087f8c', '#8d4ab8', '#bb562e', '#388052', '#aa4275', '#74601e'];
const KIND_LABELS: Record<FixtureKind, string> = {
  socket: 'Socket',
  'socket-candidate': 'Socket candidate',
  light: 'Lighting mark',
  appliance: 'Appliance',
  unresolved: 'Unresolved symbol',
};
const BASIS_LABELS: Record<ElectricalFixture['group']['basis'], string> = {
  'label-adjacent': 'Approx. label adjacency',
  'drawn-arrow': 'Drawn arrow',
  uncertain: 'Uncertain association',
  unknown: 'Unknown',
};

function groupColor(label: string | null) {
  if (label === null) return '#65738a';
  let hash = 0;
  for (const character of label) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return GROUP_COLORS[hash % GROUP_COLORS.length]!;
}

function regionViewBox(bounds: FixtureBox): [number, number, number, number] {
  const [left, top, right, bottom] = bounds;
  const width = Math.max((right - left) * SOURCE_WIDTH, 40);
  const height = Math.max((bottom - top) * SOURCE_HEIGHT, 40);
  const padding = Math.max(width, height) * 0.06;
  const x = Math.max(0, left * SOURCE_WIDTH - padding);
  const y = Math.max(0, top * SOURCE_HEIGHT - padding);
  const endX = Math.min(SOURCE_WIDTH, right * SOURCE_WIDTH + padding);
  const endY = Math.min(SOURCE_HEIGHT, bottom * SOURCE_HEIGHT + padding);
  return [x, y, Math.max(endX - x, 40), Math.max(endY - y, 40)];
}

function selectionViewBox(fixtures: readonly ElectricalFixture[]): [number, number, number, number] {
  const xs = fixtures.map(fixture => fixture.source.normalizedPoint[0] * SOURCE_WIDTH);
  const ys = fixtures.map(fixture => fixture.source.normalizedPoint[1] * SOURCE_HEIGHT);
  const left = Math.min(...xs), right = Math.max(...xs);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const padding = Math.max(28, Math.max(right - left, bottom - top) * 0.7);
  return [left - padding, top - padding, right - left + padding * 2, bottom - top + padding * 2];
}

function FixtureGlyph({ kind, size }: { readonly kind: FixtureKind; readonly size: number }) {
  const half = size * 0.48;
  switch (kind) {
    case 'socket':
      return <g className="ef-glyph">
        <circle r={size} />
        <path d={`M ${-half} ${-half / 2} v ${half} M ${half} ${-half / 2} v ${half} M ${-half / 2} ${half} h ${half}`} />
      </g>;
    case 'socket-candidate':
      return <g className="ef-glyph ef-glyph-candidate">
        <rect x={-size} y={-size} width={size * 2} height={size * 2} rx={size * 0.3} />
        <path d={`M ${-half} ${-half} L ${half} ${half} M ${half} ${-half} L ${-half} ${half}`} />
      </g>;
    case 'light':
      return <g className="ef-glyph">
        <circle r={size * 0.7} />
        <path d={`M 0 ${-size * 1.15} v ${size * 0.25} M 0 ${size * 0.9} v ${size * 0.25} M ${-size * 1.15} 0 h ${size * 0.25} M ${size * 0.9} 0 h ${size * 0.25}`} />
        <path d={`M ${-half} ${-half} L ${half} ${half} M ${half} ${-half} L ${-half} ${half}`} />
      </g>;
    case 'appliance':
      return <g className="ef-glyph">
        <rect x={-size} y={-size} width={size * 2} height={size * 2} rx={size * 0.16} />
        <path d={`M ${size * 0.15} ${-size * 0.65} L ${-size * 0.35} ${size * 0.1} H ${size * 0.3} L ${-size * 0.15} ${size * 0.65}`} />
      </g>;
    case 'unresolved':
      return <g className="ef-glyph">
        <polygon points={`0,${-size * 1.2} ${size * 1.2},0 0,${size * 1.2} ${-size * 1.2},0`} />
        <text className="ef-question" y={size * 0.38} fontSize={size * 1.3}>?</text>
      </g>;
  }
}

function glyphCountLabel(fixture: ElectricalFixture) {
  return fixture.glyphCount === null ? 'Source glyph count unknown'
    : `${fixture.glyphCount} source ${fixture.glyphCount === 1 ? 'glyph' : 'glyphs'}`;
}

/** Fixture-first source diagram. All private evidence arrives through the host contract. */
export function ElectricityFixtureDiagram(props: ElectricityFixtureDiagramProps) {
  const {
    active, viewKey, data, selectedRegionId, selectedFixtureId, selectedGroup,
    selectedPackagePlaces = null, sourceImageUrl = null, showSourceImage = false,
  } = props;
  const id = useId();
  const current = useRef(props);
  current.current = props;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 470, height: 450 });
  const [hover, setHover] = useState<{ data: typeof data; fixtureId: string } | null>(null);
  const [overview, setOverview] = useState<{ data: typeof data; regionId: string; shown: boolean } | null>(null);
  const [zoom, setZoom] = useState<{ data: typeof data; regionId: string; fixtureId: string } | null>(null);
  const [imageFailure, setImageFailure] = useState<{ data: typeof data; url: string } | null>(null);
  const [sourceActionFailure, setSourceActionFailure] = useState<{ data: typeof data; regionId: string; message: string } | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      // The SVG's 15 px inset is excluded from its drawable viewport.
      const width = Math.max(1, canvas.clientWidth - 30);
      const height = Math.max(1, canvas.clientHeight - 30);
      setCanvasSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [active, data, viewKey, selectedRegionId]);
  const available = active && data !== null && data.viewKey === viewKey;
  const live = () => current.current.active && current.current.viewKey === viewKey
    && current.current.data === data && data?.viewKey === viewKey
    && current.current.selectedRegionId === selectedRegionId
    && current.current.selectedFixtureId === selectedFixtureId
    && current.current.selectedGroup === selectedGroup
    && (current.current.selectedPackagePlaces ?? null) === selectedPackagePlaces;
  // The source action depends on the current sheet and room region, not on a
  // fixture hover/selection or group filter changing during the same click.
  const sourceLive = () => current.current.active && current.current.viewKey === viewKey
    && current.current.data === data && data?.viewKey === viewKey
    && current.current.selectedRegionId === selectedRegionId
    && (selectedRegionId !== null || (current.current.selectedPackagePlaces ?? null) === selectedPackagePlaces);

  if (!active) return null;
  if (!available || !data) return <section className="ef-diagram" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>Electrical fixtures</h3>
    <p className="ef-empty" role="status">Fixture evidence is unavailable for the current view.</p>
  </section>;

  const acceptedContext = selectedPackagePlaces?.status === 'accepted'
    && selectedPackagePlaces.viewKey === viewKey
    && data.roomMappingReceipt !== null
    && selectedPackagePlaces.receiptId === data.roomMappingReceipt.id
    && selectedPackagePlaces.receiptSha256 === data.roomMappingReceipt.sha256;
  const preferredRegion = acceptedContext && selectedPackagePlaces ? data.regions.find(region => region.places.some(place =>
    selectedPackagePlaces.targets.some(target => target.packagePlaceKey === place.packagePlaceKey
      && target.packagePlaceUuid === place.packagePlaceUuid))) : undefined;
  const region = selectedRegionId === null ? preferredRegion
    : data.regions.find(candidate => candidate.id === selectedRegionId);
  const sheet = region ? data.sheets.find(candidate => candidate.id === region.sheetId) : undefined;
  const sheetRegions = region ? data.regions.filter(candidate => candidate.sheetId === region.sheetId) : [];
  const sheetFixtures = region ? data.fixtures.filter(fixture => fixture.sheetId === region.sheetId) : [];
  const fixtures = region ? sheetFixtures.filter(fixture => fixture.regionId === region.id) : [];
  const fullSheet = region !== undefined && overview?.data === data && overview.regionId === region.id && overview.shown;
  const visibleFixtures = fullSheet ? sheetFixtures : fixtures;
  const groups = Array.from(new Set(visibleFixtures.flatMap(fixture => fixture.group.label === null ? [] : [fixture.group.label])))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const selectedFixture = visibleFixtures.find(fixture => fixture.id === selectedFixtureId);
  const selectionAvailable = data.fixtures.some(fixture => fixture.id === selectedFixtureId);
  const hoveredFixture = hover?.data === data ? visibleFixtures.find(fixture => fixture.id === hover.fixtureId) : undefined;
  const imageUnavailable = showSourceImage && (!sourceImageUrl
    || (imageFailure !== null && imageFailure.data === data && imageFailure.url === sourceImageUrl));
  const zoomAnchor = zoom?.data === data ? fixtures.find(fixture => fixture.id === zoom.fixtureId) : undefined;
  const selectionZoom = region !== undefined && selectedFixture !== undefined && zoomAnchor !== undefined
    && zoom?.regionId === region.id && (zoomAnchor.id === selectedFixture.id
      || (zoomAnchor.clusterId !== null && zoomAnchor.clusterId === selectedFixture.clusterId));
  const zoomFixtures = selectedFixture ? fixtures.filter(fixture => selectedFixture.clusterId !== null
    ? fixture.clusterId === selectedFixture.clusterId : fixture.id === selectedFixture.id) : [];
  const viewBox: [number, number, number, number] = selectionZoom && zoomFixtures.length > 0
    ? selectionViewBox(zoomFixtures) : !region || fullSheet
    ? [0, 0, SOURCE_WIDTH, SOURCE_HEIGHT] : regionViewBox(region.sourceBounds);
  const displayScale = Math.min(canvasSize.width / viewBox[2], canvasSize.height / viewBox[3]);
  // Dense source points stay fixed; 7 px glyphs have separate 22 px hit targets.
  const markerSize = 3.5 / displayScale;
  const markerHitSize = 11 / displayScale;
  const groupFontSize = 11 / displayScale;
  const drawingFixtures = visibleFixtures.filter(fixture => {
    const x = fixture.source.normalizedPoint[0] * SOURCE_WIDTH;
    const y = fixture.source.normalizedPoint[1] * SOURCE_HEIGHT;
    return x >= viewBox[0] && x <= viewBox[0] + viewBox[2]
      && y >= viewBox[1] && y <= viewBox[1] + viewBox[3];
  });
  const annotationKeys = new Set<string>();
  const groupAnnotationIds = new Set<string>();
  for (const fixture of visibleFixtures) {
    const key = JSON.stringify([fixture.clusterId ?? fixture.id, fixture.group.label]);
    if (!annotationKeys.has(key)) { annotationKeys.add(key); groupAnnotationIds.add(fixture.id); }
  }
  const representedKinds = (Object.keys(KIND_LABELS) as FixtureKind[])
    .filter(kind => visibleFixtures.some(fixture => fixture.kind === kind));
  const groupStillAvailable = selectedGroup === null || groups.includes(selectedGroup);
  const unknownGroups = visibleFixtures.filter(fixture => fixture.group.label === null).length;
  const selectFixture = (fixture: ElectricalFixture) => {
    if (!live()) return;
    if (region && fixture.regionId !== region.id) current.current.onRegionChange(fixture.regionId);
    current.current.onFixtureChange(selectedFixtureId === fixture.id ? null : fixture.id);
  };
  const nearestFixture = (clientX: number, clientY: number, svg: SVGSVGElement | null) => {
    const matrix = svg?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    let nearest: ElectricalFixture | null = null;
    let distance = markerHitSize * markerHitSize;
    for (const fixture of drawingFixtures) {
      const dx = point.x - fixture.source.normalizedPoint[0] * SOURCE_WIDTH;
      const dy = point.y - fixture.source.normalizedPoint[1] * SOURCE_HEIGHT;
      const squared = dx * dx + dy * dy;
      if (squared <= distance) { nearest = fixture; distance = squared; }
    }
    return nearest;
  };
  const chooseRegion = (regionId: string) => {
    if (!live()) return;
    current.current.onRegionChange(regionId);
    current.current.onFixtureChange(null);
  };
  const chooseGroup = (group: string | null) => {
    if (live()) current.current.onGroupChange(group);
  };

  return <section className="ef-diagram" aria-labelledby={`${id}-heading`}>
    <header className="ef-heading">
      <div><h3 id={`${id}-heading`}>Electrical fixtures</h3><p id={`${id}-status`} className="ef-status">Historical drawing · current state unverified</p></div>
      <span className="ef-position-badge">Approx. drawing positions</span>
    </header>

    <div className="ef-toolbar">
      <label className="ef-region-control" htmlFor={`${id}-region`}>
        <span>Room / drawing region</span>
        <select id={`${id}-region`} value={region?.id ?? ''} onChange={event => chooseRegion(event.target.value)}>
          {!region && <option value="">{data.regions.length === 0 ? 'No drawing regions'
            : selectedRegionId === null && selectedPackagePlaces === null ? 'Choose a drawing region' : 'Selected region unavailable'}</option>}
          {data.regions.map(candidate => <option key={candidate.id} value={candidate.id}>
            {candidate.label} · {data.sheets.find(source => source.id === candidate.sheetId)?.title ?? 'Source sheet unknown'}
          </option>)}
        </select>
      </label>
      {region && <button type="button" className="ef-button" aria-pressed={fullSheet} onClick={() => {
        if (!live()) return;
        setZoom(null);
        setOverview({ data, regionId: region.id, shown: !fullSheet });
      }}>{fullSheet ? 'Fit region' : 'Show full schematic'}</button>}
      {region && selectedFixture?.regionId === region.id && <button type="button" className="ef-button" aria-pressed={selectionZoom} onClick={() => {
        if (!live()) return;
        setOverview(null);
        setZoom(selectionZoom ? null : { data, regionId: region.id, fixtureId: selectedFixture.id });
      }}>{selectionZoom ? 'Fit region' : 'Zoom to selection'}</button>}
    </div>

    {region ? <>
      <div className="ef-groups" role="group" aria-label="Emphasize drawing group">
        <span className="ef-control-label">Group</span>
        <button type="button" aria-pressed={selectedGroup === null} onClick={() => chooseGroup(null)}>All</button>
        {groups.map(group => <button type="button" key={group} aria-pressed={selectedGroup === group}
          style={{ '--ef-group': groupColor(group) } as CSSProperties} onClick={() => chooseGroup(selectedGroup === group ? null : group)}>
          <span className="ef-swatch" aria-hidden="true" />{group}
        </button>)}
        {unknownGroups > 0 && <span className="ef-unknown-group"><span className="ef-swatch" aria-hidden="true" />Unknown</span>}
        {!groupStillAvailable && <span className="ef-filter-state" role="status">{selectedGroup}: no labeled markers in this {fullSheet ? 'sheet' : 'region'}</span>}
      </div>

      <div className="ef-workspace">
        <div className="ef-drawing-column">
          <div className="ef-canvas" ref={canvasRef}>
            <svg viewBox={viewBox.join(' ')} preserveAspectRatio="xMidYMid meet" role="group"
              aria-label={`${fullSheet ? sheet?.title ?? 'Source sheet' : region.label}: electrical fixtures at approximate source drawing positions`}
              aria-describedby={`${id}-status ${id}-key`}>
              {showSourceImage && sourceImageUrl && !imageUnavailable && <image href={sourceImageUrl}
                width={SOURCE_WIDTH} height={SOURCE_HEIGHT} preserveAspectRatio="xMidYMid meet"
                className="ef-source-image" aria-hidden="true" onError={() => {
                  if (live() && current.current.sourceImageUrl === sourceImageUrl) setImageFailure({ data, url: sourceImageUrl });
                }} />}
              {sheetRegions.map(outline => <polyline key={outline.id}
                points={(outline.outlineClosed && outline.sourceOutline.length > 0
                  ? [...outline.sourceOutline, outline.sourceOutline[0]!]
                  : outline.sourceOutline).map(([x, y]) => `${x * SOURCE_WIDTH},${y * SOURCE_HEIGHT}`).join(' ')}
                className={`ef-outline${outline.id === region.id ? ' ef-outline-current' : ''}`}
                vectorEffect="non-scaling-stroke" aria-hidden="true" />)}
              <g aria-hidden="true">{drawingFixtures.map(fixture => <circle key={fixture.id} className="ef-marker-hit"
                cx={fixture.source.normalizedPoint[0] * SOURCE_WIDTH} cy={fixture.source.normalizedPoint[1] * SOURCE_HEIGHT}
                r={markerHitSize} onClick={event => {
                  const nearest = nearestFixture(event.clientX, event.clientY, event.currentTarget.ownerSVGElement);
                  if (nearest) selectFixture(nearest);
                }} onPointerMove={event => {
                  if (!live()) return;
                  const nearest = nearestFixture(event.clientX, event.clientY, event.currentTarget.ownerSVGElement);
                  if (nearest) setHover(previous => previous?.data === data && previous.fixtureId === nearest.id
                    ? previous : { data, fixtureId: nearest.id });
                }} onPointerLeave={() => setHover(null)} />)}</g>
              {drawingFixtures.map(fixture => {
                const selected = fixture.id === selectedFixtureId;
                const emphasized = selectedGroup === null || fixture.group.label === selectedGroup;
                const group = fixture.group.label ?? 'Unknown';
                const countBadge = fixture.glyphCount !== null && fixture.glyphCount > 1;
                return <g key={fixture.id} data-fixture-id={fixture.id} role="button" tabIndex={0} aria-pressed={selected}
                  aria-label={`${fixture.label}; ${KIND_LABELS[fixture.kind]}; region ${data.regions.find(candidate => candidate.id === fixture.regionId)?.label ?? 'Unknown'}; group ${group}; ${glyphCountLabel(fixture)}${fixture.uncertainty ? `; ${fixture.uncertainty}` : ''}`}
                  className={`ef-marker${selected ? ' ef-marker-selected' : ''}${emphasized ? '' : ' ef-marker-muted'}`}
                  style={{ '--ef-group': groupColor(fixture.group.label) } as CSSProperties}
                  transform={`translate(${fixture.source.normalizedPoint[0] * SOURCE_WIDTH} ${fixture.source.normalizedPoint[1] * SOURCE_HEIGHT})`}
                  onClick={event => selectFixture(nearestFixture(event.clientX, event.clientY, event.currentTarget.ownerSVGElement) ?? fixture)} onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectFixture(fixture); }
                    if (event.key === 'Escape' && live()) current.current.onFixtureChange(null);
                  }} onPointerMove={event => {
                    if (!live()) return;
                    const nearest = nearestFixture(event.clientX, event.clientY, event.currentTarget.ownerSVGElement) ?? fixture;
                    setHover(previous => previous?.data === data && previous.fixtureId === nearest.id
                      ? previous : { data, fixtureId: nearest.id });
                  }} onPointerEnter={event => {
                    if (live()) setHover({ data, fixtureId: (nearestFixture(event.clientX, event.clientY, event.currentTarget.ownerSVGElement) ?? fixture).id });
                  }}
                  onPointerLeave={() => setHover(null)} onFocus={() => { if (live()) setHover({ data, fixtureId: fixture.id }); }}
                  onBlur={() => setHover(null)}>
                  <title>{`${fixture.label} · Group ${group} · ${glyphCountLabel(fixture)}`}</title>
                  <circle className="ef-marker-ring" r={markerSize * 1.8} />
                  <FixtureGlyph kind={fixture.kind} size={markerSize} />
                  {countBadge && <g className="ef-count" transform={`translate(${markerHitSize * 0.8} ${-markerHitSize * 0.8})`} aria-hidden="true">
                    <circle r={markerHitSize * 0.64} />
                    <text y={markerHitSize * 0.26} fontSize={markerHitSize * 0.85}>{fixture.glyphCount}</text>
                  </g>}
                  {groupAnnotationIds.has(fixture.id) && <text className="ef-marker-group" y={markerHitSize * 1.5} fontSize={groupFontSize}
                    vectorEffect="non-scaling-stroke" aria-hidden="true">{fixture.group.label ?? '?'}</text>}
                </g>;
              })}
            </svg>
            {hoveredFixture && <div className="ef-hover" aria-hidden="true">
              <strong>{hoveredFixture.label}</strong><span>{KIND_LABELS[hoveredFixture.kind]} · Group {hoveredFixture.group.label ?? 'Unknown'}</span>
            </div>}
            {visibleFixtures.length === 0 && <p className="ef-canvas-empty" role="status">No fixture symbols recorded in this {fullSheet ? 'sheet' : 'region'}.</p>}
            {imageUnavailable && <p className="ef-image-state" role="status">Source image underlay unavailable.</p>}
          </div>

          <div id={`${id}-key`} className="ef-key" aria-label="Fixture symbol key">
            {representedKinds.map(kind => <span key={kind}>
              <svg viewBox="-16 -16 32 32" aria-hidden="true"><FixtureGlyph kind={kind} size={9} /></svg>
              {kind === 'socket-candidate' ? 'X · socket candidate'
                : kind === 'socket' && data.symbolLegend.xMeansSocket === true ? 'X · socket' : KIND_LABELS[kind]}
            </span>)}
            {visibleFixtures.some(fixture => fixture.glyphCount !== null && fixture.glyphCount > 1)
              && <span className="ef-count-key"><span aria-hidden="true">n</span>Source glyph count</span>}
          </div>
          <footer className="ef-source-bar">
            <span>{sheet?.title ?? 'Source sheet unknown'}{sheet ? ` · p. ${sheet.pdfPage}` : ''}</span>
            {sheet && props.onOpenSource ? <button type="button" className="ef-source-button" onClick={() => {
              if (!sourceLive()) {
                setSourceActionFailure({ data, regionId: region.id, message: 'This drawing is no longer current. Refresh scans to check again.' });
                return;
              }
              setSourceActionFailure(null);
              current.current.onOpenSource?.(sheet.id, sheet.pdfPage);
            }}>Open reference drawing</button> : <span>Source opening unavailable</span>}
          </footer>
          {sourceActionFailure?.data === data && sourceActionFailure.regionId === region.id
            && <p className="ef-source-feedback" role="status">{sourceActionFailure.message}</p>}
          <div className="ef-fixture-list">
            <h4>Region markers <span>{fixtures.length}</span></h4>
            <ul>{fixtures.map(fixture => <li key={fixture.id}>
              <button type="button" aria-pressed={selectedFixtureId === fixture.id}
                style={{ '--ef-group': groupColor(fixture.group.label) } as CSSProperties}
                onClick={() => selectFixture(fixture)}>
                <svg viewBox="-16 -16 32 32" aria-hidden="true"><FixtureGlyph kind={fixture.kind} size={9} /></svg>
                <span><strong>{fixture.label}</strong><span>{KIND_LABELS[fixture.kind]} · Group {fixture.group.label ?? 'Unknown'}</span></span>
              </button>
            </li>)}</ul>
          </div>
        </div>

        <aside className="ef-selection" aria-labelledby={`${id}-selection`}>
          <div className="ef-selection-heading"><h4 id={`${id}-selection`}>Selected fixture</h4>
            {selectedFixture && <button type="button" className="ef-clear" aria-label="Clear selected fixture" onClick={() => {
              if (live()) current.current.onFixtureChange(null);
            }}>×</button>}
          </div>
          {selectedFixture ? <>
            <div className="ef-selected-title" style={{ '--ef-group': groupColor(selectedFixture.group.label) } as CSSProperties}>
              <svg viewBox="-16 -16 32 32" aria-hidden="true"><FixtureGlyph kind={selectedFixture.kind} size={9} /></svg>
              <div><strong>{selectedFixture.label}</strong><span>{KIND_LABELS[selectedFixture.kind]}</span></div>
            </div>
            <dl className="ef-facts">
              <div><dt>Group</dt><dd>{selectedFixture.group.label ?? 'Unknown'}</dd></div>
              <div><dt>Group basis</dt><dd>{BASIS_LABELS[selectedFixture.group.basis]}</dd></div>
              <div><dt>Source glyphs</dt><dd>{selectedFixture.glyphCount ?? 'Unknown'}</dd></div>
              <div><dt>Represented fixtures</dt><dd>{selectedFixture.fixtureCount ?? 'Unknown'}</dd></div>
              <div><dt>Source symbol</dt><dd>{selectedFixture.glyph || 'Unknown'}</dd></div>
              <div><dt>Literal labels</dt><dd>{selectedFixture.source.literalLabels.join(' · ') || 'None read'}</dd></div>
              <div><dt>Drawn position</dt><dd>{selectedFixture.source.placementDescription || 'Unknown'}</dd></div>
            </dl>
            {selectedFixture.group.note && <p className="ef-detail-note">{selectedFixture.group.note}</p>}
            {selectedFixture.uncertainty && <p className="ef-detail-note">{selectedFixture.uncertainty}</p>}
          </> : <p className="ef-empty">{selectedFixtureId === null ? 'No fixture selected.'
            : selectionAvailable ? `Selected fixture is outside this ${fullSheet ? 'sheet' : 'region'}.` : 'Selected fixture unavailable.'}</p>}
          <div className="ef-region-detail">
            <strong>{region.label}</strong>
            {region.places.length > 0 ? <ul>{region.places.map(place => <li key={`${place.packagePlaceKey}:${place.packagePlaceUuid}`}>
              {place.label}<span>{place.basis === 'owner-reported' ? 'Owner reported association' : 'Inferred association'}</span>
            </li>)}</ul> : <p>Room association unknown.</p>}
            <dl className="ef-facts ef-source-facts">
              <div><dt>Outline</dt><dd>{region.outlineBasis === 'untraced' ? 'Not traced'
                : `Approx. photo trace${region.outlineClosed ? '' : ' · open / uncertain'}`}</dd></div>
              <div><dt>Physical placement</dt><dd>Unregistered</dd></div>
              <div><dt>Source date</dt><dd>{sheet?.sourceDate ?? 'Unknown'}</dd></div>
              <div><dt>Interpreted</dt><dd>{data.interpretationDate}</dd></div>
            </dl>
            {data.symbolLegend.xMeansSocket === null && <p className="ef-legend-state">X legend pending</p>}
            {data.symbolLegend.xMeansSocket === true && data.symbolLegend.socketsPerX === null
              && <p className="ef-legend-state">Sockets per X unknown</p>}
          </div>
        </aside>
      </div>
    </> : <p className="ef-empty" role="status">{data.regions.length === 0 ? 'No drawing regions available.'
      : selectedRegionId === null ? selectedPackagePlaces !== null ? 'No drawing region is associated with this room.'
      : 'Choose a drawing region.'
      : 'Selected drawing region is unavailable.'}</p>}
  </section>;
}
