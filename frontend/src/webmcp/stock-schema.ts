import agentSchema from "../../../contracts/stock-wire3/agent/agent.schema.json";
import atlasSchema from "../../../packages/contracts/schemas/atlas.schema.json";
import operationCatalog from "../../../contracts/stock-wire3/agent/operation-catalog.json";
import toolFamilies from "../../../contracts/stock-wire3/agent/tool-families.json";
import type { JsonObject, JsonValue } from "./ports.js";

/** Exact shared inputs, not a second operation registry or generated contract. */
export const stockCatalog = operationCatalog;
export const stockFamilies = toolFamilies;
export const stockSchemaId = agentSchema.$id;

/** Materialize only reachable canonical definitions for a browser schema. All
 * references become local; no browser schema fetch or authority is introduced.
 */
export function stockInputSchema(refs: readonly string[]): JsonObject {
  const definitions: Record<string, JsonValue> = {};
  const sources: Record<string, JsonObject> = {
    agent: agentSchema as JsonObject,
    atlas: atlasSchema as JsonObject,
  };
  const reference = (ref: string, source: string): string => {
    if (ref.startsWith(`${atlasSchema.$id}#`)) {
      source = "atlas";
      ref = ref.slice(atlasSchema.$id.length);
    } else if (ref.startsWith(`${agentSchema.$id}#`)) {
      source = "agent";
      ref = ref.slice(agentSchema.$id.length);
    }
    if (!ref.startsWith("#/$defs/")) throw new TypeError("Unknown shared stock schema reference");
    const name = ref.slice("#/$defs/".length);
    const key = `${source}__${name}`;
    if (!Object.hasOwn(definitions, key)) {
      const defs = sources[source]?.["$defs"] as JsonObject | undefined;
      const node = defs?.[name];
      if (node === undefined) throw new TypeError("Missing shared stock schema definition");
      // Placeholder admits recursive schema references while retaining originals.
      definitions[key] = {};
      definitions[key] = rewrite(node, source);
    }
    return `#/$defs/${key}`;
  };
  const rewrite = (value: JsonValue, source: string): JsonValue => {
    if (Array.isArray(value)) return value.map(child => rewrite(child, source));
    if (typeof value !== "object" || value === null) return value;
    const result: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = key === "$ref" && typeof child === "string"
        ? reference(child, source) : rewrite(child, source);
    }
    return result;
  };
  const arms = refs.map(ref => ({ $ref: reference(ref, "agent") }));
  return { $schema: agentSchema.$schema, type: "object", oneOf: arms, $defs: definitions };
}
