import type { NetworkOverlayDevice, NetworkOverlayLink } from '../overlays/network/types';

/** A recorded route from one device back to the network's root, read from the
 * source's links alone. It says which records connect, never where a cable runs. */
export interface TraceNode { readonly id: string; readonly device: NetworkOverlayDevice | null }
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
}

/** Device kinds that act as the root, best first. */
const ROOT_KINDS: readonly RegExp[] = [/router/i, /gateway/i, /modem/i];
export const rootRank = (device: NetworkOverlayDevice | null): number => {
  if (!device) return -1;
  return ROOT_KINDS.findIndex(pattern => pattern.test(device.kind));
};

const CONFIDENCE_COST: Record<NetworkOverlayLink['confidence'], number> = {
  accepted: 0, recorded: 0, tentative: .3, unknown: .5, conflicting: .8,
};
/** Fewest hops first; among equal hop counts the better-evidenced route wins. */
const cost = (link: NetworkOverlayLink): number =>
  1 + CONFIDENCE_COST[link.confidence] + (link.kind === 'hypothesis' || link.kind === 'unresolved-path' ? .9 : 0);
export const traceEdgeCertain = (edge: TraceEdge): boolean =>
  (edge.link.confidence === 'accepted' || edge.link.confidence === 'recorded')
  && edge.link.kind !== 'hypothesis' && edge.link.kind !== 'unresolved-path';

/** Cheapest route from `from` to the best reachable root. Deterministic: ties go
 * to the better root kind, then the lower node ID, then the earlier source link. */
export function traceToRoot(nodes: Iterable<TraceNode>, edges: readonly TraceEdge[], from: string): NetworkTrace {
  const byId = new Map<string, TraceNode>();
  for (const node of nodes) byId.set(node.id, node);
  const roots = [...byId.values()].filter(node => rootRank(node.device) >= 0);
  const empty = (status: NetworkTraceStatus, root: string | null = null): NetworkTrace =>
    ({ from, root, status, nodes: [from], edges: [], uncertain: false });
  if (!byId.has(from)) return empty('unreachable');
  if (rootRank(byId.get(from)!.device) >= 0) return empty('is-root', from);
  if (roots.length === 0) return empty('no-root');

  const near = new Map<string, { edge: TraceEdge; other: string }[]>();
  for (const edge of edges) {
    if (edge.a === edge.b) continue;
    for (const [here, other] of [[edge.a, edge.b], [edge.b, edge.a]] as const) {
      const own = near.get(here) ?? []; own.push({ edge, other }); near.set(here, own);
    }
  }
  const dist = new Map<string, number>([[from, 0]]), back = new Map<string, TraceEdge>(), done = new Set<string>();
  const epsilon = 1e-9;
  for (;;) {
    let next: string | null = null;
    for (const [id, d] of dist) if (!done.has(id) && (next === null || d < dist.get(next)! - epsilon
      || (Math.abs(d - dist.get(next)!) <= epsilon && id < next))) next = id;
    if (next === null) break;
    done.add(next);
    for (const { edge, other } of near.get(next) ?? []) {
      if (done.has(other)) continue;
      const d = dist.get(next)! + cost(edge.link), known = dist.get(other);
      if (known === undefined || d < known - epsilon) { dist.set(other, d); back.set(other, edge); }
    }
  }
  const reached = roots.filter(node => dist.has(node.id)).sort((p, q) =>
    dist.get(p.id)! - dist.get(q.id)! || rootRank(p.device) - rootRank(q.device) || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  const root = reached[0];
  if (!root) return empty('unreachable');
  const path: string[] = [root.id], hops: TraceEdge[] = [];
  for (let at = root.id; at !== from;) {
    const edge = back.get(at)!; hops.push(edge);
    at = edge.a === at ? edge.b : edge.a; path.push(at);
  }
  path.reverse(); hops.reverse();
  return { from, root: root.id, status: 'traced', nodes: path, edges: hops, uncertain: hops.some(edge => !traceEdgeCertain(edge)) };
}
