import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAvailabilityReport, parseAvailabilityZip } from './availability.mjs';
import { availabilityRecord, identity, zipFixture } from './test-fixtures.mjs';

test('availability is a closed blocked record with exact API-derived identities', () => {
  const result = parseAvailabilityZip(zipFixture(), identity);
  assert.equal(result.reason, 'measurement-harness-unavailable');
  assert.match(result.artifactSha256, /^[0-9a-f]{64}$/);
  for (const patch of [{ headSha: 'f'.repeat(40) }, { prNumber: 8 }, { runAttempt: 2 }, { repository: 'other/HouseAtlas' },
    { reason: '@everyone https://evil.example' }, { metrics: [{ value: 0 }] }, { status: 'measured' }]) {
    const zip = zipFixture([{ name: 'availability.json', content: JSON.stringify({ ...availabilityRecord(), ...patch }) }]);
    assert.throws(() => parseAvailabilityZip(zip, identity), /^Error: Invalid availability artifact$/);
  }
});
test('archive parsing rejects extra members, paths, symlinks, large output and malformed bytes without extraction', () => {
  const entry = { name: 'availability.json', content: JSON.stringify(availabilityRecord()) };
  const badCrc = Buffer.from(zipFixture());
  const central = badCrc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  badCrc[central + 16] ^= 1;
  for (const zip of [zipFixture([entry, entry]), zipFixture([{ ...entry, name: '../availability.json' }]),
    zipFixture([{ ...entry, symlink: true }]), zipFixture([{ ...entry, content: 'x'.repeat(5000) }]), badCrc, Buffer.alloc(65537), Buffer.from('not a zip')]) {
    assert.throws(() => parseAvailabilityZip(zip, identity), /^Error: Invalid availability artifact$/);
  }
});
test('skip table makes no measurement, harness source or zero-valued speedup claim', () => {
  const report = makeAvailabilityReport({ identity, availability: { reason: 'measurement-harness-unavailable' } });
  assert.equal(report.failed, false);
  assert(report.markdown.includes('Reporter `'));
  assert(report.markdown.includes('⚪ No comparable measurements'));
  assert(!report.markdown.includes('Harness `'));
  assert(!report.markdown.includes('0%'));
  assert.throws(() => makeAvailabilityReport({ identity, availability: { reason: 'arbitrary raw text' } }));
});
