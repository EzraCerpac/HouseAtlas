/** One explicit Editor-requested HomeBox refresh. The server's admission read
 * decides whether the button is offered; only a press sends the refresh POST,
 * never a mount, view change or the service worker. */

import type { RefreshHostPort, RefreshToken } from './homebox-withheld.ts';

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

const same = (a: RefreshToken, b: RefreshToken | null) =>
  b !== null && a.workspaceId === b.workspaceId && a.homeId === b.homeId && a.session === b.session;
const keyOf = (token: RefreshToken) => JSON.stringify([token.workspaceId, token.homeId, token.session ?? null]);
const IDLE: RefreshState = { offered: false, busy: false, result: null, reconciled: true };

/** Refresh state and reconciliation, owned by the host that owns the view, not
 * by the button: closing the panel or selecting a record never drops a result.
 * One refresh at a time per home and session. Any answer that changed durable
 * cache state (refreshed or failed) re-reads the view; if that re-read fails
 * after a revocation, `withhold` hides HomeBox entries so text and content agree.
 *
 * Every effect after an await is fenced: it applies only while the host is
 * live and `current()` still names the pressed home and session. Otherwise
 * the rest is dropped; the server's result stands and the view now shown is
 * untouched. A button only reads this state; one that is not mounted misses
 * nothing, and a remounted one shows the refresh still running, or its result. */
export function createRefreshOwner(options: RefreshHostPort & {
  readonly transport: typeof fetch;
  readonly online: () => boolean;
}) {
  const states = new Map<string, RefreshState>();
  const listeners = new Set<() => void>();
  const live = (token: RefreshToken) => options.live() && same(token, options.current());
  const set = (token: RefreshToken, next: Partial<RefreshState> | null) => {
    if (next) states.set(keyOf(token), { ...(states.get(keyOf(token)) ?? IDLE), ...next });
    else states.delete(keyOf(token));
    listeners.forEach(listener => listener());
  };
  return {
    stateFor: (token: RefreshToken): RefreshState => states.get(keyOf(token)) ?? IDLE,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async check(token: RefreshToken, signal?: AbortSignal) {
      const availability = await readAvailability(token, options.transport, signal);
      if (!signal?.aborted && live(token)) set(token, { offered: availability === 'available' });
    },
    async press(token: RefreshToken) {
      const state = states.get(keyOf(token));
      if (!state?.offered || state.busy || !live(token)) return;
      set(token, { busy: true, result: null, reconciled: true });
      let result: RefreshResult;
      try {
        result = await requestRefresh(token, options.transport, options.online());
      } catch {
        result = { kind: 'unreachable' };
      }
      if (!live(token)) return set(token, null);
      let reconciled = true;
      if (result.kind === 'refreshed' || result.kind === 'failed') {
        reconciled = await options.reload().then(ok => ok === true, () => false);
        if (!live(token)) return set(token, null);
        if (reconciled) options.withhold(token, false);
        else if (result.kind === 'failed' && result.quarantined) options.withhold(token, true);
      }
      set(token, { busy: false, result, reconciled });
    },
  };
}
export type RefreshOwner = ReturnType<typeof createRefreshOwner>;

/** The host's one owner, created on first use and kept by the host. */
export const ownerOf = (port: RefreshHostPort) => port.owner ??= createRefreshOwner({
  ...port, transport: (input, init) => globalThis.fetch(input, init), online: () => globalThis.navigator?.onLine !== false,
});
