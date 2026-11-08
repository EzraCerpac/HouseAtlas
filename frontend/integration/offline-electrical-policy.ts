import type { ReadyView } from '../src/app/types';
import type { TopologyClient } from '../src/api/topology-client';
import type { ElectricalLibraryPort } from '../src/lantern/electrical-library/types';
import type { LiveCopyRetention } from './live-copy-retention';

/** Use the same reviewed building projection and current native readers as Library. */
export async function fillOfflineElectricalLibraries(options: {
  owner: LiveCopyRetention; topology: TopologyClient; port: ElectricalLibraryPort;
  view: ReadyView; current(): boolean; enabled(): boolean; signal: AbortSignal;
}): Promise<string> {
  const { owner, topology, port, view, signal } = options;
  const binding = topology.getBinding();
  const current = () => !signal.aborted && options.current() && topology.getBinding() === binding;
  if (!binding || !current()) return 'Electrical drawings need a current live read.';
  const [identity, bindings, semantics, relations] = await Promise.all([
    topology.listAll(binding, 'identity', signal), topology.listAll(binding, 'binding', signal),
    topology.listAll(binding, 'location-semantics', signal), topology.listAll(binding, 'relation', signal),
  ]);
  if (!current() || identity.status !== 'ready' || bindings.status !== 'ready' || semantics.status !== 'ready' || relations.status !== 'ready'
    || [bindings, semantics, relations].some(read => read.snapshotSha256 !== identity.snapshotSha256)) return 'The building list is unavailable or changed.';
  const { buildTopologyIndex } = await import('../src/lantern/topology/model');
  if (!current()) return 'The building list changed.';
  const index = buildTopologyIndex({ identities: identity.records, bindings: bindings.records, semantics: semantics.records,
    relations: relations.records, sourceStatuses: [identity.sourceStatus, bindings.sourceStatus, semantics.sourceStatus, relations.sourceStatus] }, view, new Map());
  let captured = 0, failed = 0;
  // Existing topology bounds the source read; cap new background work independently.
  if (index.buildings.length > 128) return 'The building count exceeds the offline library download limit.';
  for (const building of index.buildings) {
    if (!current()) return 'Electrical library download stopped because the live view changed.';
    const reader = await port.createReader();
    let frame: Awaited<ReturnType<typeof reader.read>> | null = null;
    try {
      if (!current()) return 'Electrical library download stopped because the live view changed.';
      frame = await reader.read(building.id, signal);
      if (!current()) return 'Electrical library download stopped because the live view changed.';
      if (frame.status !== 'available') { failed++; continue; }
      const result = await owner.retainElectricalLibrary(reader, frame, signal, {
        includeBytes: options.enabled(), enabled: () => current() && options.enabled(),
      });
      if (result.status === 'ok') captured++;
      else if (result.status === 'uncertain' || result.status === 'retired' || result.status === 'aborted') return `Electrical library download stopped (${result.status}). Check held files before trying again.`;
      else failed++;
    } finally { if (frame?.status === 'available') reader.release(frame); reader.dispose(); }
  }
  return `${captured} building drawing ${captured === 1 ? 'list' : 'lists'} captured${failed ? `; ${failed} unavailable` : ''}.`;
}
