import { parseLosslessJson, type LosslessJson } from '../numeric/lossless-json';
import { createExactStockResultValidator } from '../numeric/schema-validator';
import { decodeGeometryResult, type DecodedGeometryPayload } from '../numeric/stock-decoded';
import type { Scope } from '../app/types';

export interface GeometryPublicRecord {
  target: { authority: 'atlas'; recordType: 'geometry'; recordId: string };
  revision: number;
  lifecycle: 'active' | 'tombstoned';
  payload: DecodedGeometryPayload;
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
const maxResponseBytes = 4 * 1024 * 1024;
const maxAggregateBytes = 16 * 1024 * 1024;
class GeometryDeadline extends Error {}
function discard(response: Response) { void response.body?.cancel().catch(() => undefined); }
async function receive(response: Response, signal: AbortSignal, remainingBytes: number): Promise<{ value: LosslessJson; bytes: number }> {
  const byteLimit = Math.min(maxResponseBytes, remainingBytes);
  if (Number(response.headers.get('Content-Length')) > byteLimit) {
    discard(response); throw new TypeError('Geometry response exceeded byte bound');
  }
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
      if (length > byteLimit) throw new TypeError('Geometry response exceeded byte bound');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { value: parseLosslessJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)), bytes: length };
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

/** Passive, scoped stock read. The response schema is checked before any row is used. */
export function createGeometryClient(transport: typeof fetch = globalThis.fetch) {
  const validator = createExactStockResultValidator();
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
        let totalBytes = 0;

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

          const { value, bytes } = await receive(response, signal, maxAggregateBytes - totalBytes);
          totalBytes += bytes;
          signal.throwIfAborted();
          if (!validator.validate('geometry', value)) throw new TypeError('Stock envelope is incompatible');
          decodeGeometryResult(value);
          const result = value as unknown as GeometryListResult;
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
