// Explicit healthy synthetic closure checks only. No mutation execution, denial,
// adversarial controls, network, storage, renderer, or live source calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const json = path => JSON.parse(read(path));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(new URL('packages/contracts/package.json', root));
const Ajv = require('ajv/dist/2020.js').default;
const addFormats = require('ajv-formats');
const old = json('packages/contracts/schemas/atlas.schema.json');
const schema = json('packages/contracts/schemas/atlas.v2.schema.json');
const map = json('contracts/geodata-wire-v2/resource-map.json');
const manifest = json('contracts/geodata-wire-v2/adoption-manifest.json');
const catalog = json('contracts/geodata-wire-v2/agent/operation-catalog.json');
const agent = json('contracts/geodata-wire-v2/agent/agent.schema.json');
const policy = json('contracts/geodata-wire-v2/policy.json');
const ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(ajv);
for (const resource of map.resources) {
  assert.equal(hash(read(resource.path)), resource.sha256, resource.path);
  assert.equal(json(resource.path).$id, resource.uri);
  ajv.addSchema(json(resource.path));
}
for (const source of [...manifest.sources, ...manifest.generatedOutputs, ...manifest.frozenPredecessorInputs]) assert.equal(hash(read(source.path)), source.sha256, source.path);
assert.equal(manifest.selection, 'geodata-wire-v2');
assert.equal(map.networkResolution, false);
assert.deepEqual(policy.stockProviderCapabilities, []);
assert.deepEqual(policy.presenceCapabilities, []);
for (const arm of old.$defs.record.oneOf) {
  const key = arm.$ref.slice('#/$defs/'.length);
  assert.deepEqual(schema.$defs[key], old.$defs[key], `${key}: v1 record body preserved`);
  assert(schema.$defs.record.oneOf.some(value => value.$ref === arm.$ref));
}
// These historical inputs remain legal inside the successor. Their bytes stay unchanged.
const legacy = json('packages/contracts/fixtures/plan-free.snapshot.json');
const snapshot = { ...legacy, contractVersion: '2.0.0' };
const fixture = json('docs/contracts/fixtures/geodata-document-v2.synthetic.json');
const originalRead = fixture.projection;
const pin = originalRead.document.payload.original;
assert.equal(hash(fixture.generatedOriginalUtf8), pin.sha256);
assert.equal(Buffer.byteLength(fixture.generatedOriginalUtf8), pin.bytes);
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
assert.equal(canonical(fixture.custodyReceipt), fixture.custodyReceiptCanonicalUtf8);
assert.equal(hash(canonical(fixture.custodyReceipt)), originalRead.document.payload.provenance.custodyReceiptSha256);
const validate = (name, value) => {
  const check = ajv.getSchema(`${schema.$id}#/$defs/${name}`) ?? ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` });
  assert.equal(check(value), true, `${name}: ${JSON.stringify(check.errors)}`);
};
const preview = structuredClone(originalRead);
const output = { ...pin, assetId: '00000000-0000-4000-8000-000000000006', sha256: hash('synthetic-shape-only-preview'), bytes: 28 };
const receipt = { profile: 'houseatlas.geodata-derivation-receipt.v1', scope: preview.scope, inputs: [pin], output,
  renderer: 'synthetic-shape-only', rendererVersion: '1', rendererConfigSha256: hash('{}'), sourceCropExtent: [0, 0, 1, 1], description: 'Synthetic schema shape; no renderer qualification is asserted.' };
preview.document.payload.preview = { asset: output, inputs: [pin], renderer: receipt.renderer,
  rendererVersion: receipt.rendererVersion, rendererConfigSha256: receipt.rendererConfigSha256,
  qualificationReceiptSha256: hash(canonical(receipt)), sourceCropExtent: receipt.sourceCropExtent, description: receipt.description };
preview.availability.preview = 'available';
const document = originalRead.document;
const audit = { schemaVersion: 1, auditId: document.lastAuditId, workspaceId: document.workspaceId, homeId: document.homeId,
  record: { recordType: document.recordType, recordId: document.recordId }, operation: 'create', previousRevision: null,
  resultRevision: 1, actorId: '00000000-0000-4000-8000-000000000007', at: document.createdAt, reason: 'Synthetic shape',
  mutationId: '00000000-0000-4000-8000-000000000008', beforeDigest: null, afterDigest: hash(canonical(document)) };
const result = { schemaVersion: 1, record: document, audit, replayed: false };
const commands = {};
for (const operation of ['create', 'replace', 'tombstone', 'restore']) {
  commands[operation] = { schemaVersion: 1, mutationId: audit.mutationId, reason: 'Synthetic shape', guards: [{ record: {recordType:'asset',recordId:pin.assetId}, expectedRevision: 1 }],
    operation, expectedRevision: operation === 'create' ? null : 1,
    ...['create', 'replace'].includes(operation) ? { value: { recordType: 'geodata-document', payload: document.payload } } : {} };
  validate('mutation', commands[operation]);
}
const page = { profile:'houseatlas.geodata-document-list.v2', scope: originalRead.scope, documents: [originalRead], nextCursor:null };
const frame = { profile:'houseatlas.geodata-document-bytes.v2', scope:originalRead.scope, documentId:document.recordId, documentRevision:1, mode:'original', asset:pin, measuredContentType:'application/geo+json' };
// Inspect the exact operation-selected frame constraints without rejection controls.
for (const [operation, mode] of [['readOriginal', 'original'], ['readPreview', 'preview']]) {
  const frameRef = agent.$defs[`result_${operation}`].properties.output.$ref;
  const expectedName = `geodataDocument${mode[0].toUpperCase() + mode.slice(1)}ByteFrame`;
  assert.equal(frameRef, `${schema.$id}#/$defs/${expectedName}`);
  const selectedFrame = schema.$defs[expectedName];
  assert.deepEqual(selectedFrame.properties.mode, {const:mode});
  assert(selectedFrame.required.includes('mode'));
  assert(selectedFrame.required.includes('measuredContentType'));
  assert.equal(selectedFrame.additionalProperties, false);
  assert.deepEqual(selectedFrame.properties.measuredContentType, mode === 'preview' ? {const:'image/png'}
    : {type:'string',enum:schema.$defs.geodataAssetPayload.allOf[1].then.properties.contentType.enum});
}
const byteRequest = {scope:originalRead.scope,documentId:document.recordId,expectedRevision:1,mode:'original'};
const originalAsset = { ...document, recordType:'asset', recordId:pin.assetId, payload:{owner:'atlas',purpose:'original',sha256:pin.sha256,bytes:pin.bytes,contentType:'application/geo+json',sourceLicense:document.payload.provenance.license,availability:'available'} };
const previewAsset = { ...originalAsset, recordId:output.assetId, payload:{...originalAsset.payload,purpose:'preview',sha256:output.sha256,bytes:output.bytes,contentType:'application/vnd.houseatlas.geodata-preview+png'} };
validate('geodataAssetRecord', originalAsset);
validate('geodataAssetRecord', previewAsset);
// Explicit six-family schema examples use generated text pins, not measured media.
const sourceFamilies = [['GeoJSON','application/geo+json'],['CityJSON','application/city+json'],['JSON','application/json'],['TIFF','image/tiff'],['PDF','application/pdf'],['PNG','image/png']];
assert.deepEqual(policy.originalAdmissionFamilies.map(({family,measuredContentType}) => [family,measuredContentType]), sourceFamilies);
assert.deepEqual(schema.$defs.geodataDocumentOriginalByteFrame.properties.measuredContentType.enum, sourceFamilies.map(([,mime]) => mime));
assert.deepEqual(schema.$defs.geodataAssetPayload.allOf[1].then.properties.contentType.enum, sourceFamilies.map(([,mime]) => mime));
for (const [family, mime] of sourceFamilies) {
  const license = {status:'permitted',reference:'CC-BY-4.0; synthetic source declaration'};
  const familyAsset = {...originalAsset,payload:{...originalAsset.payload,contentType:mime,sourceLicense:license}};
  const familyDocument = structuredClone(document);
  familyDocument.payload.title = `Synthetic ${family} source metadata, shape only`;
  familyDocument.payload.provenance.license = license;
  const familyCustody = {...fixture.custodyReceipt,admissionProfile:`houseatlas.synthetic-original.${family.toLowerCase()}.v1`,measuredContentType:mime};
  familyDocument.payload.provenance.custodyReceiptSha256 = hash(canonical(familyCustody));
  const familyFrame = {...frame,measuredContentType:mime};
  validate('geodataAssetRecord',familyAsset);
  validate('geodataDocumentRecord',familyDocument);
  validate('geodataCustodyReceipt',familyCustody);
  validate('geodataDocumentOriginalByteFrame',familyFrame);
  assert.deepEqual(familyAsset.payload.sourceLicense,familyDocument.payload.provenance.license);
  assert.equal(familyDocument.payload.preview,null);
}

