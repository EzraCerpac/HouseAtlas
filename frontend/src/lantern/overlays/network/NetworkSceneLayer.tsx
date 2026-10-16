import { useId, useLayoutEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import type { NetworkOverlaySelection, NetworkSceneLayerProps, NetworkScenePoint } from './types';
import { networkLinkLabel } from './model';
import { networkSceneProjection } from './scene';
import { GLYPH } from '../../atlas/glyphs';
import { LAYER } from '../../atlas/palette';
import { stageMark, type StageToken } from '../../observability/stage-timing';
import './scene.css';

function curve(a: NetworkScenePoint, b: NetworkScenePoint, lane: number, ui: number) {
  if (a[0] === b[0] && a[1] === b[1]) {
    const r = (10 + (lane % 7) * 2) * ui;
    return `M${a[0]} ${a[1]} C${a[0] - r * 2} ${a[1] - r * 2} ${a[0] + r * 2} ${a[1] - r * 2} ${a[0]} ${a[1]}`;
  }
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1;
  const bend = ((lane % 5) - 2) * 8 * ui;
  return `M${a[0]} ${a[1]} Q${(a[0] + b[0]) / 2 - dy / length * bend} ${(a[1] + b[1]) / 2 + dx / length * bend} ${b[0]} ${b[1]}`;
}

/** Where along an edge's chord a pointer activation landed, for anonymous
 * timing evidence only: the middle half or the outer quarters. */
function chordPart(event: MouseEvent<SVGGElement>, a: NetworkScenePoint, b: NetworkScenePoint): StageToken {
  const matrix = event.currentTarget.getScreenCTM?.();
  const length = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  if (!matrix || length === 0) return 'none';
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  const t = ((point.x - a[0]) * (b[0] - a[0]) + (point.y - a[1]) * (b[1] - a[1])) / length;
  return t > .25 && t < .75 ? 'midpoint' : 'endpoint';
}

/** SVG layer in the actual house scene, not a separate topology canvas.
 * Adapts Lantern Model.PinMark's stem, shadow, head, glyph, halo and callout. */
export function NetworkSceneLayer({ active, viewKey, data, anchors, unplacedDock, ui, selection,
  selectedPackagePlaces = null, onSelectionChange, onOpenUnplaced, labelPoint,
  label = 'Room markers · logical connections' }: NetworkSceneLayerProps) {
  const id = useId();
  const [hover, setHover] = useState<string | null>(null);
  const current = active && data?.viewKey === viewKey ? data : null;
  const projected = useMemo(() => {
    if (!current) return null;
    const start = performance.now();
    return { scene: networkSceneProjection(current, anchors, unplacedDock, ui, selectedPackagePlaces), ms: performance.now() - start };
  }, [current, anchors, unplacedDock, ui, selectedPackagePlaces]);
  const scene = projected?.scene ?? null;
  useLayoutEffect(() => {
    if (projected) stageMark('network-scene', 'layer-commit', { edges: projected.scene.edges.length, pins: projected.scene.placed.length,
      unplaced: projected.scene.unplaced.length, projectMs: Math.round(projected.ms * 10) / 10 });
  }, [projected]);
  if (!current || !scene) return null;
  const color = LAYER.network.color, u = scene.ui;
  const choose = (next: NetworkOverlaySelection, hit: StageToken, input: StageToken, part: StageToken = 'none') => {
    stageMark('network-scene', 'select', { hit, input, part });
    onSelectionChange(next);
  };
  const key = (event: KeyboardEvent<SVGGElement>, next: NetworkOverlaySelection, hit: StageToken) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); choose(next, hit, 'keyboard'); }
  };
  const stop = (event: PointerEvent<SVGGElement>) => event.stopPropagation();
  return <g className="network-scene-layer stage-ui" role="group" aria-labelledby={`${id}-title`}>
    <title id={`${id}-title`}>Network room-level schematic markers and logical connections, not physical cable routes</title>
    {labelPoint && <text x={labelPoint[0]} y={labelPoint[1]} fontSize={12 * u} className="network-scene-caption">{label}</text>}
    <g className="network-scene-connections">
      {scene.edges.map(edge => {
        const next = edge.selection;
        const selected = selection?.kind === next.kind && selection.id === next.id;
        const incident = selection?.kind === 'device' && (edge.from === selection.id || edge.to === selection.id);
        const muted = selection !== null && !selected && !incident;
        const path = curve(edge.fromPoint, edge.toPoint, edge.index, u);
        const name = edge.association
          ? `${edge.association.devices.map(device => device.label).join(' ↔ ')}; ${edge.association.segment.label}; shared ${edge.association.medium} network; logical association`
          : `${networkLinkLabel(current, edge.link)}; ${edge.link.medium === 'unknown' ? 'connection type not recorded' : edge.link.medium}; logical connection`;
        return <g key={edge.id} className={`network-scene-edge${selected ? ' is-selected' : ''}`} role="button" tabIndex={0}
          aria-label={name} aria-pressed={selected} data-hit="edge" onPointerDown={stop}
          onClick={event => { event.stopPropagation(); choose(next, 'edge', event.detail === 0 ? 'keyboard' : 'pointer', chordPart(event, edge.fromPoint, edge.toPoint)); }}
          onKeyDown={event => key(event, next, 'edge')}>
          <title>{name}</title>
          <path d={path} className="network-scene-link-hit" fill="none" stroke="transparent" strokeWidth={14 * u} />
          <path d={path} className="network-scene-link" fill="none" stroke={color} strokeWidth={(selected ? 3.5 : incident ? 2.5 : 1.5) * u}
            strokeLinecap="round" opacity={muted ? .12 : selected || incident ? 1 : .64} />
        </g>;
      })}
    </g>
    {scene.placed.map(({ device, anchor, base, top }) => {
      const selected = selection?.kind === 'device' && selection.id === device.id;
      const hovered = hover === device.id, R = (selected ? 10 : 8) * u;
      const next = { kind: 'device' as const, id: device.id };
      return <g key={device.id} className={`network-scene-pin pin${selected ? ' is-selected' : ''}`} role="button" tabIndex={0}
        aria-label={`${device.label}; ${device.place!.roomLabel}; room-level schematic marker`} aria-pressed={selected}
        data-scene-anchor={anchor.id} data-hit="pin" onPointerDown={stop}
        onClick={event => { event.stopPropagation(); choose(next, 'pin', event.detail === 0 ? 'keyboard' : 'pointer'); }} onKeyDown={event => key(event, next, 'pin')}
        onPointerEnter={() => setHover(device.id)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(device.id)} onBlur={() => setHover(null)}>
        <title>{device.label} · {device.place!.roomLabel} · Room-level schematic marker</title>
        <ellipse cx={base[0]} cy={base[1]} rx={R * .75} ry={R * .35} fill="#1E2638" opacity={.12} />
        <line x1={base[0]} y1={base[1]} x2={top[0]} y2={top[1]} stroke={color} strokeWidth={1.4 * u} />
        {selected && <circle cx={top[0]} cy={top[1]} r={R * 1.9} fill="none" stroke={color} strokeWidth={1.4 * u} className="network-scene-halo" />}
        <circle cx={top[0]} cy={top[1]} r={R} fill={color} stroke="#FFFFFF" strokeWidth={1.4 * u} />
        <path d={GLYPH.device} transform={`translate(${top[0] - R * .62} ${top[1] - R * .62}) scale(${R * .124})`}
          fill="none" stroke="#FFFFFF" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={top[0]} cy={top[1]} r={22 * u} fill="transparent" className="network-scene-pin-hit pin-hit" />
        {(selected || hovered) && <g transform={`translate(${top[0]} ${top[1] - 20 * u}) scale(${u})`} className="network-scene-callout" pointerEvents="none">
          <rect x={-92} y={-43} width={184} height={40} rx={9} fill={selected ? '#1E2638' : '#FCFBF8'} stroke={selected ? '#1E2638' : '#C9BFAE'} />
          <text textAnchor="middle" y={-26} fill={selected ? '#FFFFFF' : '#1E2638'} fontSize={12} fontWeight={650}>{device.label.length > 27 ? `${device.label.slice(0, 25)}…` : device.label}</text>
          <text textAnchor="middle" y={-12} fill={selected ? '#E9E4DA' : '#596173'} fontSize={11}>{device.place!.roomLabel}</text>
        </g>}
      </g>;
    })}
    <g className="network-scene-dock" transform={`translate(${scene.dock[0]} ${scene.dock[1]}) scale(${u})`} role={onOpenUnplaced ? 'button' : 'img'}
      tabIndex={onOpenUnplaced ? 0 : undefined} aria-label={`${scene.unplaced.length} devices outside shown room markers; open network records`} data-hit="dock"
      onPointerDown={stop} onClick={event => { event.stopPropagation(); stageMark('network-scene', 'open-unplaced', { input: event.detail === 0 ? 'keyboard' : 'pointer' }); onOpenUnplaced?.(); }}
      onKeyDown={event => { if (onOpenUnplaced && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); stageMark('network-scene', 'open-unplaced', { input: 'keyboard' }); onOpenUnplaced(); } }}>
      <title>Outside shown room markers. Mobile, nonspatial, unmatched and off-plan records remain unplaced.</title>
      <rect x={-55} y={-22} width={110} height={44} rx={22} fill="#FCFBF8" stroke="#C9BFAE" />
      <circle cx={-33} cy={0} r={7} fill={color} />
      <text x={-18} y={4} fill="#1E2638" fontSize={12} fontWeight={600}>{scene.unplaced.length} unplaced</text>
    </g>
  </g>;
}
