import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NetworkOverlayData, NetworkOverlayDevice, NetworkOverlayEndpoint, NetworkOverlayLink } from '../overlays/network/types';
import type { DocumentaryNetworkGraph } from './runtime-overlays';
import './network-graph.css';

/** The complete recorded network in its own frame, apart from the house. The
 * layout is computed from the topology alone: a position is never a place in
 * the house and a line is never a cable route. Every device, endpoint and
 * link stays reachable, including records with no connection to any other. */

type NodeKind = 'device' | 'endpoint' | 'unresolved';
interface GraphNode {
  readonly id: string; readonly kind: NodeKind; readonly label: string; readonly sourceId: string;
  readonly device: NetworkOverlayDevice | null; readonly endpoint: NetworkOverlayEndpoint | null;
  /** Endpoints the source assigns to this device, drawn as part of it. */
  readonly ports: readonly NetworkOverlayEndpoint[];
}
type EdgeTone = 'recorded' | 'uncertain' | 'hypothesis' | 'membership' | 'unresolved';
interface GraphEdge { readonly key: string; readonly link: NetworkOverlayLink; readonly a: string; readonly b: string; readonly tone: EdgeTone }
interface Point { readonly x: number; readonly y: number; readonly angle: number }
type Choice = { readonly kind: 'node' | 'link'; readonly id: string } | null;

const EDGE_LABEL: Record<EdgeTone, string> = {
  recorded: 'Recorded connection', uncertain: 'Connection, confidence not recorded or uncertain', hypothesis: 'Hypothesis in the source',
  membership: 'Segment membership', unresolved: 'Unresolved path or endpoint',
};
const NODE_LABEL: Record<NodeKind, string> = { device: 'Device', endpoint: 'Endpoint without a device', unresolved: 'Endpoint ID not in the source' };
const LINK_KIND: Record<NetworkOverlayLink['kind'], string> = {
  connection: 'Connection', 'segment-membership': 'Segment membership', 'unresolved-path': 'Unresolved path', hypothesis: 'Hypothesis',
};
const MAPPING = { unmatched: 'not matched to a model room', proposed: 'proposed room match, not reviewed', accepted: 'reviewed room match' } as const;
const KIND_ORDER: Record<NodeKind, number> = { device: 0, endpoint: 1, unresolved: 2 };
const TONE_ORDER: readonly EdgeTone[] = ['recorded', 'uncertain', 'membership', 'hypothesis', 'unresolved'];
/** Logical units: least ring spacing, least arc between nodes on one ring, the
 * frame's minimum width and the margin kept around each group. */
const RING = 56, SPACING = 34, WIDTH = 360, MARGIN = 28;
/** Name text in logical units: characters per line, line height and average glyph widths. */
const LINE = 16, LEAD = 12, GLYPH = 6.1, ROOT_GLYPH = 6.9;
const HYPOTHESIS = /hypothes/i;
const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** A name in up to `max` lines of about `width` characters, broken at spaces;
 * only what still does not fit ends in an ellipsis. The full name stays in the lists. */
function wrap(text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= width) lines[lines.length - 1] = `${last} ${word}`; else lines.push(word);
  }
  const cut = (line: string) => line.length > width ? `${line.slice(0, width - 1)}…` : line;
  const kept = lines.slice(0, max).map(cut);
  if (lines.length > max) kept[max - 1] = `${kept[max - 1]!.replace(/…$/, '').slice(0, width - 1)}…`;
  return kept.length > 0 ? kept : [cut(text)];
}

function toneOf(link: NetworkOverlayLink, a: string, b: string): EdgeTone {
  if (link.kind === 'hypothesis' || [link.temporalStatus, link.basis, link.notes].some(text => HYPOTHESIS.test(text ?? ''))) return 'hypothesis';
  if (link.kind === 'unresolved-path' || a.startsWith('u:') || b.startsWith('u:')) return 'unresolved';
  if (link.kind === 'segment-membership') return 'membership';
  return link.confidence === 'accepted' || link.confidence === 'recorded' ? 'recorded' : 'uncertain';
}

