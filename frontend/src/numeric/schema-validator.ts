/// <reference types="vite/client" />
import { fullFormats } from 'ajv-formats/dist/formats.js';
import agentSource from '../../../contracts/stock-wire3/agent/agent.schema.json?raw';
import atlasSource from '../../../packages/contracts/schemas/atlas.schema.json?raw';
import { ExactDecimal, isExactDecimal } from './decimal';
import type { LosslessJson } from './lossless-json';

/** The only accepted result definitions. Schema and instance numbers never pass through f64. */
export type StockResultKind = 'geometry' | 'identity' | 'binding' | 'location_semantics' | 'relation' | 'evidence';
const roots: Record<StockResultKind, string> = {
  geometry: 'result_atlas_geometry_list',
  identity: 'result_atlas_identity_list',
  binding: 'result_atlas_binding_list',
  location_semantics: 'result_atlas_location_semantics_list',
  relation: 'result_atlas_relation_list',
  evidence: 'result_atlas_evidence_get',
};
// Closed Atlas write outputs from catalog SHA-256 f369fdf13aaebf836760f5b5d2160214c16706f89e2ea5898e80c6a857d9ab4c.
const mutationRoots: Readonly<Record<string, string>> = Object.freeze({
  "atlas.identity.create": "#/$defs/result_atlas_identity_create",
  "atlas.identity.replace": "#/$defs/result_atlas_identity_replace",
  "atlas.identity.tombstone": "#/$defs/result_atlas_identity_tombstone",
  "atlas.identity.restore": "#/$defs/result_atlas_identity_restore",
  "atlas.binding.create": "#/$defs/result_atlas_binding_create",
  "atlas.binding.review": "#/$defs/result_atlas_binding_review",
  "atlas.binding.tombstone": "#/$defs/result_atlas_binding_tombstone",
  "atlas.binding.restore": "#/$defs/result_atlas_binding_restore",
  "atlas.evidence.create": "#/$defs/result_atlas_evidence_create",
  "atlas.evidence.tombstone": "#/$defs/result_atlas_evidence_tombstone",
  "atlas.evidence.restore": "#/$defs/result_atlas_evidence_restore",
  "atlas.location-semantics.create": "#/$defs/result_atlas_location_semantics_create",
  "atlas.location-semantics.replace": "#/$defs/result_atlas_location_semantics_replace",
  "atlas.location-semantics.tombstone": "#/$defs/result_atlas_location_semantics_tombstone",
  "atlas.location-semantics.restore": "#/$defs/result_atlas_location_semantics_restore",
  "atlas.circuit.create": "#/$defs/result_atlas_circuit_create",
  "atlas.circuit.replace": "#/$defs/result_atlas_circuit_replace",
  "atlas.circuit.tombstone": "#/$defs/result_atlas_circuit_tombstone",
  "atlas.circuit.restore": "#/$defs/result_atlas_circuit_restore",
  "atlas.valve.create": "#/$defs/result_atlas_valve_create",
  "atlas.valve.replace": "#/$defs/result_atlas_valve_replace",
  "atlas.valve.tombstone": "#/$defs/result_atlas_valve_tombstone",
  "atlas.valve.restore": "#/$defs/result_atlas_valve_restore",
  "atlas.relation.create": "#/$defs/result_atlas_relation_create",
  "atlas.relation.replace": "#/$defs/result_atlas_relation_replace",
  "atlas.relation.tombstone": "#/$defs/result_atlas_relation_tombstone",
  "atlas.relation.restore": "#/$defs/result_atlas_relation_restore",
  "atlas.geometry.create": "#/$defs/result_atlas_geometry_create",
  "atlas.geometry.tombstone": "#/$defs/result_atlas_geometry_tombstone",
  "atlas.geometry.restore": "#/$defs/result_atlas_geometry_restore",
  "atlas.asset.create": "#/$defs/result_atlas_asset_create",
  "atlas.asset.review": "#/$defs/result_atlas_asset_review",
  "atlas.asset.tombstone": "#/$defs/result_atlas_asset_tombstone",
  "atlas.asset.restore": "#/$defs/result_atlas_asset_restore",
  "atlas.reconciliation.create": "#/$defs/result_atlas_reconciliation_create",
  "atlas.reconciliation.tombstone": "#/$defs/result_atlas_reconciliation_tombstone",
  "atlas.reconciliation.restore": "#/$defs/result_atlas_reconciliation_restore",
  "atlas.binding.remap": "#/$defs/result_atlas_binding_remap",
  "atlas.binding.reassign-identity": "#/$defs/result_atlas_binding_reassign_identity",
  "atlas.asset.hard-purge": "#/$defs/result_atlas_asset_hard_purge",
  "atlas.evidence.replace": "#/$defs/result_atlas_evidence_replace",
  "atlas.geometry.replace": "#/$defs/result_atlas_geometry_replace",
  "atlas.reconciliation.replace": "#/$defs/result_atlas_reconciliation_replace",
  "atlas.batch.execute": "#/$defs/result_atlas_batch_execute",
});
// The native place form admits only these existing canonical arms. No dynamic roots.
const nativeRequests = Object.freeze({
  'atlas.identity.get': 'request_atlas_identity_get',
  'atlas.evidence.get': 'request_atlas_evidence_get',
  'atlas.location-semantics.get': 'request_atlas_location_semantics_get',
  'atlas.evidence.create': 'request_atlas_evidence_create',
  'atlas.identity.create': 'request_atlas_identity_create',
  'atlas.location-semantics.create': 'request_atlas_location_semantics_create',
  'atlas.location-semantics.replace': 'request_atlas_location_semantics_replace',
  'atlas.relation.create': 'request_atlas_relation_create',
  'atlas.batch.execute': 'request_atlas_batch_execute',
});
const nativeReads = Object.freeze({
  'atlas.identity.get': 'result_atlas_identity_get',
  'atlas.evidence.get': 'result_atlas_evidence_get',
  'atlas.location-semantics.get': 'result_atlas_location_semantics_get',
});
// Actual flattened Atlas records/guards returned by the native evidence DTO.
const nativeEvidenceShapes = Object.freeze({
  identity: 'identityRecord',
  'location-semantics': 'location-semanticsRecord',
  guard: 'guard',
});
const agentId = 'urn:houseatlas:agent:stock:3';
const atlasId = 'https://houseatlas.invalid/contracts/1.1.0/atlas.schema.json';
const dialect = 'https://json-schema.org/draft/2020-12/schema';
const agentHash = '42174cebb9a7080cacb8231aba2bf80c4ab59fdb92085db1af3d5fe368cd5835';
const atlasHash = 'b24f2d0ba25287ecbeb6618dd26728cb201875103edaede51804e00e26c3bc86';

