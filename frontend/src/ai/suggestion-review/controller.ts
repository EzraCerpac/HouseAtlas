import type { SuggestionReviewView, SuggestionReviewPorts, SuggestionReviewSnapshot,
  SuggestionReviewIntent, SuggestionReviewPhase, MaintenanceTaskView, MaintenanceTaskDraft,
  MaintenanceIntervalView, MaintenanceIntervalDraft, MaintenanceUrgency, MaintenanceEditedField } from './view-types';


const units = ['days', 'weeks', 'months', 'years', 'usage-hours'];
const urgencies = ['unknown', 'routine', 'review-soon'];
function intervalView(interval: MaintenanceIntervalView): MaintenanceIntervalView {
  const exact = (keys: string[]) => Object.keys(interval).sort().join(',') === keys.sort().join(',');
  if (!interval || typeof interval !== 'object') throw new TypeError('Invalid maintenance interval');
  if (interval.kind === 'periodic' && exact(['kind', 'every', 'unit']) && Number.isSafeInteger(interval.every)
    && interval.every > 0 && interval.every <= 4294967295 && units.includes(interval.unit)) return Object.freeze({ ...interval });
  if (interval.kind === 'conditional' && exact(['kind', 'condition']) && typeof interval.condition === 'string'
    && interval.condition.trim().length > 0 && interval.condition.length <= 4096) return Object.freeze({ ...interval });
  if (interval.kind === 'unknown' && exact(['kind'])) return Object.freeze({ kind: 'unknown' });
  throw new TypeError('Unsupported maintenance interval');
}
function intervalDraft(interval: MaintenanceIntervalView): MaintenanceIntervalDraft {
  return Object.freeze(interval.kind === 'periodic' ? { ...interval, every: String(interval.every) } : { ...interval });
}
function copyIntervalDraft(interval: MaintenanceIntervalDraft): MaintenanceIntervalDraft {
  if (!interval || typeof interval !== 'object') throw new TypeError('Invalid interval edit');
  const keys = Object.keys(interval).sort().join(',');
  if (interval.kind === 'unknown' && keys === 'kind') return Object.freeze({ kind: 'unknown' });
  if (interval.kind === 'periodic' && keys === 'every,kind,unit' && typeof interval.every === 'string'
    && interval.every.length <= 10 && (interval.unit === null || units.includes(interval.unit))) return Object.freeze({ ...interval });
  if (interval.kind === 'conditional' && keys === 'condition,kind' && typeof interval.condition === 'string'
    && interval.condition.length <= 4096) return Object.freeze({ ...interval });
  throw new TypeError('Unsupported interval edit');
}
function validTask(task: Pick<MaintenanceTaskDraft, 'title' | 'interval' | 'conditions'>): boolean {
  const i = task.interval;
  return task.title.trim().length > 0 && task.conditions.every(v => v.trim().length > 0)
    && (i.kind === 'unknown' || i.kind === 'conditional' && i.condition.trim().length > 0
      || i.kind === 'periodic' && i.unit !== null && /^[0-9]{1,10}$/.test(i.every)
        && Number(i.every) > 0 && Number(i.every) <= 4294967295);
}
function editedTask(task: MaintenanceTaskDraft, original: MaintenanceTaskView): readonly MaintenanceEditedField[] {
  const changed: MaintenanceEditedField[] = [];
  if (task.title !== original.title) changed.push('title');
  if (JSON.stringify(task.interval) !== JSON.stringify(intervalDraft(original.interval))) changed.push('interval');
  if (JSON.stringify(task.conditions) !== JSON.stringify(original.conditions)) changed.push('conditions');
  if (task.urgency !== original.urgency) changed.push('urgency');
  return Object.freeze(changed);
}
function taskIntent(task: MaintenanceTaskDraft, original: MaintenanceTaskView) {
  if (!validTask(task)) throw new TypeError('Incomplete maintenance edit');
  const i = task.interval;
  const interval: MaintenanceIntervalView = i.kind === 'periodic'
    ? Object.freeze({ kind: 'periodic', every: Number(i.every), unit: i.unit! }) : Object.freeze({ ...i });
  return Object.freeze({ key: task.key, targetKey: original.targetKey, title: task.title,
    interval, conditions: Object.freeze([...task.conditions]), urgency: task.urgency, editedFields: editedTask(task, original) });
}

