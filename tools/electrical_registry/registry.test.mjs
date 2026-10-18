// Generated positive data and the five specifically requested review regressions.
// Four explicitly requested boundary repairs add generated disposable local files.
// No provider, listener, household files or native actions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildRegistry, validateLedger, readEvidenceFile, writeRegistryFile, MAX_EVIDENCE_JSON_BYTES } from './registry.mjs';

const bytes = value => Buffer.from(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const original = Buffer.from('generated source original');
const rendered = Buffer.from('generated upright drawing');
const receipt = bytes({ receiptId: 'generated-room-receipt' });
function fixture() {
  const data = {
    schema: 'houseatlas.documentary-electrical-fixtures.v1', viewKey: 'generated:historical-source', interpretationDate: '2026-10-17',
    symbolLegend: { xMeansSocket: true, socketsPerX: 1, receiptId: 'generated-symbol-receipt' },
    roomMappingReceipt: { id: 'generated-room-receipt', sha256: hash(receipt) },
    registrationReceipts: [],
    sheets: [{ id: 'sheet', title: 'Generated drawing', pdfPage: 2, sourceDate: null, originalPhoto: 'generated-photo.jpg',
      originalPhotoSha256: hash(original), renderedPhotoSha256: hash(rendered), regionIds: ['region', 'unassigned'] }],
    regions: ['region', 'unassigned'].map(id => ({ id, sheetId: 'sheet', label: id,
      sourceBounds: [0, 0, 1, 1], sourceOutline: [], outlineClosed: false, outlineBasis: 'untraced',
      physicalTransform: null, orientation: 'unregistered',
      places: id === 'unassigned' ? [] : [
        { packagePlaceKey: 'room:a', packagePlaceUuid: '00000000-0000-0000-0000-00000000000a', label: 'Same label', basis: 'owner-reported' },
        { packagePlaceKey: 'room:b', packagePlaceUuid: '00000000-0000-0000-0000-00000000000b', label: 'Same label', basis: 'inferred' }] })),
    groups: [{ id: 'group', label: 'L7', fixtureIds: ['socket', 'light'],
      evidenceBasis: 'historic-drawing-label', currentCircuitId: null, verifiedWiring: false }],
    fixtures: ['socket', 'light', 'unresolved'].map((kind, i) => ({ id: kind, kind, clusterId: null, label: `Generated ${kind}`, glyph: kind === 'socket' ? 'X' : '', sheetId: 'sheet',
      regionId: kind === 'unresolved' ? 'unassigned' : 'region',
      source: { symbolKey: `generated-${kind}`, originalPhotoSha256: hash(original), renderedPhotoSha256: hash(rendered),
        normalizedPoint: [0.25 + i / 10, 0.5], normalizedBox: [0.1, 0.1, 0.8, 0.8],
        literalLabels: ['L7'], placementDescription: 'Generated source mark' },
      group: { id: kind === 'unresolved' ? null : 'group', label: kind === 'unresolved' ? null : 'L7', basis: 'label-adjacent', note: '' },
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
  assert.deepEqual(result.ledger, { sha256: hash(input), bytes: input.length, viewKey: data.viewKey, interpretationDate: data.interpretationDate });
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
  for (const [i, row] of JSON.parse(JSON.stringify(result)).records.entries()) {
    assert.equal(row.label, data.fixtures[i].label);
    assert.equal(row.glyph, data.fixtures[i].glyph);
    assert.equal(row.clusterId, null);
    assert.equal(row.source.symbolKey, data.fixtures[i].source.symbolKey);
    assert.deepEqual(row.documentaryGroup, data.fixtures[i].group);
  }
  for (const row of result.records) {
    assert.equal(row.physicalCoordinate, null); assert.equal(row.physicalTransform, null);
    assert.equal(row.currentCircuitId, null); assert.equal(row.wireRoute, null);
  }
  assert.deepEqual(result.records[0].roomAssociations.map(p => p.packagePlaceUuid), ['00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b']);
  assert.equal(result.rooms.length, 2);
  assert.deepEqual(result.rooms.map(r => r.completeness.documentaryRecords), [2, 2]);
  assert.deepEqual(result.rooms.map(r => r.completeness.roomAssociationInstances), [2, 2]);
  assert.deepEqual(result.symbolLegend, data.symbolLegend);
  assert.equal(new Set(result.records.map(row => row.source.symbolKey)).size, 3);
  const boundaries = fixture();
  boundaries.symbolLegend.socketsPerX = 10000; boundaries.fixtures[0].glyphCount = 10000;
  boundaries.fixtures[0].fixtureCount = 10000; boundaries.sheets[0].pdfPage = 10000;
  const scientific = bytes(boundaries).toString().replaceAll(':10000', ':1e4').replaceAll(':1,', ':1e0,');
  const bounded = buildRegistry(Buffer.from(scientific));
  assert.equal(bounded.records[0].glyphCount, 10000);
  assert.equal(bounded.sheets[0].pdfPage, 10000);
  assert.equal(bounded.symbolLegend.socketsPerX, 10000);
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
    originalPhotoSha256: hash(original), packagePlaceKey: 'room:a', packagePlaceUuid: '00000000-0000-0000-0000-00000000000a',
    sourceAnchorIds: ['anchor:a'], approvedFixtureIds: [i === 0 ? 'light' : 'socket'], physicalTransform: null,
    basis: 'Generated matching source landmarks', reviewQualification: 'Approximate display only; not measured or current wiring',
  }));
  data.registrationReceipts.push({ ...data.registrationReceipts[0], id: 'empty-review',
    sha256: hash(Buffer.from('empty-review')), approvedFixtureIds: [] });
  const anchors = Array.from({ length: 32 }, (_, i) => `anchor:${i}`);
  for (const registration of data.registrationReceipts) registration.sourceAnchorIds = [...anchors];
  const result = buildRegistry(bytes(data));
  assert.deepEqual(JSON.parse(JSON.stringify(result)).registrationReceipts, data.registrationReceipts);
  result.registrationReceipts[2].sourceAnchorIds.push('registry-copy-only');
  assert.deepEqual(data.registrationReceipts[2].sourceAnchorIds, anchors);
  assert(result.records.every(row => row.approximateRegistrations.every(reg => !Object.hasOwn(reg, 'sourceAnchorIds'))));
  assert(result.records.every(row => row.approximateRegistrations.every(reg => reg.id !== 'empty-review')));
  assert.equal(result.completeness.approximateRegisteredRecords, 1);
  assert.equal(result.completeness.physicalLocationUnknownRecords, 3);
  assert.equal(result.records[1].approximateRegistrations[0].status, 'proposed');
  for (const record of result.records.filter(r => r.approximateRegistrations.length)) {
    const projected = record.approximateRegistrations[0];
    const source = data.registrationReceipts.find(r => r.id === projected.id);
    assert.equal(projected.basis, source.basis);
    assert.equal(projected.reviewQualification, source.reviewQualification);
  }
  assert.deepEqual(result.rooms.map(r => r.completeness.approximateRegisteredRecords), [1, 0]);
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

test('review regression: uncertainty stays explicit through validation and JSON output', () => {
  for (const uncertainty of [null, ' Source interpretation uncertain. ']) {
    const data = fixture(); data.fixtures[0].uncertainty = uncertainty;
    const row = JSON.parse(JSON.stringify(buildRegistry(bytes(data)))).records[0];
    assert(Object.hasOwn(row, 'uncertainty'));
    assert.equal(row.uncertainty, uncertainty);
  }
  for (const uncertainty of [undefined, '', '   ', 1]) {
    const data = fixture(); data.fixtures[0].uncertainty = uncertainty;
    assert(validateLedger(data).some(e => e.path === 'fixtures.socket.uncertainty'));
    assert.throws(() => buildRegistry(bytes(data)), /explicit null or nonempty uncertainty/);
  }
});

test('review regression: point containment includes box edges and excludes each outside side', () => {
  for (const normalizedPoint of [[.1,.1], [.8,.1], [.1,.8], [.8,.8], [.1,.5], [.8,.5], [.5,.1], [.5,.8]]) {
    const data = fixture(); data.fixtures[0].source.normalizedPoint = normalizedPoint;
    assert.deepEqual(buildRegistry(bytes(data)).records[0].source.normalizedPoint, normalizedPoint);
  }
  for (const normalizedPoint of [[.09,.5], [.81,.5], [.5,.09], [.5,.81]]) {
    const data = fixture(); data.fixtures[0].source.normalizedPoint = normalizedPoint;
    assert.throws(() => buildRegistry(bytes(data)), /Source point must lie inside/);
  }
});

test('review regression: conflicting plain and escaped decoded keys never become an unknown location', () => {
  const input = bytes(fixture()).toString('utf8');
  for (const key of ['"physicalCoordinate"', String.raw`"physical\u0043oordinate"`]) {
    const duplicate = input.replace('"physicalCoordinate":null', `"physicalCoordinate":[1,2,3],${key}:null`);
    assert.throws(() => buildRegistry(Buffer.from(duplicate)), /Duplicate decoded evidence JSON key/);
  }
  const duplicateReceipt = Buffer.from('{"receiptId":"other","receiptId":"generated-room-receipt"}');
  const data = fixture(); data.roomMappingReceipt.sha256 = hash(duplicateReceipt);
  assert.throws(() => buildRegistry(bytes(data), { roomMappingBytes: duplicateReceipt }), /Duplicate decoded evidence JSON key/);
  const healthy = fixture();
  healthy.fixtures[0].source.placementDescription = String.raw`Literal text {"key":1,"key":2}, escaped quote \" and backslash \\`;
  assert.equal(buildRegistry(bytes(healthy)).records[0].source.placementDescription, healthy.fixtures[0].source.placementDescription);
});

test('review regression: registration provenance is required and preserved for reviewed and proposed receipts', () => {
  const data = fixture();
  const registration = { id: 'reviewed-a', sha256: hash(Buffer.from('reviewed-a')), status: 'owner-reviewed-approximate',
    roomMappingReceipt: data.roomMappingReceipt, regionId: 'region', sheetId: 'sheet', originalPhotoSha256: hash(original),
    packagePlaceKey: 'room:a', packagePlaceUuid: '00000000-0000-0000-0000-00000000000a', sourceAnchorIds: ['anchor:a'], approvedFixtureIds: ['socket'],
    physicalTransform: null, basis: 'Two generated documentary landmarks', reviewQualification: 'Approximate historical display; calibration and installation unknown' };
  data.registrationReceipts = [registration];
  const projected = JSON.parse(JSON.stringify(buildRegistry(bytes(data)))).records[0].approximateRegistrations[0];
  assert.equal(projected.basis, registration.basis);
  assert.equal(projected.reviewQualification, registration.reviewQualification);
  for (const field of ['basis', 'reviewQualification']) for (const invalid of [undefined, '', '  ']) {
    const candidate = structuredClone(data); candidate.registrationReceipts[0][field] = invalid;
    assert.throws(() => buildRegistry(bytes(candidate)), /basis and review qualification/);
  }
});

test('review regression: each room counts only registrations for its exact key and UUID pair', () => {
  const data = fixture();
  const registration = (id, key, uuid, status, approvedFixtureIds) => ({ id, sha256: hash(Buffer.from(id)), status,
    roomMappingReceipt: data.roomMappingReceipt, regionId: 'region', sheetId: 'sheet', originalPhotoSha256: hash(original),
    packagePlaceKey: key, packagePlaceUuid: uuid, sourceAnchorIds: ['anchor:a'], approvedFixtureIds,
    physicalTransform: null, basis: 'Generated documentary landmarks', reviewQualification: 'Approximate only' });
  data.registrationReceipts = [registration('a-reviewed', 'room:a', '00000000-0000-0000-0000-00000000000a', 'source-reviewed-approximate', ['socket', 'light']),
    registration('b-proposed', 'room:b', '00000000-0000-0000-0000-00000000000b', 'proposed', ['socket'])];
  let result = buildRegistry(bytes(data));
  assert.equal(result.completeness.approximateRegisteredRecords, 2);
  assert.deepEqual(result.rooms.map(r => r.completeness.approximateRegisteredRecords), [2, 0]);
  assert.deepEqual(result.rooms.map(r => r.completeness.documentaryRecords), [2, 2]);
  data.registrationReceipts.push(registration('b-reviewed', 'room:b', '00000000-0000-0000-0000-00000000000b', 'owner-reviewed-approximate', ['socket']));
  result = buildRegistry(bytes(data));
  assert.equal(result.completeness.approximateRegisteredRecords, 2); // Distinct records, not receipts.
  assert.deepEqual(result.rooms.map(r => r.completeness.approximateRegisteredRecords), [2, 1]);
  assert(result.records.every(r => r.physicalCoordinate === null && r.currentCircuitId === null));
});

const scratch = t => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'houseatlas-registry-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
};
const cli = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('./registry.mjs', import.meta.url)), ...args],
  { encoding: 'utf8', timeout: 15000 });

