import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { createLocalEditRetentionStore } from './store';
import { createSavedLocalEditAdapter, type SavedDraftDetail, type SavedHouseSelection, type SavedLocalEditAdapter } from './saved-adapter';

const subscribeNone = () => () => {};
const noSnapshot = () => null;

function DraftDetail({ detail, adapter, disabled }: {
  readonly detail: SavedDraftDetail; readonly adapter: SavedLocalEditAdapter; readonly disabled: boolean;
}) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  const [text, setText] = useState(detail.proposalText ?? detail.originalText ?? '');
  useLayoutEffect(() => { heading.current?.focus(); }, []);
  useLayoutEffect(() => { setText(detail.proposalText ?? detail.originalText ?? ''); }, [detail.version]);
  return <article className="saved-catalog-detail" aria-label="Local draft details">
    <h3 ref={heading} tabIndex={-1}>{detail.recordType}: {detail.recordId}</h3>
    <p>Documentary supplied original; native authority not established. Current base not checked.</p>
    <details><summary>Documentary evidence</summary><dl>
      <div><dt>Original revision</dt><dd>{detail.revision ?? 'Unavailable'}</dd></div>
      <div><dt>Original SHA256</dt><dd>{detail.originalSha256 ?? 'Unavailable'}</dd></div>
      <div><dt>Original bytes</dt><dd>{detail.originalBytes ?? 'Unavailable'}</dd></div>
      <div><dt>Selected resource</dt><dd>{detail.resourceId}</dd></div>
      <div><dt>Resource SHA256</dt><dd>{detail.resourceSha256}</dd></div>
      <div><dt>Manifest SHA256</dt><dd>{detail.manifestSha256}</dd></div>
      <div><dt>Proposal SHA256</dt><dd>{detail.proposalSha256 ?? 'No proposal'}</dd></div>
    </dl></details>
    {detail.originalText !== null && <details><summary>Retained original JSON</summary>
      <pre className="saved-catalog-raw">{detail.originalText}</pre></details>}
    {detail.editorReason && <p role="status">{detail.editorReason}</p>}
    {detail.canEdit && <form className="session-form" onSubmit={event => {
      event.preventDefault(); void adapter.saveProposal(text);
    }}>
      <label><span>Local proposal JSON</span><textarea className="saved-catalog-raw" rows={12} value={text}
        disabled={disabled} onChange={event => setText(event.currentTarget.value)} /></label>
      <p>JSON syntax only; native field semantics are not validated.</p>
      <button type="submit" disabled={disabled}>Save local proposal</button>
    </form>}
    <div className="saved-catalog-original">
      <button type="button" disabled={disabled} onClick={() => { void adapter.resetProposal(); }}>Reset local proposal</button>
      <button type="button" disabled={disabled} onClick={() => { void adapter.discard(); }}>Discard local draft</button>
    </div>
  </article>;
}

/** Production owns only stores opened by the explicit space-choice form.
 * Injection supports existing shared owners and nonbrowser SSR; no injected
 * store is closed and rendering never performs a local storage read. */
