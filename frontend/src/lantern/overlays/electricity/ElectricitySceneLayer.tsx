import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon } from '../../components/Icon';
import { LAYER } from '../../atlas/palette';
import { electricitySceneProjection } from './scene';
import type { ElectricitySceneLayerProps, ElectricitySceneSelection } from './scene-types';
import './scene.css';

/** Raw SVG g in the geometry-owned scene. Markers represent drawings associated
 * with a room, not fixtures. Only the host supplies projected DISPLAY points. */
export function ElectricitySceneLayer(props: ElectricitySceneLayerProps) {
  const id = useId(), [hover, setHover] = useState<string | null>(null);
  const current = useRef(props); current.current = props;
  const { active, viewKey, data, mapping, anchors, ui, unplacedDock, selection, labelPoint,
    selectedPackagePlaces = null, selectedPlaceId = null } = props;
  if (!active || !data || data.viewKey !== viewKey) return null;
  const scene = electricitySceneProjection(data, mapping, anchors, unplacedDock, ui, selectedPackagePlaces, selectedPlaceId);
  if (!scene) return null;
  const choose = (next: ElectricitySceneSelection) => {
    const now = current.current;
    if (!now.active || now.viewKey !== viewKey || now.data !== data || now.mapping !== mapping
      || (now.selectedPackagePlaces ?? null) !== selectedPackagePlaces || (now.selectedPlaceId ?? null) !== selectedPlaceId) return;
    const fresh = electricitySceneProjection(data, mapping, now.anchors, now.unplacedDock, now.ui, selectedPackagePlaces, selectedPlaceId);
    if (!fresh || (next.kind === 'electricity-room' && !fresh.groups.some(group => group.anchor.id === next.anchorId))) return;
    now.onSelectionChange(next);
  };
  const key = (event: KeyboardEvent<SVGGElement>, next: ElectricitySceneSelection) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); choose(next); }
  };
  const stop = (event: PointerEvent<SVGGElement>) => event.stopPropagation();
  const color = LAYER.electrical.color, u = scene.ui;
  return <g className="electricity-scene-layer stage-ui" role="group" aria-labelledby={`${id}-title`}>
    <title id={`${id}-title`}>Historical electrical drawings associated with rooms. Fixture positions and wire routes are unknown.</title>
    {labelPoint && <text x={labelPoint[0]} y={labelPoint[1]} fontSize={12 * u} className="electricity-scene-caption">Room-associated drawings · positions unknown</text>}
    {scene.groups.map(group => {
      const { anchor } = group, selected = selection?.kind === 'electricity-room' && selection.anchorId === anchor.id;
      const next = { kind: 'electricity-room' as const, anchorId: anchor.id }, R = (selected ? 11 : 9) * u;
      return <g key={anchor.id} className={`electricity-scene-pin pin${selected ? ' is-selected' : ''}`} role="button" tabIndex={0}
        data-scene-anchor={anchor.id} aria-pressed={selected}
        aria-label={`${group.label}; ${group.sheets.length} historical electrical drawings; schematic room association`}
        onPointerDown={stop} onClick={event => { event.stopPropagation(); choose(next); }} onKeyDown={event => key(event, next)}
        onPointerEnter={() => setHover(anchor.id)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(anchor.id)} onBlur={() => setHover(null)}>
        <title>{`${group.label} · ${group.sheets.length} drawings · Documentary room association`}</title>
        <ellipse cx={anchor.base[0]} cy={anchor.base[1]} rx={R * .75} ry={R * .35} fill="#1E2638" opacity={.12} />
        <line x1={anchor.base[0]} y1={anchor.base[1]} x2={anchor.top[0]} y2={anchor.top[1]} stroke={color} strokeWidth={1.4 * u} />
        {selected && <circle cx={anchor.top[0]} cy={anchor.top[1]} r={R * 1.9} fill="none" stroke={color} strokeWidth={1.4 * u} />}
        <circle cx={anchor.top[0]} cy={anchor.top[1]} r={R} fill={color} stroke="#FFFFFF" strokeWidth={1.4 * u} />
        <g transform={`translate(${anchor.top[0] - R * .65} ${anchor.top[1] - R * .65})`} style={{ color: '#FFFFFF' }}><Icon name="file" size={R * 1.3} /></g>
        <circle cx={anchor.top[0]} cy={anchor.top[1]} r={22 * u} fill="transparent" className="electricity-scene-pin-hit pin-hit" />
        {(selected || hover === anchor.id) && <g transform={`translate(${anchor.top[0]} ${anchor.top[1] - 22 * u}) scale(${u})`} pointerEvents="none">
          <rect x={-94} y={-43} width={188} height={40} rx={9} fill={selected ? '#1E2638' : '#FCFBF8'} stroke={selected ? '#1E2638' : '#C9BFAE'} />
          <text textAnchor="middle" y={-26} fill={selected ? '#FFFFFF' : '#1E2638'} fontSize={12} fontWeight={650}>{group.label.length > 28 ? `${group.label.slice(0, 26)}…` : group.label}</text>
          <text textAnchor="middle" y={-12} fill={selected ? '#E9E4DA' : '#596173'} fontSize={11}>{group.sheets.length} historical {group.sheets.length === 1 ? 'drawing' : 'drawings'}</text>
        </g>}
      </g>;
    })}
    <g className="electricity-scene-dock" transform={`translate(${scene.dock[0]} ${scene.dock[1]}) scale(${u})`} role="button" tabIndex={0}
      aria-label={`${scene.unplaced.length} drawings outside shown room markers`} aria-pressed={selection?.kind === 'electricity-unplaced'}
      onPointerDown={stop} onClick={event => { event.stopPropagation(); choose({ kind: 'electricity-unplaced' }); }}
      onKeyDown={event => key(event, { kind: 'electricity-unplaced' })}>
      <title>Drawings outside shown room markers remain available. No fixture position is implied.</title>
      <rect x={-65} y={-22} width={130} height={44} rx={22} fill="#FCFBF8" stroke="#C9BFAE" />
      <g transform="translate(-47 -8)" style={{ color }}><Icon name="file" size={16} /></g>
      <text x={-24} y={4} fill="#1E2638" fontSize={12} fontWeight={600}>{scene.unplaced.length} off-marker</text>
    </g>
  </g>;
}
