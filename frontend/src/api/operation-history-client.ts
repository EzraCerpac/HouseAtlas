import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import operationCatalog from '../../../contracts/stock-wire3/agent/operation-catalog.json' with { type: 'json' };
import type { Scope } from '../app/types';
import type { RecordRefRecordType } from './generated/contracts';

export interface OperationHistoryEntry {
  eventId: string;
  rootOperationId: string;
  operationId: string;
  commandId: string;
  actorId: string;
  at: string;
  target: { authority: 'atlas'; recordType: RecordRefRecordType; recordId: string };
  requestDigest: string;
  state: 'committed';
}

export interface OperationHistoryPage {
  format: 'atlas-operation-events/1';
  resolvedScope: Scope;
  coverage: 'retained-atlas-stock-only';
  completeness: 'partial';
  order: 'audit-sequence-ascending';
  entries: OperationHistoryEntry[];
  nextCursor: string | null;
}

export type OperationHistoryRead =
  | { status: 'loading' | 'unavailable' | 'denied' | 'expired' }
  | { status: 'ready'; page: OperationHistoryPage;
      earlierPages?: OperationHistoryPage[]; loadingMore?: boolean; moreUnavailable?: boolean };

export class OperationHistoryReadError extends Error {
  readonly status: number;
  constructor(status: number) {
    super('Operation history could not be loaded');
    this.status = status;
  }
}

const uuid = { type: 'string', format: 'uuid', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const scopeSchema = {
  type: 'object', additionalProperties: false, required: ['workspaceId', 'homeId'],
  properties: { workspaceId: uuid, homeId: uuid },
};
const pageSchema = {
  type: 'object', additionalProperties: false,
  required: ['format', 'resolvedScope', 'coverage', 'completeness', 'order', 'entries', 'nextCursor'],
  properties: {
    format: { const: 'atlas-operation-events/1' },
    resolvedScope: scopeSchema,
    coverage: { const: 'retained-atlas-stock-only' },
    completeness: { const: 'partial' },
    order: { const: 'audit-sequence-ascending' },
    entries: {
      type: 'array', maxItems: 100,
      items: {
        type: 'object', additionalProperties: false,
        required: ['eventId', 'rootOperationId', 'operationId', 'commandId', 'actorId', 'at', 'target', 'requestDigest', 'state'],
        properties: {
          eventId: uuid, rootOperationId: uuid, operationId: uuid,
          commandId: { type: 'string', minLength: 1, maxLength: 255,
            enum: operationCatalog.commands.map(command => command.commandId) },
          actorId: uuid, at: { type: 'string', format: 'date-time' },
          target: {
            type: 'object', additionalProperties: false,
            required: ['authority', 'recordType', 'recordId'],
            properties: {
              authority: { const: 'atlas' },
              recordType: { enum: ['identity', 'binding', 'evidence', 'location-semantics', 'circuit', 'valve', 'relation', 'geometry', 'asset', 'reconciliation'] },
              recordId: uuid,
            },
          },
          requestDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          state: { const: 'committed' },
        },
      },
    },
    nextCursor: { anyOf: [{ type: 'string', minLength: 1, maxLength: 4096 }, { type: 'null' }] },
  },
};

/** Passive, scoped read of retained stock operation events. */
export function createOperationHistoryClient(transport: typeof fetch = globalThis.fetch) {
  const validator = new Ajv2020({ strict: true, allErrors: true });
  addFormats(validator);
  const validatePage = validator.compile<OperationHistoryPage>(pageSchema);
  return {
    async read(scope: Scope, signal: AbortSignal, cursor: string | null = null): Promise<OperationHistoryRead> {
      if (cursor !== null && (typeof cursor !== 'string' || cursor.length === 0
        || new TextEncoder().encode(cursor).length > 4096))
        throw new TypeError('Invalid operation history cursor');
      signal.throwIfAborted();
      const query = new URLSearchParams({ homeId: scope.homeId, pageSize: '25' });
      if (cursor !== null) query.set('cursor', cursor);
      const response = await transport(`/api/atlas/operation-events?${query}`, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json' }, signal,
      });
      signal.throwIfAborted();
      if (response.status === 401) return { status: 'expired' };
      if (response.status === 403) return { status: 'denied' };
      if (!response.ok) throw new OperationHistoryReadError(response.status);

      const value: unknown = await response.json();
      signal.throwIfAborted();
      if (!validatePage(value)) throw new TypeError('Operation history page is incompatible');
      if (value.resolvedScope.workspaceId !== scope.workspaceId || value.resolvedScope.homeId !== scope.homeId)
        throw new TypeError('Operation history scope does not match request');
      if (value.nextCursor !== null && new TextEncoder().encode(value.nextCursor).length > 4096)
        throw new TypeError('Operation history cursor exceeded byte bound');
      if (new Set(value.entries.map(entry => entry.eventId)).size !== value.entries.length)
        throw new TypeError('Operation history page repeated an event');
      return { status: 'ready', page: value };
    },
  };
}
