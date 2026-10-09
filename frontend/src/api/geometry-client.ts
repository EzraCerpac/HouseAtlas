import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import agent from '../../../contracts/stock-wire3/agent/agent.schema.json' with { type: 'json' };
import atlas from '../../../packages/contracts/schemas/atlas.schema.json' with { type: 'json' };
import type { Scope } from '../app/types';
import type { GeometryPayload } from './generated/contracts';

export interface GeometryPublicRecord {
  target: { authority: 'atlas'; recordType: 'geometry'; recordId: string };
  revision: number;
  lifecycle: 'active' | 'tombstoned';
  payload: GeometryPayload;
}

export type GeometrySourceStatus = 'current' | 'stale' | 'unavailable' | 'unresolved';
export type GeometryRead =
  | { status: 'loading' | 'unavailable' | 'denied' | 'expired' }
  | { status: 'ready'; records: GeometryPublicRecord[]; sourceStatus: GeometrySourceStatus };

export class GeometryReadError extends Error {
  readonly status: number;
  constructor(status: number) {
    super('Geometry information could not be loaded');
    this.status = status;
  }
}

interface GeometryListResult {
  resolvedScope: Scope;
  data: {
    records: GeometryPublicRecord[];
    nextCursor: string | null;
    sourceStatus: GeometrySourceStatus;
  };
}

// One budget covers headers, every body and all continuation pages.
const sequenceTimeoutMs = 60_000;
class GeometryDeadline extends Error {}
function discard(response: Response) { void response.body?.cancel().catch(() => undefined); }
async function receive(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError('Geometry response missing');
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

/** Passive, scoped stock read. The response schema is checked before any row is used. */
export function createGeometryClient(transport: typeof fetch = globalThis.fetch) {
  const validator = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
  addFormats(validator);
  validator.addSchema(atlas);
  validator.addSchema(agent);
  const validateResult = validator.getSchema(`${agent.$id}#/$defs/result_atlas_geometry_list`);
  if (!validateResult) throw new TypeError('Geometry result schema is unavailable');
  return {
    async read(scope: Scope, signal: AbortSignal): Promise<GeometryRead> {
      signal.throwIfAborted();
      const controller = new AbortController();
      const forward = () => controller.abort(signal.reason);
      let reject!: (reason: unknown) => void;
      const stopped = new Promise<never>((_, no) => { reject = no; });
      const abort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
      signal.addEventListener('abort', forward, { once: true });
      const timer = setTimeout(() => controller.abort(new GeometryDeadline('Geometry read timed out')), sequenceTimeoutMs);
      const sequence = async (): Promise<GeometryRead> => {
        const signal = controller.signal;
        const base = `/api/atlas/stock/v3/workspaces/${encodeURIComponent(scope.workspaceId)}/homes/${encodeURIComponent(scope.homeId)}/records/geometry`;
        const records: GeometryPublicRecord[] = [];
        const seenCursors = new Set<string>();
        let cursor: string | null = null;
        let sourceStatus: GeometrySourceStatus | undefined;

        // Bound a malformed or indefinitely changing continuation stream.
        for (let page = 0; page < 100; page++) {
          signal.throwIfAborted();
          const query = new URLSearchParams({ pageSize: '100', includeArchived: 'false' });
          if (cursor !== null) query.set('cursor', cursor);
          const response = await transport(`${base}?${query}`, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            redirect: 'error',
            headers: { Accept: 'application/json' },
            signal,
          });
          if (signal.aborted) { discard(response); signal.throwIfAborted(); }
          if (response.status === 401) { discard(response); return { status: 'expired' }; }
          if (response.status === 403) { discard(response); return { status: 'denied' }; }
          if (!response.ok) { discard(response); throw new GeometryReadError(response.status); }

          const value = await receive(response, signal);
          signal.throwIfAborted();
          if (!validateResult(value)) throw new TypeError('Stock envelope is incompatible');
          const result = value as GeometryListResult;
          if (result.resolvedScope.workspaceId !== scope.workspaceId || result.resolvedScope.homeId !== scope.homeId)
            throw new TypeError('Geometry scope does not match request');
          if (sourceStatus !== undefined && sourceStatus !== result.data.sourceStatus)
            throw new TypeError('Geometry page source status changed');
          sourceStatus = result.data.sourceStatus;
          for (const record of result.data.records) {
            if (record.target.authority !== 'atlas' || record.target.recordType !== 'geometry' || record.lifecycle !== 'active')
              throw new TypeError('Geometry list did not match its active geometry filter');
            records.push(record);
          }
          const next = result.data.nextCursor;
          if (next === null) return { status: 'ready', records, sourceStatus };
          if (seenCursors.has(next)) throw new TypeError('Geometry cursor repeated');
          seenCursors.add(next);
          cursor = next;
        }
        throw new TypeError('Geometry pagination exceeded page bound');
      };
      try {
        const result = await Promise.race([sequence(), stopped]);
        controller.signal.throwIfAborted();
        return result;
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof GeometryDeadline) return { status: 'unavailable' };
        throw error;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', forward);
        controller.signal.removeEventListener('abort', abort);
      }
    },
  };
}
