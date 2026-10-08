import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import agent from '../../../contracts/stock-wire3/agent/agent.schema.json' with { type: 'json' };
import atlas from '../../../packages/contracts/schemas/atlas.schema.json' with { type: 'json' };
import catalog from '../../../contracts/stock-wire3/agent/operation-catalog.json' with { type: 'json' };
import type { Scope } from '../app/types';
import type { StockRequestEnvelope, StockResultEnvelope } from '../webmcp/stock';

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
export interface RetainedIntentReceipt {
  format: 'atlas-retained-reconciliation/1';
  lookupRequestId: string;
  inspection: RetainedIntentInspection;
  committedResult: null | {
    originalRequestId: string;
    wire: StockResultEnvelope;
    children: StockResultEnvelope[];
    originalMediaRelease: 'not-established';
    originalHttpDelivery: 'not-established';
  };
}
export type RetainedIntentRead =
  | { status: 'ready'; receipt: RetainedIntentReceipt }
  | { status: 'unavailable' | 'denied' | 'expired' };

const maximumBytes = 16 * 1024;
const validator = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(validator);
validator.addSchema(atlas);
validator.addSchema(agent);
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
function intentQuery(request: StockRequestEnvelope): string {
  operationFor(request);
  const original = JSON.stringify(request);
  if (new TextEncoder().encode(original).length > maximumBytes)
    throw new TypeError('Original stock request exceeds retained intent bound');
  const query = new URLSearchParams({
    workspaceId: request.context.workspaceId, homeId: request.context.homeId, intent: original,
  }).toString();
  if (new TextEncoder().encode(query).length > maximumBytes)
    throw new TypeError('Retained intent query exceeds transport bound');
  return query;
}
/** Eligibility only; the original complete envelope is never reconstructed. */
export function canReadRetainedIntent(request: StockRequestEnvelope): boolean {
  try { intentQuery(request); return true; } catch { return false; }
}
function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length
    && left.every((value, index) => equalJson(value, right[index]));
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(key => Object.hasOwn(b, key) && equalJson(a[key], b[key]));
}
function validateWire(request: StockRequestEnvelope, wire: StockResultEnvelope, originalRequestId: string, scope: Scope) {
  const operation = operationFor(request);
  const check = validator.getSchema(agent.$id + operation.outputSchema);
  if (!check || !check(wire) || wire.requestId !== originalRequestId
    || wire['commandId'] !== request.commandId || !sameScope(wire['resolvedScope'] as unknown as Scope, scope))
    throw new TypeError('Retained wire receipt correlation differs');
}
/** Passive lookup of a genuine submitted envelope; no retries or media release. */
export function createRetainedIntentClient(transport: typeof fetch = globalThis.fetch) {
  return {
    async read(request: StockRequestEnvelope, scope: Scope, signal: AbortSignal): Promise<RetainedIntentRead> {
      const query = intentQuery(request);
      // Snapshot the exact serialized input for correlation across the await.
      const original = JSON.parse(new URLSearchParams(query).get('intent')!) as StockRequestEnvelope;
      if (!validateScope(scope) || !sameScope(original.context, scope))
        throw new TypeError('Retained intent scope differs from selected scope');
      const selected = { workspaceId: scope.workspaceId, homeId: scope.homeId };
      signal.throwIfAborted();
      const response = await transport(`/api/atlas/retained-intent?${query}`, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json' }, signal,
      });
      signal.throwIfAborted();
      if (response.status === 401) return { status: 'expired' };
      if (response.status === 403) return { status: 'denied' };
      if (!response.ok) return { status: 'unavailable' };
      const value: unknown = await response.json();
      signal.throwIfAborted();
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
    },
  };
}
