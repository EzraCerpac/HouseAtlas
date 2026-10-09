import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import agent from '../../../contracts/stock-wire3/agent/agent.schema.json' with { type: 'json' };
import atlas from '../../../packages/contracts/schemas/atlas.schema.json' with { type: 'json' };
import type { Scope } from '../app/types';
import type { EvidencePayload } from './generated/contracts';

export interface EvidencePublicRecord {
  target: { authority: 'atlas'; recordType: 'evidence'; recordId: string };
  revision: number;
  lifecycle: 'active' | 'tombstoned';
  payload: EvidencePayload;
}
export type EvidenceSourceStatus = 'current' | 'stale' | 'unavailable' | 'unresolved';
export type EvidenceRead =
  | { status: 'idle' | 'loading' | 'missing' | 'denied' | 'expired' | 'unavailable' }
  | { status: 'ready'; record: EvidencePublicRecord; sourceStatus: EvidenceSourceStatus };

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
async function receive(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError('Response body missing');
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      length += part.value.byteLength;
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

// Match the frozen wire's lowercase UUID pattern and UUID format without accepting aliases.
export function isEvidenceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
interface EvidenceResult {
  resolvedScope: Scope;
  data: { records: EvidencePublicRecord[]; nextCursor: string | null; sourceStatus: EvidenceSourceStatus };
}

/** One explicit passive GET; the server owns its request ID and access decision. */
export function createEvidenceClient(transport: typeof fetch = globalThis.fetch) {
  const validator = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
  addFormats(validator);
  validator.addSchema(atlas);
  validator.addSchema(agent);
  const validateResult = validator.getSchema(`${agent.$id}#/$defs/result_atlas_evidence_get`);
  const validateUuid = validator.compile({ type: 'string', format: 'uuid', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' });
  if (!validateResult) throw new TypeError('Evidence result schema is unavailable');
  return {
    async read(scope: Scope, evidenceId: string, signal: AbortSignal): Promise<EvidenceRead> {
      if (!validateUuid(scope.workspaceId) || !validateUuid(scope.homeId) || !validateUuid(evidenceId))
        throw new TypeError('Evidence scope or ID is incompatible');
      signal.throwIfAborted();
      try {
        return await withReadDeadline<EvidenceRead>(signal, async signal => {
          const response = await transport(`/api/atlas/stock/v3/workspaces/${scope.workspaceId}/homes/${scope.homeId}/records/evidence/${evidenceId}`, {
            method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
            headers: { Accept: 'application/json' }, signal,
          });
          if (signal.aborted) { discard(response); signal.throwIfAborted(); }
          if (!response.ok) discard(response);
          signal.throwIfAborted();
          if (response.status === 401) return { status: 'expired' };
          if (response.status === 403) return { status: 'denied' };
          if (response.status === 404) return { status: 'missing' };
          if (!response.ok) return { status: 'unavailable' };
          const value: unknown = await receive(response, signal);
          signal.throwIfAborted();
          if (!validateResult(value)) throw new TypeError('Evidence envelope is incompatible');
          const result = value as EvidenceResult;
          if (result.resolvedScope.workspaceId !== scope.workspaceId || result.resolvedScope.homeId !== scope.homeId)
            throw new TypeError('Evidence scope does not match request');
          const record = result.data.records[0];
          if (result.data.records.length !== 1 || result.data.nextCursor !== null ||
              record?.target.authority !== 'atlas' || record.target.recordType !== 'evidence' || record.target.recordId !== evidenceId)
            throw new TypeError('Evidence record does not match request');
          return { status: 'ready', record, sourceStatus: result.data.sourceStatus };
        });
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ReadDeadline) return { status: 'unavailable' };
        throw error;
      }
    },
  };
}
