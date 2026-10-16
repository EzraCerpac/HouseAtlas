/** Automatic whole-snapshot re-reads after a stale selection, counted per
 * request identity (port and request, never the attempt). A replacement
 * request starts with the full allowance; another attempt of the same request
 * keeps what it has used. */
export interface StaleRetries { readonly identity: object; readonly used: number }
export const MAX_STALE_RETRIES = 2;

/** This identity's allowance: carried for the same identity, fresh otherwise. */
export function retriesFor(budget: StaleRetries | null, identity: object): StaleRetries {
  return budget !== null && budget.identity === identity ? budget : { identity, used: 0 };
}

/** The allowance after one more automatic re-read, or null when none is left. */
export function takeRetry(budget: StaleRetries): StaleRetries | null {
  return budget.used < MAX_STALE_RETRIES ? { identity: budget.identity, used: budget.used + 1 } : null;
}
