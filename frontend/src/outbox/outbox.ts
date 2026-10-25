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
  /** Whether Keep mine can prepare this entry again here. */
  canKeepMine(id: string): boolean;
  /** Whether the signed-in person may decide about this entry: only the
   * account and home that made it can keep or discard it. */
  isMine(id: string): boolean;
  /** Entries that reached the server in the background (on reconnect, Send
   * now or Keep mine), once per pass, so views of those records can reload.
   * A Save that syncs at once refreshes its own view instead. */
  onSynced(listener: (entries: readonly OutboxEntry[]) => void): () => void;
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
  /** Serializes sending across tabs, waiting for another tab's pass to end.
   * Absent: this page is the only sender. */
  readonly lock?: <T>(work: () => Promise<T>) => Promise<T>;
  /** Tells other tabs that the stored entries changed. */
  readonly announce?: () => void;
  /** The server answered 401 during a send. */
  readonly signedOut?: () => void;
  readonly lookup?: (entry: OutboxEntry, context: OutboxContext) => Promise<LookupOutcome>;
}
/** Synced entries kept for the recent list in Settings. */
export const KEEP_SYNCED = 20;

const targetKey = (entry: OutboxEntry) => `${entry.owner.workspaceId}/${entry.owner.homeId}/${entry.target.recordType}/${entry.target.recordId}`;
/** Which waiting entries a pass may send: all, or those the person asked
 * for by saving them in "When I ask" mode. */
type Scope = 'all' | ReadonlySet<string>;

const owns = (entry: OutboxEntry, context: OutboxContext) => entry.owner.actorId === context.actorId
  && entry.owner.workspaceId === context.workspaceId && entry.owner.homeId === context.homeId;

