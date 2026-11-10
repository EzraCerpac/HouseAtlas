import type { Scope } from '../app/types';
import type { OfflineHomeboxAttachmentRefV1, OfflineHomeboxPinV1 } from './live-copy-types';

/** Borrowed-byte client for the backend's finite HomeBox offline-original response (#372/#560).
 * One fresh requestId per call; a requestId is never reused and nothing here retries. The result
 * is one server-local capture, not a provider revision, remote membership or catalog completeness. */
export type HomeboxOriginalRead =
  | Readonly<{ status: 'ok'; pin: OfflineHomeboxPinV1; bytes: ArrayBuffer }>
  /** Nothing was sent, or the server answered with a definitive non-200 status. */
  | Readonly<{ status: 'unavailable'; sent: boolean; httpStatus: number | null }>
  /** Sent without a complete verifiable answer (network, cancellation, truncated body or malformed facts).
   * The server may have read the provider; do not retry automatically, even with a fresh requestId. */
  | Readonly<{ status: 'unknown'; httpStatus: number | null }>
  /** A complete 200 answer whose facts, length or digest differ from the request or the received bytes. */
  | Readonly<{ status: 'integrity' }>;

const MAX_BYTES = 10_485_760, HEADER_MAX = 16_384, WIRE_MAX = 16_384;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, SHA = /^[0-9a-f]{64}$/;
const RFC3339 = /^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]+)?(?:[Zz]|[+-][0-9]{2}:[0-9]{2})$/;
const TARGET = ['authority', 'sourceInstanceId', 'collectionId', 'resourceKind', 'entityId', 'resourceId'] as const;

function exact(value: unknown, keys: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys)
    throw new TypeError('Unexpected original facts');
  return value as Record<string, unknown>;
}
const text = (value: unknown, cap: number): value is string => typeof value === 'string' && new TextEncoder().encode(value).length <= cap;
const hex = async (bytes: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(v => v.toString(16).padStart(2, '0')).join('');
/** Local qualification only: the source MIME is descriptive and never admits a renderer by itself. */
const measuredPdf = (bytes: Uint8Array) => bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';

/** Exact v4 homebox.file.download wire for one association. Any collection spelling is kept as supplied. */
export function homeboxOriginalRequest(scope: Readonly<Scope>, ref: OfflineHomeboxAttachmentRefV1, requestId: string) {
  if (!UUID.test(scope.workspaceId) || !UUID.test(scope.homeId) || ref.source !== 'homebox-attachment'
    || !UUID.test(ref.sourceInstanceId) || !text(ref.collectionId, 4096) || !ref.collectionId
    || !UUID.test(ref.entityId) || !UUID.test(ref.attachmentId) || !UUID.test(requestId)) return null;
  const request = { schemaVersion: 4, commandId: 'homebox.file.download',
    context: { workspaceId: scope.workspaceId, homeId: scope.homeId },
    target: { authority: 'homebox', sourceInstanceId: ref.sourceInstanceId, collectionId: ref.collectionId,
      resourceKind: 'attachment', entityId: ref.entityId, resourceId: ref.attachmentId },
    payload: {}, requestId } as const;
  const wire = JSON.stringify(request);
  if (!text(wire, WIRE_MAX)) return null;
  const query = new URLSearchParams({ request: wire }).toString();
  if (query.length > 32_768) return null;
  const root = `/api/atlas/stock/v4/workspaces/${encodeURIComponent(scope.workspaceId)}/homes/${encodeURIComponent(scope.homeId)}`;
  return { request, url: `${root}/homebox-offline-original?${query}` };
}

/** Decodes the x-houseatlas-original header and correlates every field with the exact request. */
export function decodeHomeboxOriginalFacts(header: string, request: NonNullable<ReturnType<typeof homeboxOriginalRequest>>['request']) {
  if (header.length === 0 || header.length > HEADER_MAX || !/^[A-Za-z0-9+/]+={0,2}$/.test(header) || header.length % 4 !== 0)
    throw new TypeError('Original facts header is malformed');
  const raw = Uint8Array.from(atob(header), c => c.charCodeAt(0));
  const row = exact(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)),
    'byteSize,contentType,localCapture,observationId,requestId,schemaVersion,scope,sha256,sourceRegistrationSha256,sourceRegistrationVersion,target');
  const scope = exact(row['scope'], 'collectionId,homeId,sourceInstanceId,workspaceId');
  const target = exact(row['target'], [...TARGET].sort().join(','));
  const capture = exact(row['localCapture'], 'afterRetrievedAt,beforeRetrievedAt,bodyRetrievedAt,semantics,statuses');
  const statuses = capture['statuses'];
  const { byteSize, sha256, contentType, observationId, sourceRegistrationVersion: version, sourceRegistrationSha256: registration } = row;
  if (row['schemaVersion'] !== 1 || row['requestId'] !== request.requestId
    || scope['workspaceId'] !== request.context.workspaceId || scope['homeId'] !== request.context.homeId
    || scope['sourceInstanceId'] !== request.target.sourceInstanceId || scope['collectionId'] !== request.target.collectionId
    || !TARGET.every(key => target[key] === request.target[key])
    || typeof observationId !== 'string' || !UUID.test(observationId)
    || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0
    || typeof registration !== 'string' || !SHA.test(registration) || typeof sha256 !== 'string' || !SHA.test(sha256)
    || typeof byteSize !== 'number' || !Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_BYTES
    || !(contentType === null || text(contentType, 4096))
    || capture['semantics'] !== 'process-local-pinned-snapshot'
    || !['beforeRetrievedAt', 'bodyRetrievedAt', 'afterRetrievedAt'].every(key => typeof capture[key] === 'string' && RFC3339.test(capture[key] as string))
    || !Array.isArray(statuses) || statuses.length !== 3 || !statuses.every(status => status === 200))
    throw new TypeError('Original facts differ from the request');
  return { observationId, sourceRegistrationVersion: version, sourceRegistrationSha256: registration, sha256, bytes: byteSize,
    sourceContentType: contentType as string | null, beforeRetrievedAt: capture['beforeRetrievedAt'] as string,
    bodyRetrievedAt: capture['bodyRetrievedAt'] as string, afterRetrievedAt: capture['afterRetrievedAt'] as string };
}

