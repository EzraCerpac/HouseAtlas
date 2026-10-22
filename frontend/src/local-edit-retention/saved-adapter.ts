import { parseLosslessJson } from '../numeric/lossless-json';
import type { SavedHouse, SavedHouseStore } from '../offline/store';
import { readRetainedIdentityCandidates, type RetainedIdentityCandidate, type VerifiedRetainedIdentities } from './retained-identity';
import { createLocalEditRetentionController, type LocalEditResult, type LocalEditSelectionController } from './controller';
import { LOCAL_EDIT_RETENTION_LIMITS } from './store';
import type { LocalEditDraft, LocalEditResourcePin, LocalEditRetentionStore } from './types';

/** Independent of optional Atlas/model/catalog admission. */
export interface SavedHouseSelection {
  readonly house: SavedHouse;
  readonly signal: AbortSignal;
  readonly resources?: Pick<SavedHouseStore, 'list' | 'asset'>;
  isCurrent(): boolean;
}
export interface SavedDraftSummary {
  readonly key: string;
  readonly recordType: string;
  readonly recordId: string;
  readonly revision: string | null;
  readonly resourceId: string;
  readonly hasProposal: boolean;
}
export interface SavedDraftDetail extends SavedDraftSummary {
  readonly originalSha256: string | null;
  readonly originalBytes: number | null;
  readonly resourceSha256: string;
  readonly manifestSha256: string;
  readonly proposalSha256: string | null;
  readonly originalText: string | null;
  readonly proposalText: string | null;
  readonly canEdit: boolean;
  readonly editorReason: string | null;
  readonly version: number;
}
export type SavedDraftOutcome = Omit<LocalEditResult, 'draft'>;
export interface SavedDraftSnapshot {
  readonly localPartitionId: string;
  readonly context: Readonly<{ scope: SavedHouse['scope']; savedKey: string; snapshotId: string; localRevision: string }>;
  readonly status: 'idle' | 'listing' | 'listed' | 'opening' | 'ready' | 'pending' | 'unavailable' | 'completion-unconfirmed' | 'retired';
  readonly summaries: readonly SavedDraftSummary[];
  readonly selectedKey: string | null;
  readonly detail: SavedDraftDetail | null;
  readonly outcome: SavedDraftOutcome | null;
  readonly message: string | null;
  readonly candidates: readonly RetainedIdentityCandidate[];
  readonly candidateStatus: 'idle' | 'reading' | 'ready' | 'unavailable';
  readonly candidateMessage: string | null;
  readonly selectedCandidate: string | null;
  readonly canRetain: boolean;
}
export interface SavedLocalEditAdapter {
  /** Stable cached, deeply frozen metadata/text. No mutable byte buffers escape. */
  getSnapshot(): SavedDraftSnapshot;
  subscribe(listener: () => void): () => void;
  list(): Promise<void>;
  readCandidates(): Promise<void>;
  chooseCandidate(key: string): Promise<LocalEditResult | null>;
  retain(): Promise<LocalEditResult | null>;
  open(key: string): Promise<LocalEditResult | null>;
  read(): Promise<LocalEditResult | null>;
  saveProposal(text: string): Promise<LocalEditResult | null>;
  resetProposal(): Promise<LocalEditResult | null>;
  discard(): Promise<LocalEditResult | null>;
  closeDetail(): void;
  /** Retires publication; never closes the injected store or deletes its rows. */
  dispose(): void;
}
function need(value: unknown): asserts value {
  if (!value) throw new Error('The retained draft does not match this saved copy');
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) frozen(item);
    Object.freeze(value);
  }
  return value;
}
function resourceKey(pin: LocalEditResourcePin): string {
  return JSON.stringify([pin.id, pin.role, pin.label, pin.sha256, pin.bytes, pin.contentType,
    pin.record === undefined ? [] : pin.record === null ? null : [pin.record.recordType, pin.record.recordId, pin.record.revision]]);
}
function draftKey(row: LocalEditDraft): string {
  return JSON.stringify([resourceKey(row.selectedResource), row.recordIdentity.recordType, row.recordIdentity.recordId]);
}
function equalBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const x = new Uint8Array(a), y = new Uint8Array(b);
  return x.length === y.length && x.every((byte, index) => byte === y[index]);
}
async function digest(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
/** Syntax support only. Never serialize a parsed tree to manufacture originals. */
function jsonText(bytes: ArrayBuffer): string | null {
  try {
    need(bytes.byteLength <= LOCAL_EDIT_RETENTION_LIMITS.recordBytes);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    need(equalBytes(new TextEncoder().encode(text).buffer, bytes));
    parseLosslessJson(text); return text;
  } catch { return null; }
}
function summary(row: LocalEditDraft): SavedDraftSummary {
  return { key: draftKey(row), recordType: row.recordIdentity.recordType, recordId: row.recordIdentity.recordId,
    revision: row.original.revision, resourceId: row.selectedResource.id, hasProposal: row.proposal !== null };
}
function detail(row: LocalEditDraft, version: number): SavedDraftDetail {
  const originalText = row.original.bytes === null ? null : jsonText(row.original.bytes);
  const proposalText = row.proposal === null ? null : jsonText(row.proposal.bytes);
  const inventory = row.selectedResource.role.split('/')[0] === 'inventory';
  const reason = inventory ? 'Saved inventory remains read-only.'
    : row.original.bytes === null || row.original.sha256 === null || row.original.revision === null
      ? 'Exact original bytes, hash or revision are unavailable.'
      : originalText === null || row.proposal !== null && proposalText === null
        ? 'This editor requires byte-faithful UTF-8 JSON within 1 MiB.' : null;
  return { ...summary(row), originalSha256: row.original.sha256, originalBytes: row.original.bytes?.byteLength ?? null,
    resourceSha256: row.selectedResource.sha256, manifestSha256: row.manifest.sha256,
    proposalSha256: row.proposal?.sha256 ?? null, originalText, proposalText,
    canEdit: reason === null, editorReason: reason, version };
}

/** All resource/storage reads require an explicit action after
 * the caller chooses a local partition. Store ownership stays with the caller. */
export function createSavedLocalEditAdapter(
  selection: SavedHouseSelection, localPartitionId: string, store: LocalEditRetentionStore,
): SavedLocalEditAdapter {
  const house = structuredClone(selection.house);
  const context = { scope: house.scope, savedKey: house.key, snapshotId: house.snapshotId, localRevision: house.localRevision };
  const controller = createLocalEditRetentionController(localPartitionId, store);
  let active = true, generation = 0, version = 0, rows: LocalEditDraft[] = [];
  let handle: LocalEditSelectionController | null = null, selectedKey: string | null = null, busy = false, uncertain = false;
  let evidence: VerifiedRetainedIdentities | null = null, candidateKey: string | null = null;
  const listeners = new Set<() => void>();
  let state: SavedDraftSnapshot = frozen({ localPartitionId, context: structuredClone(context), status: 'idle',
    summaries: [], selectedKey: null, detail: null, outcome: null, message: null,
    candidates: [], candidateStatus: 'idle', candidateMessage: null, selectedCandidate: null, canRetain: false });
  const current = () => active && !selection.signal.aborted && selection.isCurrent();
  const owns = (ticket: number) => ticket === generation && current();
  function publish(patch: Partial<SavedDraftSnapshot>): void {
    state = frozen({ ...state, ...structuredClone(patch) });
    for (const listener of [...listeners]) { try { listener(); } catch { /* Observers do not own storage outcomes. */ } }
  }
  function closeDetail(): number {
    // Capture before notifying: a subscriber may retire or replace this allocation.
    const ticket = ++generation;
    handle?.retire(); controller.retire(); handle = null; selectedKey = null; candidateKey = null; busy = false; uncertain = false;
    if (state.candidateStatus === 'reading') evidence = null;
    publish({ status: current() ? 'listed' : 'retired', selectedKey: null, detail: null, outcome: null, message: null,
      selectedCandidate: null, canRetain: false,
      candidateStatus: state.candidateStatus === 'reading' ? 'idle' : state.candidateStatus });
    return ticket;
  }
  function retire(): void {
    if (!active) return;
    active = false; generation++; handle?.retire(); controller.retire(); handle = null; selectedKey = null;
    busy = false; rows = []; evidence = null; candidateKey = null; selection.signal.removeEventListener('abort', retire);
    publish({ status: 'retired', summaries: [], selectedKey: null, detail: null, outcome: null, message: null,
      candidates: [], candidateStatus: 'idle', candidateMessage: null, selectedCandidate: null, canRetain: false });
  }
  selection.signal.addEventListener('abort', retire, { once: true });
  if (!current()) retire();
  async function admitted(row: LocalEditDraft): Promise<void> {
    need(row.localPartitionId === localPartitionId && row.scope.workspaceId === context.scope.workspaceId
      && row.scope.homeId === context.scope.homeId && row.savedKey === context.savedKey
      && row.snapshotId === context.snapshotId && row.localRevision === context.localRevision);
    need(house.resources.some(pin => resourceKey(pin) === resourceKey(row.selectedResource)));
    need(equalBytes(row.manifest.bytes, house.manifest) && await digest(house.manifest) === row.manifest.sha256);
  }
  async function run(action: 'read' | 'retain' | 'save' | 'reset' | 'discard', text?: string): Promise<LocalEditResult | null> {
    if (!current() || busy || !handle || !selectedKey || uncertain && action !== 'read') return null;
    if (action === 'retain' && (!candidateKey || !state.canRetain)) return null;
    let proposal: ArrayBuffer | null = null;
    if (action === 'save') {
      try {
        need(state.detail?.canEdit && typeof text === 'string');
        proposal = new TextEncoder().encode(text).buffer;
        need(jsonText(proposal) === text);
      } catch {
        publish({ message: 'Enter complete byte-faithful UTF-8 JSON within 1 MiB.' }); return null;
      }
    }
    const ticket = generation, owned = handle, key = selectedKey;
    busy = true; publish({ status: action === 'read' ? 'opening' : 'pending', selectedKey: key, outcome: null, message: null, canRetain: false });
    if (!owns(ticket)) return null;
    let observed: LocalEditResult | null = null;
    try {
      const result = action === 'read' ? await owned.read() : action === 'retain' ? await owned.retain() : action === 'save' ? await owned.setProposal(proposal!)
        : action === 'reset' ? await owned.resetProposal() : await owned.discard();
      observed = result;
      if (!owns(ticket)) return result;
      const { draft, ...outcome } = result;
      if (result.completion === 'verified' && result.published) {
        if (draft !== null) { await admitted(draft); if (!owns(ticket)) return result; need(draftKey(draft) === key); }
        if (!owns(ticket)) return result;
        rows = rows.filter(row => draftKey(row) !== key);
        if (draft !== null) rows.push(structuredClone(draft));
        uncertain = false;
        publish({ status: 'ready', summaries: rows.map(summary), detail: draft === null ? null : detail(draft, ++version),
          outcome, canRetain: action === 'read' && draft === null && candidateKey !== null,
          message: action === 'retain' ? 'Local draft retained; not submitted.' : action === 'discard' ? 'Local draft discarded; no native record changed.'
            : action === 'read' ? draft === null ? 'No retained local draft at this selection.' : 'Retained local draft read.'
              : action === 'reset' ? 'Local proposal reset; original unchanged.' : 'Local proposal saved; not submitted.' });
      } else {
        // A failed read cannot resolve a previous uncertain write.
        uncertain ||= result.completion === 'completion-unconfirmed';
        publish({ status: uncertain ? 'completion-unconfirmed' : 'unavailable', detail: null, outcome,
          message: uncertain ? 'Local write completion is unconfirmed. Read local draft before another write; no safe retry is established.'
            : 'The retained local draft is unavailable. Read local draft to inspect it.' });
      }
      return result;
    } catch {
      if (owns(ticket)) {
        uncertain ||= action !== 'read';
        publish({ status: uncertain ? 'completion-unconfirmed' : 'unavailable', detail: null,
          message: uncertain ? 'Local write completion is unconfirmed. Read local draft before another write; no safe retry is established.'
            : 'The retained local draft could not be verified for this saved copy.' });
      }
      // Preserve the controller's original completion/attribution for the caller
      // even if additional selected-copy admission could not be confirmed.
      return observed;
    } finally { if (owns(ticket)) busy = false; }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async list() {
      if (!current() || busy) return;
      const ticket = closeDetail();
      if (!owns(ticket)) return;
      busy = true; rows = [];
      publish({ status: 'listing', summaries: [], message: null });
      if (!owns(ticket)) return;
      try {
        const found = await store.list(structuredClone(context));
        if (!owns(ticket)) return;
        for (const row of found) { await admitted(row); if (!owns(ticket)) return; }
        if (!owns(ticket)) return;
        rows = structuredClone([...found]); publish({ status: 'listed', summaries: rows.map(summary) });
      } catch { if (owns(ticket)) publish({ status: 'unavailable', summaries: [], message: 'Local drafts are unavailable or do not match this saved copy.' }); }
      finally { if (owns(ticket)) busy = false; }
    },
    async readCandidates() {
      if (!current() || busy || uncertain) return;
      const ticket = ++generation;
      // Candidate admission is independent of retained row reading/editing.
      candidateKey = null; busy = true; evidence = null;
      publish({ candidateStatus: 'reading', candidates: [], candidateMessage: null,
        selectedCandidate: null, canRetain: false });
      if (!owns(ticket)) return;
      try {
        need(selection.resources);
        const found = await readRetainedIdentityCandidates(selection.resources, house, () => owns(ticket));
        if (!owns(ticket)) return;
        evidence = found;
        publish({ candidateStatus: 'ready', candidates: found.candidates,
          candidateMessage: found.candidates.length === 0 ? 'No included identity originals are available for retention.'
            : `${found.candidates.length} verified saved identity originals; ${found.omitted} oversized originals omitted.` });
      } catch {
        if (owns(ticket)) publish({ candidateStatus: 'unavailable', candidates: [],
          candidateMessage: 'Exact saved identity evidence is unavailable or could not be verified. Existing local drafts remain readable.' });
      } finally { if (owns(ticket)) busy = false; }
    },
    async chooseCandidate(key) {
      if (!current() || busy || !evidence || !state.candidates.some(candidate => candidate.key === key)) return null;
      const input = evidence.input(key);
      const ticket = closeDetail();
      if (!owns(ticket)) return null;
      candidateKey = key;
      selectedKey = JSON.stringify([resourceKey(input.selectedResource), input.recordIdentity.recordType, input.recordIdentity.recordId]);
      publish({ selectedCandidate: key, selectedKey });
      if (!owns(ticket)) return null;
      handle = controller.select(input);
      if (!owns(ticket)) { handle.retire(); return null; }
      // Read the selected local key first. An existing row is opened, never
      // overwritten; only a verified absent read enables explicit retention.
      return run('read');
    },
    retain: () => run('retain'),
    async open(key) {
      if (!current() || busy) return null;
      const row = rows.find(value => draftKey(value) === key);
      if (!row) return null;
      const ticket = closeDetail();
      if (!owns(ticket)) return null;
      selectedKey = key; handle = controller.select(structuredClone(row));
      if (!owns(ticket)) { handle.retire(); return null; }
      return run('read');
    },
    read: () => run('read'), saveProposal: text => run('save', text),
    resetProposal: () => run('reset'), discard: () => run('discard'),
    closeDetail: () => { closeDetail(); }, dispose: retire,
  };
}
