import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { AnySchemaObject, ValidateFunction } from 'ajv';
import agent from '../../../contracts/stock-wire3/agent/agent.schema.json' with { type: 'json' };
import atlas from '../../../packages/contracts/schemas/atlas.schema.json' with { type: 'json' };

/** The one Ajv for the pinned stock contracts (Atlas and agent), built on first
 * use. Adding the agent contract and compiling against it takes seconds of
 * main thread on a phone, so nothing here runs while the app's modules load,
 * and every client shares the closures already compiled. */
let shared: Ajv2020 | null = null;
const added = new Set<unknown>();
export function stockAjv(): Ajv2020 {
  if (!shared) {
    const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
    addFormats(ajv); ajv.addSchema(atlas); ajv.addSchema(agent);
    shared = ajv;
  }
  return shared;
}

/** `stockAjv()` with `schemas` added once, for a contract only some clients read. */
export function stockAjvWith(...schemas: readonly AnySchemaObject[]): Ajv2020 {
  const ajv = stockAjv();
  for (const schema of schemas) if (!added.has(schema.$id)) { ajv.addSchema(schema); added.add(schema.$id); }
  return ajv;
}

/** A validator that `compile` builds on its first call and keeps. */
export function compileOnUse<T>(compile: (ajv: Ajv2020) => ValidateFunction<T>): (value: unknown) => value is T {
  let check: ValidateFunction<T> | null = null;
  return (value): value is T => (check ??= compile(stockAjv()))(value);
}
