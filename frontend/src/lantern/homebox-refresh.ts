/** One explicit Editor-requested HomeBox refresh. The server's admission read
 * decides whether the button is offered; only a press sends the refresh POST,
 * never a mount, view change or the service worker. */

export type Availability = 'available' | 'not-approved' | 'not-configured';
export type RefreshResult =
  | { readonly kind: 'refreshed'; readonly refreshedAt: string | null }
  | { readonly kind: 'failed'; readonly reason: string | null; readonly quarantined: boolean; readonly lastSuccessfulFetchAt: string | null }
  | { readonly kind: 'not-configured' | 'running' | 'denied' | 'unreachable' | 'offline' };
export interface RefreshState {
  /** True only when the server answered `available` for this signed-in caller. */
  readonly offered: boolean;
  readonly busy: boolean;
  readonly result: RefreshResult | null;
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
  if (status === 'available' || status === 'not-approved' || status === 'not-configured') return status;
  throw new TypeError('Unrecognised HomeBox refresh availability');
}

export function decodeRefreshResult(value: unknown): RefreshResult {
  const body = record(value), cache = record(body?.cache);
  switch (body?.status) {
    case 'refreshed': return { kind: 'refreshed', refreshedAt: time(cache?.lastSuccessfulFetchAt) };
    case 'failed': return { kind: 'failed', reason: typeof body.reason === 'string' ? body.reason : null,
      quarantined: cache?.status === 'access-revoked', lastSuccessfulFetchAt: time(cache?.lastSuccessfulFetchAt) };
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

export function describeRefresh(result: RefreshResult, format: (iso: string) => string): string {
  switch (result.kind) {
    case 'refreshed': return result.refreshedAt ? `Refreshed from HomeBox ${format(result.refreshedAt)}.` : 'Refreshed from HomeBox.';
    case 'failed': {
      const reason = (result.reason && REASONS[result.reason]) ?? 'HomeBox could not be read';
      // Quarantine withdraws the saved copy; never call it current or still shown.
      if (result.quarantined) return `Not refreshed: ${reason}. Access revoked: the saved HomeBox copy is withheld.`;
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

/** State owner behind the button. Any answer that changed durable cache state
 * (refreshed or failed) re-reads the view, so a quarantined copy is withheld. */
export function createRefreshControl(options: {
  readonly scope: Scope;
  readonly transport: typeof fetch;
  readonly online: () => boolean;
}) {
  let state: RefreshState = { offered: false, busy: false, result: null };
  const listeners = new Set<() => void>();
  const set = (next: Partial<RefreshState>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
  return {
    getSnapshot: (): RefreshState => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async check(signal?: AbortSignal) {
      const availability = await readAvailability(options.scope, options.transport, signal);
      if (!signal?.aborted) set({ offered: availability === 'available' });
    },
    async press(reload: () => Promise<boolean>) {
      if (!state.offered || state.busy) return;
      set({ busy: true, result: null });
      let result: RefreshResult;
      try {
        result = await requestRefresh(options.scope, options.transport, options.online());
      } catch {
        result = { kind: 'unreachable' };
      }
      if (result.kind === 'refreshed' || result.kind === 'failed') await reload().catch(() => false);
      set({ busy: false, result });
    },
  };
}
