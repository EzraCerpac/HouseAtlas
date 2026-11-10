import type { ElectricalGroup } from './electrical-group';

/* Consumer of `houseatlas.electrical-data-projection.v1` (#554). It follows
 * only the projector's own verdicts: reviewed association -> current breaker
 * -> current panel -> reviewed room. It recomputes no review, currentness or
 * conflict decision and never reads a candidate circuit of a withheld row.
 * Nothing here is a wire route, cable position or physical placement. */

type Pin = { readonly recordType: string; readonly recordId: string; readonly revision: number };
type Review = { readonly status: string; readonly confidence: string; readonly uncertainty: string | null };
interface ProjectedPanel {
  readonly id: string; readonly identity: Pin; readonly label: string | null;
  readonly roomAssociation?: unknown; readonly status: 'current' | 'withheld'; readonly reviewedRoomId: string | null;
}
interface ProjectedBreaker {
  readonly id: string; readonly circuit: Pin; readonly status: 'current' | 'withheld';
  readonly nativeRecord: { readonly payload: { readonly label: string | null } } | null;
  readonly panelRecordId: string | null;
  readonly effectiveDetails: { readonly position?: { readonly label: string; readonly ways: readonly string[] } | null;
    readonly ratingAmperes?: number | null; readonly protection?: string | null } | null;
}
interface ProjectedMapping {
  readonly id: string; readonly basis: string; readonly review: Review;
  readonly target: { readonly kind: 'documentary-group' | 'fixture'; readonly id: string };
  readonly test?: { readonly observedAt: string; readonly method: string };
  readonly fixtureIds: readonly string[]; readonly reasons: readonly string[];
  readonly status: 'reviewed-association' | 'withheld'; readonly currentCircuitId: string | null; readonly verifiedWiring: boolean;
}
export interface ElectricalProjection {
  readonly schema: string;
  readonly scope: { readonly workspaceId: string; readonly homeId: string };
  readonly viewKey: string; readonly fixtureLedgerSha256: string;
  readonly panels: readonly ProjectedPanel[]; readonly breakers: readonly ProjectedBreaker[]; readonly mappings: readonly ProjectedMapping[];
  readonly wireRoutes: null; readonly physicalCableCoordinates: null; readonly nativeQualified: false;
}

/** Supplied only by the owner of the current overlay frame, from the same
 * frame lifetime: the projection, the exact documentary ledger it was computed
 * from and that frame's qualified room bindings. The owner must replace or
 * withdraw it whenever source, native, review or room currentness changes.
 * The checks below establish consistency with the shown group, not authority. */
export interface ElectricalTraceSource {
  readonly ledger: { readonly workspaceId: string; readonly homeId: string; readonly sceneEvidenceId: string;
    readonly sceneOriginalSha256: string; readonly viewKey: string; readonly sha256: string };
  readonly projection: ElectricalProjection;
  readonly roomBindings: readonly { readonly roomId: string; readonly nativePlaceId: string }[];
}

export type TracePanelRoom =
  | { readonly kind: 'room'; readonly roomId: string }
  | { readonly kind: 'not-recorded' | 'unknown' | 'not-placed' };
export interface TraceCircuit {
  readonly circuitId: string; readonly label: string | null;
  /** Absent key: not supplied. Null: explicitly unknown. */
  readonly details: NonNullable<ProjectedBreaker['effectiveDetails']>;
  readonly panel: { readonly label: string | null; readonly room: TracePanelRoom } | null;
}
export interface TraceRow {
  readonly mappingId: string;
  /** Whole group, or one member symbol (label null when that member is unavailable). */
  readonly coverage: { readonly kind: 'group' } | { readonly kind: 'fixture'; readonly fixtureId: string; readonly label: string | null };
  readonly basis: string; readonly confidence: string; readonly uncertainty: string | null;
  readonly circuit: TraceCircuit | null;
  /** Present only when the projection itself reports a confirmed exact test. */
  readonly test: { readonly observedAt: string; readonly method: string } | null;
  /** Plain sentences for a withheld row; empty for a reviewed association. */
  readonly reasons: readonly string[];
}
export type ElectricalTrace =
  | { readonly status: 'refused'; readonly reason: 'source-mismatch' | 'source-too-large' }
  | { readonly status: 'traced'; readonly rows: readonly TraceRow[];
      /** Declared members with no reviewed association in any row. */
      readonly uncovered: readonly { readonly fixtureId: string; readonly label: string | null }[] };

/** Consumer sentences for the frozen v1 withholding codes; an unrecognized
 * code stays an unavailable state, never raw interface text. */
export const WITHHOLD_TEXT: Readonly<Record<string, string>> = Object.freeze({
  'basis-unknown': 'Basis unknown',
  'confidence-unknown': 'Confidence unknown',
  'review-unreviewed': 'Not reviewed',
  'review-ambiguous': 'Review found it ambiguous',
  'review-conflicting': 'Review found conflicting sources',
  'review-stale': 'Review is out of date',
  'exact-review-not-current': 'No current review of this exact assertion',
  'evidence-not-current': 'Evidence is not current',
  'panel-item-not-current': 'Panel record is not current',
  'reviewed-room-not-current': 'Panel room review is not current',
  'native-circuit-not-current': 'Circuit record is not current',
  'native-circuit-evidence-not-current': 'Circuit evidence is not current',
  'native-panel-link-not-current': 'Circuit-to-panel link is not current',
  'native-panel-descriptor-missing': 'Panel details missing',
  'position-without-panel': 'Panel position given without a panel',
  'conflicting-panel-position': 'Another circuit claims the same panel position',
  'documentary-target-unavailable': 'Drawing symbol or group unavailable',
  'circuit-not-unique': 'More than one candidate circuit',
  'circuit-descriptor-not-current': 'Breaker record is not current',
  'test-not-confirmed-for-exact-target': 'Test does not confirm this exact target',
  'conflicting-fixture-circuit-candidates': 'Another mapping names a different circuit for these symbols',
  'contradictory-fixture-circuit-tests': 'A current test contradicts this association',
});
export const withholdText = (code: string): string => Object.hasOwn(WITHHOLD_TEXT, code) ? WITHHOLD_TEXT[code]! : 'Unavailable';