type Schema = boolean | Record<string, unknown>;
type Document = Record<string, unknown>;
type Compiled = { schema: Schema; source: string; ref?: Compiled; children: Record<string, Compiled | Compiled[] | Record<string, Compiled>>; pattern?: RegExp; limits: Partial<Record<'minimum' | 'maximum' | 'exclusiveMinimum' | 'exclusiveMaximum', ExactDecimal>> };
const assertions = new Set(['$ref', 'type', 'const', 'enum', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'required', 'properties', 'additionalProperties', 'items', 'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern', 'format', 'allOf', 'anyOf', 'oneOf', 'if', 'then', 'else']);
const annotations = new Set(['$comment', 'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly']);
const singleChildren = ['additionalProperties', 'items', 'if', 'then', 'else'] as const;
const arrayChildren = ['allOf', 'anyOf', 'oneOf'] as const;
const types = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);
const has = (object: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) && !isExactDecimal(value);
const schemaNode = (value: unknown): value is Schema => typeof value === 'boolean' || object(value);
const fail: (message: string) => never = (message) => { throw new TypeError(`Unsupported stock result schema: ${message}`); };

// Synchronous SHA-256 of the exact imported source bytes. A changed schema cannot silently
// broaden this closed evaluator, even when its reachable keyword list happens to be unchanged.
function sha256(source: string): string {
  const bytes = new TextEncoder().encode(source);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array((bytes.length + 9 + 63) & ~63);
  padded.set(bytes); padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const primes: number[] = [];
  const initial: number[] = [];
  for (let candidate = 2; primes.length < 64; candidate++) {
    let prime = true;
    for (let factor = 2; factor * factor <= candidate; factor++) if (candidate % factor === 0) { prime = false; break; }
    if (!prime) continue;
    const fractional = (number: number) => (number % 1 * 0x100000000) >>> 0;
    if (primes.length < 8) initial.push(fractional(Math.sqrt(candidate)));
    primes.push(fractional(Math.cbrt(candidate)));
  }
  const state = initial;
  const words = new Uint32Array(64);
  const rotate = (value: number, count: number) => (value >>> count) | (value << (32 - count));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15]!; const b = words[i - 2]!;
      words[i] = (words[i - 16]! + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + words[i - 7]! + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + primes[i]! + words[i]!) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    for (const [i, value] of [a, b, c, d, e, f, g, h].entries()) state[i] = (state[i]! + value) >>> 0;
  }
  return state.map(value => value.toString(16).padStart(8, '0')).join('');
}

