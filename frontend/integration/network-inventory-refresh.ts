/** One explicit named-Editor refresh. No automatic invocation or retry. */
import type { CollectorScope } from './network-collector.ts';
import { isExactDecimal } from '../src/numeric/decimal.ts';
import { parseLosslessJson, type LosslessJson } from '../src/numeric/lossless-json.ts';

export interface NetworkRefreshCache {
  readonly status: 'empty' | 'fresh' | 'stale' | 'error' | 'access-revoked';
  readonly lastSuccessfulFetchAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly errorCode: string | null;
}
export type NetworkInventoryRefreshResult =
  | { readonly status: 'needs-review'; readonly reviewedInventoryRevision: number; readonly collectorInventoryRevision: number }
  | { readonly status: 'refreshed' | 'unchanged'; readonly inventoryRevision: number; readonly cache: NetworkRefreshCache }
  | { readonly status: 'running' | 'not-configured' }
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string; readonly quarantined: boolean; readonly cache?: NetworkRefreshCache };

function need(ok: unknown): asserts ok { if (!ok) throw new TypeError('Network refresh response unavailable'); }
function row(v: LosslessJson | undefined): Record<string, LosslessJson> {
  need(v !== null && typeof v === 'object' && !Array.isArray(v) && !isExactDecimal(v)); return v;
}
function keys(v: Record<string, LosslessJson>, required: readonly string[], optional: readonly string[] = []) {
  need(required.every(k => k in v) && Object.keys(v).every(k => required.includes(k) || optional.includes(k)));
}
function text(v: LosslessJson | undefined): string { need(typeof v === 'string' && v.length > 0 && v.length <= 4096); return v; }
function date(v: LosslessJson | undefined): string | null { if (v === null) return null; const s = text(v); need(Number.isFinite(Date.parse(s))); return s; }
function cache(v: LosslessJson | undefined): NetworkRefreshCache {
  const c = row(v); keys(c, ['status', 'lastSuccessfulFetchAt', 'lastAttemptAt', 'errorCode']);
  const status = text(c.status); need(['empty', 'fresh', 'stale', 'error', 'access-revoked'].includes(status));
  return Object.freeze({ status: status as NetworkRefreshCache['status'], lastSuccessfulFetchAt: date(c.lastSuccessfulFetchAt), lastAttemptAt: date(c.lastAttemptAt), errorCode: c.errorCode === null ? null : text(c.errorCode) });
}
export function decodeNetworkInventoryRefresh(v: LosslessJson): NetworkInventoryRefreshResult {
  const r = row(v), status = text(r.status);
  if (status === 'needs-review') {
    keys(r, ['status', 'reviewedInventoryRevision', 'collectorInventoryRevision']);
    const revision = (v: LosslessJson | undefined) => {
      const n = isExactDecimal(v) ? v.toSafeInteger() : v;
      need(typeof n === 'number' && Number.isSafeInteger(n) && n >= 0); return n;
    };
    const reviewedInventoryRevision = revision(r.reviewedInventoryRevision), collectorInventoryRevision = revision(r.collectorInventoryRevision);
    need(reviewedInventoryRevision !== collectorInventoryRevision);
    return Object.freeze({ status, reviewedInventoryRevision, collectorInventoryRevision });
  }
  if (status === 'running' || status === 'not-configured') { keys(r, ['status']); return Object.freeze({ status }); }
  if (status === 'refused') { keys(r, ['status', 'reason']); return Object.freeze({ status, reason: text(r.reason) }); }
  if (status === 'failed') {
    keys(r, ['status', 'reason', 'quarantined'], ['cache']); need(typeof r.quarantined === 'boolean');
    return Object.freeze({ status, reason: text(r.reason), quarantined: r.quarantined, ...('cache' in r ? { cache: cache(r.cache) } : {}) });
  }
  need(status === 'refreshed' || status === 'unchanged'); keys(r, ['status', 'inventoryRevision', 'cache']);
  const inventoryRevision = isExactDecimal(r.inventoryRevision) ? r.inventoryRevision.toSafeInteger() : r.inventoryRevision;
  need(typeof inventoryRevision === 'number' && Number.isSafeInteger(inventoryRevision) && inventoryRevision >= 0);
  return Object.freeze({ status, inventoryRevision, cache: cache(r.cache) });
}
/** Supply current session CSRF. A lost response may follow a committed publish;
 * reconcile cached inventory/results and never automatically retry this POST. */
export async function requestNetworkInventoryRefresh(scope: CollectorScope, csrf: string, transport: typeof fetch = fetch, signal?: AbortSignal): Promise<NetworkInventoryRefreshResult> {
  const path = `/api/atlas/providers/network/workspaces/${encodeURIComponent(scope.workspaceId)}/homes/${encodeURIComponent(scope.homeId)}/sources/${encodeURIComponent(scope.sourceInstanceId)}/refresh?collection=${encodeURIComponent(scope.collectionId)}`;
  const response = await transport(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json', 'X-Atlas-CSRF': csrf }, signal: signal ?? AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error('Network refresh refused or outcome unknown');
  return decodeNetworkInventoryRefresh(parseLosslessJson(await response.text()));
}
