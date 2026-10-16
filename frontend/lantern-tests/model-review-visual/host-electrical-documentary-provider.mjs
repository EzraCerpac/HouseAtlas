/**
 * In-memory consumer port for an already qualified, host-authorized snapshot.
 * This module does not qualify bytes, lineage, identity, access or custody.
 *
 * createHostElectricalDocumentaryProvider(snapshot, authority)
 * authority.isCurrent(): boolean
 * authority.subscribeInvalidation(() => void): () => void
 * authority.openSource(descriptor, signal, context): Promise<'opened'|'unavailable'>
 *
 * descriptor is the exact frozen source row of context.frame.view.sources.
 * context = { frame, binding, reviewSha256, fixtureLedgerSha256, custody }.
 * The host resolves opaque keys using that owner-fenced context; it must check
 * signal/current access immediately before any irreversible reader action.
 * Cancellation intent cannot undo an already completed host action.
 *
 * Supply an exact view target for every authorized selection, including each
 * occurrence and the logical-room-only target. Occurrence membership derives
 * exclusively from these reviewed entries, never names or string expansion.
 * Snapshot data must be structured-cloneable plain data. The factory clones it
 * once and freezes its copy, leaving the caller's fixtureData unchanged. Each
 * frame rebinds only fixtureData.viewKey to its fresh host owner viewKey; all
 * ledger/domain fields remain unchanged. This matches the owner-fenced native
 * fixture consumer's context metadata requirement, without adding schema fields.
 */
export const HOST_ELECTRICAL_DOCUMENTARY_CONTRACT = 'houseatlas.host-electrical-documentary-port.v1';
let nextView = 0;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nonempty = value => typeof value === 'string' && value.length > 0;
const uniqueStrings = values => Array.isArray(values) && values.every(nonempty) && new Set(values).size === values.length;
const recordRoles = new Set(['socket-mark', 'light-label', 'light-annotation', 'unresolved-symbol']);
const sourceRoles = new Set(['original-sheet', 'drawing-crop', 'interpretation-record']);
function assertPlainData(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError('Snapshot must contain plain data only');
  }
  Object.values(value).forEach(child => assertPlainData(child, seen));
}
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
};
const unavailable = reason => Object.freeze({ status: 'unavailable', reason });
const stale = () => Object.freeze({ status: 'stale', reason: 'selection-changed' });
function bindingKey(binding) {
  if (!binding || typeof binding !== 'object') return null;
  if (binding.kind === 'canonical-publication' &&
      [binding.sourceRevisionId, binding.publicationId, binding.semanticMapRevisionId].every(nonempty) && digest(binding.semanticMapSha256)) {
    return JSON.stringify([binding.kind, binding.sourceRevisionId, binding.publicationId, binding.semanticMapRevisionId, binding.semanticMapSha256]);
  }
  if (binding.kind === 'private-preview' && nonempty(binding.modelVersion) &&
      digest(binding.modelGlbSha256) && digest(binding.crosswalkSha256) &&
      (binding.canonicalSourceSha256 === null || digest(binding.canonicalSourceSha256))) {
    return JSON.stringify([binding.kind, binding.modelVersion, binding.modelGlbSha256, binding.canonicalSourceSha256, binding.crosswalkSha256]);
  }
  return null;
}
function targetKey(target) {
  if (target?.kind === 'model-room' && nonempty(target.roomId) &&
      (target.spaceOccurrenceId === null || nonempty(target.spaceOccurrenceId))) {
    return JSON.stringify([target.kind, target.roomId, target.spaceOccurrenceId]);
  }
  if (target?.kind === 'documentary-scope' && nonempty(target.scopeId)) return JSON.stringify([target.kind, target.scopeId]);
  return null;
}