/** Only copies bounded local presentation data. Does not decode or validate AI wire input. */
function copyView(view: SuggestionReviewView): SuggestionReviewView {
  const text = (v: string, cap = 4096) => { if (typeof v !== 'string' || v.length > cap) throw new TypeError('Invalid suggestion display text'); return v; };
  const key = (v: string) => { text(v, 256); if (!v) throw new TypeError('Missing display key'); return v; };
  const optional = (v: string | null) => v === null ? null : text(v);
  const list = <T>(values: readonly T[], cap = 16) => {
    if (!Array.isArray(values) || values.length > cap) throw new TypeError('Invalid suggestion display list'); return values;
  };
  if (!view.context || typeof view.context !== 'object' || !['inventory', 'document', 'maintenance'].includes(view.kind))
    throw new TypeError('Unsupported suggestion presentation');
  const unique = (keys: readonly string[]) => { if (new Set(keys).size !== keys.length) throw new TypeError('Duplicate display key'); };
  const sources = list(view.sources).map(s => {
    if (!['snapshot-current', 'stale', 'unknown'].includes(s.freshness)
      || !['available', 'unavailable', 'withdrawn'].includes(s.original)
      || !(s.page === null || Number.isSafeInteger(s.page) && s.page > 0)) throw new TypeError('Invalid source display');
    return Object.freeze({ key: key(s.key), label: text(s.label), recordVersion: key(s.recordVersion),
      sourceDate: optional(s.sourceDate), retrievedAt: optional(s.retrievedAt), page: s.page, section: optional(s.section),
      excerpt: text(s.excerpt, 8192), freshness: s.freshness, original: s.original });
  });
  if (!sources.length) throw new TypeError('Source display required');
  unique(sources.map(s => s.key)); const sourceKeys = new Set(sources.map(s => s.key));
  const evidence = (keys: readonly string[]) => {
    const result = list(keys).map(key); unique(result);
    if (!result.length || result.some(k => !sourceKeys.has(k))) throw new TypeError('Unresolved display evidence');
    return Object.freeze(result);
  };
  const fields = list(view.fields).map(f => Object.freeze({ key: key(f.key), label: text(f.label),
    current: optional(f.current), proposed: text(f.proposed), reason: text(f.reason), uncertainty: text(f.uncertainty),
    evidenceKeys: evidence(f.evidenceKeys) }));
  const candidates = list(view.candidates).map(c => {
    if (!['possible-duplicate', 'same-product', 'proposed-association'].includes(c.relation)) throw new TypeError('Invalid candidate display');
    return Object.freeze({ key: key(c.key), label: text(c.label), relation: c.relation, reason: text(c.reason),
      uncertainty: text(c.uncertainty), evidenceKeys: evidence(c.evidenceKeys) });
  });
  unique(fields.map(f => f.key)); unique(candidates.map(c => c.key));
  let maintenance: readonly MaintenanceTaskView[] | undefined;
  if (view.kind === 'maintenance') {
    if (fields.length || candidates.length) throw new TypeError('Maintenance requires task selections');
    maintenance = Object.freeze(list(view.maintenance!).map(task => {
      const allowed = ['key', 'targetKey', 'targetLabel', 'title', 'interval', 'conditions', 'urgency', 'reason', 'uncertainty', 'evidenceKeys', 'baselineDate'];
      if (!task || Object.keys(task).sort().join(',') !== allowed.sort().join(',') || !urgencies.includes(task.urgency))
        throw new TypeError('Invalid maintenance display');
      const title = text(task.title); if (!title.trim()) throw new TypeError('Maintenance title required');
      const conditions = list(task.conditions).map(value => { text(value); if (!value.trim()) throw new TypeError('Empty condition'); return value; });
      return Object.freeze({ key: key(task.key), targetKey: key(task.targetKey), targetLabel: text(task.targetLabel),
        title, interval: intervalView(task.interval), conditions: Object.freeze(conditions), urgency: task.urgency,
        reason: text(task.reason), uncertainty: text(task.uncertainty), evidenceKeys: evidence(task.evidenceKeys),
        baselineDate: optional(task.baselineDate) });
    }));
    unique(maintenance.map(task => task.key));
  } else if (Object.hasOwn(view, 'maintenance')) throw new TypeError('Unexpected maintenance display');
  return Object.freeze({ context: view.context, key: key(view.key), revision: key(view.revision), sourceSetRevision: key(view.sourceSetRevision),
    kind: view.kind, title: text(view.title), sources: Object.freeze(sources), fields: Object.freeze(fields),
    candidates: Object.freeze(candidates), uncertainty: Object.freeze(list(view.uncertainty).map(v => text(v))),
    uncalibratedScore: optional(view.uncalibratedScore), ...(maintenance ? { maintenance } : {}) });
}
const empty = Object.freeze([]);
const hidden = (phase: 'superseded' | 'closed', message: string): SuggestionReviewSnapshot =>
  Object.freeze({ phase, message, view: null, fields: empty, candidateKeys: empty, maintenance: empty });
