import { nativeLink, sameScope, sourceKey } from '../../app/model';
import type { Entry, Scope } from '../../app/types';
import type { SelectionBinding } from './session';
import type { SuggestionReviewContext, SuggestionReviewIntent, SuggestionReviewSnapshot } from '../suggestion-review/view-types';

/** LOCAL owner seam, not a wire schema or a source/approval grant. inputRef must
 * be resolved by the admitted input owner, never interpreted as a native ID.
 * version is that owner's exact version, NOT Entry retrieval/update time. */
export interface NativeHandoffInput {
  readonly inputRef: string;
  readonly version: string;
  readonly entry: Entry;
}
export interface NativeHandoffCurrent extends SuggestionReviewContext, Scope {
  readonly accountKey: string;
  readonly canEdit: boolean;
  readonly inputs: readonly NativeHandoffInput[];
}
export interface NativeHandoffPin extends Scope {
  readonly accountKey: string;
  readonly inputRef: string;
  readonly version: string;
  readonly sourceKey: string;
}
export interface NativeHandoffOwner {
  /** Current authenticated owner only. Replace context on every generation,
   * including A-B-A; return null on source/session retirement. */
  current(): NativeHandoffCurrent | null;
  subscribe(changed: () => void): () => void;
  /** Recheck original admitted inputs AND exact target versions/access. No write.
   * A current result is not native authority or an approval. */
  recheck(pins: readonly NativeHandoffPin[], signal: AbortSignal): Promise<'current' | 'stale' | 'unavailable'>;
}
export interface NativeHandoffRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly edited: boolean;
  readonly href: string;
}
export interface NativeHandoffSnapshot {
  readonly phase: 'checking' | 'ready' | 'unavailable' | 'retired';
  readonly message: string;
  readonly rows: readonly NativeHandoffRow[];
}
const empty: readonly NativeHandoffRow[] = Object.freeze([]);
const unavailable: NativeHandoffSnapshot = Object.freeze({ phase: 'unavailable',
  message: 'Native handoff unavailable. Continue through the existing source workflow.', rows: empty });
const retired: NativeHandoffSnapshot = Object.freeze({ phase: 'retired', message: 'Native handoff cleared.', rows: empty });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Call only from the existing session owner's onIntent with the controller's
 * current sent snapshot and its selected bindings. Keeps deliberate edits as
 * review text; never maps category/tag text to IDs or intervals to due dates.
 * No fetch, persistence, write acknowledgement, window.open or navigation. */