/** Devices carry their own endpoints; an endpoint without a known device is its
 * own node, and a link end the source does not list is kept as unresolved.
 * Device IDs resolve before endpoint IDs, as in the existing network helpers. */
function buildGraph(data: NetworkOverlayData) {
  const devices = new Map(data.devices.map(device => [device.id, device]));
  const endpoints = new Map(data.endpoints.map(endpoint => [endpoint.id, endpoint]));
  const nodes = new Map<string, GraphNode>();
  for (const device of data.devices) nodes.set(`d:${device.id}`, { id: `d:${device.id}`, kind: 'device', label: device.label, sourceId: device.id,
    device, endpoint: null, ports: data.endpoints.filter(endpoint => endpoint.ownerDeviceId === device.id) });
  for (const endpoint of data.endpoints) if (endpoint.ownerDeviceId === null || !devices.has(endpoint.ownerDeviceId))
    nodes.set(`e:${endpoint.id}`, { id: `e:${endpoint.id}`, kind: 'endpoint', label: endpoint.label, sourceId: endpoint.id, device: null, endpoint, ports: [] });
  const resolve = (id: string) => {
    if (devices.has(id)) return `d:${id}`;
    const endpoint = endpoints.get(id);
    if (endpoint) return endpoint.ownerDeviceId !== null && devices.has(endpoint.ownerDeviceId) ? `d:${endpoint.ownerDeviceId}` : `e:${id}`;
    if (!nodes.has(`u:${id}`)) nodes.set(`u:${id}`, { id: `u:${id}`, kind: 'unresolved', label: `Unresolved endpoint (${id})`, sourceId: id, device: null, endpoint: null, ports: [] });
    return `u:${id}`;
  };
  const edges = data.links.map((link, at): GraphEdge => {
    const a = resolve(link.fromEndpointId), b = resolve(link.toEndpointId);
    return { key: `${at}:${link.id}`, link, a, b, tone: toneOf(link, a, b) };
  });
  return { nodes, edges };
}

/** Deterministic radial trees, one per connected group, largest first and
 * packed in rows; records with no connection to another node are listed apart. */
