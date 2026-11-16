import type { ReadyView } from '../src/app/types';
import type { TopologyClient } from '../src/api/topology-client';
import type { HeldTopologyV1 } from '../src/offline/held-topology';
import type { LiveCopyRetention } from './live-copy-retention';

type Outcome = 'held' | 'not-held' | 'stopped';
type Load = () => Promise<readonly [typeof import('../src/lantern/topology/model'), typeof import('../src/offline/held-topology')]>;
const loadModules: Load = () => Promise.all([import('../src/lantern/topology/model'), import('../src/offline/held-topology')]);
interface PassOptions {
  owner: Pick<LiveCopyRetention, 'retainTopology'>; topology: TopologyClient; view: ReadyView; current(): boolean; signal: AbortSignal;
}

/** Holds the building records the Rooms & places lens reads: the same four list GETs and per-building
 * membership GETs through the lens's own client, under one server snapshot. Anything short of a complete,
 * consistent read is recorded as not held; the rest of the saved copy is untouched. After `deadline`
 * this pass writes and removes nothing: its owner records the timeout. */
export async function retainOfflineTopology(options: PassOptions & { readonly deadline?: AbortSignal; readonly load?: Load }): Promise<Outcome> {
  const { owner, topology, view, signal } = options, deadline = options.deadline ?? new AbortController().signal;
  const reads = AbortSignal.any([signal, deadline]);
  const binding = topology.getBinding();
  const current = () => !reads.aborted && options.current() && topology.getBinding() === binding;
  if (!binding || !current() || binding.scope.workspaceId !== view.scope.workspaceId || binding.scope.homeId !== view.scope.homeId) return 'stopped';
  const capturedAt = new Date().toISOString();
  const encoded = async (): Promise<Uint8Array | null> => {
    const [identity, bindings, semantics, relations] = await Promise.all([
      topology.listAll(binding, 'identity', reads), topology.listAll(binding, 'binding', reads),
      topology.listAll(binding, 'location-semantics', reads), topology.listAll(binding, 'relation', reads),
    ]);
    if (!current() || identity.status !== 'ready' || bindings.status !== 'ready' || semantics.status !== 'ready' || relations.status !== 'ready'
      || [bindings, semantics, relations].some(read => read.snapshotSha256 !== identity.snapshotSha256)) return null;
    const [{ buildTopologyIndex }, codec] = await (options.load ?? loadModules)();
    if (!current()) return null;
    const index = buildTopologyIndex({ identities: identity.records, bindings: bindings.records, semantics: semantics.records,
      relations: relations.records, sourceStatuses: [identity.sourceStatus, bindings.sourceStatus, semantics.sourceStatus, relations.sourceStatus] }, view, new Map());
    if (index.buildings.length > codec.HELD_TOPOLOGY_LIMITS.buildings) return null;
    const buildings: HeldTopologyV1['buildings'][number][] = [];
    for (const building of index.buildings) {
      const members = await topology.buildingMembers(binding, building.id, reads);
      if (!current() || members.status !== 'ready' || members.snapshotSha256 !== identity.snapshotSha256) return null;
      buildings.push({ buildingId: building.id, members: { records: members.records, sourceStatus: members.sourceStatus } });
    }
    const list = <T extends { records: R; sourceStatus: S }, R, S>(read: T) => ({ records: read.records, sourceStatus: read.sourceStatus });
    return codec.encodeHeldTopology({ version: 1, scope: { workspaceId: view.scope.workspaceId, homeId: view.scope.homeId }, capturedAt,
      snapshotSha256: identity.snapshotSha256, buildings,
      lists: { identity: list(identity), binding: list(bindings), 'location-semantics': list(semantics), relation: list(relations) } });
  };
  let payload: Uint8Array | null;
  try { payload = await encoded(); } catch { payload = null; }
  // An expired or obsolete pass never persists; `current` also fences the storage transaction itself.
  if (!current()) return 'stopped';
  let result = await owner.retainTopology(payload, signal, current);
  // Records that could not be stored (size, quota) leave no older ones in their place.
  if (payload && result.status !== 'ok' && current()) { payload = null; result = await owner.retainTopology(null, signal, current); }
  return result.status !== 'ok' ? 'stopped' : payload ? 'held' : 'not-held';
}

/** One building-record pass per account and home at a time, beside the library fill. A capture during a pass
 * asks for one rerun, used only if that pass stopped. One deadline covers module loading, reads and storage:
 * at the deadline the slot is released and the records are recorded as not held, and the late pass persists nothing. */
export function createBuildingRecordsPasses(settings: { readonly deadlineMs?: number; readonly load?: Load } = {}) {
  let running: { readonly key: string; rerun: (() => void) | null } | null = null;
  const keep = async (options: PassOptions & { readonly actorId: string }): Promise<Outcome | 'queued'> => {
    const key = JSON.stringify([options.actorId, options.view.scope.workspaceId, options.view.scope.homeId]);
    if (running?.key === key) { running.rerun = () => void keep(options); return 'queued'; }
    if (options.signal.aborted || !options.current()) return 'stopped';
    const pass = { key, rerun: null as (() => void) | null };
    running = pass;
    const deadline = AbortSignal.timeout(settings.deadlineMs ?? 120_000);
    const expired = new Promise<'expired'>(done => deadline.addEventListener('abort', () => done('expired'), { once: true }));
    let outcome: Outcome = 'stopped';
    try {
      const result = await Promise.race([
        retainOfflineTopology({ ...options, deadline, ...(settings.load ? { load: settings.load } : {}) }).catch(() => 'stopped' as const), expired]);
      if (result !== 'expired') outcome = result;
      else if (!options.signal.aborted && options.current()) {
        const recorded = await options.owner.retainTopology(null, options.signal, () => !options.signal.aborted && options.current());
        outcome = recorded.status === 'ok' ? 'not-held' : 'stopped';
      }
    } finally {
      if (running === pass) running = null;
    }
    if (outcome === 'stopped') pass.rerun?.();
    return outcome;
  };
  return keep;
}
