import type { TopologyBinding, TopologyClient, TopologyRecord } from '../src/api/topology-client';

type Kind = 'identity' | 'location-semantics' | 'circuit' | 'evidence';
type Pin = { readonly recordType: Kind; readonly recordId: string; readonly revision: number };
type RecordSet = { readonly identities: readonly TopologyRecord<'identity'>[];
  readonly semantics: readonly TopologyRecord<'location-semantics'>[];
  readonly circuits: readonly TopologyRecord<'circuit'>[]; readonly evidence: readonly TopologyRecord<'evidence'>[] };
type Result = { readonly status: 'partial'; readonly records: RecordSet; readonly snapshotSha256: string;
  readonly unavailable: readonly ['electrical-record-closure', 'electrical-review-verifier'] }
  | { readonly status: 'unavailable' | 'retired' };

/** A frame-scoped partial reader. No result is an electrical assertion or review.
 * Every disclosure reads all four canonical lists again; a prior result is never a cache.
 * The caller must retire the owner on frame, source, or review withdrawal. */
export function createElectricalRecordOwner(options: {
  readonly client: TopologyClient;
  readonly binding: TopologyBinding;
  readonly pins: readonly Pin[];
  readonly frameSignal: AbortSignal;
  readonly subscribeDependencies: (retire: () => void) => () => void;
}) {
  const { client, binding, frameSignal } = options;
  const pins = options.pins.map(pin => ({ ...pin }));
  const keys = new Set<string>();
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
  const valid = pins.length <= 10000 && pins.every(pin => {
    const key = `${pin.recordType}:${pin.recordId}`;
    if (!['identity', 'location-semantics', 'circuit', 'evidence'].includes(pin.recordType) || !pin.recordId ||
      !Number.isSafeInteger(pin.revision) || pin.revision < 1 || keys.has(key)) return false;
    keys.add(key); return true;
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
      const selected = <K extends Kind>(kind: K, rows: readonly TopologyRecord<K>[]) => {
        const wanted = pins.filter(pin => pin.recordType === kind);
        return wanted.map(pin => rows.find(row => row.target.recordId === pin.recordId && row.revision === pin.revision));
      };
      const foundIdentities = selected('identity', identities.records);
      const foundSemantics = selected('location-semantics', semantics.records);
      const foundCircuits = selected('circuit', circuits.records);
      const foundEvidence = selected('evidence', evidence.records);
      if (foundCircuits.some(row => !row) || foundEvidence.some(row => !row || ['disputed', 'withdrawn', 'superseded'].includes(row.payload.provenance.uncertainty.status)) || foundIdentities.some(row => !row) || foundSemantics.some(row => !row)) {
        retire(); return { status: 'unavailable' };
      }
      // Schema-validated records from the native client; selected arrays contain no missing rows.
      return { status: 'partial', records: {
        identities: foundIdentities.filter((row): row is TopologyRecord<'identity'> => row !== undefined),
        semantics: foundSemantics.filter((row): row is TopologyRecord<'location-semantics'> => row !== undefined),
        circuits: foundCircuits.filter((row): row is TopologyRecord<'circuit'> => row !== undefined),
        evidence: foundEvidence.filter((row): row is TopologyRecord<'evidence'> => row !== undefined),
      }, snapshotSha256: identities.snapshotSha256,
      unavailable: ['electrical-record-closure', 'electrical-review-verifier'] };
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