function layoutGraph(nodes: ReadonlyMap<string, GraphNode>, edges: readonly GraphEdge[]) {
  const order = [...nodes.values()].sort((p, q) => KIND_ORDER[p.kind] - KIND_ORDER[q.kind] || p.label.localeCompare(q.label) || (p.id < q.id ? -1 : 1));
  const rank = new Map(order.map((node, at) => [node.id, at]));
  const near = new Map(order.map(node => [node.id, new Set<string>()]));
  for (const edge of edges) if (edge.a !== edge.b) { near.get(edge.a)!.add(edge.b); near.get(edge.b)!.add(edge.a); }
  const degree = (id: string) => near.get(id)!.size;
  const weight = (p: string, q: string) => degree(q) - degree(p) || rank.get(p)! - rank.get(q)!;

  const seen = new Set<string>(), groups: string[][] = [];
  for (const node of order) {
    if (seen.has(node.id)) continue;
    const group = [node.id]; seen.add(node.id);
    for (let at = 0; at < group.length; at++) for (const next of near.get(group[at]!)!) if (!seen.has(next)) { seen.add(next); group.push(next); }
    groups.push(group);
  }
  const linked = groups.filter(group => group.length > 1).sort((p, q) => q.length - p.length || rank.get(p[0]!)! - rank.get(q[0]!)!);
  const alone = groups.filter(group => group.length === 1).map(group => group[0]!);

  const trees = linked.map(group => {
    const root = [...group].sort(weight)[0]!;
    const children = new Map<string, string[]>(), depth = new Map([[root, 0]]), queue = [root];
    for (let at = 0; at < queue.length; at++) {
      const id = queue[at]!, own: string[] = [];
      for (const next of [...near.get(id)!].sort(weight)) if (!depth.has(next)) { depth.set(next, depth.get(id)! + 1); own.push(next); queue.push(next); }
      children.set(id, own);
    }
    const leaves = new Map<string, number>();
    for (const id of [...queue].reverse()) {
      const own = children.get(id)!;
      leaves.set(id, own.length === 0 ? 1 : own.reduce((sum, child) => sum + leaves.get(child)!, 0));
    }
    // Each ring is wide enough for the nodes it carries, so a busy hub's neighbours never bunch.
    const perDepth = new Map<number, number>();
    for (const d of depth.values()) perDepth.set(d, (perDepth.get(d) ?? 0) + 1);
    const radius = [0];
    for (let d = 1; perDepth.has(d); d++) radius[d] = Math.max(radius[d - 1]! + RING, perDepth.get(d)! * SPACING / (2 * Math.PI));
    const spots = new Map<string, Point>();
    const place = (id: string, from: number, span: number) => {
      const r = radius[depth.get(id)!]!, angle = from + span / 2;
      spots.set(id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r, angle });
      let start = from;
      for (const child of children.get(id)!) { const share = span * leaves.get(child)! / leaves.get(id)!; place(child, start, share); start += share; }
    };
    place(root, -Math.PI / 2, Math.PI * 2);
    const xs = [...spots.values()].map(p => p.x), ys = [...spots.values()].map(p => p.y);
    const box = { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
    return { root, depth, spots, w: box.r - box.l + 2 * MARGIN, h: box.b - box.t + 2 * MARGIN, box };
  });

  const width = Math.max(WIDTH, ...trees.map(tree => tree.w));
  const rows: (typeof trees)[] = [];
  let used = Infinity;
  for (const tree of trees) {
    if (used + tree.w > width) { rows.push([]); used = 0; }
    rows[rows.length - 1]!.push(tree); used += tree.w;
  }
  const points = new Map<string, Point>(), roots = new Set<string>(), depths = new Map<string, number>();
  let y = 0;
  for (const row of rows) {
    let x = (width - row.reduce((sum, tree) => sum + tree.w, 0)) / 2;
    const h = Math.max(...row.map(tree => tree.h));
    for (const tree of row) {
      const dx = x + MARGIN - tree.box.l, dy = y + (h - tree.h) / 2 + MARGIN - tree.box.t;
      for (const [id, p] of tree.spots) points.set(id, { x: p.x + dx, y: p.y + dy, angle: p.angle });
      for (const [id, d] of tree.depth) depths.set(id, d);
      roots.add(tree.root); x += tree.w;
    }
    y += h;
  }
  return { points, roots, depths, degree, rank, width, height: y, alone, order };
}

interface NameTag { readonly x: number; readonly y: number; readonly anchor: 'start' | 'middle' | 'end'; readonly lines: readonly string[] }
type Box = { readonly l: number; readonly t: number; readonly r: number; readonly b: number };

/** Names placed by priority: the chosen record, what touches it, each group's
 * hub, then the best-connected. A name goes outward from its node, else below
 * or above it, and is left to the lists where it would cover another name or
 * node. Returns the names and the frame that holds nodes and names. */
