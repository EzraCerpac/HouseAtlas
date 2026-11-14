/** One explicit Editor-requested HomeBox refresh. The server's admission read
 * decides whether the button is offered; only a press sends the refresh POST,
 * never a mount, view change or the service worker. */

import type { ReadyView } from '../app/types.ts';

export type Availability = 'available' | 'unavailable';
export type RefreshResult =
  | { readonly kind: 'refreshed'; readonly refreshedAt: string | null }
  | { readonly kind: 'failed'; readonly reason: string | null; readonly quarantined: boolean; readonly lastSuccessfulFetchAt: string | null }
  | { readonly kind: 'not-configured' | 'running' | 'denied' | 'unreachable' | 'offline' };
export interface RefreshState {
  /** True only when the server answered `available` for this signed-in caller. */
  readonly offered: boolean;
  readonly busy: boolean;
  readonly result: RefreshResult | null;
  /** False when the view could not be re-read after a recorded answer. */
  readonly reconciled: boolean;
}
interface Scope { readonly workspaceId: string; readonly homeId: string }

const TIMEOUT_MS = 300_000;
const OPTIONS = { credentials: 'same-origin', cache: 'no-store', redirect: 'error' } as const;
const route = (scope: Scope) =>
  `/api/atlas/providers/homebox/workspaces/${encodeURIComponent(scope.workspaceId)}/homes/${encodeURIComponent(scope.homeId)}/refresh`;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function time(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

export function decodeAvailability(value: unknown): Availability {
  const status = record(value)?.status;
  if (status === 'available' || status === 'unavailable') return status;
  throw new TypeError('Unrecognised HomeBox refresh availability');
}

export function decodeRefreshResult(value: unknown): RefreshResult {
  const body = record(value), cache = record(body?.cache);
  switch (body?.status) {
    case 'refreshed': return { kind: 'refreshed', refreshedAt: time(cache?.lastSuccessfulFetchAt) };
    case 'failed': return { kind: 'failed', reason: typeof body.reason === 'string' ? body.reason : null,
      quarantined: cache?.status === 'access-revoked' || body.reason === 'access-revoked', lastSuccessfulFetchAt: time(cache?.lastSuccessfulFetchAt) };
    case 'not-configured': return { kind: 'not-configured' };
    case 'running': return { kind: 'running' };
    default: throw new TypeError('Unrecognised HomeBox refresh answer');
  }
}

const REASONS: Readonly<Record<string, string>> = {
  timeout: 'HomeBox did not answer in time',
  auth: 'HomeBox refused the configured credential',
  'wrong-scope': 'HomeBox returned records outside the configured collection',
  'not-approved': 'this account is not approved to refresh this source',
  'registration-unavailable': 'the source could not be registered here',
};

export function describeRefresh(result: RefreshResult, format: (iso: string) => string, reconciled = true): string {
  const stale = reconciled ? '' : ' This view could not be updated.';
  switch (result.kind) {
    case 'refreshed': return `${result.refreshedAt ? `Refreshed from HomeBox ${format(result.refreshedAt)}.` : 'Refreshed from HomeBox.'}${stale}`;
    case 'failed': {
      const reason = (result.reason && REASONS[result.reason]) ?? 'HomeBox could not be read';
      // Quarantine withdraws the saved copy; never call it current or still shown.
      // A quarantine survives every later press: the server refuses before
      // contacting HomeBox, so never suggest that trying again helps.
      if (result.reason === 'access-revoked')
        return 'Not refreshed: access to this HomeBox source is revoked, and refreshing cannot restore it on this server yet.';
      if (result.quarantined) return reconciled
        ? `Not refreshed: ${reason}. Access revoked: the saved HomeBox copy is withheld, and refreshing cannot restore it on this server yet.`
        : `Not refreshed: ${reason}. Access revoked: HomeBox entries are withheld here, and refreshing cannot restore them on this server yet.`;
      if (!reconciled) return `Not refreshed: ${reason}.${stale}`;
      const kept = result.lastSuccessfulFetchAt ? ` The copy from ${format(result.lastSuccessfulFetchAt)} is still shown.` : '';
      return `Not refreshed: ${reason}.${kept}`;
    }
    case 'not-configured': return 'Refreshing from HomeBox is not set up on this server.';
    case 'running': return 'A refresh is already running. Try again when it finishes.';
    case 'denied': return 'Only an approved, signed-in Editor can refresh from HomeBox.';
    case 'offline': return 'Refreshing from HomeBox is unavailable offline.';
    case 'unreachable': return 'Not refreshed: this server could not be reached.';
  }
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

/** Read-only admission for the current session; sends nothing to HomeBox. */
export async function readAvailability(scope: Scope, transport: typeof fetch, signal?: AbortSignal): Promise<Availability | null> {
  try {
    const response = await transport(route(scope), {
      ...OPTIONS, method: 'GET', headers: { Accept: 'application/json' }, signal: signal ?? AbortSignal.timeout(30_000),
    });
    return response.ok ? decodeAvailability(await response.json()) : null;
  } catch {
    return null;
  }
}

/** Reads the current session for CSRF, then sends the one POST. */
export async function requestRefresh(scope: Scope, transport: typeof fetch, online: boolean): Promise<RefreshResult> {
  if (!online) return { kind: 'offline' };
  try {
    const session = await transport('/api/atlas/auth/session', {
      ...OPTIONS, method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
    });
    const csrf = session.ok ? record(await session.json())?.csrfToken : null;
    if (typeof csrf !== 'string' || !csrf) return { kind: 'denied' };
    const response = await transport(route(scope), {
      ...OPTIONS, method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json', 'X-Atlas-CSRF': csrf },
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (!response.ok) return { kind: 'unreachable' };
    return decodeRefreshResult(await response.json());
  } catch (failure) {
    if (failure instanceof TypeError && failure.message === 'Unrecognised HomeBox refresh answer') throw failure;
    return { kind: 'unreachable' };
  }
}

/** State owner behind the button. Any answer that changed durable cache state
 * (refreshed or failed) re-reads the view. If that re-read fails after a
 * revocation, `withhold` hides HomeBox entries locally so text and content agree. */
export function createRefreshControl(options: {
  readonly scope: Scope;
  readonly transport: typeof fetch;
  readonly online: () => boolean;
}) {
  let state: RefreshState = { offered: false, busy: false, result: null, reconciled: true };
  const listeners = new Set<() => void>();
  const set = (next: Partial<RefreshState>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
  return {
    getSnapshot: (): RefreshState => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async check(signal?: AbortSignal) {
      const availability = await readAvailability(options.scope, options.transport, signal);
      if (!signal?.aborted) set({ offered: availability === 'available' });
    },
    /** `withhold(true)` hides this home's HomeBox entries after a revocation
     * that could not be re-read; `withhold(false)` after a successful re-read. */
    async press(reload: () => Promise<boolean>, withhold: (on: boolean) => void) {
      if (!state.offered || state.busy) return;
      set({ busy: true, result: null, reconciled: true });
      let result: RefreshResult;
      try {
        result = await requestRefresh(options.scope, options.transport, options.online());
      } catch {
        result = { kind: 'unreachable' };
      }
      let reconciled = true;
      if (result.kind === 'refreshed' || result.kind === 'failed') {
        reconciled = await reload().then(ok => ok === true, () => false);
        if (reconciled) withhold(false);
        else if (result.kind === 'failed' && result.quarantined) withhold(true);
      }
      set({ busy: false, result, reconciled });
    },
  };
}
