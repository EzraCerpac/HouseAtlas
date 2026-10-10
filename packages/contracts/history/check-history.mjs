// Explicit static/schema and valid-fixture check. Do not invoke test globs or package scripts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const Ajv2020 = require('ajv/dist/2020.js').default;
const addFormats = require('ajv-formats');
const read = url => JSON.parse(readFileSync(url, 'utf8'));
const digest = url => createHash('sha256').update(readFileSync(url)).digest('hex');
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
let checks = 0;
const check = (name, body) => {
  body();
  checks += 1;
  console.log(`PASS ${name}`);
};

const frozenApiUrl = new URL('../../../docs/contracts/atlas.openapi.json', import.meta.url);
const sidecarApiUrl = new URL('../../../docs/contracts/atlas.openapi.v1.1.0.json', import.meta.url);
const atlasSchemaUrl = new URL('../schemas/atlas.schema.json', import.meta.url);
const historySchemaUrl = new URL('./http-history.v1.1.0.schema.json', import.meta.url);
const frozenApi = read(frozenApiUrl);
const sidecar = read(sidecarApiUrl);
const atlasSchema = read(atlasSchemaUrl);
const historySchema = read(historySchemaUrl);
const recordPath = '/api/atlas/v1/workspaces/{workspaceId}/homes/{homeId}/records/{recordType}/{recordId}';
const historyPath = `${recordPath}/history`;

check('accepted frozen OpenAPI, amended Atlas 1.1 schema and frozen audit preimages', () => {
  assert.equal(digest(frozenApiUrl), '4c161a9f2fad81cfbd7fa38b0d7476816163b390b5ee898fe3b80a37e7195351');
  assert.equal(digest(atlasSchemaUrl), 'b24f2d0ba25287ecbeb6618dd26728cb201875103edaede51804e00e26c3bc86');
  // Frozen audit shape from published f67ec8f Atlas 1.0, retained in Atlas 1.1.
  assert.equal(createHash('sha256').update(canonical(atlasSchema.$defs.audit)).digest('hex'),
    'f2751df7a5c82c9748308134b410533cecc11dcf4bfccf865dfa05b79c0d21dc');
});
check('six accepted path objects are identical; seventh path is the sole addition', () => {
  assert.equal(Object.keys(frozenApi.paths).length, 6);
  assert.equal(Object.keys(sidecar.paths).length, 7);
  for (const [path, item] of Object.entries(frozenApi.paths)) assert.deepEqual(sidecar.paths[path], item);
  assert.deepEqual(Object.keys(sidecar.paths).filter(path => !Object.hasOwn(frozenApi.paths, path)), [historyPath]);
});
check('existing metadata, components and security retain compatibility', () => {
  assert.equal(sidecar.info.version, '1.1.0');
  const preserved = structuredClone(sidecar);
  delete preserved.paths[historyPath];
  preserved.info.version = frozenApi.info.version;
  preserved.info.description = frozenApi.info.description;
  assert.deepEqual(preserved, frozenApi);
});
check('history reuses required record parameters, session and error responses', () => {
  const history = sidecar.paths[historyPath];
  assert.deepEqual(Object.keys(history), ['get']);
  assert.equal(history.get.operationId, 'getAtlasRecordHistory');
  assert.deepEqual(history.get.parameters, frozenApi.paths[recordPath].get.parameters);
  assert.deepEqual(history.get.parameters.map(parameter => parameter.in), ['path', 'path', 'path', 'path']);
  assert.deepEqual(Object.keys(history.get.responses), ['200', '401', '403', '404']);
  for (const status of ['401', '403', '404']) {
    assert.deepEqual(history.get.responses[status], frozenApi.paths[recordPath].get.responses[status]);
  }
  assert.equal(history.get.responses['200'].content['application/json'].schema.$ref,
    '../../packages/contracts/history/http-history.v1.1.0.schema.json');
});
check('bare array schema references unchanged schema 1 audit', () => {
  assert.equal(historySchema.type, 'array');
  assert.equal(historySchema.items.$ref, '../schemas/atlas.schema.json#/$defs/audit');
  assert.equal(atlasSchema.$defs.audit.properties.schemaVersion.const, 1);
});

// Local URL registration resolves relative references without loading remote schemas.
const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(ajv);
ajv.addSchema(atlasSchema, atlasSchemaUrl.href);
ajv.addSchema(historySchema, historySchemaUrl.href);
const validateHistory = ajv.getSchema(historySchemaUrl.href);
const validateRecord = ajv.compile({ $ref: `${atlasSchemaUrl.href}#/$defs/record` });
check('history and supporting record schemas compile', () => {
  assert.equal(typeof validateHistory, 'function');
  assert.equal(typeof validateRecord, 'function');
});

const contexts = read(new URL('./fixtures/contexts.json', import.meta.url));
for (const fixture of contexts.cases) {
  const items = read(new URL(`./fixtures/${fixture.file}`, import.meta.url));
  check(`valid wire shape: ${fixture.file}`, () => {
    assert.equal(validateHistory(items), true, JSON.stringify(validateHistory.errors));
  });
  check(`expected recorded order and scope: ${fixture.file}`, () => {
    assert.deepEqual(items.map(item => item.operation), fixture.expectedOperations);
    for (const [index, item] of items.entries()) {
      assert.equal(item.workspaceId, contexts.workspaceId);
      assert.equal(item.homeId, contexts.homeId);
      assert.deepEqual(item.record, contexts.record);
      assert.equal(item.schemaVersion, 1);
      if (index > 0) {
        assert.equal(item.previousRevision, items[index - 1].resultRevision);
        assert.equal(item.beforeDigest, items[index - 1].afterDigest);
      }
    }
  });
  if (fixture.committedRecord) {
    check(`valid synthetic committed record and digest: ${fixture.file}`, () => {
      const record = fixture.committedRecord;
      assert.equal(validateRecord(record), true, JSON.stringify(validateRecord.errors));
      assert.equal(record.schemaVersion, 1);
      assert.equal(record.lifecycle, fixture.recordLifecycle);
      assert.equal(record.workspaceId, contexts.workspaceId);
      assert.equal(record.homeId, contexts.homeId);
      assert.equal(record.recordType, contexts.record.recordType);
      assert.equal(record.recordId, contexts.record.recordId);
      assert.equal(record.revision, items.at(-1).resultRevision);
      assert.equal(record.lastAuditId, items.at(-1).auditId);
      const hash = createHash('sha256').update(canonical(record)).digest('hex');
      assert.equal(hash, items.at(-1).afterDigest);
    });
  }
}
console.log(`HouseAtlas HTTP 1.1.0: ${checks} static/schema/valid-example checks passed; production qualification deferred.`);
