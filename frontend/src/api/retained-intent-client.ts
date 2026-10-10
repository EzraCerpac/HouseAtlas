import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import agent from '../../../contracts/stock-wire3/agent/agent.schema.json' with { type: 'json' };
import atlas from '../../../packages/contracts/schemas/atlas.schema.json' with { type: 'json' };
import catalog from '../../../contracts/stock-wire3/agent/operation-catalog.json' with { type: 'json' };
import { isExactDecimal } from '../numeric/decimal';
import { JSON_LIMITS, parseLosslessJson, type LosslessJson } from '../numeric/lossless-json';
import { createExactStockResultValidator } from '../numeric/schema-validator';
import type { Scope } from '../app/types';
import type { StockHostContext, StockRequestEnvelope } from '../webmcp/stock';

/** Internal retained wire tree; canonical stock DTOs remain unchanged. */
export type RetainedStockResultEnvelope = { readonly requestId: string; readonly [key: string]: LosslessJson };

export interface RetainedIntentInspection {
  format: 'atlas-retained-intent-inspection/1';
  resolvedScope: Scope;
  coverage: 'retained-atlas-stock-only';
  outcome: 'retained-commit' | 'not-retained-at-snapshot';
  retrySafety: 'not-established';
  rootOperationId: string | null;
  operationId: string | null;
  commandId: string;
  requestDigest: string;
}
export type RetainedIntentReceipt = LosslessJson & {
  format: 'atlas-retained-reconciliation/1';
  lookupRequestId: string;
  inspection: RetainedIntentInspection;
  committedResult: null | {
    originalRequestId: string;
    wire: RetainedStockResultEnvelope;
    children: RetainedStockResultEnvelope[];
    originalMediaRelease: 'not-established';
    originalHttpDelivery: 'not-established';
  };
}
export type RetainedIntentRead =
  | { status: 'ready'; receipt: RetainedIntentReceipt }
  | { status: 'unavailable' | 'denied' | 'expired' };

// Local settlement covers headers and body, not server cancellation or retry safety.
const readTimeoutMs = 15_000;
class ReadDeadline extends Error {}
function discard(response: Response) { void response.body?.cancel().catch(() => undefined); }
async function withReadDeadline<T>(outer: AbortSignal, exchange: (signal: AbortSignal) => Promise<T>): Promise<T> {
  outer.throwIfAborted();
  const controller = new AbortController();
  const forward = () => controller.abort(outer.reason);
  let reject!: (reason: unknown) => void;
  const stopped = new Promise<never>((_, no) => { reject = no; });
  const abort = () => reject(controller.signal.reason);
  controller.signal.addEventListener('abort', abort, { once: true });
  outer.addEventListener('abort', forward, { once: true });
  const timer = setTimeout(() => controller.abort(new ReadDeadline('Response unavailable after local deadline')), readTimeoutMs);
  try {
    const value = await Promise.race([exchange(controller.signal), stopped]);
    controller.signal.throwIfAborted();
    return value;
  } finally {
    clearTimeout(timer);
    outer.removeEventListener('abort', forward);
    controller.signal.removeEventListener('abort', abort);
  }
}
async function receive(response: Response, signal: AbortSignal): Promise<LosslessJson> {
  const declaredLength = response.headers.get('Content-Length');
  if (declaredLength !== null) {
    const contentLength = Number(declaredLength);
    if (!/^[0-9]+$/.test(declaredLength) || !Number.isSafeInteger(contentLength) || contentLength > JSON_LIMITS.textBytes) {
      discard(response);
      throw new TypeError('Retained intent response exceeded byte bound');
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError('Response body missing');
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  let length = 0;
  try {
    // One owned buffer also bounds per-chunk metadata for the complete receipt.
    let bytes = new Uint8Array(Math.min(16 * 1024, JSON_LIMITS.textBytes));
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      if (part.value.byteLength > JSON_LIMITS.textBytes - length)
        throw new TypeError('Retained intent response exceeded byte bound');
      if (part.value.byteLength === 0) continue;
      const nextLength = length + part.value.byteLength;
      if (nextLength > bytes.byteLength) {
        let capacity = bytes.byteLength;
        while (capacity < nextLength) capacity = Math.min(capacity * 2, JSON_LIMITS.textBytes);
        const grown = new Uint8Array(capacity);
        grown.set(bytes.subarray(0, length));
        bytes = grown;
      }
      bytes.set(part.value, length);
      length = nextLength;
    }
    return parseLosslessJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)));
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

