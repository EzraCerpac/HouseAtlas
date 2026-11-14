/** One explicit Editor-requested HomeBox refresh, and one explicit recheck of
 * revoked access where the server's profile names it. The server's admission
 * read decides what is offered; only a press sends a POST, never a mount, view
 * change or the service worker. */

import type { RefreshHostPort, RefreshToken } from './homebox-withheld.ts';

export interface Availability {
  /** True only when the server answered `available` for this signed-in caller. */
  readonly offered: boolean;
  /** The server also offers this caller the access recheck. */
  readonly recheck: boolean;
}
export type Action = 'refresh' | 'recheck';
export type RefreshResult =
  | { readonly kind: 'refreshed' | 'rechecked'; readonly refreshedAt: string | null }
  | { readonly kind: 'failed'; readonly reason: string | null; readonly quarantined: boolean; readonly lastSuccessfulFetchAt: string | null }
  /** A recheck that did not restore access; the server wrote nothing. */
  | { readonly kind: 'recheck-failed'; readonly reason: string | null }
  | { readonly kind: 'not-configured' | 'not-needed' | 'running' | 'denied' | 'unreachable' | 'offline' };
export interface RefreshState {
  /** True only when the server answered `available` for this signed-in caller. */
  readonly offered: boolean;
  readonly recheck: boolean;
  readonly busy: boolean;
  readonly result: RefreshResult | null;
  /** False when the view could not be re-read after a recorded answer. */
  readonly reconciled: boolean;
}
interface Scope { readonly workspaceId: string; readonly homeId: string }

const TIMEOUT_MS = 300_000;
const OPTIONS = { credentials: 'same-origin', cache: 'no-store', redirect: 'error' } as const;
const route = (scope: Scope, action: Action = 'refresh') =>
  `/api/atlas/providers/homebox/workspaces/${encodeURIComponent(scope.workspaceId)}/homes/${encodeURIComponent(scope.homeId)}/${action}`;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function time(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

export function decodeAvailability(value: unknown): Availability {
  const body = record(value);
  if (body?.status === 'unavailable') return { offered: false, recheck: false };
  if (body?.status === 'available' && (body.recheck === undefined || typeof body.recheck === 'boolean'))
    return { offered: true, recheck: body.recheck === true };
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

export function decodeRecheckResult(value: unknown): RefreshResult {
  const body = record(value), cache = record(body?.cache);
  switch (body?.status) {
    case 'rechecked': return { kind: 'rechecked', refreshedAt: time(cache?.lastSuccessfulFetchAt) };
    case 'failed': return { kind: 'recheck-failed', reason: typeof body.reason === 'string' ? body.reason : null };
    case 'not-needed': return { kind: 'not-needed' };
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
  upstream: 'HomeBox stopped answering during the read',
  pagination: 'HomeBox pages changed during the read',
  'invalid-schema': 'HomeBox answered in an unexpected format',
  'size-limit': 'the read exceeded its size limit',
  transport: 'HomeBox could not be reached',
  changed: 'the saved copy changed during the check',
  'records-missing': 'HomeBox did not return every record saved for this source',
};

/** `recheck` says whether this caller is offered the access recheck, which
 * is then the only way to restore a revoked source. */
export function describeRefresh(result: RefreshResult, format: (iso: string) => string, reconciled = true, recheck = false): string {
  const stale = reconciled ? '' : ' This view could not be updated.';
  const restore = recheck ? 'only a recheck of HomeBox access can restore it' : 'refreshing cannot restore it on this server yet';
  switch (result.kind) {
    case 'refreshed': return `${result.refreshedAt ? `Refreshed from HomeBox ${format(result.refreshedAt)}.` : 'Refreshed from HomeBox.'}${stale}`;
    case 'rechecked': return `Access restored: ${result.refreshedAt ? `refreshed from HomeBox ${format(result.refreshedAt)}.` : 'refreshed from HomeBox.'}${stale}`;
    case 'recheck-failed': {
      const reason = (result.reason && REASONS[result.reason]) ?? 'HomeBox could not be read';
      return `Access not restored: ${reason}. HomeBox entries stay withheld.`;
    }
    case 'not-needed': return `HomeBox access is not revoked; nothing was rechecked.${stale}`;
    case 'failed': {
      const reason = (result.reason && REASONS[result.reason]) ?? 'HomeBox could not be read';
      // Quarantine withdraws the saved copy; never call it current or still shown.
      // A quarantine survives every later refresh: the server refuses before
      // contacting HomeBox, so never suggest that refreshing again helps.
      if (result.reason === 'access-revoked')
        return `Not refreshed: access to this HomeBox source is revoked, and ${restore}.`;
      if (result.quarantined) return reconciled
        ? `Not refreshed: ${reason}. Access revoked: the saved HomeBox copy is withheld, and ${restore}.`
        : `Not refreshed: ${reason}. Access revoked: HomeBox entries are withheld here, and ${restore.replace(' it', ' them')}.`;
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
export async function requestRefresh(scope: Scope, transport: typeof fetch, online: boolean, action: Action = 'refresh'): Promise<RefreshResult> {
  if (!online) return { kind: 'offline' };
  try {
    const session = await transport('/api/atlas/auth/session', {
      ...OPTIONS, method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
    });
    const csrf = session.ok ? record(await session.json())?.csrfToken : null;
    if (typeof csrf !== 'string' || !csrf) return { kind: 'denied' };
    const response = await transport(route(scope, action), {
      ...OPTIONS, method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json', 'X-Atlas-CSRF': csrf },
    });
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    if (!response.ok) return { kind: 'unreachable' };
    const body: unknown = await response.json();
    return action === 'recheck' ? decodeRecheckResult(body) : decodeRefreshResult(body);
  } catch (failure) {
    if (failure instanceof TypeError && failure.message === 'Unrecognised HomeBox refresh answer') throw failure;
    return { kind: 'unreachable' };
  }
}

const same = (a: RefreshToken, b: RefreshToken | null) =>
  b !== null && a.workspaceId === b.workspaceId && a.homeId === b.homeId && a.session === b.session;
const keyOf = (token: RefreshToken) => JSON.stringify([token.workspaceId, token.homeId, token.session ?? null]);
const IDLE: RefreshState = { offered: false, recheck: false, busy: false, result: null, reconciled: true };

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
      if (!signal?.aborted && live(token)) set(token, availability ?? { offered: false, recheck: false });
    },
    /** One refresh or recheck at a time per home and session. A recheck that
     * did not restore access changed nothing on the server, so the view is
     * not re-read; every other recorded answer re-reads it. */
    async press(token: RefreshToken, action: Action = 'refresh') {
      const state = states.get(keyOf(token));
      if (!state?.offered || state.busy || !live(token) || (action === 'recheck' && !state.recheck)) return;
      set(token, { busy: true, result: null, reconciled: true });
      let result: RefreshResult;
      try {
        result = await requestRefresh(token, options.transport, options.online(), action);
      } catch {
        result = { kind: 'unreachable' };
      }
      if (!live(token)) return set(token, null);
      let reconciled = true;
      if (['refreshed', 'failed', 'rechecked', 'not-needed'].includes(result.kind)) {
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
