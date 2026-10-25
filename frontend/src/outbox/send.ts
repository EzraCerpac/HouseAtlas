import type { OutboxContext, OutboxEntry, OutboxProblem } from './types.ts';

/** committed: the server holds the change (first write or replay).
 * problem: the server refused it; the person decides what happens next.
 * later: the outcome is unknown or the server is out of reach; the same
 * envelope goes again on the next attempt. */
export type SendOutcome =
  | { readonly kind: 'committed'; readonly receipt: unknown }
  | { readonly kind: 'problem'; readonly problem: OutboxProblem }
  | { readonly kind: 'later'; readonly signedOut: boolean };

export const SEND_TIMEOUT_MS = 20_000;

const problems: Readonly<Record<number, OutboxProblem>> = {
  403: 'denied', 404: 'removed', 409: 'changed', 412: 'changed', 422: 'rejected', 428: 'changed',
};

/** Posts the stored envelope byte for byte. Nothing is re-prepared here: a
 * new request identity is only ever made when the person asks for it. */
export async function sendEntry(entry: OutboxEntry, context: OutboxContext, transport: typeof fetch = fetch): Promise<SendOutcome> {
  const path = `/api/atlas/stock/v3/workspaces/${encodeURIComponent(context.workspaceId)}/homes/${encodeURIComponent(context.homeId)}/commands`;
  let response: Response;
  try {
    response = await transport(path, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Atlas-CSRF': context.csrfToken },
      body: entry.body,
    });
  } catch {
    return { kind: 'later', signedOut: false };
  }
  if (response.status === 200) {
    try {
      const receipt: unknown = await response.json();
      const row = receipt as { requestId?: unknown; commandId?: unknown; status?: unknown };
      if (row.requestId === entry.requestId && row.commandId === entry.commandId && row.status === 'committed')
        return { kind: 'committed', receipt };
      // A readable answer that is not a commit is the server's refusal.
      return { kind: 'problem', problem: 'rejected' };
    } catch {
      // The body was lost on the way: the commit may exist, so check again later.
      return { kind: 'later', signedOut: false };
    }
  }
  void response.body?.cancel().catch(() => undefined);
  if (response.status === 401) return { kind: 'later', signedOut: true };
  const problem = problems[response.status];
  return problem ? { kind: 'problem', problem } : { kind: 'later', signedOut: false };
}

/** committed: an earlier send arrived. absent: none did, so sending is safe;
 * the permanent idempotency key still rules out a second write if an old send
 * lands late. later: the server could not say. */
export type LookupOutcome = 'committed' | 'absent' | 'later';

/** Asks the server whether it already holds this envelope. Needed before a
 * resend because the server refuses an identical resend instead of replaying
 * it, so the refusal alone cannot tell a lost reply from a failure. */
export async function lookupEntry(entry: OutboxEntry, context: OutboxContext, transport: typeof fetch = fetch): Promise<LookupOutcome> {
  try {
    const response = await transport('/api/atlas/retained-intent', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Atlas-CSRF': context.csrfToken },
      body: entry.body,
    });
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); return 'later'; }
    const value = await response.json() as { lookupRequestId?: unknown; inspection?: { commandId?: unknown; outcome?: unknown } };
    if (value.lookupRequestId !== entry.requestId || value.inspection?.commandId !== entry.commandId) return 'later';
    return value.inspection.outcome === 'retained-commit' ? 'committed'
      : value.inspection.outcome === 'not-retained-at-snapshot' ? 'absent' : 'later';
  } catch {
    return 'later';
  }
}
