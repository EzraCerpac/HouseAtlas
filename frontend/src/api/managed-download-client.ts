import type { GatewayDownloadPort } from '../webmcp/gateway/ports.js';
import type { StockSchemaPort } from '../webmcp/stock.js';
import { stockCatalog } from '../webmcp/stock-schema.js';

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
        const response = await transport(`${href}/availability`, {
          method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
          headers: { Accept: 'application/json' }, signal: context.signal,
        });
        if (!response.ok) return null;
        observed = await response.json();
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
