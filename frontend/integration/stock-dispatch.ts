import { stockCatalog } from "../src/webmcp/stock-schema.js";
import type { StockDispatchPort } from "../src/webmcp/stock.js";

export function createStockDispatch(): StockDispatchPort {
  return {
    async dispatch(request, context) {
      const operation = stockCatalog.commands.find(row => row.commandId === request.commandId);
      if (!operation) throw new TypeError("Unknown stock operation");
      const root = `/api/atlas/stock/v3/workspaces/${encodeURIComponent(request.context.workspaceId)}/homes/${encodeURIComponent(request.context.homeId)}`;
      const raw = JSON.stringify(request);
      const read = operation.effect === "read";
      const query = `request=${encodeURIComponent(raw)}`;
      if (read && (new TextEncoder().encode(raw).length > 16_384 || query.length > 32_768))
        throw new TypeError("Stock request exceeds read transport bound");
      const response = await fetch(read ? `${root}/invoke?${query}` : `${root}/commands`, {
        method: read ? "GET" : "POST",
        credentials: "same-origin", cache: "no-store", redirect: "error",
        signal: context.signal,
        headers: read ? { Accept: "application/json" } : {
          Accept: "application/json", "Content-Type": "application/json",
          "X-Atlas-CSRF": context.applicationSession.csrfToken,
        },
        ...(read ? {} : { body: raw }),
      });
      const body: unknown = await response.json();
      if (!response.ok && (!body || typeof body !== "object" || !("schemaVersion" in body) || body.schemaVersion !== 3))
        throw new Error("Stock transport could not complete");
      // The owner boundary validates actual success/error schema and correlation.
      // Retry advice is displayed; this client never automatically resubmits.
      return body;
    },
  };
}
