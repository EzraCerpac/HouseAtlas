import { createSuggestionReviewController, validateMaintenanceValues } from '../suggestion-review/controller';
import type { SuggestionReviewContext, SuggestionReviewIntent, SuggestionReviewView } from '../suggestion-review/view-types';

type ObjectData = Record<string, unknown>;
export interface InspectionBinding {
  readonly inputRef: string; readonly version: string;
  readonly evidenceRef: string | null; readonly location: unknown;
}
export interface SelectionBinding {
  readonly kind: string; readonly inputRef: string;
  /** Maintenance only: exact index in the revision-pinned canonical task list. */
  readonly taskIndex?: number;
}
export interface ReviewIdentity { readonly proposalRevision: string; readonly sourceSetRevision: string }
export interface SuggestionSessionOwner {
  current(): SuggestionReviewContext | null;
  subscribe(changed: () => void): () => void;
  /** Fresh original access/source checks, not approval or a mutation. */
  recheck(identity: ReviewIdentity, signal: AbortSignal): Promise<'current' | 'stale' | 'withdrawn' | 'unavailable'>;
  /** Resolve through the original owner; IDs and locations are correlation data. */
  inspect(identity: ReviewIdentity, binding: InspectionBinding, signal: AbortSignal): Promise<void>;
  /** Validate edited values, bindings and current authority again in the existing
   * workflow. No acknowledgement may be reported as a committed source change. */
  onIntent(intent: SuggestionReviewIntent, selections: Readonly<Record<string, SelectionBinding>>): void | Promise<void>;
}
const object = (v: unknown): ObjectData => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TypeError('Invalid review disclosure object');
  return v as ObjectData;
};
const exact = (v: unknown, keys: readonly string[]): ObjectData => {
  const row = object(v);
  if (Object.keys(row).length !== keys.length || keys.some(k => !Object.hasOwn(row, k)))
    throw new TypeError('Unexpected review disclosure fields');
  return row;
};
const ref = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(v)) throw new TypeError('Invalid admitted reference');
  return v;
};
const hash = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) throw new TypeError('Invalid review revision');
  return v;
};
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { for (const v of Object.values(value)) freeze(v); Object.freeze(value); }
  return value;
};

/** Decode only a source-owner-produced disclosure, NEVER raw generated output.
 * Structural checks and context pins are not authentication. No fetch/URL/API
 * fallback exists. The canonical generated-output validator remains in Rust. */