function placeNames(view: ReturnType<typeof layoutGraph>, nodes: ReadonlyMap<string, GraphNode>, chosen: string | null, lit: ReadonlySet<string> | null) {
  const near = (id: string): Box => { const p = view.points.get(id)!; return { l: p.x - 8, t: p.y - 8, r: p.x + 8, b: p.y + 8 }; };
  const ids = [...view.points.keys()];
  const tier = (id: string) => id === chosen ? 0 : lit?.has(id) ? 1 : view.roots.has(id) ? 2 : 3;
  ids.sort((p, q) => tier(p) - tier(q) || view.degree(q) - view.degree(p) || view.depths.get(p)! - view.depths.get(q)! || view.rank.get(p)! - view.rank.get(q)!);
  const placed: Box[] = [], tags = new Map<string, NameTag>();
  const hits = (box: Box, own: string) => placed.some(o => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)
    || ids.some(id => id !== own && (o => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)(near(id)));
  let frame: Box = { l: 0, t: 0, r: view.width, b: view.height };
  for (const id of ids) {
    const p = view.points.get(id)!, root = view.roots.has(id);
    const lines = wrap(nodes.get(id)!.label, id === chosen ? LINE + 4 : LINE, id === chosen ? 3 : 2);
    const w = Math.max(...lines.map(line => line.length)) * (root ? ROOT_GLYPH : GLYPH), h = lines.length * LEAD;
    const c = Math.cos(p.angle), s = Math.sin(p.angle);
    const side = c > .35 ? 'start' : c < -.35 ? 'end' : 'middle';
    const spots: { anchor: NameTag['anchor']; x: number; top: number }[] = [
      ...(root ? [] : [{ anchor: side, x: p.x + c * 12, top: p.y + s * 12 - h / 2 + (side === 'middle' ? (s > 0 ? h / 2 : -h / 2) : 0) }]),
      { anchor: 'middle', x: p.x, top: root ? p.y - 12 - h : p.y + 10 },
      { anchor: 'middle', x: p.x, top: root ? p.y + 12 : p.y - 10 - h },
    ];
    const required = tier(id) < 2;
    for (const [at, spot] of spots.entries()) {
      const l = spot.anchor === 'start' ? spot.x : spot.anchor === 'end' ? spot.x - w : spot.x - w / 2;
      const box = { l: l - 2, t: spot.top - 1, r: l + w + 2, b: spot.top + h + 1 };
      // The chosen record and its neighbours keep a name even where nothing is free.
      if (hits(box, id) && !(required && at === spots.length - 1)) continue;
      placed.push(box);
      frame = { l: Math.min(frame.l, box.l - 4), t: Math.min(frame.t, box.t - 4), r: Math.max(frame.r, box.r + 4), b: Math.max(frame.b, box.b + 4) };
      tags.set(id, { x: spot.x, y: spot.top + LEAD - 3, anchor: spot.anchor, lines });
      break;
    }
  }
  return { tags, frame };
}

function edgePath(p: Point, q: Point, bend: number, self: boolean) {
  if (self) {
    const ux = Math.cos(p.angle) || 0, uy = Math.sin(p.angle) || 1, cx = p.x + ux * 20, cy = p.y + uy * 20;
    return `M${p.x} ${p.y}C${cx - uy * 12} ${cy + ux * 12} ${cx + uy * 12} ${cy - ux * 12} ${p.x} ${p.y}`;
  }
  if (bend === 0) return `M${p.x} ${p.y}L${q.x} ${q.y}`;
  const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1;
  return `M${p.x} ${p.y}Q${(p.x + q.x) / 2 - dy / l * bend} ${(p.y + q.y) / 2 + dx / l * bend} ${q.x} ${q.y}`;
}

function Glyph({ kind, x = 0, y = 0, r = 6 }: { readonly kind: NodeKind; readonly x?: number; readonly y?: number; readonly r?: number }) {
  if (kind === 'device') return <circle className="ung-node-device" cx={x} cy={y} r={r} />;
  if (kind === 'endpoint') return <rect className="ung-node-endpoint" x={x - r * .72} y={y - r * .72} width={r * 1.44} height={r * 1.44} transform={`rotate(45 ${x} ${y})`} />;
  return <circle className="ung-node-unresolved" cx={x} cy={y} r={r * .85} />;
}

function KeyGlyph({ kind }: { readonly kind: NodeKind }) {
  return <svg className="ung-glyph" width={14} height={14} viewBox="-7 -7 14 14" aria-hidden="true"><Glyph kind={kind} r={4.6} /></svg>;
}

function LineSample({ tone }: { readonly tone: EdgeTone }) {
  return <svg className="ung-glyph is-line" width={26} height={10} viewBox="0 0 26 10" aria-hidden="true">
    <path className={`ung-edge is-${tone}`} d="M1 5H25" /></svg>;
}