export function createSuggestionReviewController(input: SuggestionReviewView, ports: SuggestionReviewPorts) {
  const view = copyView(input), listeners = new Set<() => void>();
  const superseded = hidden('superseded', 'The account, context or source selection changed. Open a current suggestion.');
  const closed = hidden('closed', 'Suggestion dismissed.');
  const initiallyStale = view.sources.some(s => s.freshness === 'stale' || s.original === 'withdrawn');
  let state: SuggestionReviewSnapshot = Object.freeze({ phase: initiallyStale ? 'stale' : 'reviewing',
    message: initiallyStale ? 'Source evidence changed or was withdrawn. Dismiss this suggestion and request a current review.' : 'Select fields or candidates to review.',
    view, fields: Object.freeze(view.fields.map(f => Object.freeze({ key: f.key, value: f.proposed, selected: false, edited: false }))),
    candidateKeys: empty, maintenance: Object.freeze((view.maintenance ?? []).map(task => Object.freeze({ key: task.key,
      selected: false, title: task.title, interval: intervalDraft(task.interval), conditions: Object.freeze([...task.conditions]),
      urgency: task.urgency, valid: true, edited: false }))) });
  let disposed = false, consumed = false, active: AbortController | null = null, sequence = 0;
  let resumePhase: 'reviewing' | 'stale' = initiallyStale ? 'stale' : 'reviewing';
  let held: SuggestionReviewSnapshot | null = null, heldAvailability = '';
  const current = () => {
    const now = ports.current();
    return now && now.context === view.context && now.proposalRevision === view.revision
      && now.sourceSetRevision === view.sourceSetRevision ? now : null;
  };
  const snapshot = (): SuggestionReviewSnapshot => {
    if (disposed || state.phase === 'closed') return closed;
    const now = current(); if (!now) return superseded;
    if (now.availability !== 'ready' && !consumed) {
      if (!held || heldAvailability !== now.availability || held.fields !== state.fields || held.maintenance !== state.maintenance) {
        heldAvailability = now.availability;
        held = Object.freeze({ ...state, phase: 'unavailable', message: 'Suggestion review is ' + now.availability + '. Manual workflows remain available.' });
      }
      return held;
    }
    return state;
  };
  const emit = () => { for (const cb of [...listeners]) { try { cb(); } catch { /* view observers do not own review */ } } };
  const publish = (phase: SuggestionReviewPhase, message: string) => { state = Object.freeze({ ...state, phase, message }); held = null; emit(); };
  const ready = () => !disposed && !consumed && current()?.availability === 'ready' && state.phase !== 'closed';
  const cancel = () => { sequence++; active?.abort(); active = null; };
  const unsubscribe = ports.subscribe(() => {
    if (!current()) { cancel(); state = superseded; }
    else if (current()?.availability !== 'ready' && !consumed) {
      cancel();
      if (state.phase === 'checking' || state.phase === 'inspecting')
        state = Object.freeze({ ...state, phase: resumePhase, message: 'Review paused. Check availability before continuing.' });
    }
    held = null; emit();
  });
  const editable = () => ready() && state.phase === 'reviewing' && active === null;
  return {
    getSnapshot: snapshot,
    subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    selectField(key: string, selected: boolean) {
      if (!editable() || !state.fields.some(f => f.key === key)) return false;
      state = Object.freeze({ ...state, fields: Object.freeze(state.fields.map(f => f.key === key ? Object.freeze({ ...f, selected }) : f)) }); emit(); return true;
    },
    editField(key: string, value: string) {
      if (!editable() || typeof value !== 'string' || value.length > 4096 || !state.fields.some(f => f.key === key)) return false;
      state = Object.freeze({ ...state, fields: Object.freeze(state.fields.map(f => f.key === key ? Object.freeze({ ...f, value, edited: value !== view.fields.find(v => v.key === key)!.proposed }) : f)) }); emit(); return true;
    },
    selectCandidate(key: string, selected: boolean) {
      if (!editable() || !view.candidates.some(c => c.key === key)) return false;
      const next = new Set(state.candidateKeys); if (selected) next.add(key); else next.delete(key);
      state = Object.freeze({ ...state, candidateKeys: Object.freeze([...next]) }); emit(); return true;
    },
    selectMaintenanceTask(key: string, selected: boolean) {
      if (!editable() || !state.maintenance.some(task => task.key === key)) return false;
      state = Object.freeze({ ...state, maintenance: Object.freeze(state.maintenance.map(task => task.key === key
        ? Object.freeze({ ...task, selected }) : task)) }); held = null; emit(); return true;
    },
    editMaintenanceTask(key: string, patch: { readonly title?: string; readonly interval?: MaintenanceIntervalDraft;
      readonly conditions?: readonly string[]; readonly urgency?: MaintenanceUrgency }) {
      if (!editable() || !patch || typeof patch !== 'object' || Array.isArray(patch)
        || Object.keys(patch).some(k => !['title', 'interval', 'conditions', 'urgency'].includes(k))) return false;
      const before = state.maintenance.find(task => task.key === key), original = view.maintenance?.find(task => task.key === key);
      if (!before || !original) return false;
      try {
        const title = Object.hasOwn(patch, 'title') ? patch.title : before.title;
        const urgency = Object.hasOwn(patch, 'urgency') ? patch.urgency : before.urgency;
        const conditions = Object.hasOwn(patch, 'conditions') ? patch.conditions : before.conditions;
        if (typeof title !== 'string' || title.length > 4096 || typeof urgency !== 'string' || !urgencies.includes(urgency)
          || !Array.isArray(conditions) || conditions.length > 16 || conditions.some(v => typeof v !== 'string' || v.length > 4096)) return false;
        const interval = copyIntervalDraft(Object.hasOwn(patch, 'interval') ? patch.interval! : before.interval);
        const draft = { ...before, title, urgency: urgency as MaintenanceUrgency, interval, conditions: Object.freeze([...conditions]) };
        const next = Object.freeze({ ...draft, valid: validTask(draft), edited: editedTask(draft, original).length > 0 });
        state = Object.freeze({ ...state, maintenance: Object.freeze(state.maintenance.map(task => task.key === key ? next : task)) });
        held = null; emit(); return true;
      } catch { return false; }
    },
    async inspectSource(key: string) {
      const source = view.sources.find(s => s.key === key);
      if (!ready() || active || !source || source.original !== 'available'
        || !['reviewing', 'stale'].includes(state.phase)) return;
      const previous = state.phase; resumePhase = previous === 'stale' ? 'stale' : 'reviewing';
      const operation = ++sequence, controller = new AbortController(); active = controller;
      publish('inspecting', 'Opening the exact source through its owner.');
      try {
        if (!ready() || controller.signal.aborted || sequence !== operation) return;
        await ports.inspectSource(view, source, controller.signal);
        if (!ready() || controller.signal.aborted || sequence !== operation) return;
        publish(previous, 'Source inspection finished.');
      } catch {
        if (ready() && !controller.signal.aborted && sequence === operation) publish(previous, 'The source could not be opened.');
      } finally { if (sequence === operation) active = null; }
    },
    async decide(action: 'accept-for-review' | 'reject') {
      if (!['accept-for-review', 'reject'].includes(action) || !editable() || (action === 'accept-for-review' && !state.fields.some(f => f.selected) && !state.candidateKeys.length && !state.maintenance.some(task => task.selected))) return;
      if (action === 'accept-for-review' && state.maintenance.some(task => task.selected && !task.valid)) {
        publish('reviewing', 'Complete the selected maintenance titles, intervals and conditions before review.'); return;
      }
      const operation = ++sequence, controller = new AbortController(); active = controller; publish('checking', 'Checking the current source selection.');
      try {
        if (!ready() || controller.signal.aborted || sequence !== operation) return;
        const result = await ports.recheck(view, controller.signal);
        if (!ready() || controller.signal.aborted || operation !== sequence) return;
        if (result !== 'current') {
          publish(result === 'stale' || result === 'withdrawn' ? 'stale' : 'reviewing',
            result === 'unavailable' ? 'The source check is unavailable. No review intent was sent.' : 'Source evidence changed or was withdrawn. Dismiss this suggestion.');
          return;
        }
        const intent: SuggestionReviewIntent = Object.freeze({ kind: 'suggestion-review-intent', authority: 'none',
          intentId: crypto.randomUUID(), context: view.context, proposalKey: view.key, proposalRevision: view.revision,
          sourceSetRevision: view.sourceSetRevision, action,
          fields: Object.freeze(action === 'reject' ? [] : state.fields.filter(f => f.selected).map(f => Object.freeze({ key: f.key, value: f.value, edited: f.edited }))),
          candidateKeys: Object.freeze(action === 'reject' ? [] : [...state.candidateKeys]),
          ...(view.kind === 'maintenance' ? { maintenance: Object.freeze(action === 'reject' ? []
            : state.maintenance.filter(task => task.selected).map(task => taskIntent(task, view.maintenance!.find(v => v.key === task.key)!))) } : {}) });
        // Consume BEFORE the callback: synchronous re-entry, throws and unknown delivery never replay.
        consumed = true; active = null; publish(action === 'reject' ? 'rejected' : 'sent', 'Review intent handed to the source owner.');
        if (disposed || !current() || current()?.availability !== 'ready' || sequence !== operation || state.phase === 'closed') {
          if (!disposed && state.phase !== 'closed') publish('unavailable', 'The context changed before delivery. No review intent was sent.');
          return;
        }
        try { await ports.onIntent(intent); }
        catch { if (!disposed && current() && sequence === operation && state.phase !== 'closed') publish('handoff-unconfirmed', 'Review intent delivery is unconfirmed. Do not resubmit this suggestion.'); }
      } catch {
        if (ready() && !controller.signal.aborted && operation === sequence) publish('reviewing', 'The source check failed. No review intent was sent.');
      } finally { if (sequence === operation) active = null; }
    },
    /** Local dismissal only: no inference, persistence or source callback. */
    dismiss() { if (disposed || state.phase === 'closed') return; cancel(); state = closed; emit(); },
    dispose() { if (disposed) return; cancel(); disposed = true; try { unsubscribe(); } finally { state = closed; emit(); listeners.clear(); } },
  };
}
export type SuggestionReviewController = ReturnType<typeof createSuggestionReviewController>;
