import { useRef } from 'react';
import type { ElectricityFixtureLayerProps, ProjectedElectricalFixture } from './fixture-types';
import { electricalGroupColor, registeredFixturePlacements } from './fixture-model';

/** Raw SVG layer; the geometry owner projects reviewed points or an explicit
 * proposed alignment preview. Neither creates a physical fixture coordinate. */
export function ElectricityFixtureLayer(props: ElectricityFixtureLayerProps) {
  const latest = useRef(props);
  latest.current = props;
  const placements = registeredFixturePlacements(props);
  const data = props.data;
  if (!props.active || !data || data.viewKey !== props.viewKey) return null;
  const ui = Number.isFinite(props.ui) && props.ui > 0 ? props.ui : 1;
  const live = () => latest.current.active && latest.current.data === data
    && latest.current.viewKey === props.viewKey && latest.current.placements === props.placements;
  const chooseNearest = (clientX: number, clientY: number, svg: SVGSVGElement | null) => {
    if (!live()) return;
    const matrix = svg?.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    let closest: ProjectedElectricalFixture | null = null;
    let distance = (12 * ui) ** 2;
    for (const placement of placements) {
      const squared = (point.x - placement.point[0]) ** 2 + (point.y - placement.point[1]) ** 2;
      if (squared <= distance) { closest = placement; distance = squared; }
    }
    if (closest) latest.current.onFixtureChange(closest.fixtureId);
  };
  return <g aria-label={props.registrationPreviewId ? 'Proposed historical drawing alignment' : 'Historical electrical fixture positions'}>
    {placements.map(placement => {
      const fixture = data.fixtures.find(candidate => candidate.id === placement.fixtureId)!;
      const selected = fixture.id === props.selectedFixtureId;
      const color = electricalGroupColor(fixture.group.label);
      const muted = props.selectedGroup !== null && props.selectedGroup !== fixture.group.label;
      const proposed = placement.basis === 'proposed-diagram-alignment';
      const choose = () => { if (live()) latest.current.onFixtureChange(fixture.id); };
      const r = (selected ? 7 : 5) * ui;
      return <g key={fixture.id} data-fixture-id={fixture.id} role="button" tabIndex={0} aria-pressed={selected}
        aria-label={`${fixture.label}; group ${fixture.group.label ?? 'unknown'}; historical drawing, ${proposed ? 'proposed alignment' : 'approximate position'}`}
        transform={`translate(${placement.point[0]} ${placement.point[1]})`}
        opacity={muted ? 0.35 : 1} onClick={event => chooseNearest(event.clientX, event.clientY, event.currentTarget.ownerSVGElement)} onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); }
        }} style={{ cursor: 'pointer' }}>
        <title>{`${fixture.label} · ${fixture.group.label ?? 'Group unknown'}${proposed ? ' · Proposed drawing alignment' : ''}`}</title>
        <circle r={12 * ui} fill="transparent" />
        <circle r={r + 2 * ui} fill="white" stroke={selected ? '#223554' : color} strokeWidth={1.5 * ui}
          strokeDasharray={proposed ? `${2 * ui} ${1.5 * ui}` : undefined} />
        {fixture.kind === 'light' ? <g stroke={color} strokeWidth={1.4 * ui}>
          <circle r={r * 0.55} fill="#fff8d3" />
          <path d={`M ${-r} 0 H ${r} M 0 ${-r} V ${r}`} />
        </g> : fixture.kind === 'socket' ? <g stroke={color} strokeWidth={1.5 * ui}>
          <path d={`M ${-r * 0.4} ${-r * 0.3} v ${r * 0.6} M ${r * 0.4} ${-r * 0.3} v ${r * 0.6}`} />
        </g> : <rect x={-r * 0.45} y={-r * 0.45} width={r * 0.9} height={r * 0.9} fill={color} />}
      </g>;
    })}
  </g>;
}
