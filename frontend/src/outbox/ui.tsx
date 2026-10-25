import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../lantern/components/Icon';
import { Modal } from '../lantern/components/Modal';
import { getOutbox, useOutbox, type Outbox, type OutboxEntry } from './index.ts';
import { countLegacyDrafts, exportLegacyDrafts } from './legacy-drafts.ts';
import { setSyncMode, useSyncMode } from './preference.ts';
import './outbox.css';

const problemText: Readonly<Record<NonNullable<OutboxEntry['problem']>, string>> = {
  changed: 'Changed elsewhere after you edited it.',
  removed: 'This no longer exists on the server.',
  denied: 'Your account can no longer make this change.',
  rejected: 'The server did not accept this change.',
  unconfirmed: 'Sent, but the server can no longer say whether it arrived. Check the record, then discard this.',
};
const openers = new Set<() => void>();
/** Opens the list from anywhere, such as an editor inside Atlas tools, which
 * covers the header pill. */
export function openSyncSheet() { openers.forEach(open => open()); }

/** Live state of one queued change, for the editor that made it. */
export function QueuedNote({ id, outbox = getOutbox() }: { readonly id: string; readonly outbox?: Outbox }) {
  const entry = useOutbox(outbox).entries.find(row => row.id === id);
  if (!entry) return null;
  return <p role="status" aria-live="polite">
    {entry.state === 'synced' ? 'Synced with the server.'
      : entry.state === 'needs-you' ? <>{problemText[entry.problem ?? 'rejected']}{' '}
        <button type="button" className="btn" onClick={openSyncSheet}>Review changes</button></>
      : 'Saved on this device. It will sync when the server can be reached.'}
  </p>;
}

const time = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

/** Header pill: hidden while nothing waits, otherwise one short status that
 * opens the list of changes. */