test('four-boundary geometry: retain all supported source geometry without inferred physical rules', () => {
  for (const sourceBounds of [[0, 0, 1, 1], [.5, .5, .5, .5], [0, 0, 0, 1], [0, 1, 1, 1]]) {
    for (const outlineClosed of [false, true]) {
      const data = fixture();
      Object.assign(data.regions[0], { sourceBounds, sourceOutline: [[0, 1]], outlineClosed, outlineBasis: 'approximate-photo-trace' });
      const result = buildRegistry(bytes(data)), region = result.regions[0];
      assert.deepEqual(region.sourceBounds, sourceBounds);
      assert.deepEqual(region.sourceOutline, [[0, 1]]);
      assert.equal(region.outlineClosed, outlineClosed);
      assert.equal(region.outlineBasis, 'approximate-photo-trace');
      assert.equal(region.physicalTransform, null); assert.equal(region.orientation, 'unregistered');
      region.sourceBounds[0] = .25; region.sourceOutline[0][0] = .25;
      assert.deepEqual(data.regions[0].sourceBounds, sourceBounds);
      assert.deepEqual(data.regions[0].sourceOutline, [[0, 1]]);
    }
  }
  const data = fixture();
  data.regions[0].sourceOutline = Array.from({ length: 1024 }, (_, i) => [i % 2, (i + 1) % 2]);
  data.regions[0].outlineBasis = 'approximate-photo-trace';
  assert.deepEqual(buildRegistry(bytes(data)).regions[0].sourceOutline, data.regions[0].sourceOutline);
  assert.deepEqual(buildRegistry(bytes(fixture())).regions[0].sourceOutline, []);
});