export function NetworkGraph({ graph }: { readonly graph: DocumentaryNetworkGraph }) {
  const { data } = graph;
  const built = useMemo(() => buildGraph(data), [data]);
  const view = useMemo(() => layoutGraph(built.nodes, built.edges), [built]);
  const [choice, setChoice] = useState<Choice>(null);
  const root = useRef<HTMLElement>(null), detail = useRef<HTMLDivElement>(null), title = useRef<HTMLElement>(null);
  const focusOrigin = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const chosen = choice?.kind === 'node' ? built.nodes.get(choice.id) ?? null : null;
  const chosenEdge = choice?.kind === 'link' ? built.edges.find(edge => edge.key === choice.id) ?? null : null;
  const select = (next: Choice, toggle = false) => {
    const active = document.activeElement;
    focusOrigin.current = active instanceof HTMLElement && root.current?.contains(active) ? active : null;
    setChoice(value => toggle && value && next && value.kind === next.kind && value.id === next.id ? null : next);
  };
  const choose = (next: Choice) => select(next, true);
  useLayoutEffect(() => {
    const origin = focusOrigin.current; focusOrigin.current = null;
    if (!origin || origin.isConnected) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    (choice ? detail.current : title.current)?.focus({ preventScroll: true });
  }, [choice]);
  const label = (id: string) => built.nodes.get(id)?.label ?? id;

  // The chosen record and what touches it stay in full; the rest steps back.
  const lit = useMemo(() => {
    if (chosenEdge) return { nodes: new Set([chosenEdge.a, chosenEdge.b]), edges: new Set([chosenEdge.key]) };
    if (!chosen) return null;
    const edges = built.edges.filter(edge => edge.a === chosen.id || edge.b === chosen.id);
    return { nodes: new Set([chosen.id, ...edges.flatMap(edge => [edge.a, edge.b])]), edges: new Set(edges.map(edge => edge.key)) };
  }, [chosen, chosenEdge, built]);
  const { tags: names, frame } = useMemo(() => placeNames(view, built.nodes, chosen?.id ?? null, lit?.nodes ?? null), [view, built, chosen, lit]);

  // Parallel links between the same two nodes bow apart instead of overlapping.
  const drawn = useMemo(() => {
    const pairs = new Map<string, GraphEdge[]>();
    for (const edge of built.edges) {
      if (!view.points.has(edge.a) || !view.points.has(edge.b)) continue;
      const pair = [edge.a, edge.b].sort().join('\n'); const own = pairs.get(pair) ?? []; own.push(edge); pairs.set(pair, own);
    }
    return [...pairs.values()].flatMap(own => own.map((edge, at) => {
      const p = view.points.get(edge.a)!, q = view.points.get(edge.b)!;
      return { edge, d: edgePath(p, q, (at - (own.length - 1) / 2) * 16, edge.a === edge.b) };
    }));
  }, [built, view]);

  const tones = TONE_ORDER.filter(tone => built.edges.some(edge => edge.tone === tone));
  const kinds = (['device', 'endpoint', 'unresolved'] as const).filter(kind => view.order.some(node => node.kind === kind));
  const devices = view.order.filter(node => node.kind === 'device');
  const others = view.order.filter(node => node.kind !== 'device');
  const alone = view.alone.map(id => built.nodes.get(id)!);
  const { source } = data;

  const nodeButton = (node: GraphNode) => {
    const links = built.edges.filter(edge => edge.a === node.id || edge.b === node.id).length;
    return <li key={node.id}><button type="button" className="ung-item" aria-pressed={choice?.kind === 'node' && choice.id === node.id}
      onClick={() => choose({ kind: 'node', id: node.id })}>
      <KeyGlyph kind={node.kind} /><span className="ung-item-name">{node.label}</span>
      <span className="ung-item-meta">{links === 0 ? 'no connection' : plural(links, 'connection')}</span></button></li>;
  };

  return <figure className="ung" aria-labelledby={titleId} ref={root}>
    <figcaption className="ung-caption">
      <strong id={titleId} ref={title} tabIndex={-1}>{graph.qualification}</strong>
      <span>{plural(data.devices.length, 'device')}, {plural(data.endpoints.length, 'endpoint')}, {plural(data.links.length, 'connection')}
        {alone.length > 0 ? `; ${alone.length.toLocaleString()} not connected to another record` : ''}</span>
    </figcaption>

    {view.points.size > 0 && <div className="ung-frame">
      {/* Never drawn below 80% of its logical size, so names stay legible; a wide graph scrolls in its frame. */}
      <svg className="ung-svg" viewBox={`${frame.l} ${frame.t} ${frame.r - frame.l} ${frame.b - frame.t}`} role="img"
        style={{ width: `clamp(${Math.round((frame.r - frame.l) * .8)}px, 100%, ${Math.round((frame.r - frame.l) * 1.3)}px)` }}
        aria-label="Logical layout of the recorded network. Positions are not places in the house and lines are not cable routes.">
        <g className={`ung-edges${lit ? ' is-dimmed' : ''}`}>
          {drawn.map(({ edge, d }) => <g key={edge.key} className={lit?.edges.has(edge.key) ? 'is-lit' : undefined}>
            <path className={`ung-edge is-${edge.tone}${choice?.kind === 'link' && choice.id === edge.key ? ' is-chosen' : ''}`} d={d} />
            <path className="ung-edge-hit" d={d} onClick={() => choose({ kind: 'link', id: edge.key })} />
          </g>)}
        </g>
        <g className={`ung-nodes${lit ? ' is-dimmed' : ''}`}>
          {[...view.points].map(([id, p]) => {
            const node = built.nodes.get(id)!, on = choice?.kind === 'node' && choice.id === id, root = view.roots.has(id);
            return <g key={id} className={`ung-node${on ? ' is-chosen' : ''}${lit?.nodes.has(id) ? ' is-lit' : ''}`}
              onClick={() => choose({ kind: 'node', id })}>
              <title>{node.label}</title>
              {root && <circle className="ung-hub" cx={p.x} cy={p.y} r={12} />}
              {on && <circle className="ung-halo" cx={p.x} cy={p.y} r={root ? 13 : 11} />}
              <circle className="ung-hit" cx={p.x} cy={p.y} r={12} />
              <Glyph kind={node.kind} x={p.x} y={p.y} r={root ? 7.5 : 6} />
            </g>;
          })}
        </g>
        {/* Names above every node and line, so a line never strikes through one. */}
        <g className={`ung-names${lit ? ' is-dimmed' : ''}`} aria-hidden="true">
          {[...names].map(([id, tag]) => <text key={id} x={tag.x} y={tag.y} textAnchor={tag.anchor}
            className={`${view.roots.has(id) ? 'is-root' : ''}${lit?.nodes.has(id) ? ' is-lit' : ''}${choice?.kind === 'node' && choice.id === id ? ' is-chosen' : ''}`.trim() || undefined}>
            {tag.lines.map((line, at) => <tspan key={at} x={tag.x} dy={at === 0 ? 0 : LEAD}>{line}</tspan>)}
          </text>)}
        </g>
      </svg>
    </div>}

    <ul className="ung-legend" aria-label="Graph key">
      {kinds.map(kind => <li key={kind}><KeyGlyph kind={kind} />{NODE_LABEL[kind]}</li>)}
      {tones.map(tone => <li key={tone}><LineSample tone={tone} />{EDGE_LABEL[tone]}</li>)}
    </ul>
    <p className="ung-note">Positions show topology only, not places in the house. Every line is a recorded association, not a cable route.</p>

    {(chosen || chosenEdge) && <div className="ung-detail" aria-live="polite" ref={detail} tabIndex={-1} aria-label="Selected network record">
      {chosen && <NodeDetail node={chosen} edges={built.edges.filter(edge => edge.a === chosen.id || edge.b === chosen.id)} label={label}
        chooseLink={key => select({ kind: 'link', id: key })} />}
      {chosenEdge && <LinkDetail edge={chosenEdge} data={data} label={label} chooseNode={id => select({ kind: 'node', id })} />}
      <button type="button" className="text-btn" onClick={() => select(null)}>Clear graph selection</button>
    </div>}

    {alone.length > 0 && <div className="ung-alone" role="group" aria-label="Not connected to another record">
      <span className="ung-alone-head">Not connected to another record</span>
      <ul>{alone.map(node => <li key={node.id}><button type="button" className="ung-chip" aria-pressed={choice?.kind === 'node' && choice.id === node.id}
        onClick={() => choose({ kind: 'node', id: node.id })}><KeyGlyph kind={node.kind} />{node.label}</button></li>)}</ul>
    </div>}

    <details className="ung-list"><summary>Devices ({devices.length.toLocaleString()})</summary><ul>{devices.map(nodeButton)}</ul></details>
    {others.length > 0 && <details className="ung-list"><summary>Endpoints without a device ({others.length.toLocaleString()})</summary><ul>{others.map(nodeButton)}</ul></details>}
    {built.edges.length > 0 && <details className="ung-list"><summary>Connections ({built.edges.length.toLocaleString()})</summary><ul>
      {built.edges.map(edge => <li key={edge.key}><button type="button" className="ung-item" aria-pressed={choice?.kind === 'link' && choice.id === edge.key}
        onClick={() => choose({ kind: 'link', id: edge.key })}>
        <LineSample tone={edge.tone} /><span className="ung-item-name">{label(edge.a)} ↔ {label(edge.b)}</span>
        <span className="ung-item-meta">{LINK_KIND[edge.link.kind]}</span></button></li>)}
    </ul></details>}

    <details className="ung-list ung-source"><summary>Network source</summary>
      <dl>
        <div><dt>Source</dt><dd>{source.label}{source.revision ? `, revision ${source.revision}` : ''}</dd></div>
        <div><dt>Status</dt><dd>{source.status}{source.acceptedAt ? `, accepted ${source.acceptedAt}` : ''}</dd></div>
        <div><dt>Recorded</dt><dd>{source.recordedAt ?? 'unknown'}</dd></div>
        <div><dt>Retrieved</dt><dd>{source.retrievedAt ?? 'unknown'}</dd></div>
        <div><dt>Inventory coverage</dt><dd>{source.coverage}</dd></div>
        {source.notes && <div><dt>Notes</dt><dd>{source.notes}</dd></div>}
      </dl>
    </details>
  </figure>;
}