export function createNativeHandoff(intent: SuggestionReviewIntent,
  selections: Readonly<Record<string, SelectionBinding>>, snapshot: SuggestionReviewSnapshot,
  owner: NativeHandoffOwner) {
  const view = snapshot.view;
  if (intent.kind !== 'suggestion-review-intent' || intent.authority !== 'none'
    || intent.action !== 'accept-for-review' || snapshot.phase !== 'sent' || !view
    || intent.context !== view.context || intent.proposalKey !== view.key
    || intent.proposalRevision !== view.revision || intent.sourceSetRevision !== view.sourceSetRevision
    || ['answer', 'contradictions'].includes(view.kind)
    || !same(intent.fields, snapshot.fields.filter(f => f.selected).map(({ key, value, edited }) => ({ key, value, edited })))
    || !same(intent.candidateKeys, snapshot.candidateKeys)) throw new TypeError('Unbound native handoff');

  const requested: { key: string; label: string; value: string; edited: boolean;
    binding: SelectionBinding; nativeIntent: 'edit' | 'maintenance' }[] = [];
  const add = (key: string, kind: string, label: string, value: string, edited: boolean,
    nativeIntent: 'edit' | 'maintenance' = 'edit') => {
    const binding = selections[key];
    if (!binding || binding.kind !== kind || requested.some(row => row.key === key)) throw new TypeError('Unbound native selection');
    requested.push({ key, label, value, edited, binding: Object.freeze({ ...binding }), nativeIntent });
  };
  for (const field of intent.fields) {
    const original = view.fields.find(f => f.key === field.key);
    const kind = view.kind === 'inventory' ? ({ category: 'inventory-category', tags: 'inventory-tags' } as Record<string, string>)[field.key]
      : view.kind === 'document' && field.key === 'document-class' ? 'document-class' : undefined;
    if (!original || !kind) throw new TypeError('Unknown native field');
    add(field.key, kind, original.label, field.value, field.edited);
  }
  for (const key of intent.candidateKeys) {
    const candidate = view.candidates.find(c => c.key === key);
    const kind = selections[key]?.kind;
    if (!candidate || !kind || !(view.kind === 'document' ? ['document-link'] : ['inventory-container', 'inventory-duplicate']).includes(kind))
      throw new TypeError('Unknown native candidate');
    add(key, kind, 'Proposed relationship (manual review)', `${candidate.label}\n${candidate.relation}`, false);
  }
  const selectedTasks = snapshot.maintenance.filter(task => task.selected);
  if ((intent.maintenance?.length ?? 0) !== selectedTasks.length) throw new TypeError('Unbound maintenance selection');
  for (const task of intent.maintenance ?? []) {
    const original = view.maintenance?.find(t => t.key === task.key);
    const draft = selectedTasks.find(t => t.key === task.key);
    const binding = selections[task.key];
    if (view.kind !== 'maintenance' || !original || !draft || !draft.valid || !binding
      || binding.inputRef !== original.targetKey || task.targetKey !== original.targetKey
      || binding.taskIndex !== view.maintenance?.indexOf(original)
      || task.title !== draft.title || task.urgency !== draft.urgency || !same(task.conditions, draft.conditions)
      || task.interval.kind !== draft.interval.kind
      || (task.interval.kind === 'periodic' && (draft.interval.kind !== 'periodic'
        || task.interval.every !== Number(draft.interval.every) || task.interval.unit !== draft.interval.unit))
      || (task.interval.kind === 'conditional' && (draft.interval.kind !== 'conditional' || task.interval.condition !== draft.interval.condition)))
      throw new TypeError('Changed maintenance binding');
    add(task.key, 'maintenance-task', original.targetLabel,
      JSON.stringify({ title: task.title, interval: task.interval, conditions: task.conditions, urgency: task.urgency,
        baselineDate: original.baselineDate, dueDate: null }), task.editedFields.length > 0, 'maintenance');
  }
  if (!requested.length || requested.length > 64 || requested.length !== Object.keys(selections).length
    || requested.some(row => row.value.length > 16384)) throw new TypeError('Invalid native selection size');

  const current = owner.current();
  const initial = current ? Object.freeze({ context: current.context, accountKey: current.accountKey,
    workspaceId: current.workspaceId, homeId: current.homeId }) : null;
  const pins = Object.freeze(requested.map(row => {
    const matches = current?.inputs.filter(input => input.inputRef === row.binding.inputRef) ?? [];
    const input = matches.length === 1 ? matches[0] : undefined;
    return input && initial ? Object.freeze({ accountKey: initial.accountKey, workspaceId: initial.workspaceId,
      homeId: initial.homeId, inputRef: input.inputRef, version: input.version, sourceKey: sourceKey(input.entry.source) }) : null;
  }));
  let state: NativeHandoffSnapshot = Object.freeze({ phase: 'checking', message: 'Checking the current native source link.', rows: empty });
  let disposed = false;
  const abort = new AbortController(), listeners = new Set<() => void>();
  let unsubscribe = () => {};
  const emit = () => { for (const cb of [...listeners]) cb(); };
  const clear = (next: NativeHandoffSnapshot) => {
    if (state === next) return;
    abort.abort(); state = next; emit();
  };
  const resolve = (): readonly NativeHandoffRow[] | null => {
    const now = owner.current();
    if (!initial || !now || now.context !== intent.context || now.context !== initial.context
      || now.accountKey !== initial.accountKey || !sameScope(now, initial)
      || now.proposalRevision !== intent.proposalRevision || now.sourceSetRevision !== intent.sourceSetRevision
      || now.availability !== 'ready' || !now.canEdit) return null;
    const rows: NativeHandoffRow[] = [];
    for (const [index, row] of requested.entries()) {
      const pin = pins[index];
      const matches = now.inputs.filter(input => input.inputRef === row.binding.inputRef);
      const input = matches.length === 1 ? matches[0] : undefined;
      if (!pin || !input || !input.version || input.version !== pin.version || !sameScope(input.entry, pin)
        || input.entry.key !== pin.sourceKey || sourceKey(input.entry.source) !== pin.sourceKey
        || input.entry.entity.id !== input.entry.source.externalId || input.entry.entity.archived) return null;
      const href = nativeLink(input.entry, row.nativeIntent, now.canEdit);
      if (!href) return null;
      rows.push(Object.freeze({ key: row.key, label: row.label, value: row.value, edited: row.edited, href }));
    }
    return Object.freeze(rows);
  };
  // Validate before starting any asynchronous owner work. A changed link also
  // invalidates a ready snapshot, even if its target/version claims are equal.
  const check = () => {
    if (disposed || state.phase === 'unavailable' || state.phase === 'retired') return;
    const rows = resolve();
    if (!rows || state.phase === 'ready' && !same(rows, state.rows)) clear(unavailable);
  };
  unsubscribe = owner.subscribe(() => { check(); emit(); });
  check();
  const ready = (async () => {
    if (abort.signal.aborted) return;
    try {
      const result = await owner.recheck(pins.filter((pin): pin is NativeHandoffPin => pin !== null), abort.signal);
      if (disposed || abort.signal.aborted) return;
      const rows = resolve();
      if (result !== 'current' || !rows) { clear(unavailable); return; }
      state = Object.freeze({ phase: 'ready', message: 'Review these values in the native source. Nothing has been applied.', rows }); emit();
    } catch { if (!disposed && !abort.signal.aborted) clear(unavailable); }
  })();
  return {
    ready,
    getSnapshot() { check(); return state; },
    subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    /** Synchronous final guard for an ordinary explicit anchor activation. Does
     * not navigate. Refuses stale rendered hrefs and every non-ready state. */
    canNavigate(key: string, href: string) { check(); return state.phase === 'ready' && state.rows.some(row => row.key === key && row.href === href); },
    dispose() { if (disposed) return; disposed = true; try { unsubscribe(); } finally { clear(retired); listeners.clear(); } },
  };
}
export type NativeHandoff = ReturnType<typeof createNativeHandoff>;
