/** Invented current panel and circuit data for the example house only, in the
 * `houseatlas.electrical-data.v1` read contract (contracts/electrical-data).
 * Two fictional circuits on the example's historic drawing group: A1 with an
 * invented confirmed test of one Hall symbol, A2 an owner report for the Living
 * room symbol with no test and unknown rating and protection. The fictional
 * panel is reviewed as in Hall. No test was performed; nothing here is
 * installed wiring evidence, a cable route or a real receipt.
 *
 * The page ships the projection as the projector computes it (the example
 * bundle carries no schema validator). example-combined-overlays-healthy.mjs
 * runs the actual projector on `exampleElectricalInput` and requires exactly
 * `exampleElectricalProjection`. */
import type { ElectricalProjection } from '../src/lantern/unified-atlas/electrical-trace';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AT = '2026-01-02T09:00:00Z';
const pin = (recordType: string, n: number) => ({ recordType, recordId: U(n), revision: 1 });
const receipt = (name: string, digit: string) => ({ id: `example-review-${name}`, sha256: digit.repeat(64) });
const review = (name: string, digit: string, evidence: number, confidence: 'low' | 'medium' | 'high') =>
  ({ status: 'reviewed' as const, receipt: receipt(name, digit), evidence: [pin('evidence', evidence)], confidence,
    uncertainty: 'Fictional example assertion only' });

/** Canonical native records, all invented under the example scope. */
function records(scope: Readonly<{ workspaceId: string; homeId: string }>, hallNativePlaceId: string) {
  const base = (recordType: string, recordId: string, audit: number, payload: object) => ({ schemaVersion: 1, recordType, recordId,
    ...scope, revision: 1, lifecycle: 'active', createdAt: AT, updatedAt: AT, lastAuditId: U(audit), payload });
  const evidence = (n: number, statement: string, evidenceBasis: string, tested: boolean) => base('evidence', U(n), n + 100, { statement,
    provenance: { source: null, sourceRevision: null, sourceConfidence: null, evidenceBasis, factAt: tested ? AT : null, retrievedAt: AT,
      vantage: null, uncertainty: { status: tested ? 'supported' : 'unknown', explanation: 'Fictional example house; no installed wiring' } },
    supersedesEvidenceIds: [], references: [] });
  const circuit = (n: number, label: string, evidenceId: number) => base('circuit', U(n), n + 100,
    { label, panel: { kind: 'atlas-record', ref: { recordType: 'identity', recordId: U(620) } }, evidenceIds: [U(evidenceId)] });
  return [
    evidence(630, 'FICTIONAL: invented panel and Hall statement for the example house', 'owner-report', false),
    evidence(631, 'FICTIONAL: invented breaker label reading; no real panel', 'document', false),
    evidence(632, 'FICTIONAL: invented test result for symbol 1 only; no test was performed', 'physical-survey', true),
    evidence(633, 'FICTIONAL: invented owner report for symbol 4; not tested', 'owner-report', false),
    base('identity', U(620), 720, { kind: 'item', evidenceIds: [U(630)] }),
    base('identity', hallNativePlaceId, 721, { kind: 'location', evidenceIds: [U(630)] }),
    base('location-semantics', U(621), 722, { atlasId: hallNativePlaceId, label: 'Hall', semanticKind: 'room', reviewStatus: 'accepted', evidenceIds: [U(630)] }),
    circuit(625, 'Fictional circuit A1', 632),
    circuit(626, 'Fictional circuit A2', 633),
  ];
}

/** Projector input: the contract data and its current context, except the
 * review receipts, which only a review owner can make current. */
export function exampleElectricalInput(scope: Readonly<{ workspaceId: string; homeId: string }>, viewKey: string,
  ledger: unknown, ledgerSha256: string, hallNativePlaceId: string) {
  const panel = pin('identity', 620);
  const data = {
    schema: 'houseatlas.electrical-data.v1', scope: { ...scope }, viewKey, fixtureLedgerSha256: ledgerSha256,
    panels: [{ id: 'example-panel', basis: 'owner-report', review: review('panel', '1', 630, 'medium'), identity: panel,
      label: 'Fictional panel', roomAssociation: { room: { recordType: 'identity', recordId: hallNativePlaceId, revision: 1 },
        semantics: pin('location-semantics', 621) } }],
    breakers: [
      { id: 'example-breaker-a1', basis: 'label-match', review: review('breaker-a1', '2', 631, 'medium'), circuit: pin('circuit', 625),
        panel, position: { label: 'A1', ways: ['A1'] }, ratingAmperes: 16, protection: 'Fictional label: RCD 30 mA' },
      { id: 'example-breaker-a2', basis: 'label-match', review: review('breaker-a2', '3', 631, 'medium'), circuit: pin('circuit', 626),
        panel, position: { label: 'A2', ways: ['A2'] }, ratingAmperes: null, protection: null },
    ],
    mappings: [
      { id: 'example-mapping-a1', basis: 'test', review: review('mapping-a1', '4', 632, 'high'),
        target: { kind: 'fixture', id: 'example-symbol-0' }, candidates: [pin('circuit', 625)],
        test: { evidence: pin('evidence', 632), observedAt: AT, method: 'Fictional test; none was performed', outcome: 'confirmed',
          fixtureIds: ['example-symbol-0'] } },
      { id: 'example-mapping-a2', basis: 'owner-report', review: review('mapping-a2', '5', 633, 'low'),
        target: { kind: 'fixture', id: 'example-symbol-3' }, candidates: [pin('circuit', 626)] },
    ],
  };
  return { data, context: { scope: { ...scope }, viewKey, records: records(scope, hallNativePlaceId),
    documentary: { sha256: ledgerSha256, data: ledger } } };
}

/** The projector's verdicts for that input with every review current: all
 * rows current, A1 tested, A2 not. */
export function exampleElectricalProjection(input: ReturnType<typeof exampleElectricalInput>): ElectricalProjection {
  const { data, context } = input;
  const circuit = (id: string) => context.records.find(row => row.recordId === id)!;
  return {
    schema: 'houseatlas.electrical-data-projection.v1', scope: { ...data.scope }, viewKey: data.viewKey,
    fixtureLedgerSha256: data.fixtureLedgerSha256,
    panels: data.panels.map(row => ({ ...row, status: 'current' as const, reasons: [], reviewedRoomId: row.roomAssociation.room.recordId })),
    breakers: data.breakers.map(row => ({ ...row, status: 'current' as const, reasons: [],
      nativeRecord: circuit(row.circuit.recordId) as unknown as { payload: { label: string | null } },
      panelRecordId: row.panel.recordId,
      effectiveDetails: { position: row.position, ratingAmperes: row.ratingAmperes, protection: row.protection } })),
    mappings: data.mappings.map(row => ({ ...row, fixtureIds: [row.target.id], reasons: [], status: 'reviewed-association' as const,
      currentCircuitId: row.candidates[0]!.recordId, verifiedWiring: row.basis === 'test' })) as ElectricalProjection['mappings'],
    wireRoutes: null, physicalCableCoordinates: null, nativeQualified: false,
  };
}
