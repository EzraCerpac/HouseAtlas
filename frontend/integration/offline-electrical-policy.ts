import type { ReadyView } from '../src/app/types';
import type { TopologyClient } from '../src/api/topology-client';
import type { ElectricalLibraryPort } from '../src/lantern/electrical-library/types';
import type { LiveCopyRetention } from './live-copy-retention';

/** Use the same reviewed building projection and current native readers as Library. */
export async function fillOfflineElectricalLibraries(options: {
  owner: LiveCopyRetention; topology: TopologyClient; port: ElectricalLibraryPort;
  view: ReadyView; current(): boolean; enabled(): boolean; signal: AbortSignal;
}): Promise<{ message: string; complete: boolean }> {
  const result = (message: string, complete = false) => ({ message, complete });
  const { owner, topology, port, view, signal } = options;
  const binding = topology.getBinding();
  const current = () => !signal.aborted && options.current() && topology.getBinding() === binding;
  if (!binding || !current()) return result('Electrical drawings need a current live read.');
  const [identity, bindings, semantics, relations] = await Promise.all([
    topology.listAll(binding, 'identity', signal), topology.listAll(binding, 'binding', signal),
    topology.listAll(binding, 'location-semantics', signal), topology.listAll(binding, 'relation', signal),
  ]);
  if (!current() || identity.status !== 'ready' || bindings.status !== 'ready' || semantics.status !== 'ready' || relations.status !== 'ready'
    || [bindings, semantics, relations].some(read => read.snapshotSha256 !== identity.snapshotSha256)) return result('The building list is unavailable or changed.');
  const { buildTopologyIndex } = await import('../src/lantern/topology/model');
  if (!current()) return result('The building list changed.');
  const index = buildTopologyIndex({ identities: identity.records, bindings: bindings.records, semantics: semantics.records,
    relations: relations.records, sourceStatuses: [identity.sourceStatus, bindings.sourceStatus, semantics.sourceStatus, relations.sourceStatus] }, view, new Map());
  let captured = 0, absent = 0, failed = 0;
  // Existing topology bounds the source read; cap new background work independently.
  if (index.buildings.length > 128) return result('The building count exceeds the offline library download limit.');
  for (const building of index.buildings) {
    if (!current()) return result('Electrical library download stopped because the live view changed.');
    const reader = await port.createReader();
    let frame: Awaited<ReturnType<typeof reader.read>> | null = null;
    try {
      if (!current()) return result('Electrical library download stopped because the live view changed.');
      const readerOwner = reader.owner();
      frame = await reader.read(building.id, signal);
      if (!current()) return result('Electrical library download stopped because the live view changed.');
      if (frame.status !== 'available') {
        if (frame.reason !== 'no-current-association') { failed++; continue; }
        const stillAbsent = () => current() && readerOwner !== null && reader.owner() === readerOwner;
        if (!stillAbsent()) return result('Electrical library download stopped because the live view changed.');
        const retired = await owner.retireElectricalLibrary(building.id, signal, stillAbsent);
        if (retired.status === 'ok') absent++;
        else if (retired.status === 'uncertain' || retired.status === 'retired' || retired.status === 'aborted')
          return result(`Electrical library download stopped (${retired.status}). Check held files before trying again.`);
        else failed++;
        continue;
      }
      const retained = await owner.retainElectricalLibrary(reader, frame, signal, {
        includeBytes: options.enabled(), enabled: () => current() && options.enabled(),
      });
      if (retained.status === 'ok') captured++;
      else if (retained.status === 'uncertain' || retained.status === 'retired' || retained.status === 'aborted') return { message: `Electrical library download stopped (${retained.status}). Check held files before trying again.`, complete: false };
      else failed++;
    } finally { if (frame?.status === 'available') reader.release(frame); reader.dispose(); }
  }
  return result(`${captured} building drawing ${captured === 1 ? 'list' : 'lists'} captured${absent ? `; ${absent} without a current association` : ''}${failed ? `; ${failed} unavailable` : ''}.`, failed === 0);
}
