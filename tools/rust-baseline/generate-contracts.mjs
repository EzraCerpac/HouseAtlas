// Deterministic local generation. No network, controls, or executable fixtures.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
assert.equal(process.version, 'v26.10.0', 'Contract generation requires the repository-pinned Node version');
const atlasPath = 'packages/contracts/schemas/atlas.schema.json';
const historyPath = 'packages/contracts/history/http-history.v1.1.0.schema.json';
const read = path => readFileSync(new URL(path, root), 'utf8');
const atlasBytes = read(atlasPath);
const historyBytes = read(historyPath);
const atlas = JSON.parse(atlasBytes);
const history = JSON.parse(historyBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = `${atlasPath} sha256:${hash(atlasBytes)}\n${historyPath} sha256:${hash(historyBytes)}`;
const pascal = name => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean)
  .map(word => word[0].toUpperCase() + word.slice(1)).join('').replace(/^(?=[0-9])/u, 'V');
const snake = name => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();
const definitionName = name => name === 'record' ? 'AtlasRecord' : pascal(name);
const rustIdentifier = name => ['type', 'ref', 'match', 'from', 'self', 'super', 'crate', 'loop', 'move'].includes(snake(name))
  ? `r#${snake(name)}` : snake(name);
const refName = ref => {
  assert.match(ref, /^#\/\$defs\/[^/]+$/u, 'Only canonical local definition references are supported');
  const key = ref.slice('#/$defs/'.length);
  assert.ok(Object.hasOwn(atlas.$defs, key), `Unknown reference: ${ref}`);
  return definitionName(key);
};
const nullable = schema => schema.type === 'null' || (Array.isArray(schema.type) && schema.type.includes('null'))
  || (schema.anyOf ?? schema.oneOf ?? []).some(nullable);
const keywords = new Set(['$schema', '$id', '$defs', '$ref', 'title', 'description', 'type', 'properties', 'required',
  'additionalProperties', 'items', 'oneOf', 'anyOf', 'allOf', 'if', 'then', 'const', 'enum', 'format', 'pattern',
  'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'minItems', 'maxItems', 'uniqueItems']);
function inspect(schema) {
  for (const key of Object.keys(schema)) assert.ok(keywords.has(key), `Unsupported schema keyword: ${key}`);
  for (const child of Object.values(schema.$defs ?? {})) inspect(child);
  for (const child of Object.values(schema.properties ?? {})) inspect(child);
  for (const key of ['oneOf', 'anyOf', 'allOf']) for (const child of schema[key] ?? []) inspect(child);
  for (const key of ['items', 'if', 'then']) if (schema[key]) inspect(schema[key]);
  if (schema.allOf) {
    // Conditional refinements keep the base DTO shape; the runtime schema enforces them.
    assert.equal(schema.type, 'object');
    for (const rule of schema.allOf) {
      assert.deepEqual(Object.keys(rule).sort(), ['if', 'then']);
      for (const part of [rule.if, rule.then]) {
        assert.ok(Object.keys(part).every(key => ['properties', 'required'].includes(key)));
        for (const key of part.required ?? []) assert.ok(Object.hasOwn(schema.properties, key));
        for (const [key, refinement] of Object.entries(part.properties)) {
          assert.ok(Object.hasOwn(schema.properties, key));
          assert.ok(!refinement.properties && !refinement.$ref && !refinement.oneOf && !refinement.anyOf);
          if (refinement.type) assert.equal(refinement.type, schema.properties[key].type);
        }
      }
    }
  }
}
inspect(atlas);
inspect(history);
assert.equal(history.type, 'array');
assert.equal(history.items.$ref, '../schemas/atlas.schema.json#/$defs/audit');

const declarations = new Map();
const schemaDefinitions = Object.keys(atlas.$defs);
function declare(name, schema) {
  const old = declarations.get(name);
  if (old) { assert.deepEqual(old.schema, schema, `Generated name collision: ${name}`); return name; }
  const item = { schema, rust: '', ts: '' };
  declarations.set(name, item);
  if (schema.type === 'object') {
    assert.ok(schema.properties, `Object ${name} must declare its fields`);
    assert.equal(typeof schema.additionalProperties, 'boolean', `Object ${name} must declare its boundary`);
    const required = new Set(schema.required ?? []);
    for (const key of required) assert.ok(Object.hasOwn(schema.properties, key));
    const fields = Object.entries(schema.properties).map(([key, value]) => {
      const type = typeOf(value, name + pascal(key));
      const isRequired = required.has(key);
      const attributes = [`#[serde(rename = ${JSON.stringify(key)})]`];
      if (!isRequired) attributes.push('#[serde(default, skip_serializing_if = "Optional::is_missing")]');
      else if (nullable(value)) attributes.push('#[serde(deserialize_with = "required_field")]');
      return {
        rust: attributes.map(line => `    ${line}`).join('\n') + `\n    pub ${rustIdentifier(key)}: ${isRequired ? type.rust : `Optional<${type.rust}>`},`,
        decode: `            ${rustIdentifier(key)}: super::json_value::take_${isRequired ? 'required' : 'optional'}(&mut fields, ${JSON.stringify(key)})\n                .map_err(serde::de::Error::custom)?,`,
        ts: `  ${JSON.stringify(key)}${isRequired ? '' : '?'}: ${type.ts};`,
      };
    });
    const open = schema.additionalProperties;
    const extrasSerializer = `serialize_${snake(name)}_extras`;
    // Whole-object raw capture precedes Serde's flatten buffering, preserving
    // arbitrary object keys instead of interpreting serde_json's private tags.
    const openDeserializer = open ? `\n\nimpl<'de> Deserialize<'de> for ${name} {\n    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {\n        let mut fields = super::json_value::deserialize_fields(deserializer)?;\n        Ok(Self {\n${fields.map(field => field.decode).join('\n')}\n            additional_properties: super::json_value::remaining_fields(fields)\n                .map_err(serde::de::Error::custom)?,\n        })\n    }\n}` : '';
    item.rust = `#[derive(Debug, Clone, PartialEq, Serialize${open ? '' : ', Deserialize'})]\n${open ? '' : '#[serde(deny_unknown_fields)]\n'}pub struct ${name} {\n${fields.map(field => field.rust).join('\n')}${open ? `\n    /// Unmodeled fields are permitted only by this open upstream wire schema.\n    #[serde(flatten, serialize_with = ${JSON.stringify(extrasSerializer)})]\n    pub additional_properties: std::collections::BTreeMap<String, serde_json::Value>,` : ''}\n}${openDeserializer}${open ? `\n\nfn ${extrasSerializer}<S: serde::Serializer>(\n    properties: &std::collections::BTreeMap<String, serde_json::Value>,\n    serializer: S,\n) -> Result<S::Ok, S::Error> {\n    super::serialize_additional_properties(\n        properties,\n        &[${Object.keys(schema.properties).map(key => JSON.stringify(key)).join(', ')}],\n        serializer,\n    )\n}` : ''}`;
    item.ts = `export interface ${name} {\n${fields.map(field => field.ts).join('\n')}${open ? '\n  [key: string]: unknown;' : ''}\n}`;
  } else if (Object.hasOwn(schema, 'const') && typeof schema.const === 'string' || schema.enum) {
    const values = schema.enum ?? [schema.const];
    assert.ok(values.every(value => typeof value === 'string'), 'Only string enums are supported');
    const variants = values.map(value => pascal(value));
    assert.equal(new Set(variants).size, values.length, `Enum name collision: ${name}`);
    item.rust = `#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]\npub enum ${name} {\n${values.map((value, index) => `    #[serde(rename = ${JSON.stringify(value)})]\n    ${variants[index]},`).join('\n')}\n}`;
    item.ts = `export type ${name} = ${values.map(value => JSON.stringify(value)).join(' | ')};`;
  } else {
    const branches = schema.oneOf ?? schema.anyOf ?? (Array.isArray(schema.type) ? schema.type.map(type => ({ type })) : null);
    if (branches) {
      const variants = branches.map((branch, index) => {
        const discriminator = ['kind', 'recordType', 'operation', 'status'].map(key => branch.properties?.[key]?.const).find(value => typeof value === 'string');
        const variant = branch.$ref ? refName(branch.$ref) : discriminator ? pascal(discriminator) : branch.type && !Array.isArray(branch.type) ? pascal(branch.type) : `Variant${index + 1}`;
        return { variant, type: typeOf(branch, name + variant) };
      });
      assert.equal(new Set(variants.map(branch => branch.variant)).size, variants.length, `Union name collision: ${name}`);
      // Box the wide document envelope while preserving its untagged JSON shape.
      item.rust = `#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n#[serde(untagged)]\npub enum ${name} {\n${variants.map(branch => `    ${branch.variant}(${name === 'AtlasDocument' ? `Box<${branch.type.rust}>` : branch.type.rust}),`).join('\n')}\n}`;
      item.ts = `export type ${name} = ${variants.map(branch => branch.type.ts).join(' | ')};`;
    } else {
      const type = typeOf(schema, name + 'Value');
      item.rust = `pub type ${name} = ${type.rust};`;
      item.ts = `export type ${name} = ${type.ts};`;
    }
  }
  return name;
}
function typeOf(schema, hint) {
  if (schema.$ref) { const name = refName(schema.$ref); return { rust: name, ts: name }; }
  if (Object.hasOwn(schema, 'const')) {
    if (typeof schema.const === 'string') return { rust: declare(hint, schema), ts: JSON.stringify(schema.const) };
    if (typeof schema.const === 'boolean') return { rust: `ConstBool<${schema.const}>`, ts: String(schema.const) };
    assert.ok(Number.isSafeInteger(schema.const), 'Only safe integer numeric literals are supported');
    return { rust: `ConstInt<${schema.const}>`, ts: String(schema.const) };
  }
  if (schema.enum) return { rust: declare(hint, schema), ts: hint };
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches?.some(branch => branch.type === 'null')) {
    const rest = branches.filter(branch => branch.type !== 'null');
    assert.ok(rest.length > 0);
    const value = typeOf(rest.length === 1 ? rest[0] : { anyOf: rest }, hint);
    return { rust: `Option<${value.rust}>`, ts: `${value.ts} | null` };
  }
  // Format alternatives share a string wire type; their constraints remain
  // authoritative at the JSON Schema boundary rather than duplicate DTO arms.
  if (schema.anyOf?.length && schema.anyOf.every(branch => branch.type === 'string'
    && !branch.$ref && !branch.enum && !Object.hasOwn(branch, 'const'))) {
    return { rust: 'String', ts: 'string' };
  }
  if (branches || Array.isArray(schema.type) || schema.type === 'object') {
    return { rust: declare(hint, schema), ts: hint };
  }
  if (schema.type === 'array') {
    assert.ok(schema.items, 'Arrays must declare item schemas');
    const item = typeOf(schema.items, hint + 'Item');
    return { rust: `Vec<${item.rust}>`, ts: `Array<${item.ts}>` };
  }
  const primitive = { string: ['String', 'string'], integer: ['JsonInteger', 'number'], number: ['JsonNumber', 'number'], boolean: ['bool', 'boolean'], null: ['()', 'null'] }[schema.type];
  assert.ok(primitive, `Unsupported schema type at ${hint}: ${JSON.stringify(schema)}`);
  return { rust: primitive[0], ts: primitive[1] };
}
for (const [name, schema] of Object.entries(atlas.$defs)) declare(definitionName(name), schema);
declare('AtlasDocument', { oneOf: atlas.oneOf });
const rust = `// @generated by tools/rust-baseline/generate-contracts.mjs; do not edit.\n// ${sources.replaceAll('\n', '\n// ')}\n// DTOs preserve wire shape. contracts::{decode, validate, encode} enforces schema constraints.\nuse serde::{Deserialize, Serialize};\nuse super::{required_field, ConstBool, ConstInt, Contract, JsonInteger, JsonNumber, Optional};\n\n${[...declarations.values()].map(item => item.rust).join('\n\n')}\n\npub type Record = AtlasRecord;\npub type HttpHistory = Vec<Audit>;\n\npub(crate) const SCHEMA_DEFINITIONS: &[&str] = &[\n${schemaDefinitions.map(name => `    ${JSON.stringify(name)},`).join('\n')}\n];\n\n${schemaDefinitions.map(name => `impl Contract for ${definitionName(name)} { const SCHEMA_KEY: &'static str = ${JSON.stringify(name)}; }`).join('\n')}\nimpl Contract for AtlasDocument { const SCHEMA_KEY: &'static str = "$atlas"; }\nimpl Contract for HttpHistory { const SCHEMA_KEY: &'static str = "$history"; }\n`;
const ts = `// @generated by tools/rust-baseline/generate-contracts.mjs; do not edit.\n// ${sources.replaceAll('\n', '\n// ')}\n// Static DTO types; JSON Schema remains authoritative for runtime constraints.\n\n${[...declarations.values()].map(item => item.ts).join('\n\n')}\n\nexport type Record = AtlasRecord;\nexport type HttpHistory = Array<Audit>;\n`;
const consumerInputs = [
  ['healthySnapshot', 'Snapshot', 'packages/contracts/fixtures/plan-free.snapshot.json'],
  ['healthyHistory', 'HttpHistory', 'packages/contracts/history/fixtures/recorded.audit-array.json'],
  ['healthyHomeboxPage', 'HomeboxPageWire', 'packages/contracts/fixtures/homebox-page.wire.json'],
  ['healthyMutationResult', 'MutationResult', 'packages/contracts/fixtures/create-circuit.result.json'],
];
const consumer = `// @generated from named existing synthetic fixtures; no fixture execution.\nimport type { Snapshot, HttpHistory, HomeboxPageWire, MutationResult } from '../../frontend/src/api/generated/contracts';\n\n${consumerInputs.map(([name, type, path]) => `// ${path}\nexport const ${name}: ${type} = ${JSON.stringify(JSON.parse(read(path)), null, 2)};`).join('\n\n')}\n`;
const allOutputs = [
  ['backend/src/contracts/generated.rs', execFileSync('rustfmt', ['--edition', '2024', '--emit', 'stdout'], { cwd: fileURLToPath(root), input: rust, encoding: 'utf8' })],
  ['frontend/src/api/generated/contracts.ts', ts],
  ['tools/rust-baseline/healthy-contracts.ts', consumer],
];
assert.ok(process.argv.slice(2).every(arg => ['--check', '--rust-only'].includes(arg)), 'Usage: node generate-contracts.mjs [--check] [--rust-only]');
const outputs = process.argv.includes('--rust-only') ? allOutputs.filter(([path]) => path.endsWith('.rs')) : allOutputs;
for (const [path, content] of outputs) {
  if (process.argv.includes('--check')) assert.equal(read(path), content, `${path} differs; run the generator`);
  else { const target = fileURLToPath(new URL(path, root)); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); }
}
console.log(`Contract generation ${process.argv.includes('--check') ? 'matches' : 'wrote'} ${outputs.length} deterministic source files (${schemaDefinitions.length} canonical definitions and bare HTTP history).`);
