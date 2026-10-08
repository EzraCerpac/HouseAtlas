/** Credential-free Rust DTO decoding. Shared stock validation stays server-owned. */
import { decodeConnectionActionResult } from '../wire.js';
import type {
  CancelReceipt, ConnectionSnapshot, JsonValue, RequestStatus, ReviewChallenge,
  RunOutcome, ToolCall, Usage, ModelDiscovery,
} from '../types.js';

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid AI host object');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key)))
    throw new TypeError('Invalid AI host fields');
  return row;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Invalid AI host string');
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  const match = choices.find(item => item === value);
  if (match === undefined) throw new TypeError('Invalid AI host state');
  return match;
}
function array<T>(value: unknown, decode: (item: unknown) => T): readonly T[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid AI host array');
  return value.map(decode);
}
function json(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(json);
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item)]));
  throw new TypeError('Invalid AI host JSON');
}
function token(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError('AI token count is not exactly representable');
  return value;
}
function usage(value: unknown): Usage {
  const row = object(value, ['inputTokens', 'outputTokens', 'totalTokens']);
  return { inputTokens: token(row['inputTokens']), outputTokens: token(row['outputTokens']), totalTokens: token(row['totalTokens']) };
}
function call(value: unknown): ToolCall {
  const row = object(value, ['callId', 'name', 'arguments']);
  return { callId: text(row['callId']), name: text(row['name']), arguments: json(row['arguments']) };
}
function review(value: unknown): ReviewChallenge {
  const row = object(value, ['challengeId', 'commandId', 'requestDigest', 'targetDigest', 'impactId', 'impactDigest', 'affectedTargets', 'recoverability', 'expiresAt']);
  return {
    challengeId: text(row['challengeId']), commandId: text(row['commandId']),
    requestDigest: text(row['requestDigest']), targetDigest: text(row['targetDigest']),
    impactId: text(row['impactId']), impactDigest: text(row['impactDigest']),
    affectedTargets: array(row['affectedTargets'], json),
    recoverability: choice(row['recoverability'], ['reversible-tombstone', 'provider-permanent', 'unresolved-provider-effects']),
    expiresAt: text(row['expiresAt']),
  };
}

export function decodeConnectionSnapshot(value: unknown): ConnectionSnapshot {
  // Reuse the donor's snapshot decoder through its exported envelope decoder.
  // This structural envelope is never published as an action or workflow result.
  return decodeConnectionActionResult({ actionId: '', status: 'completed', snapshot: value }).snapshot;
}

export function decodeRunOutcome(value: unknown): RunOutcome {
  if (value === null || typeof value !== 'object' || !('status' in value))
    throw new TypeError('Invalid AI host outcome');
  const status = choice(value.status, ['completed', 'review-required', 'domain-held', 'cancelled', 'stopped', 'failed']);
  switch (status) {
    case 'completed': {
      const row = object(value, ['status', 'text', 'operationIds', 'usage']);
      return { status, text: text(row['text']), operationIds: array(row['operationIds'], text), usage: usage(row['usage']) };
    }
    case 'review-required': {
      const row = object(value, ['status', 'continuationId', 'calls', 'reviews', 'usage']);
      return { status, continuationId: text(row['continuationId']), calls: array(row['calls'], call), reviews: array(row['reviews'], review), usage: usage(row['usage']) };
    }
    case 'domain-held': {
      const row = object(value, ['status', 'operationId', 'operationIds', 'state', 'usage']);
      return { status, operationId: row['operationId'] === null ? null : text(row['operationId']),
        operationIds: array(row['operationIds'], text),
        state: choice(row['state'], ['prepared', 'queued', 'dispatching', 'rejected-before-dispatch', 'partial', 'unknown-held']), usage: usage(row['usage']) };
    }
    case 'failed': {
      const row = object(value, ['status', 'reason', 'operationIds', 'usage']);
      return { status, reason: choice(row['reason'], ['connection-unavailable', 'invalid-input', 'invalid-catalog', 'invalid-provider-output', 'unknown-tool', 'limit-reached', 'cancel-requested', 'provider-unavailable', 'usage-limit-reached', 'domain-unavailable']),
        operationIds: array(row['operationIds'], text), usage: usage(row['usage']) };
    }
    case 'cancelled':
    case 'stopped': {
      const row = object(value, ['status', 'usage']);
      return { status, usage: usage(row['usage']) };
    }
  }
}

export function decodeCancelReceipt(value: unknown, requestId: string): CancelReceipt {
  const row = object(value, ['requestId', 'status']);
  if (row['requestId'] !== requestId) throw new TypeError('Unexpected AI cancellation request');
  return { requestId, status: choice(row['status'], ['requested', 'confirmed', 'already-finished', 'unsupported']) };
}

export function decodeRequestStatus(value: unknown, requestId: string): RequestStatus {
  if (value === null || typeof value !== 'object' || !('status' in value))
    throw new TypeError('Invalid AI request status');
  const status = choice(value.status, ['running', 'unconfirmed', 'finished']);
  const row = object(value, status === 'finished' ? ['requestId', 'status', 'outcome'] : ['requestId', 'status']);
  if (row['requestId'] !== requestId) throw new TypeError('Unexpected AI status request');
  return status === 'finished'
    ? { requestId, status, outcome: decodeRunOutcome(row['outcome']) }
    : { requestId, status };
}

/** Exact native Models DTO, preserving provider order and original timestamp. */
export function decodeModelDiscovery(value: unknown): ModelDiscovery {
  const row = object(value, ['registrationId', 'checkedAt', 'modelSlugs']);
  const registrationId = text(row['registrationId']);
  if (registrationId.trim().length === 0 || new TextEncoder().encode(registrationId).length > 4096)
    throw new TypeError('Invalid AI model registration');
  const checkedAt = text(row['checkedAt']);
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/u.exec(checkedAt);
  if (!match) throw new TypeError('Invalid AI model timestamp');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0)
    || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 60
    || (match[8] !== undefined && Number(match[8]) > 23)
    || (match[9] !== undefined && Number(match[9]) > 59))
    throw new TypeError('Invalid AI model timestamp');
  if (!Array.isArray(row['modelSlugs']) || row['modelSlugs'].length > 1024)
    throw new TypeError('Invalid AI models collection');
  const seen = new Set<string>();
  const modelSlugs = row['modelSlugs'].map((value: unknown) => {
    const slug = text(value);
    if (slug.length === 0 || new TextEncoder().encode(slug).length > 256 || /\p{Cc}/u.test(slug)
      || /[\uD800-\uDFFF]/u.test(slug) || seen.has(slug)) throw new TypeError('Invalid AI model slug');
    seen.add(slug);
    return slug;
  });
  return { registrationId, checkedAt, modelSlugs };
}
