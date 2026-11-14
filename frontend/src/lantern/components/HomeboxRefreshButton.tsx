import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { fmtDateTime } from '../data/time';
import { describeRefresh, ownerOf } from '../homebox-refresh.ts';
import type { RefreshHostPort } from '../homebox-withheld.ts';
import { useStore } from '../state/store';

/** Loaded only when the Sources section renders. A view of the host's refresh
 * state for this home and session; the host reconciles the result whether or
 * not this button is still mounted. */
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
  return <div><dt>HomeBox refresh</dt><dd>
    <button type="button" className="btn" disabled={state.busy} onClick={() => { void owner.press(token); }}>
      {state.busy ? 'Refreshing from HomeBox…' : 'Refresh from HomeBox'}
    </button>
    <p role="status" aria-live="polite">{state.result ? describeRefresh(state.result, fmtDateTime, state.reconciled) : ''}</p>
  </dd></div>;
}