export function createSuggestionReviewSession(json: string, context: object, owner: SuggestionSessionOwner) {
  if (typeof json !== 'string' || new TextEncoder().encode(json).length > 65536) throw new TypeError('Review disclosure too large');
  const parsed = object(JSON.parse(json));
  const isAnswer = object(parsed.view).kind === 'answer';
  const isComparison = object(parsed.view).kind === 'contradictions';
  const wire = exact(parsed, ['schemaVersion', 'contextPin', 'view', 'inspections', 'selections', ...(isAnswer ? ['rankings'] : []), ...(isComparison ? ['comparisons'] : [])]);
  if (wire.schemaVersion !== 1) throw new TypeError('Unsupported review disclosure');
  const pin = hash(wire.contextPin);
  const isMaintenance = object(wire.view).kind === 'maintenance';
  const display = exact(wire.view, ['key', 'revision', 'sourceSetRevision', 'kind', 'title', 'sources', 'fields', 'candidates', 'uncertainty', 'uncalibratedScore', ...(isMaintenance ? ['maintenance'] : []), ...(isAnswer ? ['answer'] : []), ...(isComparison ? ['contradictions'] : [])]);
  const revision = hash(display.revision);
  if (display.key !== 'review:' + revision || display.sourceSetRevision !== pin || display.uncalibratedScore !== null)
    throw new TypeError('Mismatched review disclosure identity');
  if (!Array.isArray(display.sources) || !Array.isArray(display.fields) || !Array.isArray(display.candidates)) throw new TypeError('Missing review display lists');
  const inspections = object(wire.inspections), selections = object(wire.selections);
  const tasks: ObjectData[] = [];
  const sourceKeys: string[] = [], selectionKeys: string[] = [];
  for (const value of display.sources) {
    const s = exact(value, ['key', 'label', 'recordVersion', 'sourceDate', 'retrievedAt', 'page', 'section', 'excerpt', 'freshness', 'original']);
    if (typeof s.key !== 'string' || !Object.hasOwn(inspections, s.key)) throw new TypeError('Unresolved inspection binding');
    sourceKeys.push(s.key);
    const b = exact(inspections[s.key], ['inputRef', 'version', 'evidenceRef', 'location']);
    ref(b.inputRef);
    if (b.version !== s.recordVersion || (b.evidenceRef !== null && ref(b.evidenceRef) !== s.key)) throw new TypeError('Mismatched exact evidence');
    if (b.evidenceRef === null) {
      if (s.original !== 'unavailable' || b.location !== null || s.page !== null || s.section !== null) throw new TypeError('Invented original availability');
    } else {
      const location = object(b.location);
      if (location.kind === 'page') {
        exact(location, ['kind', 'page', 'pageCount']);
        if (!Number.isSafeInteger(location.page) || !Number.isSafeInteger(location.pageCount)
          || Number(location.page) < 1 || Number(location.page) > Number(location.pageCount)
          || location.page !== s.page || s.section !== null) throw new TypeError('Mismatched exact page');
      } else if (location.kind === 'text-range') {
        exact(location, ['kind', 'start', 'end', 'textLength']);
        if (![location.start, location.end, location.textLength].every(Number.isSafeInteger)
          || Number(location.start) < 0 || Number(location.end) <= Number(location.start)
          || Number(location.end) > Number(location.textLength) || s.page !== null
          || s.section !== `Text characters ${location.start}–${location.end} of ${location.textLength}`) throw new TypeError('Mismatched exact text range');
      } else { exact(location, ['kind']); if (location.kind !== 'record' || s.page !== null || s.section !== null) throw new TypeError('Unsupported evidence location'); }
    }
  }
  for (const value of display.fields) {
    const f = exact(value, ['key', 'label', 'current', 'proposed', 'reason', 'uncertainty', 'evidenceKeys']);
    if (typeof f.key !== 'string') throw new TypeError('Invalid field key');
    const expected = display.kind === 'inventory' ? { category: 'inventory-category', tags: 'inventory-tags' } : { 'document-class': 'document-class' };
    const kind = (expected as Record<string, string>)[f.key];
    if (!kind || !Object.hasOwn(selections, f.key)) throw new TypeError('Unsupported proposed field');
    const b = exact(selections[f.key], ['kind', 'inputRef']); ref(b.inputRef);
    if (b.kind !== kind) throw new TypeError('Mismatched field binding');
    selectionKeys.push(f.key);
  }
  for (const value of display.candidates) {
    const c = exact(value, ['key', 'label', 'relation', 'reason', 'uncertainty', 'evidenceKeys']);
    if (typeof c.key !== 'string' || !Object.hasOwn(selections, c.key)) throw new TypeError('Unresolved candidate');
    const b = exact(selections[c.key], ['kind', 'inputRef']); const input = ref(b.inputRef);
    const expected = display.kind === 'document' ? { ['document-link:' + input]: ['document-link', 'proposed-association'] }
      : { ['container:' + input]: ['inventory-container', 'proposed-association'], ['duplicate:' + input]: ['inventory-duplicate', c.relation] };
    const pair = expected[c.key];
    if (!pair || b.kind !== pair[0] || c.relation !== pair[1]) throw new TypeError('Mismatched candidate binding');
    if (b.kind === 'inventory-duplicate' && !['possible-duplicate', 'same-product'].includes(String(c.relation))) throw new TypeError('Unsupported duplicate relationship');
    selectionKeys.push(c.key);
  }
  if (isMaintenance) {
    if (display.fields.length || display.candidates.length || !Array.isArray(display.maintenance) || display.maintenance.length > 16)
      throw new TypeError('Invalid maintenance disclosure lists');
    for (const value of display.maintenance) {
      const task = exact(value, ['key', 'targetKey', 'targetLabel', 'title', 'interval', 'conditions', 'urgency', 'reason', 'uncertainty', 'evidenceKeys', 'baselineDate']);
      if (typeof task.key !== 'string' || !Object.hasOwn(selections, task.key)) throw new TypeError('Unbound maintenance task');
      const binding = exact(selections[task.key], ['kind', 'inputRef', 'taskIndex']);
      const target = ref(binding.inputRef);
      if (binding.kind !== 'maintenance-task' || binding.taskIndex !== tasks.length || task.targetKey !== target
        || task.key !== `maintenance:${binding.taskIndex}:${target}` || task.baselineDate !== null)
        throw new TypeError('Mismatched canonical maintenance binding');
      validateMaintenanceValues(task); tasks.push(task); selectionKeys.push(task.key);
    }
  }
  if (isAnswer) {
    if (display.fields.length || display.candidates.length || Object.keys(selections).length)
      throw new TypeError('Answer disclosure is read-only');
    const answer = exact(display.answer, ['route', 'coverage', 'rankedCandidates', 'statements', 'missingEvidence']);
    const rankings = object(wire.rankings);
    if (!Array.isArray(answer.rankedCandidates) || answer.rankedCandidates.length > 32
      || !Array.isArray(answer.statements) || answer.statements.length > 16)
      throw new TypeError('Invalid answer lists');
    const rankKeys = new Set<string>();
    answer.rankedCandidates.forEach((value, index) => {
      const rank = exact(value, ['key', 'label']);
      if (typeof rank.key !== 'string' || !Object.hasOwn(rankings, rank.key) || rankKeys.has(rank.key))
        throw new TypeError('Unbound answer rank');
      const binding = exact(rankings[rank.key], ['inputRef', 'version', 'rankIndex']);
      const input = ref(binding.inputRef);
      if (rank.key !== 'rank:' + input || binding.rankIndex !== index || typeof binding.version !== 'string'
        || !binding.version.trim() || new TextEncoder().encode(binding.version).length > 256
        || rank.label !== `${input} · ${binding.version}`) throw new TypeError('Mismatched exact rank binding');
      rankKeys.add(rank.key);
    });
    if (rankKeys.size !== Object.keys(rankings).length) throw new TypeError('Unreferenced answer rank');
    answer.statements.forEach((value, index) => {
      const statement = exact(value, ['key', 'text', 'reason', 'uncertainty', 'evidenceKeys']);
      if (statement.key !== 'answer:' + index || !Array.isArray(statement.evidenceKeys)
        || !statement.evidenceKeys.length || statement.evidenceKeys.some(key => typeof key !== 'string' || !sourceKeys.includes(key)))
        throw new TypeError('Mismatched answer citation');
    });
  }
  if (isComparison) {
    if (display.fields.length || display.candidates.length || Object.keys(selections).length)
      throw new TypeError('Comparison disclosure is read-only');
    const comparison = exact(display.contradictions, ['findings', 'missingEvidence']);
    const bindings = object(wire.comparisons);
    if (!Array.isArray(comparison.findings) || comparison.findings.length > 16)
      throw new TypeError('Invalid comparison list');
    const findingKeys = new Set<string>();
    comparison.findings.forEach((value, index) => {
      const finding = exact(value, ['key', 'pattern', 'assertions', 'rationale', 'uncertainty']);
      if (typeof finding.key !== 'string' || !Object.hasOwn(bindings, finding.key) || findingKeys.has(finding.key))
        throw new TypeError('Unbound comparison finding');
      const binding = exact(bindings[finding.key], ['findingKey', 'findingIndex', 'assertions']);
      if (finding.key !== 'finding:' + hash(binding.findingKey) || binding.findingIndex !== index
        || !Array.isArray(finding.assertions) || finding.assertions.length > 16)
        throw new TypeError('Mismatched canonical finding');
      const assertions = object(binding.assertions), claimKeys = new Set<string>();
      finding.assertions.forEach(value => {
        const assertion = exact(value, ['key', 'inputKey', 'text', 'uncertainty', 'factDate', 'evidenceKeys']);
        const claim = ref(assertion.key), input = ref(assertion.inputKey);
        if (!Object.hasOwn(assertions, claim) || claimKeys.has(claim) || assertion.factDate !== null)
          throw new TypeError('Unbound claim or invented fact time');
        const source = exact(assertions[claim], ['inputRef', 'version', 'evidenceRefs']);
        if (source.inputRef !== input || typeof source.version !== 'string' || !source.version.trim()
          || !Array.isArray(source.evidenceRefs) || !Array.isArray(assertion.evidenceKeys)
          || !assertion.evidenceKeys.length || assertion.evidenceKeys.length > 16
          || JSON.stringify(source.evidenceRefs) !== JSON.stringify(assertion.evidenceKeys))
          throw new TypeError('Mismatched exact assertion evidence');
        for (const key of assertion.evidenceKeys) {
          if (typeof key !== 'string' || !sourceKeys.includes(key)) throw new TypeError('Unresolved assertion evidence');
          const evidence = object(inspections[key]);
          if (evidence.inputRef !== input || evidence.version !== source.version || evidence.evidenceRef !== key)
            throw new TypeError('Assertion evidence belongs to another input or version');
        }
        claimKeys.add(claim);
      });
      if (claimKeys.size !== Object.keys(assertions).length) throw new TypeError('Unreferenced claim bindings');
      findingKeys.add(finding.key);
    });
    if (findingKeys.size !== Object.keys(bindings).length) throw new TypeError('Unreferenced finding bindings');
  }
  if (sourceKeys.length !== Object.keys(inspections).length || selectionKeys.length !== Object.keys(selections).length)
    throw new TypeError('Unreferenced disclosure bindings');
  freeze(wire);
  const identity = Object.freeze({ proposalRevision: revision, sourceSetRevision: pin });
  const now = owner.current();
  if (!now || now.context !== context || now.proposalRevision !== revision || now.sourceSetRevision !== pin)
    throw new TypeError('Superseded review disclosure');
  const view = { ...display, context } as unknown as SuggestionReviewView;
  const controller = createSuggestionReviewController(view, {
    current: () => owner.current(), subscribe: cb => owner.subscribe(cb),
    recheck: (_view, signal) => owner.recheck(identity, signal),
    inspectSource: (_view, s, signal) => owner.inspect(identity, inspections[s.key] as unknown as InspectionBinding, signal),
    onIntent(intent) {
      // Defense in depth if a future controller accidentally attempts delivery.
      if (isAnswer || isComparison) throw new TypeError('Read-only results cannot deliver review intents');
      const reviewedTasks = intent.maintenance ?? [];
      if (!isMaintenance && reviewedTasks.length) throw new TypeError('Unexpected maintenance intent');
      for (const edited of reviewedTasks) {
        const original = tasks.find(task => task.key === edited.key);
        if (!original || edited.targetKey !== original.targetKey) throw new TypeError('Changed maintenance target');
        validateMaintenanceValues(edited as unknown as ObjectData);
        const fields = ['title', 'interval', 'conditions', 'urgency'] as const;
        const signature = (value: unknown) => {
          const i = object(value); return JSON.stringify([i.kind, i.every ?? null, i.unit ?? null, i.condition ?? null]);
        };
        const changed = fields.filter(key => key === 'interval' ? signature(edited[key]) !== signature(original[key])
          : JSON.stringify(edited[key]) !== JSON.stringify(original[key]));
        // The retained controller also marks raw interval spelling/key-order
        // edits. Preserve that intent marker even if canonical values coincide.
        const declared = fields.filter(key => changed.includes(key) || key === 'interval' && edited.editedFields.includes(key));
        if (JSON.stringify(edited.editedFields) !== JSON.stringify(declared)) throw new TypeError('Mismatched maintenance edits');
      }
      const selected = [...intent.fields.map(f => f.key), ...intent.candidateKeys, ...reviewedTasks.map(task => task.key)];
      const bindings = Object.fromEntries(selected.map(key => {
        if (!Object.hasOwn(selections, key)) throw new TypeError('Unbound selection');
        return [key, selections[key] as unknown as SelectionBinding];
      }));
      return owner.onIntent(intent, Object.freeze(bindings));
    },
  });
  let retired = false;
  const retirement = new Set<() => void>();
  return {
    controller,
    onRetire(cb: () => void) { if (retired) { cb(); return () => {}; } retirement.add(cb); return () => { retirement.delete(cb); }; },
    get retired() { return retired; },
    dispose() {
      if (retired) return; retired = true;
      try { controller.dispose(); }
      finally {
        for (const cb of [...retirement]) { try { cb(); } catch { /* retire all owned views */ } }
        retirement.clear();
      }
    },
  };
}
export type SuggestionReviewSession = ReturnType<typeof createSuggestionReviewSession>;
