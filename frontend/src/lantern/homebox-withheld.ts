/** The startup part of the explicit HomeBox refresh: the host's port and the
 * local withholding it applies to every view. The controller and its button
 * load only when the Sources section renders (see homebox-refresh.ts). */

import type { ReadyView } from '../app/types.ts';
import type { RefreshOwner } from './homebox-refresh.ts';

interface Scope { readonly workspaceId: string; readonly homeId: string }

/** The home and signed-in session a refresh belongs to. */
export interface RefreshToken { readonly workspaceId: string; readonly homeId: string; readonly session: string | undefined }

/** What the host owns so a refresh is reconciled whether or not its button is
 * still mounted. The lazily loaded controller keeps its one owner in `owner`. */
export interface RefreshHostPort {
  /** False once the host is torn down. */
  readonly live: () => boolean;
  /** The home and session the host shows now. */
  readonly current: () => RefreshToken | null;
  /** Re-reads the view the host shows now. */
  readonly reload: () => Promise<boolean>;
  /** Hides (true) or restores (false) HomeBox entries of that home and session. */
  readonly withhold: (token: RefreshToken, on: boolean) => void;
  owner?: RefreshOwner;
}

/** The local stand-in after a revocation the view could not re-read: no
 * HomeBox entries, and each HomeBox cache as the server's quarantine marker. */
export function withholdHomebox(view: ReadyView): ReadyView {
  return {
    ...view,
    entries: view.entries.filter(entry => entry.source.sourceKind !== 'homebox-entity'),
    caches: view.caches.map(cache => cache.owner === 'homebox'
      ? { owner: 'homebox', status: 'access-revoked', displayStatus: 'access-revoked' } : cache),
  };
}

/** Which views a recorded revocation withholds: every later view of the same
 * home in the same session, not only the object current at the press. */
export interface Withheld { readonly scope: Scope; readonly session: string | undefined }
export function shownView(view: ReadyView, session: string | undefined, withheld: Withheld | null): ReadyView {
  return withheld && withheld.session === session && withheld.scope.workspaceId === view.scope.workspaceId
    && withheld.scope.homeId === view.scope.homeId ? withholdHomebox(view) : view;
}