test('four-boundary provenance: historical view and original-photo references survive serialization', () => {
  for (const viewKey of ['v', 'historical-source-distinct-from-current-host', 'x'.repeat(256), '🗺'.repeat(256)]) {
    const data = fixture(); data.viewKey = viewKey;
    data.sheets[0].originalPhoto = 'a/b/c/d/e/f/g/Original photo.HEIC';
    const result = JSON.parse(JSON.stringify(buildRegistry(bytes(data))));
    assert.equal(result.ledger.viewKey, viewKey);
    assert.equal(result.sheets[0].originalPhoto, data.sheets[0].originalPhoto);
    assert.equal(result.sheets[0].original.status, 'not-supplied'); // A documentary name is never opened.
    assert.equal(result.sheets[0].sourceDate, null);
    assert.equal(result.qualification, 'offline-documentary-consistency-only');
  }
  const data = fixture(), first = buildRegistry(bytes(data));
  data.interpretationDate = '2026-10-18';
  const revised = buildRegistry(bytes(data));
  assert.equal(first.ledger.viewKey, revised.ledger.viewKey);
  assert.notEqual(first.ledger.sha256, revised.ledger.sha256);
});

test('four-boundary JSON reads: descriptor bounds cover partial reads, exact limit and file growth', t => {
  const root = scratch(t), input = join(root, 'input.json'), room = join(root, 'room.json');
  const source = bytes(fixture()); fs.writeFileSync(input, source); fs.writeFileSync(room, receipt);
  const read = fs.readSync; let calls = 0, backing = null;
  t.mock.method(fs, 'readSync', (fd, buffer, offset, length, position) => {
    calls++; backing ??= buffer;
    assert.equal(buffer, backing);
    assert.equal(buffer.length, source.length + 1);
    return read(fd, buffer, offset, Math.min(length, 7), position);
  });
  try { assert.deepEqual(readEvidenceFile(input), source); assert(calls > 1); }
  finally { t.mock.restoreAll(); }
  fs.symlinkSync('input.json', join(root, 'explicit-alias.json'));
  assert.deepEqual(readEvidenceFile(join(root, 'explicit-alias.json')), source);

  assert.equal(MAX_EVIDENCE_JSON_BYTES, 16 * 1024 * 1024);
  const padded = Buffer.concat([source, Buffer.alloc(MAX_EVIDENCE_JSON_BYTES - source.length, 0x20)]);
  fs.writeFileSync(input, padded);
  assert.equal(readEvidenceFile(input).length, MAX_EVIDENCE_JSON_BYTES);
  assert.equal(buildRegistry(readEvidenceFile(input)).completeness.documentaryRecords, 3);

  fs.writeFileSync(input, '{}'); let grew = false;
  t.mock.method(fs, 'readSync', (fd, buffer, offset, length, position) => {
    assert.equal(buffer.length, 3); // Growth cannot enlarge the initial allocation.
    if (!grew) { grew = true; fs.truncateSync(input, MAX_EVIDENCE_JSON_BYTES + 1); }
    return read(fd, buffer, offset, length, position);
  });
  try { assert.throws(() => readEvidenceFile(input), /changed while reading/); }
  finally { t.mock.restoreAll(); }
  t.mock.method(fs, 'readSync', () => { throw new Error('Oversized evidence must be rejected before reading'); });
  try { assert.throws(() => readEvidenceFile(input), /exceeds 16 MiB/); }
  finally { t.mock.restoreAll(); }

  const good = join(root, 'good.json'); fs.writeFileSync(good, source);
  for (const args of [[input], [good, '--room-mapping', input]]) {
    const output = join(root, `unpublished-${args.length}.json`);
    const result = cli(args[0], output, ...args.slice(1));
    assert.notEqual(result.status, 0); assert.match(result.stderr, /exceeds 16 MiB/);
    assert.equal(fs.existsSync(output), false);
  }
  const output = join(root, 'healthy-cli.json'), run = cli(good, output, '--room-mapping', room);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(fs.readFileSync(output)).roomMapping.status, 'retained-byte-match');
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
});

