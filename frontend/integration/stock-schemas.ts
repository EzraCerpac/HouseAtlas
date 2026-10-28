import agent from "../../contracts/client-schemas/agent-ajv.schema.json";
import { stockAjv } from "../src/numeric/stock-ajv";
import type { StockSchemaPort } from "../src/webmcp/stock.js";

/** Shared immutable resources, resolved offline without coercion or defaults.
 * The contracts are compiled on the first validation, not when the port is made. */
export function createStockSchemas(): StockSchemaPort {
  return {
    validate(reference, value) {
      const canonical = reference.startsWith("#") ? agent.$id + reference : reference;
      const check = stockAjv().getSchema(canonical);
      if (!check || !check(value)) throw new TypeError("Stock envelope is incompatible");
    },
  };
}
