/** JSON boundary for the injected host lifecycle endpoints; no transport/login. */
import type {
  AiClient, ConnectionActionRequest, ConnectionActionResult, ConnectionSnapshot,
  HumanReviewResult, ReviewInput,
} from './types.js';

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid AI wire object');
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) throw new TypeError('Invalid AI wire fields');
  return record;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Invalid AI wire string');
  return value;
}
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  const result = text(value);
  const match = choices.find(item => item === result);
  if (match === undefined) throw new TypeError('Invalid AI wire state');
  return match;
}

function connectionSnapshot(value: unknown): ConnectionSnapshot {
  const record = object(value, ['method', 'account', 'eligibility', 'permission', 'authorization', 'paidUseAdmission', 'runtime', 'usageSupported']);
  const runtime = object(record['runtime'], ['kind', 'route', 'qualification', 'availability', 'checkedAt']);
  const account = record['account'] === null ? null : object(record['account'], ['accountId', 'workspaceId', 'label']);
  if (typeof record['usageSupported'] !== 'boolean') throw new TypeError('Invalid AI wire usage state');
  return {
    method: choice(record['method'], ['sign-in-with-chatgpt', 'api-key', 'local-runtime']),
    account: account === null ? null : { accountId: text(account['accountId']), workspaceId: text(account['workspaceId']), label: text(account['label']) },
    eligibility: choice(record['eligibility'], ['unknown', 'eligible', 'ineligible', 'not-applicable']),
    permission: choice(record['permission'], ['unknown', 'granted', 'denied', 'not-applicable']),
    authorization: choice(record['authorization'], ['unconfigured', 'sign-in-required', 'connected', 'expired']),
    paidUseAdmission: choice(record['paidUseAdmission'], ['held', 'verified-zero-paid-use', 'explicit-spend-approval']),
    runtime: {
      kind: choice(runtime['kind'], ['hosted', 'local']),
      route: choice(runtime['route'], ['unset', 'local-sign-in-helper', 'issued-website-client', 'local-inference-companion']),
      qualification: choice(runtime['qualification'], ['held', 'qualified']),
      availability: choice(runtime['availability'], ['unknown', 'ready', 'sleeping', 'unreachable']),
      checkedAt: nullableText(runtime['checkedAt']),
    },
    usageSupported: record['usageSupported'],
  };
}

export function decodeHumanReviewResult(value: unknown): HumanReviewResult {
  const record = object(value, ['status']);
  return { status: choice(record['status'], ['pending', 'closed', 'ready-to-resume']) };
}

export function decodeConnectionActionResult(value: unknown): ConnectionActionResult {
  const record = object(value, ['actionId', 'status', 'snapshot']);
  return {
    actionId: text(record['actionId']),
    status: choice(record['status'], ['completed', 'pending', 'unconfirmed']),
    snapshot: connectionSnapshot(record['snapshot']),
  };
}

/** Host transport returns parsed JSON from the Rust DTO, without unsafe casts. */
export interface AiLifecycleWirePort {
  connectionAction(input: ConnectionActionRequest, signal: AbortSignal): Promise<unknown>;
  connectionActionStatus(actionId: string, signal: AbortSignal): Promise<unknown>;
  openReview(input: ReviewInput, signal: AbortSignal): Promise<unknown>;
}

/** Compose these methods into the host's already authenticated/scoped AiClient. */
export function bindAiLifecyclePort(port: AiLifecycleWirePort): Pick<AiClient, 'connectionAction' | 'connectionActionStatus' | 'openReview'> {
  function correlated(value: unknown, actionId: string): ConnectionActionResult {
    const result = decodeConnectionActionResult(value);
    if (result.actionId !== actionId) throw new TypeError('Unexpected AI connection action');
    return result;
  }
  return {
    async connectionAction(input, signal) { return correlated(await port.connectionAction(input, signal), input.actionId); },
    async connectionActionStatus(actionId, signal) { return correlated(await port.connectionActionStatus(actionId, signal), actionId); },
    async openReview(input, signal) { return decodeHumanReviewResult(await port.openReview(input, signal)); },
  };
}