const LIMIT = 10_000;
const sameIds = (a: readonly string[], b: readonly string[]) => {
  if (a.length !== b.length) return false;
  const left = [...a].sort(), right = [...b].sort();
  return left.every((id, at) => id === right[at]);
};

/** Pure, bounded join of one #553 drawing group to a supplied projection. */
export function traceElectricalGroup(group: ElectricalGroup, source: ElectricalTraceSource): ElectricalTrace {
  const { ledger, projection: p, roomBindings } = source;
  if (p.panels.length > LIMIT || p.breakers.length > LIMIT || p.mappings.length > LIMIT || roomBindings.length > LIMIT)
    return { status: 'refused', reason: 'source-too-large' };
  const g = group.source;
  // The projection must describe exactly the documentary ledger behind this group.
  if (p.schema !== 'houseatlas.electrical-data-projection.v1' || p.wireRoutes !== null || p.physicalCableCoordinates !== null || p.nativeQualified !== false
    || p.scope.workspaceId !== g.workspaceId || p.scope.homeId !== g.homeId
    || ledger.workspaceId !== g.workspaceId || ledger.homeId !== g.homeId
    || ledger.sceneEvidenceId !== g.sceneEvidenceId || ledger.sceneOriginalSha256 !== g.sceneOriginalSha256
    || p.viewKey !== ledger.viewKey || p.fixtureLedgerSha256 !== ledger.sha256) return { status: 'refused', reason: 'source-mismatch' };
  const members = new Set(group.fixtureIds);
  const labels = new Map(group.members.map(({ record }) => [record.id, record.label]));
  const relevant = p.mappings.filter(row => row.target.kind === 'documentary-group' ? row.target.id === group.groupId : members.has(row.target.id));
  const mismatch = { status: 'refused', reason: 'source-mismatch' } as const;
  const rows: TraceRow[] = [];
  const covered = new Set<string>();
  for (const row of relevant) {
    // Expanded membership must be the exact declared documentary membership.
    if (!sameIds(row.fixtureIds, row.target.kind === 'documentary-group' ? group.fixtureIds : [row.target.id])) return mismatch;
    const reviewed = row.status === 'reviewed-association';
    if (reviewed !== (row.reasons.length === 0) || reviewed !== (row.currentCircuitId !== null)
      || (row.verifiedWiring && (!reviewed || row.basis !== 'test' || !row.test))) return mismatch;
    let circuit: TraceCircuit | null = null;
    if (reviewed) {
      // A reviewed association names a current breaker; anything else is an inconsistent source.
      const breakers = p.breakers.filter(b => b.circuit.recordId === row.currentCircuitId);
      const breaker = breakers.length === 1 && breakers[0]!.status === 'current' ? breakers[0]! : null;
      if (!breaker || !breaker.effectiveDetails) return mismatch;
      let panel: TraceCircuit['panel'] = null;
      if (breaker.panelRecordId !== null) {
        const panels = p.panels.filter(row => row.identity.recordId === breaker.panelRecordId);
        const own = panels.length === 1 && panels[0]!.status === 'current' ? panels[0]! : null;
        if (!own) return mismatch;
        let room: TracePanelRoom;
        if (own.reviewedRoomId === null) room = { kind: own.roomAssociation === undefined ? 'not-recorded' : 'unknown' };
        else {
          // Only the frame owner's qualified bindings place the room; no label or raw ID fallback.
          const rooms = new Set(roomBindings.filter(b => b.nativePlaceId === own.reviewedRoomId).map(b => b.roomId));
          room = rooms.size === 1 ? { kind: 'room', roomId: [...rooms][0]! } : { kind: 'not-placed' };
        }
        panel = { label: own.label, room };
      }
      circuit = { circuitId: row.currentCircuitId!, label: breaker.nativeRecord?.payload.label ?? null, details: breaker.effectiveDetails, panel };
      row.fixtureIds.forEach(id => covered.add(id));
    }
    rows.push({ mappingId: row.id,
      coverage: row.target.kind === 'documentary-group' ? { kind: 'group' } : { kind: 'fixture', fixtureId: row.target.id, label: labels.get(row.target.id) ?? null },
      basis: row.basis, confidence: row.review.confidence, uncertainty: row.review.uncertainty, circuit,
      test: row.verifiedWiring && row.test ? { observedAt: row.test.observedAt, method: row.test.method } : null,
      reasons: [...new Set(row.reasons.map(withholdText))] });
  }
  return { status: 'traced', rows,
    uncovered: group.fixtureIds.filter(id => !covered.has(id)).map(fixtureId => ({ fixtureId, label: labels.get(fixtureId) ?? null })) };
}