test('four-boundary output: complete-only publication preserves destinations and cleans owned staging', t => {
  const root = scratch(t), registry = buildRegistry(bytes(fixture()));
  const output = join(root, 'r'.repeat(255));
  const link = fs.linkSync;
  t.mock.method(fs, 'linkSync', (temporary, selected) => {
    assert.equal(fs.statSync(dirname(temporary)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(temporary).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(temporary)), registry);
    assert.equal(fs.existsSync(selected), false);
    link(temporary, selected);
  });
  try { writeRegistryFile(output, registry); } finally { t.mock.restoreAll(); }
  assert.deepEqual(JSON.parse(fs.readFileSync(output)), registry);
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert(fs.readdirSync(root).every(name => !name.startsWith('.houseatlas-registry-')));

  const prior = join(root, 'prior.json'); fs.writeFileSync(prior, 'prior evidence');
  const directory = join(root, 'existing-directory'); fs.mkdirSync(directory);
  const alias = join(root, 'existing-link'), dangling = join(root, 'dangling-link');
  fs.symlinkSync('prior.json', alias); fs.symlinkSync('missing.json', dangling);
  for (const selected of [prior, directory, alias, dangling]) assert.throws(() => writeRegistryFile(selected, registry), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(prior, 'utf8'), 'prior evidence');
  assert(fs.statSync(directory).isDirectory()); assert.equal(fs.readlinkSync(alias), 'prior.json');
  assert.equal(fs.readlinkSync(dangling), 'missing.json');

  const same = join(root, 'same-input-output.json'), source = bytes(fixture()); fs.writeFileSync(same, source);
  const sameRun = cli(same, same); assert.notEqual(sameRun.status, 0); assert.match(sameRun.stderr, /EEXIST/);
  assert.deepEqual(fs.readFileSync(same), source);

  const failed = join(root, 'failed.json'), write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (fd, body) => {
    write(fd, body.slice(0, 12)); throw Object.assign(new Error('Generated partial write failure'), { code: 'ENOSPC' });
  });
  try { assert.throws(() => writeRegistryFile(failed, registry), { code: 'ENOSPC' }); }
  finally { t.mock.restoreAll(); }
  assert.equal(fs.existsSync(failed), false);
  assert(fs.readdirSync(root).every(name => !name.startsWith('.houseatlas-registry-')));

  const complete = join(root, 'complete-despite-cleanup.json'), unlink = fs.unlinkSync;
  t.mock.method(fs, 'unlinkSync', path => {
    if (path.endsWith('/registry.json')) throw Object.assign(new Error('Generated private cleanup failure'), { code: 'EACCES' });
    return unlink(path);
  });
  try { assert.throws(() => writeRegistryFile(complete, registry), /Complete registry published/); }
  finally { t.mock.restoreAll(); }
  assert.deepEqual(JSON.parse(fs.readFileSync(complete)), registry);
  assert.equal(fs.statSync(complete).mode & 0o777, 0o600);
});
