import type {
  LocalEditDraft, LocalEditInput, LocalEditOriginal, LocalEditRetentionStore, LocalEditSelection,
} from './types.ts';

export type LocalEditAction = 'read' | 'retain' | 'set-proposal' | 'reset-proposal' | 'discard';
export interface LocalEditAttribution {
  readonly localPartitionId: string;
  /** Memory-only selection generation, never an operation or idempotency ID. */
  readonly selectionGeneration: number;
  readonly selection: LocalEditSelection;
}
export interface LocalEditResult extends LocalEditAttribution {
  readonly action: LocalEditAction;
  readonly completion: 'verified' | 'unavailable' | 'in-progress' | 'retired' | 'completion-unconfirmed';
  /** False if this result belongs to a selection that has since been retired. */
  readonly published: boolean;
  readonly draft: LocalEditDraft | null;
  readonly discarded: boolean | null;
}
export interface LocalEditSnapshot {
  readonly localPartitionId: string;
  readonly nativeAuthority: 'not-established';
  readonly currentBase: 'not-checked';
  readonly status: 'idle' | 'selected' | 'pending' | 'ready' | 'unavailable' | 'completion-unconfirmed' | 'retired';
  readonly attribution: LocalEditAttribution | null;
  readonly action: LocalEditAction | null;
  readonly draft: LocalEditDraft | null;
  /** Exact retained evidence availability only; never typed/native edit admission. */
  readonly originalAvailability: 'available' | 'unavailable';
}
export interface LocalEditSelectionController {
  read(): Promise<LocalEditResult>;
  retain(): Promise<LocalEditResult>;
  setProposal(bytes: ArrayBuffer): Promise<LocalEditResult>;
  resetProposal(): Promise<LocalEditResult>;
  discard(): Promise<LocalEditResult>;
  /** Clear memory publication only. Pending storage is not cancelled or undone. */
  retire(): void;
}
export interface LocalEditRetentionController {
  /** Detached on every call, including buffers. No React mounting is implied. */
  getSnapshot(): LocalEditSnapshot;
  subscribe(listener: () => void): () => void;
  /** Select synchronously, with no storage read or automatic retention. The
   * returned handle stays bound to this allocation even after another selection. */
  select(input: LocalEditInput): LocalEditSelectionController;
  retire(): void;
}