export function SyncStatus({ outbox = getOutbox() }: { readonly outbox?: Outbox }) {
  const snapshot = useOutbox(outbox), [host, setHost] = useState<Element | null>(null), [justSynced, setJustSynced] = useState(false);
  const pending = useRef(0), anchor = useRef<HTMLSpanElement>(null);
  // An open dialog such as Atlas tools makes everything outside it inert, so
  // the sheet goes inside the topmost one; otherwise into the app root, above
  // the header's own stacking layer.
  const show = () => setHost([...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(dialog => !dialog.closest('[inert], [hidden]')).at(-1)
    ?? anchor.current?.closest('.lantern-host') ?? document.body);
  useEffect(() => { openers.add(show); return () => { openers.delete(show); }; }, []);
  useEffect(() => {
    const before = pending.current;
    pending.current = snapshot.waiting;
    if (before > 0 && snapshot.waiting === 0 && snapshot.needsYou === 0) {
      setJustSynced(true);
      const timer = setTimeout(() => setJustSynced(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [snapshot.waiting, snapshot.needsYou]);
  const label = snapshot.needsYou > 0 ? `${snapshot.needsYou} need${snapshot.needsYou === 1 ? 's' : ''} you`
    : snapshot.syncing ? 'Syncing…'
    : snapshot.waiting > 0 ? `${snapshot.waiting} waiting`
    : justSynced ? 'Synced' : null;
  return <>
    {label && <button type="button" className={`sync-pill${snapshot.needsYou > 0 ? ' is-attention' : ''}`}
      aria-label={`Changes on this device: ${label}`} onClick={show}>
      <Icon name={snapshot.needsYou > 0 ? 'alert' : justSynced && !snapshot.syncing ? 'check' : 'sync'} size={16} />
      <span>{label}</span>
    </button>}
    <span ref={anchor} hidden />
    {host && createPortal(<div className="lantern-host sync-layer">
      <SyncSheet outbox={outbox} onClose={() => setHost(null)} /></div>, host)}
  </>;
}

function NeedsYou({ entry, outbox }: { readonly entry: OutboxEntry; readonly outbox: Outbox }) {
  const [current, setCurrent] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  // Keep mine needs this app to know how to prepare the change again.
  const rebase = entry.problem === 'changed' && outbox.canKeepMine(entry.id);
  useEffect(() => {
    if (!rebase) return;
    const controller = new AbortController();
    outbox.current(entry.id, controller.signal).then(value => setCurrent(value), () => setCurrent(null));
    return () => controller.abort();
  }, [entry.id, rebase, outbox]);
  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch { setError('That did not work. Check the connection and try again.'); }
    finally { setBusy(false); }
  };
  return <li className="sync-row is-attention">
    <strong>{entry.label}</strong>
    <span>{problemText[entry.problem ?? 'rejected']}</span>
    {current && <span>Now: {current}</span>}
    {error && <span role="alert">{error}</span>}
    <div className="sync-actions">
      {rebase && <button type="button" className="btn btn-primary" disabled={busy}
        onClick={() => void act(() => outbox.keepMine(entry.id, AbortSignal.timeout(30_000)))}>Keep mine</button>}
      <button type="button" className="btn" disabled={busy} onClick={() => void act(() => outbox.useTheirs(entry.id))}>
        {rebase ? 'Use theirs' : 'Discard'}
      </button>
    </div>
  </li>;
}

/** Every change made on this device that has not settled, then the recent
 * ones that did. */
function SyncList({ outbox }: { readonly outbox: Outbox }) {
  const snapshot = useOutbox(outbox), mode = useSyncMode();
  const attention = snapshot.entries.filter(entry => entry.state === 'needs-you');
  const waiting = snapshot.entries.filter(entry => entry.state === 'waiting' || entry.state === 'sending');
  const synced = snapshot.entries.filter(entry => entry.state === 'synced').reverse();
  return <div className="sync-list">
    {attention.length > 0 && <section aria-label="Needs you"><h3>Needs you</h3>
      <ul>{attention.map(entry => <NeedsYou key={entry.id} entry={entry} outbox={outbox} />)}</ul></section>}
    {waiting.length > 0 && <section aria-label="Waiting"><h3>Waiting</h3>
      <p className="setting-static">{mode === 'ask' ? 'These go out when you press Send now.' : 'These go out as soon as the server can be reached.'}</p>
      <ul>{waiting.map(entry => <li key={entry.id} className="sync-row"><strong>{entry.label}</strong>
        <span>{entry.state === 'sending' ? 'Sending…' : `Saved on this device at ${time(entry.createdAt)}`}</span></li>)}</ul>
      <button type="button" className="btn" disabled={snapshot.syncing}
        onClick={() => void outbox.drain({ force: true })}>{snapshot.syncing ? 'Sending…' : 'Send now'}</button></section>}
    {synced.length > 0 && <details><summary>Recently synced ({synced.length})</summary>
      <ul>{synced.map(entry => <li key={entry.id} className="sync-row"><strong>{entry.label}</strong>
        <span>Synced at {time(entry.settledAt)}</span></li>)}</ul></details>}
    {attention.length + waiting.length + synced.length === 0 && <p className="setting-static">
      Nothing waiting. Changes you make while offline stay here until they reach the server.</p>}
  </div>;
}

export function SyncSheet({ outbox = getOutbox(), onClose }: { readonly outbox?: Outbox; readonly onClose: () => void }) {
  return <Modal title="Changes on this device" onClose={onClose}
    footer={<button type="button" className="btn btn-primary" onClick={onClose}>Done</button>}>
    <SyncList outbox={outbox} />
  </Modal>;
}

/** Settings → Sync: when queued changes go out, and the list of them. */
export function SyncSettings({ outbox = getOutbox() }: { readonly outbox?: Outbox }) {
  const mode = useSyncMode(), [legacy, setLegacy] = useState(0);
  useEffect(() => { let active = true; void countLegacyDrafts().then(count => { if (active) setLegacy(count); }); return () => { active = false; }; }, []);
  const download = async () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await exportLegacyDrafts());
    link.download = 'houseatlas-older-local-drafts.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  const values = ['automatic', 'ask'] as const;
  return <fieldset className="field">
    <legend>Sync</legend>
    <div className="seg" role="radiogroup" aria-label="Send changes">
      {([['automatic', 'Automatically'], ['ask', 'When I ask']] as const).map(([value, label]) => (
        <button key={value} type="button" role="radio" aria-checked={mode === value} tabIndex={mode === value ? 0 : -1}
          onKeyDown={event => {
            const index = values.indexOf(value);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1
              : ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key) ? (index + 1) % values.length : -1;
            if (next < 0) return;
            event.preventDefault();
            setSyncMode(values[next]!);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
          }}
          onClick={() => setSyncMode(value)}>{label}</button>
      ))}
    </div>
    <p className="setting-static">{mode === 'ask'
      ? 'Changes made offline wait until you press Send now. Changes elsewhere are never overwritten.'
      : 'Changes made offline go out when the server can be reached. Changes elsewhere are never overwritten.'}</p>
    <SyncList outbox={outbox} />
    {legacy > 0 && <p className="setting-static">
      {legacy} older {legacy === 1 ? 'draft' : 'drafts'} from the removed Local drafts tab {legacy === 1 ? 'is' : 'are'} still on this device and {legacy === 1 ? 'was' : 'were'} never sent.{' '}
      <button type="button" className="btn" onClick={() => void download()}>Download</button>
    </p>}
  </fieldset>;
}
