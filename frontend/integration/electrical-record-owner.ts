import type { TopologyBinding, TopologyClient } from '../src/api/topology-client';

import { resolveElectricalRecordClosure, type ElectricalRecordPin, type ElectricalRecordPools } from './electrical-record-closure.ts';

type Result = { readonly status: 'partial'; readonly records: ElectricalRecordPools; readonly snapshotSha256: string;
  readonly unavailable: readonly ['canonical-records', 'electrical-projector', 'electrical-review-verifier', 'evidence-assets', 'supersession', 'external-sources'] }
  | { readonly status: 'unavailable' | 'retired' };

/** A frame-scoped partial reader. No result is an electrical assertion or review.
 * Every disclosure reads all four Stock lists again; a prior result is never a cache.
 * The caller must retire the owner on frame, source, or review withdrawal. */
export function createElectricalRecordOwner(options: {
  readonly client: TopologyClient;
  readonly binding: TopologyBinding;
  readonly pins: readonly ElectricalRecordPin[];
  readonly frameSignal: AbortSignal;
  readonly subscribeDependencies: (retire: () => void) => () => void;
}) {
  const { client, binding, frameSignal } = options;
  const withinPinLimit = options.pins.length <= 10000;
  const pins = withinPinLimit ? options.pins.map(pin => ({ ...pin })) : [];
  let retired = false, generation = 0;
  const listeners = new Set<() => void>();
  const controller = new AbortController();
  let unsubscribe = () => {};
  const retire = () => {
    if (retired) return;
    retired = true; generation++; pins.length = 0; controller.abort(); unsubscribe();
    for (const listener of listeners) { try { listener(); } catch { /* Notify every subscriber. */ } }
    listeners.clear();
    frameSignal.removeEventListener('abort', retire);
  };
  const valid = withinPinLimit && pins.every(pin => {
    if (!['identity', 'location-semantics', 'circuit', 'evidence'].includes(pin.recordType) || !pin.recordId ||
      !Number.isSafeInteger(pin.revision) || pin.revision < 1) return false;
    return true;
  });
  const stopBinding = client.subscribe(() => { if (client.getBinding() !== binding) retire(); });
  const stopDependencies = options.subscribeDependencies(retire);
  unsubscribe = () => { stopBinding(); stopDependencies(); };
  frameSignal.addEventListener('abort', retire, { once: true });
  if (frameSignal.aborted || client.getBinding() !== binding || retired) {
    if (retired) unsubscribe(); else retire();
  }
  async function read(): Promise<Result> {
    if (retired) return { status: 'retired' };
    if (!valid || client.getBinding() !== binding) { retire(); return { status: 'unavailable' }; }
    const own = ++generation;
    try {
      const [identities, semantics, circuits, evidence] = await Promise.all([
        client.listAll(binding, 'identity', controller.signal),
        client.listAll(binding, 'location-semantics', controller.signal),
        client.listAll(binding, 'circuit', controller.signal),
        client.listAll(binding, 'evidence', controller.signal),
      ]);
      if (retired || client.getBinding() !== binding) { retire(); return { status: 'retired' }; }
      if (own !== generation) return { status: 'unavailable' };
      if (identities.status !== 'ready' || semantics.status !== 'ready' || circuits.status !== 'ready' || evidence.status !== 'ready' ||
        identities.sourceStatus !== 'current' || semantics.sourceStatus !== 'current' || circuits.sourceStatus !== 'current' || evidence.sourceStatus !== 'current' ||
        identities.snapshotSha256 !== semantics.snapshotSha256 || identities.snapshotSha256 !== circuits.snapshotSha256 ||
        identities.snapshotSha256 !== evidence.snapshotSha256) { retire(); return { status: 'unavailable' }; }
      const records = resolveElectricalRecordClosure(pins, {
        identities: identities.records, semantics: semantics.records, circuits: circuits.records, evidence: evidence.records,
      });
      if (!records) { retire(); return { status: 'unavailable' }; }
      return { status: 'partial', records, snapshotSha256: identities.snapshotSha256,
        unavailable: ['canonical-records', 'electrical-projector', 'electrical-review-verifier', 'evidence-assets', 'supersession', 'external-sources'] };
    } catch {
      if (retired) return { status: 'retired' };
      if (own !== generation) return { status: 'unavailable' };
      retire(); return { status: 'unavailable' };
    }
  }
  return { read, retire, subscribe(listener: () => void) {
    if (retired) { listener(); return () => {}; }
    listeners.add(listener); return () => { listeners.delete(listener); };
  } };
}