export function createHostElectricalDocumentaryProvider(snapshot, authority) {
  if (!authority || !['isCurrent', 'subscribeInvalidation', 'openSource'].every(key => typeof authority[key] === 'function')) {
    throw new TypeError('Host authority callbacks are required');
  }
  const copy = structuredClone(snapshot);
  assertPlainData(copy);
  const data = freeze(copy);
  const selectedBinding = bindingKey(data.binding);
  if (!selectedBinding || !digest(data.reviewSha256) || !digest(data.fixtureLedgerSha256) ||
      !['native-retained', 'private-local-review'].includes(data.custody) ||
      data.documentaryIndex !== null || !Array.isArray(data.views) || !Array.isArray(data.fixtureData?.fixtures)) {
    throw new TypeError('Expected an already qualified documentary snapshot');
  }
  const fixtureIds = data.fixtureData.fixtures.map(row => row.id);
  const ledgerValid = uniqueStrings(fixtureIds);
  const ledger = new Set(fixtureIds);
  const entries = new Map();
  const duplicateTargets = new Set();
  for (const entry of data.views) {
    const key = targetKey(entry.target);
    if (!key) throw new TypeError('View target must be explicit');
    if (entries.has(key)) duplicateTargets.add(key);
    entries.set(key, entry);
  }
  function validView(entry) {
    const { view, target } = entry;
    if (!ledgerValid || duplicateTargets.has(targetKey(target)) || !view ||
        !nonempty(view.id) || !nonempty(view.label) || view.installedFixtureCount !== null ||
        !uniqueStrings(view.fixtureIds) || !Array.isArray(view.records) || !Array.isArray(view.sources)) return false;
    if (!view.fixtureIds.every(id => ledger.has(id)) ||
        !uniqueStrings(view.records.map(row => row.fixtureId)) ||
        view.records.length !== view.fixtureIds.length ||
        !view.records.every(row => view.fixtureIds.includes(row.fixtureId))) return false;
    if (!view.records.every(row => {
      if (!recordRoles.has(row.role) || !uniqueStrings(row.sharedScopeIds)) return false;
      const scope = row.associationScope;
      if (scope?.kind === 'documentary-only') return true;
      if (target.kind !== 'model-room') return false;
      if (scope?.kind === 'logical-room') return true;
      return scope?.kind === 'occurrences' && uniqueStrings(scope.spaceOccurrenceIds) &&
        scope.spaceOccurrenceIds.length > 0 && scope.spaceOccurrenceIds.every(id =>
          entries.has(targetKey({ kind: 'model-room', roomId: target.roomId, spaceOccurrenceId: id })) &&
          !duplicateTargets.has(targetKey({ kind: 'model-room', roomId: target.roomId, spaceOccurrenceId: id })));
    })) return false;
    return uniqueStrings(view.sources.map(source => source.sourceKey)) && view.sources.every(source =>
      sourceRoles.has(source.role) && nonempty(source.label) &&
      (source.sheetId === null || data.fixtureData.sheets?.some(sheet => sheet.id === source.sheetId)) &&
      (source.pdfPage === null || (Number.isSafeInteger(source.pdfPage) && source.pdfPage > 0)));
  }
  // Explicit projection prevents review-only fields from entering the port view.
  function projectView(entry) {
    const selectedOccurrence = entry.target.kind === 'model-room' ? entry.target.spaceOccurrenceId : null;
    const rows = entry.view.records.filter(row => selectedOccurrence === null ||
      row.associationScope.kind !== 'occurrences' || row.associationScope.spaceOccurrenceIds.includes(selectedOccurrence));
    return freeze({
      id: entry.view.id, label: entry.view.label,
      fixtureIds: entry.view.fixtureIds.filter(id => rows.some(row => row.fixtureId === id)),
      records: rows.map(row => ({ fixtureId: row.fixtureId, role: row.role,
        associationScope: row.associationScope.kind === 'occurrences'
          ? { kind: 'occurrences', spaceOccurrenceIds: row.associationScope.spaceOccurrenceIds }
          : { kind: row.associationScope.kind }, sharedScopeIds: row.sharedScopeIds })),
      sources: entry.view.sources.map(source => ({ sourceKey: source.sourceKey, role: source.role,
        label: source.label, sheetId: source.sheetId, pdfPage: source.pdfPage })),
      installedFixtureCount: null,
    });
  }
  const prepared = new Map([...entries].map(([key, entry]) => [key, validView(entry) ? projectView(entry) : null]));
  const frames = new Map();
  let invalidated = false;
  let unsubscribeHost;
  function endState(state) {
    frames.delete(state.frame);
    for (const controller of state.opens) controller.abort();
    state.opens.clear();
  }
  function invalidate() {
    if (invalidated) return;
    invalidated = true;
    const previous = [...frames.values()];
    // Remove all membership before abort events or subscriber callbacks can run.
    frames.clear();
    for (const state of previous) endState(state);
    for (const state of previous) {
      for (const changed of state.listeners) { try { changed(); } catch { /* independent subscribers */ } }
      state.listeners.clear();
    }
    unsubscribeHost?.();
  }
  function currentAuthority() {
    if (invalidated) return false;
    let current = false;
    try { current = authority.isCurrent() === true; } catch { /* unavailable authority */ }
    if (!current) invalidate();
    return current && !invalidated;
  }
  function isCurrent(frame) {
    return frames.has(frame) && currentAuthority() && frames.has(frame);
  }
  const stop = authority.subscribeInvalidation(invalidate);
  if (typeof stop !== 'function') throw new TypeError('Host invalidation subscription must return an unsubscribe function');
  unsubscribeHost = stop;
  if (invalidated) stop();
  const port = {
    contract: HOST_ELECTRICAL_DOCUMENTARY_CONTRACT,
    async read(request, signal) {
      if (signal?.aborted) return stale();
      if (!currentAuthority()) return stale();
      if (bindingKey(request?.binding) !== selectedBinding) return unavailable('model-not-qualified');
      const key = targetKey(request?.target);
      if (!entries.has(key)) return unavailable('room-link-not-qualified');
      const view = prepared.get(key);
      if (!view) return unavailable('evidence-not-qualified');
      const viewKey = `electrical-documentary-view-${++nextView}`;
      const frame = freeze({ status: 'available', lease: Object.freeze(Object.create(null)),
        viewKey, binding: data.binding,
        target: entries.get(key).target, custody: data.custody, qualification: 'documentary-only',
        reviewSha256: data.reviewSha256, fixtureLedgerSha256: data.fixtureLedgerSha256,
        fixtureData: { ...data.fixtureData, viewKey }, documentaryIndex: null, view });
      frames.set(frame, { frame, listeners: new Set(), opens: new Set() });
      if (signal?.aborted || !isCurrent(frame)) { port.release(frame); return stale(); }
      return frame;
    },
    isCurrent,
    subscribeInvalidation(frame, changed) {
      if (typeof changed !== 'function') throw new TypeError('Expected invalidation callback');
      if (!isCurrent(frame)) { changed(); return () => {}; }
      const state = frames.get(frame);
      state.listeners.add(changed);
      return () => { state.listeners.delete(changed); };
    },
    async openSource(frame, sourceKey, signal) {
      if (signal?.aborted || !isCurrent(frame)) return 'unavailable';
      const descriptor = frame.view.sources.find(source => source.sourceKey === sourceKey);
      if (!descriptor) return 'unavailable';
      const state = frames.get(frame);
      const controller = new AbortController();
      const abort = () => controller.abort();
      state.opens.add(controller);
      signal?.addEventListener('abort', abort, { once: true });
      let onAbort;
      try {
        if (signal?.aborted || !isCurrent(frame)) return 'unavailable';
        const cancelled = new Promise(resolve => {
          onAbort = () => resolve('unavailable');
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        const context = freeze({ frame, binding: frame.binding, reviewSha256: frame.reviewSha256,
          fixtureLedgerSha256: frame.fixtureLedgerSha256, custody: frame.custody });
        const result = await Promise.race([authority.openSource(descriptor, controller.signal, context), cancelled]);
        return result === 'opened' && !controller.signal.aborted && !signal?.aborted && isCurrent(frame)
          ? 'opened' : 'unavailable';
      } catch { return 'unavailable'; }
      finally {
        state.opens.delete(controller);
        signal?.removeEventListener('abort', abort);
        if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      }
    },
    release(frame) {
      const state = frames.get(frame);
      if (!state) return;
      endState(state);
      state.listeners.clear();
    },
  };
  return Object.freeze(port);
}
