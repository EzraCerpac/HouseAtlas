import { useEffect, useSyncExternalStore } from 'react';
import { createOutbox, type Outbox, type OutboxSnapshot } from './outbox.ts';
import { subscribeSyncMode, syncMode } from './preference.ts';
import { openOutboxStore } from './store.ts';

export type { Outbox, OutboxSnapshot } from './outbox.ts';
export type { OutboxContext, OutboxEntry, OutboxKind, OutboxProblem, OutboxSubmission } from './types.ts';

/** While anything waits, the page checks this often whether the server is
 * back, on top of the browser's online and visibility events. */
export const RETRY_INTERVAL_MS = 30_000;
const CHANNEL = 'houseatlas-outbox';
let shared: Outbox | null = null;

/** This page's outbox over the device's shared store. Tabs take turns to
 * send through a Web Lock and tell each other when the stored entries change.
 * Starts reading the store and listening on first use; no network until a
 * signed-in host calls configure. */
export function getOutbox(): Outbox {
  if (shared) return shared;
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  const outbox = createOutbox({
    store: openOutboxStore(),
    announce: () => channel?.postMessage('changed'),
    // Waiting for the lock, not skipping it, keeps a Save or Send now made
    // while another tab sends: it runs as soon as that tab is done.
    ...(locks ? { lock: work => locks.request(CHANNEL, work) } : {}),
  });
  shared = outbox;
  channel?.addEventListener('message', () => { void outbox.reload().catch(() => undefined); });
  void outbox.reload().catch(() => undefined);
  const retry = () => { if (outbox.getSnapshot().waiting > 0) void outbox.drain(); };
  addEventListener('online', retry);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retry(); });
  setInterval(retry, RETRY_INTERVAL_MS);
  subscribeSyncMode(() => { if (syncMode() === 'automatic') retry(); });
  return outbox;
}

const empty: OutboxSnapshot = { entries: [], waiting: 0, needsYou: 0, syncing: false, loaded: false };
const noop = () => () => {};
export function useOutbox(outbox: Outbox | null = getOutbox()): OutboxSnapshot {
  return useSyncExternalStore(outbox?.subscribe ?? noop, outbox?.getSnapshot ?? (() => empty), () => empty);
}

/** Reloads a view when edits of these kinds reach the server in the
 * background, so a change that synced on reconnect shows up without a reload. */
export function useOutboxSynced(kinds: readonly string[], reload: () => void, outbox: Outbox = getOutbox()): void {
  const key = kinds.join('\n');
  useEffect(() => outbox.onSynced(entries => {
    if (entries.some(entry => key.split('\n').includes(entry.kind))) reload();
  }), [key, reload, outbox]);
}
