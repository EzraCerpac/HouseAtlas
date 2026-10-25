import { syncMode } from './preference.ts';
import { lookupEntry, sendEntry, type LookupOutcome } from './send.ts';
import type { OutboxStore } from './store.ts';
import type { OutboxContext, OutboxEntry, OutboxKind, OutboxSubmission } from './types.ts';

export interface OutboxSnapshot {
  /** Oldest first, including recently synced entries. */
  readonly entries: readonly OutboxEntry[];
  /** Waiting to send, or being sent now. */
  readonly waiting: number;
  readonly needsYou: number;
  readonly syncing: boolean;
  /** False until the stored entries have been read once. */
  readonly loaded: boolean;
}
export interface Outbox {
  getSnapshot(): OutboxSnapshot;
  subscribe(changed: () => void): () => void;
  /** The signed-in person and home that may send now; null while signed out,
   * between homes, or in the Saved viewer. */
  configure(context: OutboxContext | null): void;
  register(kind: string, adapter: OutboxKind): void;
  /** Queues a prepared edit and, when the server is reachable, sends it at
   * once: pressing Save is asking. Resolves with the entry as it stands after
   * that attempt, whether synced, still waiting or needing the person. */
  submit(submission: OutboxSubmission): Promise<OutboxEntry>;
  /** Sends what is waiting. Automatic mode calls this on its own; "When I
   * ask" waits for the person to press Send, which passes force. */
  drain(options?: { force?: boolean }): Promise<void>;
  current(id: string, signal: AbortSignal): Promise<string | null>;
  /** Prepares the person's version again against the current record, with a
   * new request identity, and sends it. */
  keepMine(id: string, signal: AbortSignal): Promise<void>;
  /** Drops the person's version; the record stays as it is on the server. */
  useTheirs(id: string): Promise<void>;
  /** Reads the stored entries again, as after another tab changed them. */
  reload(): Promise<void>;
}
export interface OutboxOptions {
  readonly store: OutboxStore;
  readonly transport?: typeof fetch;
  readonly now?: () => number;
  /** Serializes sending across tabs. Absent: this page is the only sender. */
  readonly lock?: <T>(work: () => Promise<T>) => Promise<T | null>;
  /** Tells other tabs that the stored entries changed. */
  readonly announce?: () => void;
  /** The server answered 401 during a send. */
  readonly signedOut?: () => void;
  readonly lookup?: (entry: OutboxEntry, context: OutboxContext) => Promise<LookupOutcome>;
}
/** Synced entries kept for the recent list in Settings. */
export const KEEP_SYNCED = 20;

const targetKey = (entry: OutboxEntry) => `${entry.owner.workspaceId}/${entry.owner.homeId}/${entry.target.recordType}/${entry.target.recordId}`;
const owns = (entry: OutboxEntry, context: OutboxContext) => entry.owner.actorId === context.actorId
  && entry.owner.workspaceId === context.workspaceId && entry.owner.homeId === context.homeId;

