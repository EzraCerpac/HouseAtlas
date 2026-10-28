// In-process synthetic coverage selected by the existing healthy-read lane.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { generateClientSchemas } from '../../tools/client-schemas/generate.mjs';
import { schemaSubset } from '../../tools/client-schemas/subset.mjs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const json = path => JSON.parse(read(path));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const validator = (...documents) => {
  const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
  // Ajv resolves $anchor while collecting references, but its strict keyword
  // check still rejects it when compiling the anchored definition.
  ajv.addKeyword('$anchor');
  addFormats(ajv); documents.forEach(document => ajv.addSchema(document)); return ajv;
};

export function checkClientSchemaSubset() {
  // Also checks input pins and exact byte-for-byte deterministic regeneration.
  generateClientSchemas({ check: true });
  const full = json('contracts/stock-wire3/agent/agent.schema.json');
  const atlas = json('packages/contracts/schemas/atlas.schema.json');
  const pinned = json('contracts/stock-wire4/pinned-homebox-file.v4.schema.json');
  const subset = json('contracts/client-schemas/agent-ajv.schema.json');
  const exact = json('contracts/client-schemas/agent-exact.schema.json');
  const pins = json('contracts/client-schemas/pins.json');
  for (const document of [subset, exact]) {
    const { $defs: originalDefs, ...originalRoot } = full;
    const { $defs, ...root } = document;
    assert.deepEqual(root, originalRoot, 'IDs, dialect and root assertions remain exact');
    assert(Object.keys($defs).length < Object.keys(originalDefs).length);
    for (const [name, definition] of Object.entries($defs)) assert.deepEqual(definition, originalDefs[name], name);
  }
  assert.equal(json('contracts/client-schemas/agent-exact-pin.json'), hash(read('contracts/client-schemas/agent-exact.schema.json')));
  const catalog = json('contracts/stock-wire3/agent/operation-catalog.json');
  const projected = json('contracts/client-schemas/operation-catalog.json');
  assert.deepEqual(projected.commands, catalog.commands.map(row => Object.fromEntries(pins.catalogFields.map(key => [key, row[key]]))));
  assert.deepEqual(projected.commands.map(row => row.commandId), catalog.commands.map(row => row.commandId));
  for (const row of catalog.commands) for (const key of ['inputSchema', 'outputSchema'])
    assert(pins.roots.ajv.includes(full.$id + row[key]), `All host-admissible arms: ${row.commandId}`);
  // Selected real clients resolve cross-document and deep-pointer references
  // through both resources; every retained definition is compared above.
  const original = validator(atlas, full, pinned), generated = validator(atlas, subset, pinned);
  const healthy = json('backend/src/contracts/stock/examples/healthy.json');
  for (const [index, request] of healthy.requests.entries()) {
    const operation = catalog.commands.find(row => row.commandId === request.commandId);
    assert(operation);
    for (const [ref, value] of [[operation.inputSchema, request], [operation.outputSchema, healthy.results[index].wire]]) {
      const before = original.getSchema(full.$id + ref), after = generated.getSchema(full.$id + ref);
      assert(before && after);
      assert.equal(before(value), true, JSON.stringify(before.errors));
      for (const candidate of [value, { ...value, schemaVersion: 99 }, { ...value, unexpected: true }]) {
        assert.equal(after(candidate), before(candidate));
        assert.deepEqual(after.errors, before.errors);
      }
    }
  }
  const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const context = { workspaceId: uuid(1), homeId: uuid(2) };
  const request = { schemaVersion: 3, commandId: 'homebox.file.download', context, requestId: uuid(3),
    target: { authority: 'homebox', sourceInstanceId: uuid(4), collectionId: uuid(5),
      resourceKind: 'attachment', entityId: uuid(6), resourceId: uuid(7) }, payload: {} };
  const v4 = { ...request, schemaVersion: 4, target: { ...request.target, collectionId: 'synthetic/opaque+collection' } };
  for (const [ref, value] of [
    [`${full.$id}#/$defs/contextSelection`, context],
    [`${full.$id}#/$defs/request_homebox_file_download`, request],
    [`${pinned.$id}#/$defs/request_homebox_file_download_v4`, v4],
  ]) {
    const before = original.getSchema(ref), after = generated.getSchema(ref);
    assert(before && after, ref);
    assert.equal(before(value), true, JSON.stringify(before.errors));
    for (const candidate of [value, { ...value, unexpected: true }, {}, null, [], { ...value, schemaVersion: 99 }]) {
      assert.equal(after(candidate), before(candidate), ref);
      assert.deepEqual(after.errors, before.errors, 'Rejection details are unchanged');
    }
  }
  // All root targets (including pointers below definitions) remain byte-equivalent.
  for (const [kind, document] of [['ajv', subset], ['exact', exact]]) for (const ref of pins.roots[kind]) {
    const [id, pointer] = ref.split('#');
    const beforeDocument = id === full.$id ? full : id === atlas.$id ? atlas : pinned;
    const afterDocument = id === full.$id ? document : beforeDocument;
    const at = source => pointer.slice(1).split('/').reduce((value, key) => value[key.replaceAll('~1', '/').replaceAll('~0', '~')], source);
    assert.deepEqual(at(afterDocument), at(beforeDocument), ref);
  }
  // Static anchors, recursive references, nested IDs, escaped pointers and
  // external definitions are copied in place rather than flattened or rewritten.
  const id = 'https://synthetic.invalid/root.json';
  const schema = { $schema: full.$schema, $id: id, $ref: '#/$defs/entry', $defs: {
    entry: { $ref: '#node' }, node: { $anchor: 'node', type: 'object', additionalProperties: false,
      properties: { child: { $ref: '#node' }, value: { $ref: 'part.json#/$defs/a~1b' } } },
    part: { $id: 'part.json', $defs: { 'a/b': { type: 'integer', minimum: 2 } } },
    unused: { const: 'must not be shipped' },
  } };
  const [reduced] = schemaSubset([schema], []);
  assert.deepEqual(Object.keys(reduced.$defs), ['entry', 'node', 'part']);
  const before = validator(schema).getSchema(id), after = validator(reduced).getSchema(id);
  for (const value of [{}, { value: 2, child: { value: 3 } }, { value: 1 }, { child: { extra: true } }])
    assert.equal(after(value), before(value));
  const dynamic = { $schema: full.$schema, $id: 'https://synthetic.invalid/dynamic.json', $dynamicAnchor: 'node',
    type: 'object', properties: { child: { $dynamicRef: '#node' } }, $defs: { retained: { type: 'string' } } };
  assert.deepEqual(schemaSubset([dynamic], [])[0], dynamic, 'Dynamic scope retains the complete pinned resource');
  assert.throws(() => schemaSubset([{ ...schema, $ref: '#missing' }], []), /Missing schema anchor/);
  assert.throws(() => schemaSubset([{ ...schema, $ref: 'https://unprovided.invalid/schema' }], []), /Unpinned schema resource/);
  assert.deepEqual(schemaSubset([schema], []), [reduced], 'Generation has no shared mutable traversal state');
  console.log('Client schema subset: exact roots/definitions/catalog, synthetic validation parity and reference closure');
}
