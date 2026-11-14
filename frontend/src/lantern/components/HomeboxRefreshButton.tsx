import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { fmtDateTime } from '../data/time';
import { describeRefresh, ownerOf } from '../homebox-refresh.ts';
import type { RefreshHostPort } from '../homebox-withheld.ts';
import { useStore } from '../state/store';

/** Loaded only when the Sources section renders. A view of the host's refresh
 * state for this home and session; the host reconciles the result whether or
 * not this button is still mounted. Where access was revoked and the server
 * offers it, the access recheck takes the refresh button's place. */
export default function HomeboxRefreshButton({ port }: { readonly port: RefreshHostPort }) {
  const { projection, actions } = useStore();
  const owner = ownerOf(port);
  const { workspaceId, homeId } = projection.view.scope;
  const session = actions.session?.expiresAt;
  const token = useMemo(() => ({ workspaceId, homeId, session }), [workspaceId, homeId, session]);
  useEffect(() => {
    const abort = new AbortController();
    void owner.check(token, abort.signal);
    return () => abort.abort();
  }, [owner, token]);
  const state = useSyncExternalStore(owner.subscribe, () => owner.stateFor(token));
  if (!state.offered) return null;
  const status = <p role="status" aria-live="polite">{state.result ? describeRefresh(state.result, fmtDateTime, state.reconciled, state.recheck) : ''}</p>;
  // Revoked access: refreshing cannot help, so the recheck replaces it.
  const revoked = projection.view.caches.some(cache => cache.owner === 'homebox' && cache.status === 'access-revoked');
  if (revoked && state.recheck) return <div><dt>HomeBox access</dt><dd>
    <p>HomeBox refused access, so its entries are withheld. A recheck reads the whole collection once with the configured credential; entries return only if that read succeeds.</p>
    <button type="button" className="btn" disabled={state.busy} onClick={() => { void owner.press(token, 'recheck'); }}>
      {state.busy ? 'Rechecking HomeBox access…' : 'Recheck HomeBox access'}
    </button>
    {status}
  </dd></div>;
  return <div><dt>HomeBox refresh</dt><dd>
    <button type="button" className="btn" disabled={state.busy} onClick={() => { void owner.press(token); }}>
      {state.busy ? 'Refreshing from HomeBox…' : 'Refresh from HomeBox'}
    </button>
    {status}
  </dd></div>;
}
