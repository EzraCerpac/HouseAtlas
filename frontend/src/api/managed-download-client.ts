import type { GatewayDownloadPort } from '../webmcp/gateway/ports.js';
import type { StockSchemaPort } from '../webmcp/stock.js';
import { stockCatalog } from '../webmcp/stock-schema.js';

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

/** Resolve Atlas stock handles through the actual scoped owner route. Schema
 * and session context come from the existing host; this issues no permission,
 * guesses no provider URL, and leaves unbound artifact kinds unavailable. */
export function createAtlasGatewayDownloadResolver(
  schemas: StockSchemaPort, transport: typeof fetch = globalThis.fetch,
): GatewayDownloadPort {
  const operation = stockCatalog.commands.find(row => row.commandId === 'atlas.asset.download');
  if (!operation) throw new TypeError('Atlas download contract is unavailable');
  return {
    async resolve(_toolName, input, result, context) {
      if (input['commandId'] !== operation.commandId || result === null
        || typeof result !== 'object' || Array.isArray(result))
        return null;
      try {
        schemas.validate(operation.inputSchema, input);
        schemas.validate(operation.outputSchema, result);
      } catch { return null; }
      const wire = result as Record<string, unknown>;
      if (wire['commandId'] !== operation.commandId) return null;
      const selected = input['context'] as { workspaceId: string; homeId: string };
      const resolved = wire['resolvedScope'] as { workspaceId: string; homeId: string };
      const data = wire['data'] as { downloadToken: string; contentType: string; target: unknown };
      const target = input['target'] as { authority: string; recordType: string; recordId: string };
      const returnedTarget = data.target as { authority: string; recordType: string; recordId: string };
      if (wire['status'] !== 'read' || wire['requestId'] !== input['requestId']
        || selected.workspaceId !== context.scope.workspaceId || selected.homeId !== context.scope.homeId
        || resolved.workspaceId !== selected.workspaceId || resolved.homeId !== selected.homeId
        || returnedTarget.authority !== target.authority || returnedTarget.recordType !== target.recordType
        || returnedTarget.recordId !== target.recordId) return null;
      context.signal.throwIfAborted();
      // The token comes from the validated issuer result. The server owns this
      // exact route and authenticates its current session/record/bytes anew.
      const href = `/api/atlas/media/downloads/${encodeURIComponent(selected.workspaceId)}/${encodeURIComponent(selected.homeId)}/${encodeURIComponent(data.downloadToken)}`;
      let observed: unknown;
      try {
        observed = await withReadDeadline(context.signal, async signal => {
          const response = await transport(`${href}/availability`, {
            method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
            headers: { Accept: 'application/json' }, signal,
          });
          if (signal.aborted) { discard(response); signal.throwIfAborted(); }
          if (!response.ok) { discard(response); return null; }
          return await receive(response, signal);
        });
      } catch {
        context.signal.throwIfAborted();
        return null;
      }
      context.signal.throwIfAborted();
      if (!observed || typeof observed !== 'object' || Array.isArray(observed)) return null;
      const availability = observed as { state?: unknown; lifetime?: { remainingMs?: unknown } };
      const remainingMs = availability.lifetime?.remainingMs;
      if (availability.state !== 'available' || typeof remainingMs !== 'number'
        || !Number.isSafeInteger(remainingMs) || remainingMs <= 0 || remainingMs > 300_000) return null;
      return { href, filename: null, mediaType: data.contentType, label: 'Download original',
        lifetime: { remainingMs } };
    },
  };
}
