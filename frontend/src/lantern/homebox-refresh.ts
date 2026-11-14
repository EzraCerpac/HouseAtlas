/** One explicit Editor-requested HomeBox refresh. Called only from the
 * labelled button; never on mount, view change or from the service worker. */

export type RefreshResult =
  | { readonly kind: 'refreshed'; readonly refreshedAt: string | null }
  | { readonly kind: 'failed'; readonly reason: string | null; readonly lastSuccessfulFetchAt: string | null }
  | { readonly kind: 'not-configured' | 'running' | 'denied' | 'unreachable' | 'offline' };

const TIMEOUT_MS = 300_000;
const route = (scope: { readonly workspaceId: string; readonly homeId: string }) =>
  `/api/atlas/providers/homebox/workspaces/${encodeURIComponent(scope.workspaceId)}/homes/${encodeURIComponent(scope.homeId)}/refresh`;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function time(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

export function decodeRefreshResult(value: unknown): RefreshResult {
  const body = record(value), cache = record(body?.cache);
  switch (body?.status) {
    case 'refreshed': return { kind: 'refreshed', refreshedAt: time(cache?.lastSuccessfulFetchAt) };
    case 'failed': return { kind: 'failed', reason: typeof body.reason === 'string' ? body.reason : null,
      lastSuccessfulFetchAt: time(cache?.lastSuccessfulFetchAt) };
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
      const kept = result.lastSuccessfulFetchAt ? ` The copy from ${format(result.lastSuccessfulFetchAt)} is still shown.` : '';
      return `Not refreshed: ${reason}.${kept}`;
    }
    case 'not-configured': return 'Refreshing from HomeBox is not set up on this server.';
    case 'running': return 'A refresh is already running. Try again when it finishes.';
    case 'denied': return 'Only a signed-in Editor can refresh from HomeBox.';
    case 'offline': return 'Refreshing from HomeBox is unavailable offline.';
    case 'unreachable': return 'Not refreshed: this server could not be reached.';
  }
}

/** Reads the current session for CSRF, then sends the one POST. */
export async function requestRefresh(
  scope: { readonly workspaceId: string; readonly homeId: string },
  transport: typeof fetch,
  online: boolean,
): Promise<RefreshResult> {
  if (!online) return { kind: 'offline' };
  const options = { credentials: 'same-origin', cache: 'no-store', redirect: 'error' } as const;
  try {
    const session = await transport('/api/atlas/auth/session', {
      ...options, method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
    });
    const csrf = session.ok ? record(await session.json())?.csrfToken : null;
    if (typeof csrf !== 'string' || !csrf) return { kind: 'denied' };
    const response = await transport(route(scope), {
      ...options, method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
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