function need(value: unknown): asserts value {
  if (!value) throw new Error('The selected local edit result could not be verified');
}
function selected(input: LocalEditSelection): LocalEditSelection {
  return { scope: input.scope, savedKey: input.savedKey, snapshotId: input.snapshotId,
    localRevision: input.localRevision, selectedResource: input.selectedResource, recordIdentity: input.recordIdentity };
}
/** Compare the exact selection tuple without depending on object key order. */
function tuple(value: LocalEditSelection): string {
  const p = value.selectedResource;
  return JSON.stringify([value.scope.workspaceId, value.scope.homeId, value.savedKey, value.snapshotId,
    value.localRevision, p.id, p.role, p.label, p.sha256, p.bytes, p.contentType,
    p.record === undefined ? [] : p.record === null ? null : [p.record.recordType, p.record.recordId, p.record.revision],
    value.recordIdentity.recordType, value.recordIdentity.recordId]);
}
function equalBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a), y = new Uint8Array(b);
  return x.every((byte, index) => byte === y[index]);
}
function sameOriginal(a: LocalEditOriginal, b: LocalEditOriginal): boolean {
  return a.sha256 === b.sha256 && a.revision === b.revision
    && (a.bytes === null ? b.bytes === null : b.bytes !== null && equalBytes(a.bytes, b.bytes));
}
async function digest(value: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function hasOriginal(draft: LocalEditDraft | null): boolean {
  return draft !== null && draft.original.bytes !== null && draft.original.sha256 !== null && draft.original.revision !== null;
}
interface Generation {
  readonly attribution: LocalEditAttribution;
  readonly input: LocalEditInput;
  draft: LocalEditDraft | null;
  busy: boolean;
  needsRead: boolean;
}

/** Local-only controller. The caller owns a store already bound to the explicit
 * partition and must close it separately. This partition is data isolation,
 * never actor/session/grant authority. Retirement never cleans up stored rows.
 * Browser-managed retention is neither a backup nor device-durability evidence. */
export function createLocalEditRetentionController(
  localPartitionId: string, store: LocalEditRetentionStore,
): LocalEditRetentionController {
  need(typeof localPartitionId === 'string' && localPartitionId.length > 0
    && localPartitionId.length <= 64 * 1024 && !/[\u0000-\u001f\u007f]/.test(localPartitionId));
  let current: Generation | null = null, sequence = 0;
  const listeners = new Set<() => void>();
  const empty = (status: 'idle' | 'retired'): LocalEditSnapshot => ({ localPartitionId,
    nativeAuthority: 'not-established', currentBase: 'not-checked', status,
    attribution: null, action: null, draft: null, originalAvailability: 'unavailable' });
  let snapshot = empty('idle');
  const notify = () => {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* An observer cannot change a storage outcome. */ }
    }
  };
  const isCurrent = (generation: Generation) => current === generation;
  function publish(generation: Generation, status: LocalEditSnapshot['status'], action: LocalEditAction | null): boolean {
    if (!isCurrent(generation)) return false;
    snapshot = { localPartitionId, nativeAuthority: 'not-established', currentBase: 'not-checked', status,
      attribution: generation.attribution, action, draft: status === 'ready' ? generation.draft : null,
      originalAvailability: status === 'ready' && hasOriginal(generation.draft) ? 'available' : 'unavailable' };
    notify(); return isCurrent(generation);
  }
  function result(generation: Generation, action: LocalEditAction, completion: LocalEditResult['completion'],
    published = false, draft: LocalEditDraft | null = null, discarded: boolean | null = null): LocalEditResult {
    return structuredClone({ ...generation.attribution, action, completion, published, draft, discarded });
  }
  async function verify(generation: Generation, draft: LocalEditDraft, original?: LocalEditOriginal): Promise<void> {
    need(draft.localPartitionId === localPartitionId && tuple(draft) === tuple(generation.attribution.selection)
      && draft.nativeAuthority === 'not-established' && draft.currentBase === 'not-checked');
    need(draft.manifest.sha256 === generation.input.manifest.sha256
      && equalBytes(draft.manifest.bytes, generation.input.manifest.bytes)
      && await digest(draft.manifest.bytes) === draft.manifest.sha256);
    if (original) need(sameOriginal(draft.original, original));
    if (draft.original.bytes !== null) need(await digest(draft.original.bytes) === draft.original.sha256);
    if (draft.proposal !== null) need(await digest(draft.proposal.bytes) === draft.proposal.sha256);
  }
  async function run(generation: Generation, action: LocalEditAction, bytes?: ArrayBuffer): Promise<LocalEditResult> {
    if (!isCurrent(generation)) return result(generation, action, 'retired');
    if (generation.busy) return result(generation, action, 'in-progress');
    if (action !== 'read' && (generation.needsRead
      || action === 'retain' && generation.draft !== null
      || action !== 'retain' && generation.draft === null
      || action === 'set-proposal' && !hasOriginal(generation.draft))) {
      return result(generation, action, 'unavailable');
    }
    generation.busy = true;
    // Previous verified evidence and caller bytes are captured before awaiting.
    const previous = generation.draft;
    let dispatched = false;
    try {
      const proposal = bytes === undefined ? undefined : bytes.slice(0);
      publish(generation, 'pending', action);
      // A synchronous observer may have retired/replaced the allocation.
      if (!isCurrent(generation)) return result(generation, action, 'retired');
      const selection = structuredClone(generation.attribution.selection);
      let draft: LocalEditDraft | null = null, discarded: boolean | null = null;
      dispatched = true;
      if (action === 'read') {
        draft = await store.get(selection);
        // Read restores the retained original; never replace it with a parsed
        // caller projection, even if that caller currently lacks original bytes.
        if (draft !== null) await verify(generation, draft);
      } else if (action === 'retain') {
        await store.retain(structuredClone(generation.input));
        // Retain verifies its input before writing. Read the committed row and
        // verify its exact documentary base before publishing retention success.
        draft = await store.get(selection); need(draft);
        await verify(generation, draft, generation.input.original); need(draft.proposal === null);
      } else if (action === 'discard') {
        discarded = await store.discard(selection);
        need(await store.get(selection) === null);
      } else {
        need(previous);
        if (action === 'set-proposal') {
          need(proposal); draft = await store.setProposal(selection, proposal);
          need(draft.proposal !== null && equalBytes(draft.proposal.bytes, proposal));
        } else {
          draft = await store.resetProposal(selection); need(draft.proposal === null);
        }
        await verify(generation, draft, previous.original);
      }
      // There is no asynchronous work inside an active store transaction.
      generation.draft = structuredClone(draft); generation.needsRead = false;
      const published = publish(generation, 'ready', action);
      return result(generation, action, 'verified', published, draft, discarded);
    } catch {
      // A rejected mutation (including verification after commit) proves neither
      // rollback nor safe retry. Clear publication; require an explicit read.
      const unconfirmed = action !== 'read' && dispatched;
      generation.draft = null; generation.needsRead = true;
      const completion = unconfirmed ? 'completion-unconfirmed' : 'unavailable';
      const published = publish(generation, completion, action);
      return result(generation, action, completion, published);
    } finally { generation.busy = false; }
  }
  function retire(generation: Generation | null): void {
    if (generation === null || !isCurrent(generation)) return;
    current = null; generation.draft = null;
    snapshot = empty('retired'); notify();
  }
  return {
    getSnapshot: () => structuredClone(snapshot),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    select(input) {
      // No catalog parsing, canonicalization, aggregate hashes or source reads.
      const copy = structuredClone(input);
      need(sequence < Number.MAX_SAFE_INTEGER);
      const generation: Generation = { input: copy, draft: null, busy: false, needsRead: false,
        attribution: { localPartitionId, selectionGeneration: ++sequence, selection: selected(copy) } };
      current = generation; publish(generation, 'selected', null);
      return Object.freeze({
        read: () => run(generation, 'read'), retain: () => run(generation, 'retain'),
        setProposal: (bytes: ArrayBuffer) => run(generation, 'set-proposal', bytes),
        resetProposal: () => run(generation, 'reset-proposal'), discard: () => run(generation, 'discard'),
        retire: () => retire(generation),
      });
    },
    retire: () => retire(current),
  };
}