export function createOutbox(options: OutboxOptions): Outbox {
  const { store, transport = fetch, lookup = (entry, active) => lookupEntry(entry, active, transport), now = Date.now, lock = work => work(), announce = () => {}, signedOut = () => {} } = options;
  const listeners = new Set<() => void>(), kinds = new Map<string, OutboxKind>();
  const syncedListeners = new Set<(entries: readonly OutboxEntry[]) => void>(), immediate = new Set<string>();
  let entries: OutboxEntry[] = [], context: OutboxContext | null = null, syncing = false, loaded = false;
  let snapshot: OutboxSnapshot = { entries, waiting: 0, needsYou: 0, syncing, loaded };
  // Sends the person asked for, and whether an automatic retry is due.
  let draining: Promise<void> | null = null, asked: Scope | null = null, automatic = false;

  function publish(): void {
    snapshot = { entries, syncing, loaded,
      waiting: entries.filter(entry => entry.state === 'waiting' || entry.state === 'sending').length,
      needsYou: entries.filter(entry => entry.state === 'needs-you').length };
    for (const changed of [...listeners]) changed();
  }
  function notifySynced(rows: readonly OutboxEntry[]): void {
    if (rows.length) for (const listener of [...syncedListeners]) listener(rows);
  }
  /** Takes the stored entries as they are now. Entries another tab synced
   * since this one last looked, including ones it never saw waiting, are
   * reported like this tab's own; the first read reports nothing. */
  function adopt(rows: OutboxEntry[]): void {
    const before = new Map(entries.map(row => [row.id, row.state])), hydrated = loaded;
    entries = rows; loaded = true; publish();
    if (hydrated) notifySynced(rows.filter(row => row.state === 'synced' && before.get(row.id) !== 'synced'));
  }
  async function reload(): Promise<void> {
    adopt(await store.list());
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
  async function pass(active: OutboxContext, scope: Scope): Promise<void> {
    const rows = await store.list();
    adopt(rows);
    // Only this person's decisions hold their edits; another account's
    // conflict on a shared browser does not.
    const held = new Set(rows.filter(row => row.state === 'needs-you' && owns(row, active)).map(targetKey));
    // Earlier edits to a record the person asked to send go first.
    const targets = scope === 'all' ? null : new Set(rows.filter(row => scope.has(row.id)).map(targetKey));
    const background: OutboxEntry[] = [];
    try {
      for (const row of rows) {
        if (row.state !== 'waiting' && row.state !== 'sending') continue;
        if (!owns(row, active) || held.has(targetKey(row)) || (targets && !targets.has(targetKey(row)))) continue;
        if (context !== active) return;
        const synced = async () => {
          const done = await save({ ...row, state: 'synced', sent: true, problem: null, settledAt: settled() });
          if (!immediate.has(row.id)) background.push(done);
        };
        if (row.sent) {
          const found = await lookup(row, active);
          // A session that changed meanwhile (sign-out, rotation) makes the
          // answer unreliable: its refusal may only be the old token's.
          if (found === 'later' || context !== active) return;
          if (found === 'committed') { await synced(); continue; }
          if (found === 'unconfirmed') {
            // Resending blindly could repeat a change the server can no longer
            // vouch for, so the person checks the record and dismisses it.
            held.add(targetKey(row));
            await save({ ...row, state: 'needs-you', problem: 'unconfirmed', settledAt: settled() });
            continue;
          }
        }
        // Record the dispatch before it happens: a tab closed mid-send leaves
        // an entry that is looked up before it is sent again.
        await save({ ...row, state: 'sending', sent: true });
        if (context !== active) return;
        const outcome = await sendEntry(row, active, transport);
        if (outcome.kind === 'problem' && context !== active) {
          // Refused under a session that has since been replaced: not final.
          await save({ ...row, state: 'waiting', sent: true });
          return;
        }
        if (outcome.kind === 'committed') {
          await synced();
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
    } finally {
      notifySynced(background);
    }
  }
  async function drain({ force = false, only }: { force?: boolean; only?: string } = {}): Promise<void> {
    if (!force && syncMode() === 'ask') return;
    if (!force) automatic = true;
    else asked = asked === 'all' || !only ? 'all' : new Set([...(asked ?? []), only]);
    if (draining) return draining;
    draining = (async () => {
      while (asked || automatic) {
        const requested = asked, retry = automatic, active = context;
        asked = null; automatic = false;
        if (!active) break;
        syncing = true; publish();
        // A retry that waited for another tab's send asks again: the person
        // may have chosen "When I ask" meanwhile.
        const scope = () => retry && syncMode() !== 'ask' ? 'all' : requested;
        try { await lock(async () => { const now = scope(); if (now) await pass(active, now); }); }
        catch { /* Storage failed; queued entries stay as they are. */ }
        finally { syncing = false; publish(); }
      }
    })().finally(() => { draining = null; });
    return draining;
  }
  /** Sends one entry the person just acted on; in "When I ask" mode nothing
   * else that waits goes with it. */
  const sendNow = (id: string) => drain(syncMode() === 'ask' ? { force: true, only: id } : { force: true });
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
  /** Applies a decision about a conflict only if the stored entry is still
   * the one the person saw, and in turn with sending, so a stale tab cannot
   * undo a decision another tab already made. */
  async function decide(seen: OutboxEntry, write: () => Promise<unknown>, signal?: AbortSignal): Promise<void> {
    const outcome = await lock(async () => {
      const stored = (await store.list()).find(row => row.id === seen.id);
      // Everything the decision rests on is checked again right before the
      // write: waiting for the lock may have outlasted it.
      signal?.throwIfAborted();
      if (!context || !owns(seen, context)) return 'not-mine';
      if (!stored || stored.state !== 'needs-you' || stored.requestId !== seen.requestId) return 'decided';
      await write();
      return 'done';
    });
    if (outcome === 'not-mine') throw new Error('Only the account that made this change can decide about it');
    if (outcome === 'decided') {
      await reload();
      throw new Error('This change was already decided on another tab');
    }
  }
  /** The entry, if the signed-in person may decide about it. */
  const mine = (id: string) => {
    const entry = find(id);
    if (!context || !owns(entry, context)) throw new Error('Only the account that made this change can decide about it');
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
      publish();
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
      immediate.add(entry.id);
      try { await sendNow(entry.id); } finally { immediate.delete(entry.id); }
      return entries.find(row => row.id === entry.id) ?? entry;
    },
    drain: options => drain(options),
    canKeepMine: id => { const entry = entries.find(row => row.id === id); return !!entry && kinds.has(entry.kind); },
    isMine: id => { const entry = entries.find(row => row.id === id); return !!entry && !!context && owns(entry, context); },
    onSynced(listener) { syncedListeners.add(listener); return () => { syncedListeners.delete(listener); }; },
    current: (id, signal) => { const entry = find(id); return adapter(entry).current(entry, signal); },
    async keepMine(id, signal) {
      const entry = mine(id);
      const fresh = await adapter(entry).rebase(entry, signal);
      signal.throwIfAborted();
      mine(id); // The person may have signed out while it was prepared.
      await decide(entry, () => save({ ...entry, ...fresh, state: 'waiting', sent: false, problem: null, settledAt: null }), signal);
      await sendNow(id);
    },
    useTheirs: async id => decide(mine(id), () => remove(id)),
    reload,
  };
}