function NodeDetail({ node, edges, label, chooseLink }: {
  readonly node: GraphNode; readonly edges: readonly GraphEdge[]; readonly label: (id: string) => string; readonly chooseLink: (key: string) => void;
}) {
  const { device, endpoint } = node, place = device?.place ?? null;
  return <>
    <h4><KeyGlyph kind={node.kind} />{node.label}</h4>
    <dl>
      <div><dt>Record</dt><dd>{NODE_LABEL[node.kind]}{device ? `, ${device.kind}` : endpoint ? `, ${endpoint.kind}` : ''}</dd></div>
      {device && <div><dt>Mobility</dt><dd>{device.mobility}</dd></div>}
      {device && <div><dt>Confidence</dt><dd>{device.confidence}</dd></div>}
      {device && <div><dt>Room in source</dt><dd>{place ? `${place.roomLabel}, ${MAPPING[place.mappingStatus]}; no position in the model` : 'None recorded'}</dd></div>}
      {place?.basis && <div><dt>Room basis</dt><dd>{place.basis}</dd></div>}
      {place?.detail && <div><dt>Room detail</dt><dd>{place.detail}</dd></div>}
      {node.ports.length > 0 && <div><dt>Endpoints</dt><dd>{node.ports.map(port => <details key={port.id}>
        <summary>{port.label} ({port.kind})</summary><EndpointFacts endpoint={port} />
      </details>)}</dd></div>}
      {endpoint && <div><dt>Device</dt><dd>{endpoint.ownerDeviceId === null ? 'None in the source' : `Device ID not in the source: ${endpoint.ownerDeviceId}`}</dd></div>}
      {(device?.notes || endpoint?.notes) && <div><dt>Notes</dt><dd>{device?.notes || endpoint?.notes}</dd></div>}
      <div><dt>Source record</dt><dd><code>{node.sourceId}</code></dd></div>
    </dl>
    {edges.length === 0 ? <p>No recorded connection.</p> : <ul className="ung-links">
      {edges.map(edge => <li key={edge.key}><button type="button" className="ung-item" onClick={() => chooseLink(edge.key)}>
        <LineSample tone={edge.tone} /><span className="ung-item-name">{edge.a === edge.b ? 'Within this record' : label(edge.a === node.id ? edge.b : edge.a)}</span>
        <span className="ung-item-meta">{edge.link.medium || 'medium unknown'}</span></button></li>)}
    </ul>}
  </>;
}