function schemaConstant(value: unknown): LosslessJson {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail('unsafe numeric schema constant');
    return ExactDecimal.parse(String(value));
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(schemaConstant);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, schemaConstant(child)]));
  return fail('invalid JSON schema constant');
}

function exactEqual(left: LosslessJson, right: LosslessJson): boolean {
  if (isExactDecimal(left)) return isExactDecimal(right) && left.compare(right) === 0;
  if (left === null || typeof left !== 'object') return left === right;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((item, index) => exactEqual(item, right[index]!));
  if (!object(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => has(right, key) && exactEqual(left[key]!, right[key] as LosslessJson));
}

/** Collision-free structural key: sorted object names and normalized decimal values. */
function exactKey(value: LosslessJson): string {
  if (isExactDecimal(value)) {
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.token);
    if (!match) throw new TypeError('Invalid exact numeric node');
    let coefficient = ((match[2] ?? '') + (match[3] ?? '')).replace(/^0+/, '');
    if (!coefficient) return 'n0';
    let shift = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
    while (coefficient.endsWith('0')) { coefficient = coefficient.slice(0, -1); shift++; }
    return `n${match[1] === '-' ? '-' : '+'}${coefficient}e${shift}`;
  }
  if (value === null) return 'z';
  if (typeof value === 'boolean') return value ? 't' : 'f';
  if (typeof value === 'string') return `s${JSON.stringify(value)}`;
  if (Array.isArray(value)) return `a[${value.map(item => exactKey(item)).join(',')}]`;
  return `o{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${exactKey(value[key]!)}`).join(',')}}`;
}

function isType(value: LosslessJson, type: string): boolean {
  switch (type) {
    case 'null': return value === null;
    case 'boolean': return typeof value === 'boolean';
    case 'string': return typeof value === 'string';
    case 'number': return isExactDecimal(value);
    case 'integer': return isExactDecimal(value) && value.isInteger;
    case 'array': return Array.isArray(value);
    case 'object': return object(value);
    default: return fail(`type ${type}`);
  }
}

type StockFormat = 'uuid' | 'date-time' | 'uri';
function stringFormat(name: StockFormat): (value: string) => boolean {
  const checked = (result: unknown): boolean => {
    if (typeof result !== 'boolean') fail(`format result ${name}`);
    return result;
  };
  const definition: unknown = fullFormats[name];
  if (definition instanceof RegExp) return value => definition.test(value);
  if (typeof definition === 'function') return value => checked(definition(value));
  if (object(definition) && definition.async !== true) {
    const validate = definition.validate;
    if (validate instanceof RegExp) return value => validate.test(value);
    if (typeof validate === 'function') return value => checked(validate(value));
  }
  return fail(`format implementation ${name}`);
}

/** Converts only explicitly bounded control fields after the full schema check. */
export function exactStockSafeInteger(value: LosslessJson): number {
  if (!isExactDecimal(value)) throw new TypeError('Expected an exact integer node');
  const converted = value.toSafeInteger();
  if (converted === undefined) throw new RangeError('Integer exceeds the safe control range');
  return converted;
}

/** Compile and validate only the pinned RESULT definition closures listed above. */
export function createExactStockResultValidator() {
  if (sha256(agentSource) !== agentHash || sha256(atlasSource) !== atlasHash) fail('pinned schema digest mismatch');
  const agent = JSON.parse(agentSource) as Document;
  const atlas = JSON.parse(atlasSource) as Document;
  if (agent.$id !== agentId || atlas.$id !== atlasId || agent.$schema !== dialect || atlas.$schema !== dialect) fail('schema identity or dialect mismatch');
  const formats = { uuid: stringFormat('uuid'), 'date-time': stringFormat('date-time'), uri: stringFormat('uri') };
  const documents: Record<string, Document> = { [agentId]: agent, [atlasId]: atlas };
  const cache = new Map<string, Compiled>();
  const active = new Set<string>();
  const resolve = (ref: string, source: string): Compiled => {
    const index = ref.indexOf('#');
    const id = index === 0 ? source : index < 0 ? '' : ref.slice(0, index);
    const fragment = index < 0 ? '' : ref.slice(index);
    if (!has(documents, id) || !/^#\/\$defs\/(?:[A-Za-z0-9_]+|location-semanticsRecord)$/.test(fragment)) fail(`reference ${ref}`);
    const name = fragment.slice('#/$defs/'.length);
    const definition = (documents[id]!.$defs as Record<string, unknown> | undefined)?.[name];
    if (!schemaNode(definition)) fail(`missing definition ${ref}`);
    const key = `${id}${fragment}`;
    const existing = cache.get(key);
    if (existing) return existing;
    if (active.has(key)) fail(`recursive reference ${ref}`);
    active.add(key);
    try {
      const result = compile(definition, id);
      cache.set(key, result);
      return result;
    } finally { active.delete(key); }
  };
  const compile = (schema: Schema, source: string): Compiled => {
    const result: Compiled = { schema, source, children: {}, limits: {} };
    if (typeof schema === 'boolean') return result;
    for (const key of Object.keys(schema)) if (!assertions.has(key) && !annotations.has(key)) fail(`keyword ${key}`);
    if (has(schema, '$ref')) {
      if (typeof schema.$ref !== 'string') fail('non-string $ref');
      result.ref = resolve(schema.$ref, source);
    }
    if (has(schema, 'type')) {
      const choices = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!choices.length || choices.some(choice => typeof choice !== 'string' || !types.has(choice))) fail('type value');
    }
    for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'] as const) {
      if (!has(schema, key)) continue;
      const bound = schema[key];
      if (typeof bound !== 'number' || !Number.isSafeInteger(bound)) fail(`unsafe ${key}`);
      result.limits[key] = ExactDecimal.parse(String(bound));
    }
    for (const key of ['minItems', 'maxItems', 'minLength', 'maxLength'] as const) {
      if (!has(schema, key)) continue;
      const bound = schema[key];
      if (typeof bound !== 'number' || !Number.isSafeInteger(bound) || bound < 0) fail(key);
    }
    if (has(schema, 'uniqueItems') && typeof schema.uniqueItems !== 'boolean') fail('uniqueItems');
    if (has(schema, 'required') && (!Array.isArray(schema.required) || schema.required.some(value => typeof value !== 'string'))) fail('required');
    if (has(schema, 'enum') && (!Array.isArray(schema.enum) || schema.enum.length === 0)) fail('enum');
    if (has(schema, 'const')) schemaConstant(schema.const);
    if (has(schema, 'enum')) for (const value of schema.enum as unknown[]) schemaConstant(value);
    if (has(schema, 'format') && !['uuid', 'date-time', 'uri'].includes(schema.format as string)) fail(`format ${String(schema.format)}`);
    if (has(schema, 'pattern')) {
      if (typeof schema.pattern !== 'string') fail('pattern');
      try { result.pattern = new RegExp(schema.pattern, 'u'); } catch { fail('invalid pattern'); }
    }
    if (has(schema, 'properties')) {
      if (!object(schema.properties)) fail('properties');
      const properties: Record<string, Compiled> = {};
      for (const [key, child] of Object.entries(schema.properties)) {
        if (!schemaNode(child)) fail(`property ${key}`);
        properties[key] = compile(child, source);
      }
      result.children.properties = properties;
    }
    for (const key of singleChildren) if (has(schema, key)) {
      const nested = schema[key];
      if (!schemaNode(nested)) fail(key);
      result.children[key] = compile(nested, source);
    }
    for (const key of arrayChildren) if (has(schema, key)) {
      if (!Array.isArray(schema[key]) || schema[key].length === 0 || schema[key].some(child => !schemaNode(child))) fail(key);
      result.children[key] = (schema[key] as Schema[]).map(child => compile(child, source));
    }
    return result;
  };
  const compiled = Object.fromEntries(Object.entries(roots).map(([kind, name]) => [kind, resolve(`${agentId}#/$defs/${name}`, agentId)])) as Record<StockResultKind, Compiled>;
  const compiledMutations = Object.fromEntries(Object.entries(mutationRoots).map(([command, ref]) =>
    [command, resolve(`${agentId}${ref}`, agentId)])) as Record<string, Compiled>;
  const compiledNativeRequests = Object.fromEntries(Object.entries(nativeRequests).map(([command, name]) =>
    [command, resolve(`${agentId}#/$defs/${name}`, agentId)])) as Record<string, Compiled>;
  const compiledNativeReads = Object.fromEntries(Object.entries(nativeReads).map(([command, name]) =>
    [command, resolve(`${agentId}#/$defs/${name}`, agentId)])) as Record<string, Compiled>;
  const compiledNativeEvidence = Object.fromEntries(Object.entries(nativeEvidenceShapes).map(([kind, name]) =>
    [kind, resolve(`${atlasId}#/$defs/${name}`, atlasId)])) as Record<keyof typeof nativeEvidenceShapes, Compiled>;
  const evaluate = (node: Compiled, value: LosslessJson): boolean => {
      if (typeof node.schema === 'boolean') return node.schema;
      const schema = node.schema;
      const child = (key: string) => node.children[key] as Compiled;
      const children = (key: string) => node.children[key] as Compiled[];
      if (node.ref && !evaluate(node.ref, value)) return false;
      if (has(schema, 'type')) {
        const options = Array.isArray(schema.type) ? schema.type as string[] : [schema.type as string];
        if (!options.some(type => isType(value, type))) return false;
      }
      if (has(schema, 'const') && !exactEqual(value, schemaConstant(schema.const))) return false;
      if (has(schema, 'enum') && !(schema.enum as unknown[]).some(item => exactEqual(value, schemaConstant(item)))) return false;
      if (isExactDecimal(value)) {
        if (node.limits.minimum && value.compare(node.limits.minimum) < 0) return false;
        if (node.limits.maximum && value.compare(node.limits.maximum) > 0) return false;
        if (node.limits.exclusiveMinimum && value.compare(node.limits.exclusiveMinimum) <= 0) return false;
        if (node.limits.exclusiveMaximum && value.compare(node.limits.exclusiveMaximum) >= 0) return false;
      }
      if (typeof value === 'string') {
        const length = [...value].length;
        if (has(schema, 'minLength') && length < (schema.minLength as number)) return false;
        if (has(schema, 'maxLength') && length > (schema.maxLength as number)) return false;
        if (node.pattern && !node.pattern.test(value)) return false;
        if (has(schema, 'format')) {
          if (!formats[schema.format as StockFormat](value)) return false;
        }
      }
      if (Array.isArray(value)) {
        if (has(schema, 'minItems') && value.length < (schema.minItems as number)) return false;
        if (has(schema, 'maxItems') && value.length > (schema.maxItems as number)) return false;
        if (has(schema, 'items') && !value.every(item => evaluate(child('items'), item))) return false;
        if (schema.uniqueItems === true) {
          const seen = new Set<string>();
          for (const item of value) {
            const key = exactKey(item);
            if (seen.has(key)) return false;
            seen.add(key);
          }
        }
      }
      if (object(value)) {
        if (has(schema, 'required') && !(schema.required as string[]).every(key => has(value, key))) return false;
        const properties = node.children.properties as Record<string, Compiled> | undefined;
        for (const [key, item] of Object.entries(value)) {
          if (properties && has(properties, key)) {
            if (!evaluate(properties[key]!, item as LosslessJson)) return false;
          } else if (has(schema, 'additionalProperties') && !evaluate(child('additionalProperties'), item as LosslessJson)) return false;
        }
      }
      if (has(schema, 'allOf') && !children('allOf').every(item => evaluate(item, value))) return false;
      if (has(schema, 'anyOf') && !children('anyOf').some(item => evaluate(item, value))) return false;
      if (has(schema, 'oneOf')) {
        let matches = 0;
        for (const item of children('oneOf')) if (evaluate(item, value) && ++matches > 1) return false;
        if (matches !== 1) return false;
      }
      if (has(schema, 'if')) {
        const selected = evaluate(child('if'), value) ? 'then' : 'else';
        if (has(schema, selected) && !evaluate(child(selected), value)) return false;
      }
      return true;
  };
  return {
    validate(kind: StockResultKind, value: LosslessJson): boolean {
      if (!has(compiled, kind)) throw new TypeError('Unknown stock result kind');
      return evaluate(compiled[kind], value);
    },
    validateNativeRequest(commandId: string, value: LosslessJson): boolean {
      if (!has(nativeRequests, commandId)) throw new TypeError('Unsupported native place request');
      return evaluate(compiledNativeRequests[commandId]!, value);
    },
    validateNativeRead(commandId: string, value: LosslessJson): boolean {
      if (!has(nativeReads, commandId)) throw new TypeError('Unsupported native place read');
      return evaluate(compiledNativeReads[commandId]!, value);
    },
    validateNativeEvidenceShape(kind: keyof typeof nativeEvidenceShapes, value: LosslessJson): boolean {
      if (!has(nativeEvidenceShapes, kind)) throw new TypeError('Unsupported native evidence shape');
      return evaluate(compiledNativeEvidence[kind], value);
    },
    validateMutation(commandId: string, schemaRef: string, value: LosslessJson): boolean {
      if (!has(mutationRoots, commandId) || mutationRoots[commandId] !== schemaRef)
        throw new TypeError('Unsupported stock mutation result');
      return evaluate(compiledMutations[commandId]!, value);
    },
  };
}
