import type { ModelContextPort } from "./ports.js";

/** Explicit feature detection only: importing this module never registers tools. */
export function detectModelContext(documentLike: unknown): ModelContextPort | undefined {
  if (typeof documentLike !== "object" || documentLike === null) return undefined;
  const context: unknown = Reflect.get(documentLike, "modelContext");
  if (typeof context !== "object" || context === null) return undefined;
  if (typeof Reflect.get(context, "registerTool") !== "function") return undefined;
  return context as ModelContextPort;
}