export function LocalEditPanel({ selection, adapter: supplied, lifetime }: {
  readonly selection: SavedHouseSelection;
  readonly adapter?: SavedLocalEditAdapter;
  readonly lifetime?: RefObject<(() => void) | null>;
}) {
  const [space, setSpace] = useState(''), [error, setError] = useState<string | null>(null);
  const [ownedAdapter, setOwnedAdapter] = useState<SavedLocalEditAdapter | null>(null);
  const owned = useRef<{ adapter: SavedLocalEditAdapter; store: ReturnType<typeof createLocalEditRetentionStore> } | null>(null);
  const adapter = supplied ?? ownedAdapter;
  const state = useSyncExternalStore(adapter?.subscribe ?? subscribeNone, adapter?.getSnapshot ?? noSnapshot, adapter?.getSnapshot ?? noSnapshot);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const retire = useCallback(() => {
    const prior = owned.current; owned.current = null;
    prior?.adapter.dispose();
    if (prior) void prior.store.close().catch(() => {});
    supplied?.closeDetail(); setOwnedAdapter(null); setSpace(''); selectedButton.current = null;
  }, [supplied]);
  useLayoutEffect(() => {
    if (lifetime) lifetime.current = retire;
    return () => { if (lifetime?.current === retire) lifetime.current = null; retire(); };
  }, [lifetime, retire]);
  if (selection.signal.aborted || !selection.isCurrent()) return null;
  const busy = state !== null && (['listing', 'opening', 'pending'].includes(state.status) || state.candidateStatus === 'reading');
  const disabled = busy || state?.status === 'completion-unconfirmed' || state?.status === 'retired';
  return <section className="saved-catalog" aria-label="Local drafts">
    <h2>Local drafts</h2><p>Local only / not submitted. Documentary originals; native authority not established. Current base not checked.</p>
    {!supplied && <form className="session-form" onSubmit={event => {
      event.preventDefault(); if (!selection.isCurrent() || selection.signal.aborted) return;
      const chosen = space; retire();
      let localStore: ReturnType<typeof createLocalEditRetentionStore> | null = null;
      try {
        localStore = createLocalEditRetentionStore(chosen, globalThis.indexedDB);
        const next = createSavedLocalEditAdapter(selection, chosen, localStore);
        owned.current = { adapter: next, store: localStore }; setOwnedAdapter(next); setSpace(chosen); setError(null);
        void next.list();
      } catch { if (localStore) void localStore.close().catch(() => {}); setError('Choose an available local draft space.'); }
    }}>
      <label><span>Local draft space</span><input value={space} maxLength={128} required autoComplete="off"
        onChange={event => setSpace(event.currentTarget.value)} /></label>
      <p>Browser data partition, not an account. This choice stays in memory.</p>
      <button type="submit">Open local draft space</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    {!state && <p role="status">Choose a local draft space to read its existing drafts.</p>}
    {state && adapter && <>
      <details><summary>Selected saved copy</summary><dl>
        <div><dt>Local draft space</dt><dd>{state.localPartitionId}</dd></div>
        <div><dt>Workspace / home</dt><dd>{state.context.scope.workspaceId} / {state.context.scope.homeId}</dd></div>
        <div><dt>Saved key</dt><dd>{state.context.savedKey}</dd></div>
        <div><dt>Snapshot</dt><dd>{state.context.snapshotId}</dd></div>
        <div><dt>Local revision</dt><dd>{state.context.localRevision}</dd></div>
      </dl></details>
      <section aria-label="Saved identity originals">
        <h3>Saved identity originals</h3>
        <button type="button" disabled={disabled} onClick={() => { void adapter.readCandidates(); }}>Read saved identity originals</button>
        {state.candidateStatus === 'reading' && <p role="status">Verifying saved identity originals…</p>}
        {state.candidateMessage && <p role={state.candidateStatus === 'unavailable' ? 'alert' : 'status'}>{state.candidateMessage}</p>}
        <ul className="saved-catalog-list" aria-label="Verified saved identity candidates">
          {state.candidates.map(candidate => <li key={candidate.key}>
            <button type="button" disabled={disabled} aria-pressed={state.selectedCandidate === candidate.key}
              onClick={() => { void adapter.chooseCandidate(candidate.key); }}>
              <strong>identity: {candidate.recordId}</strong><span>Revision {candidate.revision}; {candidate.bytes} bytes</span>
            </button>
            {state.selectedCandidate === candidate.key && <details><summary>Verified original evidence</summary><dl>
              <div><dt>Member SHA256</dt><dd>{candidate.sha256}</dd></div>
              <div><dt>Aggregate resource SHA256</dt><dd>{candidate.resourceSha256}</dd></div>
            </dl></details>}
          </li>)}
        </ul>
        {state.selectedCandidate !== null && <button type="button" disabled={disabled || !state.canRetain}
          onClick={() => { void adapter.retain(); }}>Retain local draft</button>}
      </section>
      {state.message && <p role={state.status === 'completion-unconfirmed' || state.status === 'unavailable' ? 'alert' : 'status'}>{state.message}</p>}
      {busy && state.candidateStatus !== 'reading' && <p role="status">{state.status === 'listing' ? 'Reading local drafts…' : state.status === 'opening' ? 'Reading local draft…' : 'Saving local change…'}</p>}
      <div className="saved-catalog-original">
        <button type="button" disabled={busy || state.status === 'retired'} onClick={() => { void adapter.list(); }}>Read local drafts</button>
        {state.selectedKey !== null && <>
          <button type="button" disabled={busy || state.status === 'retired'} onClick={() => { void adapter.read(); }}>Read local draft</button>
          <button type="button" onClick={() => { adapter.closeDetail(); if (selectedButton.current?.isConnected) selectedButton.current.focus(); }}>Close local draft</button>
        </>}
      </div>
      {(state.status === 'listed' || state.status === 'ready') && state.summaries.length === 0 && <p role="status">No existing local drafts for this space and saved copy.</p>}
      <div className="saved-catalog-columns"><ul className="saved-catalog-list" aria-label="Existing local drafts">
        {state.summaries.map(row => <li key={row.key}><button type="button" disabled={busy || state.status === 'retired'}
          aria-pressed={state.selectedKey === row.key} onClick={event => {
            selectedButton.current = event.currentTarget; void adapter.open(row.key);
          }}><strong>{row.recordType}: {row.recordId}</strong><span>Revision {row.revision ?? 'unavailable'}; {row.hasProposal ? 'local proposal retained' : 'no proposal'}</span></button></li>)}
      </ul>{state.detail && <DraftDetail key={state.detail.key} detail={state.detail} adapter={adapter} disabled={disabled} />}</div>
      {state.outcome && <details><summary>Last local result</summary><dl>
        <div><dt>Action / completion</dt><dd>{state.outcome.action} / {state.outcome.completion}</dd></div>
        <div><dt>Published to selection</dt><dd>{state.outcome.published ? 'Yes' : 'No'}</dd></div>
        <div><dt>Local selection generation</dt><dd>{state.outcome.selectionGeneration}</dd></div>
      </dl></details>}
    </>}
  </section>;
}
