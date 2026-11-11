import type { NetworkOverlayDevice, NetworkOverlayLink } from '../overlays/network/types';

/** A recorded route from one device back to the network's root, read from the
 * source's links alone. It says which records connect, never where a cable runs. */
export interface TraceNode {
  readonly id: string; readonly device: NetworkOverlayDevice | null;
  /** 'unresolved' marks a link end the source does not list; hops through it stay uncertain. */
  readonly kind?: string;
}
export interface TraceEdge { readonly key: string; readonly a: string; readonly b: string; readonly link: NetworkOverlayLink }
export type NetworkTraceStatus = 'traced' | 'is-root' | 'no-root' | 'unreachable';
export interface NetworkTrace {
  readonly from: string;
  readonly root: string | null;
  readonly status: NetworkTraceStatus;
  /** Node IDs in order, from the chosen node to the root. */
  readonly nodes: readonly string[];
  /** Edges in order; edge i joins nodes[i] and nodes[i + 1]. */
  readonly edges: readonly TraceEdge[];
  /** True when any hop rests on a link that is not accepted or recorded. */
  readonly uncertain: boolean;
  /** Per hop, in order: whether it rests on accepted or recorded evidence between known records. */
  readonly certain: readonly boolean[];
  /** Every node connected to the chosen one, itself included, so a route that
   * ends short of the root can still show what it does reach. */
  readonly reachable: ReadonlySet<string>;
}

/** A root is a device the source marks as root (`sourceRoot: true`), or one
 * whose kind names a router or gateway. Best first: the source's own mark, then
 * router, then gateway; -1 is not a root. Nothing else (a modem, a label, notes
 * or how many links a device has) makes a root. */
const ROOT_KINDS: readonly RegExp[] = [/router/i, /gateway/i];
export const rootRank = (device: NetworkOverlayDevice | null): number => {
  if (!device) return -1;
  if (device.sourceRoot === true) return 0;
  const kind = ROOT_KINDS.findIndex(pattern => pattern.test(device.kind));
  return kind < 0 ? -1 : kind + 1;
};

const HYPOTHESIS = /hypothes/i;
/** A link is a hypothesis by kind or by the source's own qualification. */
export const isHypothesisLink = (link: NetworkOverlayLink): boolean =>
  link.kind === 'hypothesis' || [link.temporalStatus, link.basis, link.notes].some(text => HYPOTHESIS.test(text ?? ''));

const CONFIDENCE_COST: Record<NetworkOverlayLink['confidence'], number> = {
  accepted: 0, recorded: 0, tentative: .3, unknown: .5, conflicting: .8,
};
/** Evidence penalty of one hop; it only orders routes of equal length. */
const penalty = (link: NetworkOverlayLink): number =>
  CONFIDENCE_COST[link.confidence] + (isHypothesisLink(link) || link.kind === 'unresolved-path' ? .9 : 0);
export const traceEdgeCertain = (edge: TraceEdge): boolean =>
  (edge.link.confidence === 'accepted' || edge.link.confidence === 'recorded')
  && !isHypothesisLink(edge.link) && edge.link.kind !== 'unresolved-path';

/** Fewest hops first; among equal hop counts the better-evidenced route wins. */
interface Cost { readonly hops: number; readonly penalty: number }
const EPSILON = 1e-9;
const compare = (p: Cost, q: Cost): number =>
  p.hops - q.hops || (Math.abs(p.penalty - q.penalty) <= EPSILON ? 0 : p.penalty - q.penalty);

/** Cheapest route from `from` to the best reachable root. Deterministic: ties go
 * to the better root rank, then the lower node ID, then the earlier source link. */
export function traceToRoot(nodes: Iterable<TraceNode>, edges: readonly TraceEdge[], from: string): NetworkTrace {
  const byId = new Map<string, TraceNode>();
  for (const node of nodes) byId.set(node.id, node);
  const roots = [...byId.values()].filter(node => rootRank(node.device) >= 0);
  const unresolved = (edge: TraceEdge) => byId.get(edge.a)?.kind === 'unresolved' || byId.get(edge.b)?.kind === 'unresolved';
  let reachable: ReadonlySet<string> = new Set([from]);
  const empty = (status: NetworkTraceStatus, root: string | null = null): NetworkTrace =>
    ({ from, root, status, nodes: [from], edges: [], uncertain: false, certain: [], reachable });
  if (!byId.has(from)) return empty('unreachable');
  if (rootRank(byId.get(from)!.device) >= 0) return empty('is-root', from);

  const near = new Map<string, { edge: TraceEdge; other: string }[]>();
  for (const edge of edges) {
    if (edge.a === edge.b) continue;
    for (const [here, other] of [[edge.a, edge.b], [edge.b, edge.a]] as const) {
      const own = near.get(here) ?? []; own.push({ edge, other }); near.set(here, own);
    }
  }
  const dist = new Map<string, Cost>([[from, { hops: 0, penalty: 0 }]]), back = new Map<string, TraceEdge>(), done = new Set<string>();
  for (;;) {
    let next: string | null = null;
    for (const [id, d] of dist) if (!done.has(id)) {
      const order = next === null ? -1 : compare(d, dist.get(next)!);
      if (order < 0 || (order === 0 && id < next!)) next = id;
    }
    if (next === null) break;
    done.add(next);
    const here = dist.get(next)!;
    for (const { edge, other } of near.get(next) ?? []) {
      if (done.has(other)) continue;
      const d = { hops: here.hops + 1, penalty: here.penalty + penalty(edge.link) + (unresolved(edge) ? .9 : 0) }, known = dist.get(other);
      if (known === undefined || compare(d, known) < 0) { dist.set(other, d); back.set(other, edge); }
    }
  }
  reachable = new Set(dist.keys());
  if (roots.length === 0) return empty('no-root');
  const reached = roots.filter(node => dist.has(node.id)).sort((p, q) =>
    compare(dist.get(p.id)!, dist.get(q.id)!) || rootRank(p.device) - rootRank(q.device) || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  const root = reached[0];
  if (!root) return empty('unreachable');
  const path: string[] = [root.id], hops: TraceEdge[] = [];
  for (let at = root.id; at !== from;) {
    const edge = back.get(at)!; hops.push(edge);
    at = edge.a === at ? edge.b : edge.a; path.push(at);
  }
  path.reverse(); hops.reverse();
  const certain = hops.map(edge => traceEdgeCertain(edge) && !unresolved(edge));
  return { from, root: root.id, status: 'traced', nodes: path, edges: hops, uncertain: certain.includes(false), certain, reachable };
}

/** Where a graph's published route goes: a route replaces the current one; a
 * graph withdrawing its own route (null) clears only a route from that graph, so
 * a late cleanup from a departing graph never clears a newer graph's route. */
export const publishStageTrace = <T extends { readonly graphKey: string }>(current: T | null, graphKey: string, trace: T | null): T | null =>
  trace ?? (current?.graphKey === graphKey ? null : current);

/** The published route only while its own graph is still shown with the exact
 * data it was traced from. Checked during render, so a replaced, removed, hidden
 * or closed graph's route never reaches the stage, even before that graph's own
 * cleanup runs. */
export const currentStageTrace = <T extends { readonly graphKey: string; readonly data: object }>(trace: T | null,
  graphs: readonly { readonly key: string; readonly data: object }[], shown: boolean): T | null =>
  trace && shown && graphs.some(graph => graph.key === trace.graphKey && graph.data === trace.data) ? trace : null;
