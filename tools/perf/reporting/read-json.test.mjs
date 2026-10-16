import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readMeasurement } from './read-json.mjs';

test('only bounded regular JSON passing the owner validator is admitted', () => {
  const directory = mkdtempSync(join(tmpdir(), 'houseatlas-report-'));
  try {
    const file = join(directory, 'measurement.json');
    writeFileSync(file, '{"synthetic":true}');
    assert.deepEqual(readMeasurement(file, value => value.synthetic === true), { synthetic: true });
    assert.throws(() => readMeasurement(file, () => false), /^Error: Invalid measurement artifact$/);
    const link = join(directory, 'link.json');
    symlinkSync(file, link);
    assert.throws(() => readMeasurement(link, () => true), /^Error: Invalid measurement artifact$/);
    writeFileSync(file, 'private raw content that must never appear in diagnostics');
    assert.throws(() => readMeasurement(file, () => true), /^Error: Invalid measurement artifact$/);
    writeFileSync(file, 'x'.repeat(1024 * 1024 + 1));
    assert.throws(() => readMeasurement(file, () => true), /^Error: Invalid measurement artifact$/);
    assert.throws(() => readMeasurement(directory, () => true), /^Error: Invalid measurement artifact$/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
