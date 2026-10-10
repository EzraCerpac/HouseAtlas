import { useId, useMemo } from 'react';
import type { KeyboardEvent } from 'react';
import type { NetworkOverlayData, NetworkOverlaySelection } from './types';
import { devicePlacement, networkGraph, networkLinkLabel } from './model';
import { LAYER } from '../../atlas/palette';
import { GLYPH } from '../../atlas/glyphs';

interface Props {
  readonly data: NetworkOverlayData;
  readonly selection: NetworkOverlaySelection | null;
  readonly onSelect: (selection: NetworkOverlaySelection) => void;
}
function wrap(label: string): string[] {
  const words = label.split(' '), lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last !== undefined && `${last} ${word}`.length <= 23) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.length <= 2 ? lines : [lines[0]!, `${lines[1]!.slice(0, 20)}…`];
}
const dash = (medium: string) => medium === 'wifi' ? '3 5' : medium === 'powerline' ? '10 4 2 4' : medium === 'unknown' ? '2 6' : undefined;

/** Reuses original Lantern Topology's BFS and Bezier edges with source endpoint
 * kinds, selectable links and an explicit schematic/physical distinction. */
export function NetworkTopology({ data, selection, onSelect }: Props) {
  const id = useId(), graph = useMemo(() => networkGraph(data), [data]);
  const color = LAYER.network.color;
  const key = (event: KeyboardEvent<SVGGElement>, next: NetworkOverlaySelection) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(next); }
  };
  return <section className="network-topology" aria-labelledby={`${id}-heading`}>
    <h4 id={`${id}-heading`}>Logical connections</h4>
    <p>Positions are schematic, not scan locations or cable routes. Interfaces are grouped with their device; the exported floor does not filter connections.</p>
    <div className="network-topology-scroll" role="region" aria-label="Scrollable logical network diagram" tabIndex={0}>
      <svg width={graph.width} height={graph.height} viewBox={`0 0 ${graph.width} ${graph.height}`} role="group" aria-label="Saved network configuration connections">
        {graph.disconnectedY !== null && <text x={18} y={graph.disconnectedY} className="network-topology-sub">Separate or unbound records</text>}
        {graph.edges.map(({ link, from, to }) => {
          const a = graph.positions.get(from)!, b = graph.positions.get(to)!;
          const mx = (a[0] + b[0]) / 2;
          const path = `M${a[0]} ${a[1]} C${mx} ${a[1]} ${mx} ${b[1]} ${b[0]} ${b[1]}`;
          const selected = selection?.kind === 'link' && selection.id === link.id;
          const accepted = link.confidence === 'accepted';
          const uncertain = !accepted && (link.kind === 'hypothesis' || link.kind === 'unresolved-path' || link.confidence === 'unknown');
          const lineColor = uncertain ? '#596173' : color;
          const next = { kind: 'link' as const, id: link.id };
          const label = accepted ? `${networkLinkLabel(data, link)}; saved configuration; ${link.medium === 'unknown' ? 'type not recorded' : link.medium}`
            : `${networkLinkLabel(data, link)}; ${link.kind}; ${link.medium}; ${link.confidence}; ${link.temporalStatus}`;
          return <g key={link.id} className={`network-topology-edge${selected ? ' is-selected' : ''}`} role="button" tabIndex={0}
            aria-label={label} aria-pressed={selected} onClick={() => onSelect(next)} onKeyDown={event => key(event, next)}>
            <title>{label}</title>
            <path className="network-topology-hit" d={path} fill="none" stroke="transparent" strokeWidth={18} />
            <path className="network-topology-line" d={path} fill="none" stroke={lineColor} strokeWidth={selected ? 5 : 2.5}
              strokeDasharray={accepted ? undefined : link.kind === 'hypothesis' ? '7 5' : dash(link.medium)} />
            <text x={mx} y={(a[1] + b[1]) / 2 - 7} textAnchor="middle" className="network-topology-edge-label">
              {accepted && link.medium === 'unknown' ? 'Connection' : link.kind === 'hypothesis' ? 'Tentative hypothesis' : link.medium === 'unknown' ? 'Unknown path' : link.medium}
            </text>
          </g>;
        })}
        {graph.nodes.map(node => {
          const p = graph.positions.get(node.id)!;
          const incident = graph.edges.find(edge => edge.from === node.id || edge.to === node.id);
          const next: NetworkOverlaySelection | null = node.device ? { kind: 'device', id: node.id }
            : incident ? { kind: 'link', id: incident.link.id } : null;
          const selected = next !== null && selection?.kind === next.kind && selection.id === next.id;
          const placement = node.device ? devicePlacement(node.device) : `${node.kind} · No physical position`;
          const labels = wrap(node.label);
          return <g key={node.id} className={`network-topology-node${selected ? ' is-selected' : ''}`}
            transform={`translate(${p[0]} ${p[1]})`} role={next ? 'button' : 'img'} tabIndex={next ? 0 : undefined}
            aria-label={`${node.label}; ${placement}`} aria-pressed={next ? selected : undefined}
            onClick={() => next && onSelect(next)} onKeyDown={event => next && key(event, next)}>
            <title>{node.label}; {placement}</title>
            <rect x={-90} y={-29} width={180} height={88} rx={9} fill="#fcfbf8" stroke={selected ? color : '#c9bfae'}
              strokeWidth={selected ? 3 : 1.5} strokeDasharray={data.source.status === 'accepted' ? undefined : node.kind === 'unresolved' || node.device?.place === null ? '5 3' : undefined} />
            {node.device ? <g transform="translate(-9 -23) scale(1.8)"><path d={GLYPH.device} fill="none" stroke={color} strokeWidth={1.6} /></g>
              : <text y={-12} textAnchor="middle" className="network-topology-sub">{node.kind}</text>}
            {labels.map((line, i) => <text key={i} y={6 + i * 15} textAnchor="middle" className="network-topology-name">{line}</text>)}
            <text y={48} textAnchor="middle" className="network-topology-sub">{node.device?.mobility === 'mobile' ? 'Mobile; no fixed position'
              : node.device?.mobility === 'nonspatial' ? 'Nonspatial' : node.device?.place ? node.device.place.roomLabel.slice(0, 26) : 'Unsited / unbound'}</text>
          </g>;
        })}
      </svg>
    </div>
    {data.source.status === 'accepted' ? <p>Solid lines: saved configuration. Connection types appear on the lines where recorded.</p> : <ul className="network-topology-key">{[['ethernet', 'Ethernet'], ['wifi', 'Wi-Fi'], ['powerline', 'Powerline membership'], ['unknown', 'Unknown / unresolved']].map(([medium, label]) => <li key={medium}>
      <svg width={36} height={12} aria-hidden="true"><path d="M2 6h32" stroke={medium === 'unknown' ? '#596173' : color} strokeWidth={2.5} strokeDasharray={dash(medium!)} /></svg>{label}
    </li>)}<li>Dashed grey: tentative owner hypothesis</li></ul>}
  </section>;
}