function EndpointFacts({ endpoint }: { readonly endpoint: NetworkOverlayEndpoint }) {
  return <dl>
    <div><dt>Endpoint ID</dt><dd><code>{endpoint.id}</code></dd></div>
    <div><dt>Label</dt><dd>{endpoint.label}</dd></div>
    <div><dt>Kind</dt><dd>{endpoint.kind}</dd></div>
    <div><dt>Owner device ID</dt><dd>{endpoint.ownerDeviceId ?? 'None in the source'}</dd></div>
    <div><dt>Notes</dt><dd>{endpoint.notes || 'None recorded'}</dd></div>
  </dl>;
}

function LinkDetail({ edge, data, label, chooseNode }: { readonly edge: GraphEdge; readonly data: NetworkOverlayData; readonly label: (id: string) => string; readonly chooseNode: (id: string) => void }) {
  const { link } = edge;
  return <>
    <h4><LineSample tone={edge.tone} />
      <button type="button" className="text-btn inline" onClick={() => chooseNode(edge.a)}>{label(edge.a)}</button> ↔{' '}
      <button type="button" className="text-btn inline" onClick={() => chooseNode(edge.b)}>{label(edge.b)}</button></h4>
    <p className="ung-qual">{EDGE_LABEL[edge.tone]}. No cable route is recorded.</p>
    <dl>
      <div><dt>From endpoint ID</dt><dd><code>{link.fromEndpointId}</code>
        {data.endpoints.filter(endpoint => endpoint.id === link.fromEndpointId).map(endpoint => <EndpointFacts key={endpoint.id} endpoint={endpoint} />)}</dd></div>
      <div><dt>To endpoint ID</dt><dd><code>{link.toEndpointId}</code>
        {data.endpoints.filter(endpoint => endpoint.id === link.toEndpointId).map(endpoint => <EndpointFacts key={endpoint.id} endpoint={endpoint} />)}</dd></div>
      <div><dt>Kind</dt><dd>{LINK_KIND[link.kind]}</dd></div>
      <div><dt>Medium</dt><dd>{link.medium || 'unknown'}</dd></div>
      <div><dt>Curated confidence</dt><dd>{link.confidence}</dd></div>
      <div><dt>Source confidence</dt><dd>{link.sourceConfidence ?? 'unknown'}</dd></div>
      <div><dt>Recorded</dt><dd>{link.recordedAt ?? 'unknown'}{link.recordedAtPrecision ? ` (${link.recordedAtPrecision})` : ''}</dd></div>
      {link.temporalStatus && <div><dt>Time status</dt><dd>{link.temporalStatus}</dd></div>}
      {link.basis && <div><dt>Basis</dt><dd>{link.basis}</dd></div>}
      {link.notes && <div><dt>Notes</dt><dd>{link.notes}</dd></div>}
      <div><dt>Source record</dt><dd><code>{link.id}</code></dd></div>
    </dl>
  </>;
}
