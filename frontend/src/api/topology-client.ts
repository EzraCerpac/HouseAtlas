import type { BindingPayload, IdentityPayload, LocationSemanticsPayload, RelationPayload } from './generated/contracts';
import type { Scope } from '../app/types';
import type { AtlasSessionInfo } from '../app/session';
import type { StockSchemaPort } from '../webmcp/stock';

export interface TopologyPayloads {
  identity: IdentityPayload;
  binding: BindingPayload;
  'location-semantics': LocationSemanticsPayload;
  relation: RelationPayload;
}
export type TopologyKind = keyof TopologyPayloads;
export interface TopologyRecord<K extends TopologyKind> {
  readonly target: { readonly authority: 'atlas'; readonly recordType: K; readonly recordId: string };
  readonly revision: number;
  readonly lifecycle: 'active' | 'tombstoned';
  readonly payload: TopologyPayloads[K];
}
export type AtlasReadStatus = 'current' | 'stale' | 'unavailable' | 'unresolved';
export type TopologyFailure = 'unavailable' | 'expired' | 'denied' | 'timedOut' | 'tooLarge' | 'continuationUnavailable' | 'changed';
export type TopologyRead<K extends TopologyKind> =
  | { readonly status: 'ready'; readonly records: readonly TopologyRecord<K>[]; readonly sourceStatus: AtlasReadStatus; readonly snapshotSha256: string }
  | { readonly status: TopologyFailure };
/** Opaque allocation correlation, not a grant or session credential. */
export interface TopologyBinding { readonly scope: Readonly<Scope> }
export interface TopologyClient {
  getBinding(): TopologyBinding | null;
  subscribe(changed: () => void): () => void;
  listAll<K extends TopologyKind>(binding: TopologyBinding, kind: K, signal: AbortSignal): Promise<TopologyRead<K>>;
  buildingMembers(binding: TopologyBinding, buildingId: string, signal: AbortSignal): Promise<TopologyRead<'identity'>>;
}
export const topologyPolicy = Object.freeze({ pageSize: 100, maxPages: 50, maxRecords: 5000,
  maxResponseBytes: 4 * 1024 * 1024, maxAggregateBytes: 16 * 1024 * 1024,
  pageTimeoutMs: 15000, sequenceTimeoutMs: 60000 });
