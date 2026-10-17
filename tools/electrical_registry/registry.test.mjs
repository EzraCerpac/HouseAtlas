// Generated positive data only. No provider, listener, household files or writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { buildRegistry, validateLedger } from './registry.mjs';

const bytes = value => Buffer.from(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const original = Buffer.from('generated source original');
const rendered = Buffer.from('generated upright drawing');
const receipt = bytes({ receiptId: 'generated-room-receipt' });
function fixture() {
  const data = {
    schema: 'houseatlas.documentary-electrical-fixtures.v1', interpretationDate: '2026-10-17',
    symbolLegend: { xMeansSocket: true, socketsPerX: 1, receiptId: 'generated-symbol-receipt' },
    roomMappingReceipt: { id: 'generated-room-receipt', sha256: hash(receipt) },
    registrationReceipts: [],
    sheets: [{ id: 'sheet', title: 'Generated drawing', pdfPage: 2, sourceDate: null,
      originalPhotoSha256: hash(original), renderedPhotoSha256: hash(rendered), regionIds: ['region', 'unassigned'] }],
    regions: ['region', 'unassigned'].map(id => ({ id, sheetId: 'sheet', label: id,
      sourceBounds: [0, 0, 1, 1], physicalTransform: null, orientation: 'unregistered',
      places: id === 'unassigned' ? [] : [
        { packagePlaceKey: 'room:a', packagePlaceUuid: 'uuid-a', label: 'Same label', basis: 'owner-reported' },
        { packagePlaceKey: 'room:b', packagePlaceUuid: 'uuid-b', label: 'Same label', basis: 'inferred' }] })),
    groups: [{ id: 'group', label: 'L7', fixtureIds: ['socket', 'light'],
      evidenceBasis: 'historic-drawing-label', currentCircuitId: null, verifiedWiring: false }],
    fixtures: ['socket', 'light', 'unresolved'].map((kind, i) => ({ id: kind, kind, sheetId: 'sheet',
      regionId: kind === 'unresolved' ? 'unassigned' : 'region',
      source: { originalPhotoSha256: hash(original), renderedPhotoSha256: hash(rendered),
        normalizedPoint: [0.25 + i / 10, 0.5], normalizedBox: [0.1, 0.1, 0.8, 0.8],
        literalLabels: ['L7'], placementDescription: 'Generated source mark' },
      group: { id: kind === 'unresolved' ? null : 'group', label: kind === 'unresolved' ? null : 'L7', basis: 'label-adjacent' },
      glyphCount: 1, fixtureCount: kind === 'socket' ? 1 : null,
      uncertainty: kind === 'light' ? 'Installed quantity unknown' : null,
      currentState: 'historic-unverified', physicalCoordinate: null, wireRoute: null })),
  };
  return data;
}

test('healthy source marks retain exact joins, unknowns and distinct same-label rooms', () => {
  const data = fixture(), before = structuredClone(data), input = bytes(data);
  assert.deepEqual(validateLedger(data), []);
  const result = buildRegistry(input);
  assert.deepEqual(data, before);
  assert.deepEqual(result.ledger, { sha256: hash(input), bytes: input.length, interpretationDate: data.interpretationDate });
  assert.equal(result.completeness.documentaryRecords, 3);
  assert.equal(result.completeness.roomAssociatedRecords, 2);
  assert.equal(result.completeness.roomAssociationInstances, 4);
  assert.equal(result.completeness.sourceQuantityUnknownRecords, 2);
  assert.equal(result.completeness.installedFixtureCount, null);
  assert.equal(result.completeness.physicalLocationUnknownRecords, 3);
  assert.equal(result.completeness.currentCircuitUnknownRecords, 3);
  assert.equal(result.completeness.approximateRegisteredRecords, 0);
  assert.equal(result.regions[1].roomAssociations.length, 0);
  assert.equal(result.sheets[0].sourceDate, null);
  assert.equal(result.sheets[0].original.status, 'not-supplied');
  assert.equal(result.roomMapping.status, 'not-supplied');
  assert.deepEqual(result.records[0].source.normalizedPoint, [0.25, 0.5]);
  for (const row of result.records) {
    assert.equal(row.physicalCoordinate, null); assert.equal(row.physicalTransform, null);
    assert.equal(row.currentCircuitId, null); assert.equal(row.wireRoute, null);
  }
  assert.deepEqual(result.records[0].roomAssociations.map(p => p.packagePlaceUuid), ['uuid-a', 'uuid-b']);
  assert.equal(result.rooms.length, 2);
  assert.deepEqual(result.rooms.map(r => r.completeness.documentaryRecords), [2, 2]);
  assert.deepEqual(result.rooms.map(r => r.completeness.roomAssociationInstances), [2, 2]);
  assert.deepEqual(result.symbolLegend, data.symbolLegend);
  result.records[0].source.normalizedPoint[0] = 0;
  assert.deepEqual(data, before);
});

test('healthy supplied bytes establish availability separately from placement', () => {
  const result = buildRegistry(bytes(fixture()), { artifacts: [{ label: 'generated image', bytes: rendered }], roomMappingBytes: receipt });
  assert.equal(result.sheets[0].rendered.status, 'retained-byte-match');
  assert.equal(result.sheets[0].rendered.artifact.bytes, rendered.length);
  assert.equal(result.sheets[0].original.status, 'not-supplied');
  assert.equal(result.roomMapping.status, 'retained-byte-match');
  assert.equal(result.completeness.physicalLocationUnknownRecords, 3);
});

test('healthy approximate and proposed registrations remain nonphysical', () => {
  const data = fixture();
  data.registrationReceipts = ['proposed', 'source-reviewed-approximate'].map((status, i) => ({
    id: `registration-${i}`, sha256: hash(Buffer.from(status)), status,
    roomMappingReceipt: data.roomMappingReceipt, regionId: 'region', sheetId: 'sheet',
    originalPhotoSha256: hash(original), packagePlaceKey: 'room:a', packagePlaceUuid: 'uuid-a',
    sourceAnchorIds: ['anchor:a'], approvedFixtureIds: [i === 0 ? 'light' : 'socket'], physicalTransform: null,
  }));
  const result = buildRegistry(bytes(data));
  assert.equal(result.completeness.approximateRegisteredRecords, 1);
  assert.equal(result.completeness.physicalLocationUnknownRecords, 3);
  assert.equal(result.records[1].approximateRegistrations[0].status, 'proposed');
  assert.equal(result.records[0].physicalCoordinate, null);
});

test('healthy empty documentary inventory has zero records and unknown installed total', () => {
  const data = fixture();
  for (const key of ['sheets', 'regions', 'fixtures', 'groups', 'registrationReceipts']) data[key] = [];
  data.roomMappingReceipt = null;
  const result = buildRegistry(bytes(data));
  assert.equal(result.completeness.documentaryRecords, 0);
  assert.equal(result.completeness.installedFixtureCount, null);
  assert.deepEqual(result.records, []);
});
