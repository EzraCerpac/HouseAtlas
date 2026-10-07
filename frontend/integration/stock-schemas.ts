import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import agent from "../../contracts/stock-wire3/agent/agent.schema.json";
import atlas from "../../packages/contracts/schemas/atlas.schema.json";
import type { StockSchemaPort } from "../src/webmcp/stock.js";

/** Shared immutable resources, resolved offline without coercion or defaults. */
export function createStockSchemas(): StockSchemaPort {
  const validator = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
  addFormats(validator);
  validator.addSchema(atlas);
  validator.addSchema(agent);
  return {
    validate(reference, value) {
      const canonical = reference.startsWith("#") ? agent.$id + reference : reference;
      const check = validator.getSchema(canonical);
      if (!check || !check(value)) throw new TypeError("Stock envelope is incompatible");
    },
  };
}
