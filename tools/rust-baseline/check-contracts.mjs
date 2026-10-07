// Shape-only checks of this explicit healthy synthetic list; no controls or fixture execution.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const root = new URL('../../', import.meta.url);
const atlasUrl = new URL('packages/contracts/schemas/atlas.schema.json', root);
const historyUrl = new URL('packages/contracts/history/http-history.v1.1.0.schema.json', root);
const read = url => JSON.parse(readFileSync(url, 'utf8'));
const require = createRequire(new URL('packages/contracts/package.json', root));
const Ajv2020 = require('ajv/dist/2020.js').default;
const addFormats = require('ajv-formats');
const atlas = read(atlasUrl);
const history = read(historyUrl);
const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(ajv);
ajv.addSchema(atlas, atlasUrl.href);
ajv.addSchema(history, historyUrl.href);
const validators = new Map(Object.keys(atlas.$defs).map(name => [name,
  ajv.compile({ $ref: `${atlasUrl.href}#/$defs/${name}` })]));
validators.set('httpHistory', ajv.getSchema(historyUrl.href));

// Keep the authorized list visible; do not discover fixtures with a glob.
const healthyFixtures = [
  ['snapshot', 'packages/contracts/fixtures/plan-free.snapshot.json'],
  ['snapshot', 'packages/contracts/fixtures/optional-geometry.snapshot.json'],
  ['snapshot', 'packages/contracts/fixtures/import-remap.snapshot.json'],
  ['mutation', 'packages/contracts/fixtures/create-circuit.mutation.json'],
  ['mutationResult', 'packages/contracts/fixtures/create-circuit.result.json'],
  ['batchMutation', 'packages/contracts/fixtures/import-remap.batch.json'],
  ['homeboxPageWire', 'packages/contracts/fixtures/homebox-page.wire.json'],
  ['httpHistory', 'packages/contracts/history/fixtures/empty.audit-array.json'],
  ['httpHistory', 'packages/contracts/history/fixtures/recorded.audit-array.json'],
  ['httpHistory', 'packages/contracts/history/fixtures/tombstone.audit-array.json'],
];
for (const [shape, path] of healthyFixtures) {
  const validator = validators.get(shape);
  assert.equal(validator(read(new URL(path, root))), true, `${path}: ${JSON.stringify(validator.errors)}`);
  console.log(`PASS schema ${shape}: ${path}`);
}
const contexts = read(new URL('packages/contracts/history/fixtures/contexts.json', root));
const validateRecord = validators.get('record');
let committedRecords = 0;
for (const fixture of contexts.cases) if (fixture.committedRecord) {
  assert.equal(validateRecord(fixture.committedRecord), true, JSON.stringify(validateRecord.errors));
  committedRecords += 1;
  console.log(`PASS schema record: contexts.json committedRecord for ${fixture.file}`);
}
console.log(`Contracts: ${Object.keys(atlas.$defs).length} canonical definitions and history compiled; ${healthyFixtures.length} named healthy fixtures and ${committedRecords} committed records passed shape validation. No graph, authorization, mutation, controls, or service calls executed.`);