const commandKind = { identity: 'identity', binding: 'binding', 'location-semantics': 'location_semantics', relation: 'relation' } as const;
class ReadFailure extends Error {
  readonly status: TopologyFailure;
  constructor(status: TopologyFailure) { super(status); this.status = status; }
}
function discard(response: Response) { void response.body?.cancel().catch(() => undefined); }
/** A hard settlement deadline also handles a transport/body that ignores abort. */
async function deadline<T>(signal: AbortSignal, milliseconds: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const forward = () => controller.abort(signal.reason);
  let reject!: (reason: unknown) => void;
  const stopped = new Promise<never>((_, no) => { reject = no; });
  const abort = () => reject(controller.signal.reason);
  controller.signal.addEventListener('abort', abort, { once: true });
  signal.addEventListener('abort', forward, { once: true });
  const timer = setTimeout(() => controller.abort(new ReadFailure('timedOut')), milliseconds);
  if (signal.aborted) forward();
  try {
    controller.signal.throwIfAborted();
    return await Promise.race([operation(controller.signal), stopped]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', forward);
    controller.signal.removeEventListener('abort', abort);
  }
}
async function receive(response: Response, signal: AbortSignal): Promise<{ value: unknown; bytes: number }> {
  if (!response.body) throw new ReadFailure('unavailable');
  if (Number(response.headers.get('Content-Length')) > topologyPolicy.maxResponseBytes) {
    discard(response); throw new ReadFailure('tooLarge');
  }
  const reader = response.body.getReader();
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
      if (length > topologyPolicy.maxResponseBytes) throw new ReadFailure('tooLarge');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)), bytes: length };
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
export function createTopologyClient(options: {
  readonly schemas: StockSchemaPort;
  readonly getSessionBinding: () => { readonly session: AtlasSessionInfo; readonly scope: Scope } | null;
  readonly subscribeSessionBinding: (changed: () => void) => () => void;
  readonly transport?: typeof fetch;
}): TopologyClient {
  const transport = options.transport ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let cached: { session: AtlasSessionInfo; scope: Scope; binding: TopologyBinding } | null = null;
  function getBinding(): TopologyBinding | null {
    const next = options.getSessionBinding();
    if (!next) { cached = null; return null; }
    if (!cached || cached.session !== next.session || cached.scope !== next.scope)
      cached = { ...next, binding: Object.freeze({ scope: Object.freeze({ ...next.scope }) }) };
    return cached.binding;
  }
  async function read<K extends TopologyKind>(binding: TopologyBinding, kind: K, outer: AbortSignal, buildingId?: string): Promise<TopologyRead<K>> {
    const changed = new AbortController();
    const current = (signal: AbortSignal) => {
      signal.throwIfAborted();
      if (getBinding() !== binding) throw new ReadFailure('expired');
    };
    const stop = () => { if (getBinding() !== binding) changed.abort(new ReadFailure('expired')); };
    const unsubscribe = options.subscribeSessionBinding(stop);
    const forward = () => changed.abort(outer.reason);
    outer.addEventListener('abort', forward, { once: true });
    if (outer.aborted) forward();
    try {
      return await deadline(changed.signal, topologyPolicy.sequenceTimeoutMs, async signal => {
        const records: TopologyRecord<K>[] = [];
        const seen = new Set<string>(), ids = new Set<string>();
        let cursor: string | null = null, sourceStatus: AtlasReadStatus | undefined, snapshotSha256: string | undefined, totalBytes = 0;
        for (let page = 0; page < topologyPolicy.maxPages; page++) {
          current(signal);
          const commandId = `atlas.${kind}.list`;
          const requestId = crypto.randomUUID();
          const request = { schemaVersion: 3, commandId, requestId, context: binding.scope,
            target: { authority: 'atlas', recordType: kind },
            payload: { cursor, pageSize: topologyPolicy.pageSize, includeArchived: false,
              ...(buildingId === undefined ? {} : { buildingId }) } };
          options.schemas.validate(`#/$defs/request_atlas_${commandKind[kind]}_list`, request);
          const raw = JSON.stringify(request), query = `request=${encodeURIComponent(raw)}`;
          if (new TextEncoder().encode(raw).byteLength > 16384 || query.length > 32768) throw new ReadFailure('tooLarge');
          const { value, bytes, snapshotSha256: pageSnapshot } = await deadline(signal, topologyPolicy.pageTimeoutMs, async pageSignal => {
            current(pageSignal);
            const url = `/api/atlas/stock/v3/workspaces/${encodeURIComponent(binding.scope.workspaceId)}/homes/${encodeURIComponent(binding.scope.homeId)}/invoke?${query}`;
            const response = await transport(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
              headers: { Accept: 'application/json' }, signal: pageSignal });
            try { current(pageSignal); } catch (error) { discard(response); throw error; }
            if (!response.ok) {
              discard(response);
              throw new ReadFailure(response.status === 401 ? 'expired' : response.status === 403 ? 'denied'
                : response.status === 422 && cursor !== null ? 'continuationUnavailable' : 'unavailable');
            }
            // Equality metadata for retained content, never authority or provider freshness.
            const snapshot = response.headers.get('x-atlas-snapshot-sha256');
            if (snapshot === null || snapshot.length !== 64 || !/^[0-9a-f]{64}$/.test(snapshot)) {
              discard(response); throw new ReadFailure('unavailable');
            }
            return { ...await receive(response, pageSignal), snapshotSha256: snapshot };
          });
          current(signal);
          totalBytes += bytes;
          if (totalBytes > topologyPolicy.maxAggregateBytes) throw new ReadFailure('tooLarge');
          options.schemas.validate(`#/$defs/result_atlas_${commandKind[kind]}_list`, value);
          // The cast follows the complete canonical result schema validation.
          const result = value as { requestId: string; commandId: string; status: string; resolvedScope: Scope;
            data: { records: TopologyRecord<K>[]; nextCursor: string | null; sourceStatus: AtlasReadStatus } };
          if (result.requestId !== requestId || result.commandId !== commandId || result.status !== 'read'
            || result.resolvedScope.workspaceId !== binding.scope.workspaceId || result.resolvedScope.homeId !== binding.scope.homeId)
            throw new ReadFailure('unavailable');
          if (snapshotSha256 !== undefined && snapshotSha256 !== pageSnapshot) throw new ReadFailure('changed');
          snapshotSha256 = pageSnapshot;
          if (sourceStatus !== undefined && sourceStatus !== result.data.sourceStatus) throw new ReadFailure('continuationUnavailable');
          sourceStatus = result.data.sourceStatus;
          for (const record of result.data.records) {
            if (record.target.authority !== 'atlas' || record.target.recordType !== kind || record.lifecycle !== 'active' || ids.has(record.target.recordId))
              throw new ReadFailure('unavailable');
            if (buildingId !== undefined && (record.payload as IdentityPayload).kind !== 'location') throw new ReadFailure('unavailable');
            ids.add(record.target.recordId); records.push(record);
          }
          if (records.length > topologyPolicy.maxRecords) throw new ReadFailure('tooLarge');
          const next = result.data.nextCursor;
          if (next === null) {
            if (buildingId !== undefined && !ids.has(buildingId)) throw new ReadFailure('unavailable');
            return { status: 'ready' as const, records, sourceStatus, snapshotSha256 };
          }
          if (seen.has(next)) throw new ReadFailure('continuationUnavailable');
          seen.add(next); cursor = next;
        }
        throw new ReadFailure('tooLarge');
      });
    } catch (error) {
      if (outer.aborted) throw error;
      return { status: error instanceof ReadFailure ? error.status : 'unavailable' };
    } finally { unsubscribe(); outer.removeEventListener('abort', forward); }
  }
  return { getBinding, subscribe: options.subscribeSessionBinding,
    listAll: (binding, kind, signal) => read(binding, kind, signal),
    buildingMembers: (binding, id, signal) => read(binding, 'identity', signal, id) };
}
