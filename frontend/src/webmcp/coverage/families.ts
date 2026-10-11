import { stockCatalog, stockFamilies } from "../stock-schema.js";
import type { StockDispatchPort, StockSessionPort } from "../stock.js";

/** Families routed by the native stock executor. Only owner-supplied command
 * IDs within these families bind; other provider peers remain unbound. */
export type AtlasCommandFamily = "atlas_records" | "atlas_bindings" | "atlas_media_geometry"
  | "homebox_entities_locations" | "homebox_tags_fields" | "homebox_maintenance" | "network_queries";
export interface CommandFamilyBinding {
  readonly toolName: AtlasCommandFamily;
  /** Exact executable arms supplied by the service owner, never browser grants.
   * For batch, the owner must also enforce its supported child profile. */
  readonly commandIds: readonly string[];
  readonly service: StockDispatchPort;
}
export interface CommandCoverage {
  readonly commandId: string;
  readonly toolName: string;
  readonly state: "admitted-and-bound" | "not-host-admitted" | "service-unbound";
}

/** Adapt independently supplied family services to the existing stock port.
 * Shared validation, correlation and authorization remain with their owners.
 * Binding changes require a new mount; session/admission changes use the
 * original session port's revision and subscription. */
export function bindCommandFamilies(sessions: StockSessionPort, bindings: readonly CommandFamilyBinding[]) {
  const routes = new Map<string, StockDispatchPort>();
  for (const binding of bindings) {
    const family = stockFamilies.families.find(row => row.toolName === binding.toolName);
    if (!family) throw new TypeError("Unknown command family binding");
    for (const id of binding.commandIds) {
      if (!family.commandIds.includes(id) || !stockCatalog.commands.some(row => row.commandId === id))
        throw new TypeError("Command does not belong to the bound family");
      if (routes.has(id)) throw new TypeError("Command has multiple service bindings");
      routes.set(id, binding.service);
    }
  }
  const currentSessions: StockSessionPort = {
    getSnapshot: () => sessions.getSnapshot(),
    subscribe: changed => sessions.subscribe(changed),
    getContext(session) {
      const current = sessions.getContext(session);
      return { ...current, commandIds: current.commandIds.filter(id => routes.has(id)) };
    },
  };
  const service: StockDispatchPort = {
    dispatch(request, context) {
      const current = currentSessions.getContext(context.session);
      const route = routes.get(request.commandId);
      if (!route || !current.commandIds.includes(request.commandId))
        throw new TypeError("Command service is not currently available");
      // Pass the original complete envelope/context to the owner, including
      // caller IDs, nested batch envelopes, nulls and optional fields.
      return route.dispatch(request, context);
    },
  };
  return { sessions: currentSessions, service,
    coverage(): readonly CommandCoverage[] {
      const snapshot = sessions.getSnapshot();
      const admitted = snapshot.state === "authenticated"
        ? sessions.getContext(snapshot).commandIds : [];
      return stockCatalog.commands.map(row => ({ commandId: row.commandId, toolName: row.toolFamily,
        state: !admitted.includes(row.commandId) ? "not-host-admitted"
          : routes.has(row.commandId) ? "admitted-and-bound" : "service-unbound" }));
    },
  };
}

/** Split the existing common executor using its owner's exact support list.
 * This does not infer service support from catalog metadata or user roles. */
export function bindAtlasService(service: StockDispatchPort, commandIds: readonly string[]): readonly CommandFamilyBinding[] {
  const names: readonly AtlasCommandFamily[] = [
    "atlas_records", "atlas_bindings", "atlas_media_geometry", "homebox_entities_locations",
    "homebox_tags_fields", "homebox_maintenance", "network_queries",
  ];
  const bindings = names.map(toolName => ({ toolName, service,
    commandIds: commandIds.filter(id => stockFamilies.families.find(row => row.toolName === toolName)?.commandIds.includes(id)),
  }));
  if (bindings.reduce((count, binding) => count + binding.commandIds.length, 0) !== commandIds.length)
    throw new TypeError("Service support includes an unbound command family");
  return bindings;
}
