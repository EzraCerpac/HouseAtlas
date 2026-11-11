import type { TopologyRecord } from '../src/api/topology-client';

export type ElectricalRecordKind = 'identity' | 'location-semantics' | 'circuit' | 'evidence';
export type ElectricalRecordPin = { readonly recordType: ElectricalRecordKind; readonly recordId: string; readonly revision: number };
export type ElectricalRecordPools = {
  readonly identities: readonly TopologyRecord<'identity'>[];
  readonly semantics: readonly TopologyRecord<'location-semantics'>[];
  readonly circuits: readonly TopologyRecord<'circuit'>[];
  readonly evidence: readonly TopologyRecord<'evidence'>[];
};

// These are Stock projections, not canonical records or a complete native graph.
// Bound both input and reference work; repeated references count toward the limit.
const MAX_ROOTS = 10_000, MAX_POOL = 5_000, MAX_REFERENCES = 10_000;
export function resolveElectricalRecordClosure(pins: readonly ElectricalRecordPin[], pools: ElectricalRecordPools): ElectricalRecordPools | null {
  if (pins.length > MAX_ROOTS || Object.values(pools).some(rows => rows.length > MAX_POOL)) return null;
  const kinds = ['identity', 'location-semantics', 'circuit', 'evidence'] as const;
  const tables = [pools.identities, pools.semantics, pools.circuits, pools.evidence] as const;
  const index = new Map<string, TopologyRecord<ElectricalRecordKind>>();
  const key = (kind: ElectricalRecordKind, id: string) => `${kind}:${id}`;
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i]!;
    for (const row of tables[i]!) {
      const id = key(kind, row.target.recordId);
      if (row.target.authority !== 'atlas' || row.target.recordType !== kind || !row.target.recordId ||
        !Number.isSafeInteger(row.revision) || row.revision < 1 || row.lifecycle !== 'active' || index.has(id)) return null;
      index.set(id, row);
    }
  }
  const selected = new Map<string, TopologyRecord<ElectricalRecordKind>>();
  for (const pin of pins) {
    if (!kinds.includes(pin.recordType) || !pin.recordId || !Number.isSafeInteger(pin.revision) || pin.revision < 1) return null;
    const id = key(pin.recordType, pin.recordId), row = index.get(id);
    if (!row || row.revision !== pin.revision) return null;
    const previous = selected.get(id);
    if (previous && previous.revision !== pin.revision) return null;
    selected.set(id, row);
  }
  let references = 0;
  // Evidence records have no payload.evidenceIds; only the selected three classes are traversed.
  for (const row of selected.values()) {
    if (row.target.recordType === 'evidence') continue;
    if (!('evidenceIds' in row.payload) || !Array.isArray(row.payload.evidenceIds)) return null;
    for (const evidenceId of row.payload.evidenceIds) {
      if (++references > MAX_REFERENCES) return null;
      const id = key('evidence', evidenceId), evidence = index.get(id);
      if (!evidence) return null;
      selected.set(id, evidence);
      if (selected.size > MAX_ROOTS) return null;
    }
  }
  const included = (kind: ElectricalRecordKind, id: string) => selected.has(key(kind, id));
  const identities = pools.identities.filter(row => included('identity', row.target.recordId));
  const semantics = pools.semantics.filter(row => included('location-semantics', row.target.recordId));
  const circuits = pools.circuits.filter(row => included('circuit', row.target.recordId));
  const evidence = pools.evidence.filter(row => included('evidence', row.target.recordId));
  if (evidence.some(row => ['withdrawn', 'disputed', 'superseded'].includes(row.payload.provenance.uncertainty.status))) return null;
  return { identities, semantics, circuits, evidence };
}