for (const date of [{value:'2026',precision:'year'},{value:'2026-01-01',precision:'day'},{value:'2026-01-01T00:00:00Z',precision:'instant'}]) validate('geodataSourceDate',date);
snapshot.records.push(originalAsset, document);
for (const [name, value] of [['snapshot',snapshot],['record',document],['record',preview.document],['geodataCustodyReceipt',fixture.custodyReceipt],['geodataDerivationReceipt',receipt],['geodataDocumentRead',originalRead],['geodataDocumentRead',preview],['geodataDocumentList',page],['geodataDocumentByteFrame',frame],['geodataDocumentByteRequest',byteRequest],['audit',audit],['mutationResult',result],['batchMutation',{schemaVersion:1,batchId:audit.mutationId,reason:'Synthetic shape',commands:[{target:audit.record,command:commands.create}]}],['batchResult',{schemaVersion:1,batchId:audit.mutationId,results:[result],replayed:false}]]) validate(name,value);
for (const command of catalog.commands) {
  const operation = command.commandId.split('.').at(-1);
  const input = operation === 'list' ? {scope:originalRead.scope,cursor:null,limit:20}
    : operation === 'get' ? {scope:originalRead.scope,documentId:document.recordId}
    : operation.startsWith('read') ? {...byteRequest,mode:operation === 'readOriginal' ? 'original' : 'preview'}
    : {scope:originalRead.scope,documentId:document.recordId,command:commands[operation]};
  const output = operation === 'list' ? page : operation === 'get' ? originalRead
    : operation.startsWith('read') ? {...frame,mode:input.mode,asset:operation === 'readPreview' ? preview.document.payload.preview.asset : pin,measuredContentType:operation === 'readPreview' ? 'image/png' : frame.measuredContentType} : result;
  for (const [fragment, value] of [[command.inputSchema,{commandId:command.commandId,input}], [command.outputSchema,{commandId:command.commandId,output}]]) {
    const check = ajv.compile({$ref:agent.$id+fragment});
    assert.equal(check(value),true,`${command.commandId}: ${JSON.stringify(check.errors)}`);
  }
}
// Compile every successor definition and exact history without discovering fixtures.
for (const name of Object.keys(schema.$defs)) ajv.compile({$ref:`${schema.$id}#/$defs/${name}`});
const history = ajv.getSchema('https://houseatlas.invalid/contracts/2.0.0/http-history.schema.json');
assert.equal(history([audit]),true,JSON.stringify(history.errors));
console.log(`PASS geodata-wire-v2: ${schema.$defs.record.oneOf.length} record arms, ${Object.keys(schema.$defs).length} definitions, ${catalog.commands.length} operation pairs, six original-family/license shapes, original-only/preview shapes, legacy records, history, batch, resource/digest closure. Shape-only synthetic evidence; no trust, custody, renderer, authorization, persistence or recovery qualification.`);