export function createOutbox(options: OutboxOptions): Outbox {
  const { store, transport = fetch, lookup = (entry, active) => lookupEntry(entry, active, transport), now = Date.now, lock = work => work(), announce = () => {}, signedOut = () => {} } = options;
  const listeners = new Set<() => void>(), kinds = new Map<string, OutboxKind>();
  let entries: OutboxEntry[] = [], context: OutboxContext | null = null, syncing = false, loaded = false;
  let snapshot: OutboxSnapshot = { entries, waiting: 0, needsYou: 0, syncing, loaded };
  let draining: Promise<void> | null = null, again = false;

  function publish(): void {
    snapshot = { entries, syncing, loaded,
      waiting: entries.filter(entry => entry.state === 'waiting' || entry.state === 'sending').length,
      needsYou: entries.filter(entry => entry.state === 'needs-you').length };
    for (const changed of [...listeners]) changed();
  }
  async function reload(): Promise<void> {
    entries = await store.list(); loaded = true; publish();
  }
  async function save(entry: OutboxEntry): Promise<OutboxEntry> {
    await store.put(entry);
    entries = [...entries.filter(row => row.id !== entry.id), entry].sort((a, b) => a.seq - b.seq);
    publish(); announce();
    return entry;
  }
  async function remove(id: string): Promise<void> {
    await store.remove(id);
    entries = entries.filter(row => row.id !== id);
    publish(); announce();
  }
  const settled = () => new Date(now()).toISOString();

  /** One pass over the queue, oldest first. A refused entry holds back later
   * edits to the same record until the person decides; an unreachable server
   * ends the pass and leaves everything queued as it was. */
  async function pass(active: OutboxContext): Promise<void> {
    const rows = await store.list();
    entries = rows; loaded = true; publish();
    const held = new Set(rows.filter(row => row.state === 'needs-you').map(targetKey));
    for (const row of rows) {
      if (row.state !== 'waiting' && row.state !== 'sending') continue;
      if (!owns(row, active) || held.has(targetKey(row))) continue;
      if (context !== active) return;
      if (row.sent) {
        const found = await lookup(row, active);
        if (found === 'later') return;
        if (found === 'committed') {
          await save({ ...row, state: 'synced', problem: null, settledAt: settled() });
          continue;
        }
      }
      // Record the dispatch before it happens: a tab closed mid-send leaves an
      // entry that is looked up before it is sent again.
      await save({ ...row, state: 'sending', sent: true });
      const outcome = await sendEntry(row, active, transport);
      if (outcome.kind === 'committed') {
        await save({ ...row, state: 'synced', sent: true, problem: null, settledAt: settled() });
      } else if (outcome.kind === 'problem') {
        held.add(targetKey(row));
        await save({ ...row, state: 'needs-you', sent: true, problem: outcome.problem, settledAt: settled() });
      } else {
        await save({ ...row, state: 'waiting', sent: true });
        if (outcome.signedOut) signedOut();
        return;
      }
    }
    const synced = entries.filter(row => row.state === 'synced');
    for (const row of synced.slice(0, Math.max(0, synced.length - KEEP_SYNCED))) await remove(row.id);
  }
  async function drain({ force = false } = {}): Promise<void> {
    if (!force && syncMode() === 'ask') return;
    if (draining) { again = true; return draining; }
    draining = (async () => {
      do {
        again = false;
        const active = context;
        if (!active) break;
        syncing = true; publish();
        try { await lock(() => pass(active)); }
        catch { /* Storage failed; queued entries stay as they are. */ }
        finally { syncing = false; publish(); }
      } while (again);
    })().finally(() => { draining = null; });
    return draining;
  }
  function adapter(entry: OutboxEntry): OutboxKind {
    const kind = kinds.get(entry.kind);
    if (!kind) throw new Error('This change can only be reviewed in the app that made it');
    return kind;
  }
  const find = (id: string) => {
    const entry = entries.find(row => row.id === id);
    if (!entry) throw new Error('This change is no longer queued');
    return entry;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(changed) { listeners.add(changed); return () => { listeners.delete(changed); }; },
    configure(next) {
      const same = next && context && next.actorId === context.actorId && next.csrfToken === context.csrfToken
        && next.workspaceId === context.workspaceId && next.homeId === context.homeId;
      if (same) return;
      context = next;
      if (next) void drain();
    },
    register(kind, value) { kinds.set(kind, value); },
    async submit(submission) {
      const owner = context;
      if (!owner) throw new Error('Sign in to save this change');
      if (!loaded) await reload();
      const seq = Math.max(now(), (entries.at(-1)?.seq ?? 0) + 1);
      const entry = await save({ ...submission, id: crypto.randomUUID(), seq,
        owner: { actorId: owner.actorId, workspaceId: owner.workspaceId, homeId: owner.homeId },
        createdAt: new Date(now()).toISOString(), state: 'waiting', sent: false, problem: null, settledAt: null });
      await drain({ force: true });
      return entries.find(row => row.id === entry.id) ?? entry;
    },
    drain,
    current: (id, signal) => { const entry = find(id); return adapter(entry).current(entry, signal); },
    async keepMine(id, signal) {
      const entry = find(id);
      const fresh = await adapter(entry).rebase(entry, signal);
      signal.throwIfAborted();
      await save({ ...entry, ...fresh, state: 'waiting', sent: false, problem: null, settledAt: null });
      await drain({ force: true });
    },
    useTheirs: id => remove(find(id).id),
    reload,
  };
}