const maximumBytes = 16 * 1024;
const validator = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(validator);
validator.addSchema(atlas);
validator.addSchema(agent);
const exactResult = createExactStockResultValidator();
const uuid = { type: 'string', format: 'uuid', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const nullableUuid = { anyOf: [uuid, { type: 'null' }] };
const validateScope = validator.getSchema(`${agent.$id}#/$defs/contextSelection`)!;
const validateReceipt = validator.compile<RetainedIntentReceipt>({
  type: 'object', additionalProperties: false,
  required: ['format', 'lookupRequestId', 'inspection', 'committedResult'],
  properties: {
    format: { const: 'atlas-retained-reconciliation/1' }, lookupRequestId: uuid,
    inspection: {
      type: 'object', additionalProperties: false,
      required: ['format', 'resolvedScope', 'coverage', 'outcome', 'retrySafety', 'rootOperationId', 'operationId', 'commandId', 'requestDigest'],
      properties: {
        format: { const: 'atlas-retained-intent-inspection/1' },
        resolvedScope: { $ref: `${agent.$id}#/$defs/contextSelection` },
        coverage: { const: 'retained-atlas-stock-only' },
        outcome: { enum: ['retained-commit', 'not-retained-at-snapshot'] },
        retrySafety: { const: 'not-established' },
        rootOperationId: nullableUuid, operationId: nullableUuid,
        commandId: { type: 'string', enum: catalog.commands.filter(row => row.authority === 'atlas' && row.effect === 'write').map(row => row.commandId) },
        requestDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      },
    },
    committedResult: {
      anyOf: [{ type: 'null' }, {
        type: 'object', additionalProperties: false,
        required: ['originalRequestId', 'wire', 'children', 'originalMediaRelease', 'originalHttpDelivery'],
        properties: {
          originalRequestId: uuid, wire: { type: 'object' },
          children: { type: 'array', maxItems: 100, items: { type: 'object' } },
          originalMediaRelease: { const: 'not-established' },
          originalHttpDelivery: { const: 'not-established' },
        },
      }],
    },
  },
});
const sameScope = (left: Scope, right: Scope) => left.workspaceId === right.workspaceId && left.homeId === right.homeId;
function operationFor(request: StockRequestEnvelope) {
  const operation = catalog.commands.find(row => row.commandId === request.commandId);
  if (!operation || operation.authority !== 'atlas' || operation.effect !== 'write')
    throw new TypeError('Retained intent requires an Atlas mutation');
  const check = validator.getSchema(agent.$id + operation.inputSchema);
  if (!check || !check(request)) throw new TypeError('Original stock request is incompatible');
  return operation;
}
function intentBody(request: StockRequestEnvelope): string {
  operationFor(request);
  const original = JSON.stringify(request);
  if (new TextEncoder().encode(original).length > maximumBytes)
    throw new TypeError('Original stock request exceeds retained intent bound');
  return original;
}
/** Eligibility only; the original complete envelope is never reconstructed. */
export function canReadRetainedIntent(request: StockRequestEnvelope): boolean {
  try { intentBody(request); return true; } catch { return false; }
}
function equalJson(left: unknown, right: unknown): boolean {
  if (isExactDecimal(left)) return isExactDecimal(right) && left.compare(right) === 0;
  if (left === right) return true;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length
    && left.every((value, index) => equalJson(value, right[index]));
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(key => Object.hasOwn(b, key) && equalJson(a[key], b[key]));
}
function validateWire(request: StockRequestEnvelope, wire: RetainedStockResultEnvelope, originalRequestId: string, scope: Scope) {
  const operation = operationFor(request);
  if (!exactResult.validateMutation(request.commandId, operation.outputSchema, wire) || wire.requestId !== originalRequestId
    || wire['commandId'] !== request.commandId || !sameScope(wire['resolvedScope'] as unknown as Scope, scope))
    throw new TypeError('Retained wire receipt correlation differs');
}
/** Passive lookup of a genuine submitted envelope; no retries or media release. */
export function createRetainedIntentClient(transport: typeof fetch = globalThis.fetch) {
  return {
    async read(request: StockRequestEnvelope, current: () => StockHostContext, signal: AbortSignal): Promise<RetainedIntentRead> {
      const body = intentBody(request);
      // Snapshot the exact serialized input for correlation across the await.
      const original = JSON.parse(body) as StockRequestEnvelope;
      signal.throwIfAborted();
      const { session, scope } = current();
      if (!validateScope(scope) || !sameScope(original.context, scope))
        throw new TypeError('Retained intent scope differs from selected scope');
      const selected = { workspaceId: scope.workspaceId, homeId: scope.homeId };
      const csrf = session.csrfToken;
      if (typeof csrf !== 'string' || csrf === '') throw new TypeError('Retained intent requires a current session');
      // A changed session (current() throws) or selected scope discards the result.
      const check = () => {
        if (!sameScope(original.context, current().scope))
          throw new TypeError('Retained intent scope is no longer current');
      };
      try {
        return await withReadDeadline<RetainedIntentRead>(signal, async signal => {
          const response = await transport('/api/atlas/retained-intent', {
            method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-atlas-csrf': csrf }, body, signal,
          });
          if (signal.aborted) { discard(response); signal.throwIfAborted(); }
          if (!response.ok) discard(response);
          try { signal.throwIfAborted(); check(); }
          catch (error) { discard(response); throw error; }
          if (response.status === 401) return { status: 'expired' };
          if (response.status === 403) return { status: 'denied' };
          if (!response.ok) return { status: 'unavailable' };
          const value = await receive(response, signal);
          signal.throwIfAborted(); check();
          if (!validateReceipt(value)) throw new TypeError('Retained intent receipt is incompatible');
          const inspection = value.inspection;
          if (value.lookupRequestId !== original.requestId || inspection.commandId !== original.commandId
            || !sameScope(inspection.resolvedScope, selected))
            throw new TypeError('Retained intent inspection correlation differs');
          const saved = value.committedResult;
          if (inspection.outcome === 'not-retained-at-snapshot') {
            if (saved !== null || inspection.rootOperationId !== null || inspection.operationId !== null)
              throw new TypeError('Retained intent absence is incompatible');
          } else {
            if (!saved || saved.originalRequestId !== original.requestId
              || inspection.rootOperationId === null || inspection.operationId === null)
              throw new TypeError('Retained original receipt correlation differs');
            validateWire(original, saved.wire, original.requestId, selected);
            if (saved.wire['operationId'] !== inspection.operationId
              || (saved.wire['data'] as Record<string, unknown>)['requestDigest'] !== inspection.requestDigest)
              throw new TypeError('Retained operation correlation differs');
            if (original.commandId === 'atlas.batch.execute') {
              const commands = original.payload['commands'] as StockRequestEnvelope[];
              if (saved.children.length !== commands.length || inspection.rootOperationId !== inspection.operationId)
                throw new TypeError('Retained batch receipt differs');
              saved.children.forEach((wire, index) => {
                const command = commands[index]!;
                if (!sameScope(command.context, selected)) throw new TypeError('Retained batch child scope differs');
                validateWire(command, wire, command.requestId, selected);
              });
              const rootData = saved.wire['data'] as Record<string, unknown>;
              for (const field of ['records', 'auditIds']) {
                const flattened = saved.children.flatMap(child => (child['data'] as Record<string, unknown>)[field] as unknown[]);
                if (!equalJson(rootData[field], flattened)) throw new TypeError('Retained batch receipt order differs');
              }
            } else if (saved.children.length !== 0) throw new TypeError('Single retained receipt has children');
          }
          return { status: 'ready', receipt: value };
        });
      } catch (error) {
        signal.throwIfAborted();
        check();
        if (error instanceof ReadDeadline) return { status: 'unavailable' };
        throw error;
      }
    },
  };
}