async function boundedBody(response: Response, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_BYTES)) throw new TypeError('Body exceeds bound');
  if (!response.body) throw new TypeError('Body unavailable');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read(); signal.throwIfAborted();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_BYTES) throw new TypeError('Body exceeds bound');
      chunks.push(next.value);
    }
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** One explicit GET; same-origin session cookie only, no capture token or credential is held or stored. */
export async function readHomeboxOriginal(options: {
  readonly scope: Readonly<Scope>; readonly ref: OfflineHomeboxAttachmentRefV1; readonly signal: AbortSignal;
  readonly transport?: typeof fetch;
}): Promise<HomeboxOriginalRead> {
  const { signal } = options, prepared = homeboxOriginalRequest(options.scope, options.ref, crypto.randomUUID());
  if (!prepared || signal.aborted) return { status: 'unavailable', sent: false, httpStatus: null };
  const transport = options.transport ?? globalThis.fetch;
  let response: Response;
  try {
    response = await transport(prepared.url, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/octet-stream' }, signal });
  } catch { return { status: 'unknown', httpStatus: null }; }
  const httpStatus = response.status;
  if (httpStatus !== 200) {
    void response.body?.cancel().catch(() => undefined);
    return { status: 'unavailable', sent: true, httpStatus };
  }
  let facts: ReturnType<typeof decodeHomeboxOriginalFacts>, body: Uint8Array<ArrayBuffer>;
  try {
    if (response.headers.get('content-type') !== 'application/octet-stream') throw new TypeError('Unexpected media type');
    facts = decodeHomeboxOriginalFacts(response.headers.get('x-houseatlas-original') ?? '', prepared.request);
    body = await boundedBody(response, signal);
  } catch {
    void response.body?.cancel().catch(() => undefined);
    return { status: 'unknown', httpStatus };
  }
  if (body.byteLength !== facts.bytes || await hex(body) !== facts.sha256) return { status: 'integrity' };
  if (signal.aborted) return { status: 'unknown', httpStatus };
  const { target } = prepared.request;
  const pin: OfflineHomeboxPinV1 = { source: 'homebox-attachment', sourceInstanceId: target.sourceInstanceId,
    collectionId: target.collectionId, entityId: target.entityId, attachmentId: target.resourceId, ...facts,
    contentType: measuredPdf(body) ? 'application/pdf' : null };
  return { status: 'ok', pin, bytes: body.buffer };
}
