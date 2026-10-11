/** Successful source timestamp displays only; no listener, provider or clock mutation. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fullFormats } from '../node_modules/ajv-formats/dist/formats.js';

// Compile the one actual formatter module. Rewrite only its installed format import.
const file = new URL('../src/lantern/data/time.ts', import.meta.url);
let source = stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'strip' });
const specifier = "'ajv-formats/dist/formats.js'";
assert.equal(source.split(specifier).length, 2);
source = source.replace(specifier,
  JSON.stringify(new URL('../node_modules/ajv-formats/dist/formats.js', import.meta.url).href));
const { fmtDate, fmtShortDate, fmtTime, fmtDateTime } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const timestamps = [
  ['2016-12-31T23:59:60Z', '31 Dec 2016', '23:59:60Z'],
  ['2016-12-31T23:59:60.123456789Z', '31 Dec 2016', '23:59:60.123456789Z'],
  ['2017-01-01T00:59:60+01:00', '1 Jan 2017', '00:59:60+01:00'],
  ['2016-12-31T22:59:60-01:00', '31 Dec 2016', '22:59:60-01:00'],
  ['2016-12-31t23:59:60z', '31 Dec 2016', '23:59:60z'],
  ['2026-10-08T00:30:00.123456789+02:00', '8 Oct 2026', '00:30:00.123456789+02:00'],
  ['2026-10-08T23:30:00-07:00', '8 Oct 2026', '23:30:00-07:00'],
];
for (const [timestamp, date, clock] of timestamps) {
  assert.equal(fullFormats['date-time'].validate(timestamp), true);
  assert.equal(fmtDateTime(timestamp), timestamp);
  assert.equal(fmtDate(timestamp), date);
  assert.equal(fmtTime(timestamp), clock);
  assert.equal(fmtShortDate(timestamp, timestamp), date.replace(/ \d{4}$/, ''));
}
assert.equal(fmtDate('2024-02-29'), '29 Feb 2024');
assert.equal(fmtTime('2024-02-29'), '2024-02-29');
assert.equal(fmtShortDate('2016-12-31T23:59:60Z', '2017-01-01T00:59:60+01:00'), '31 Dec 2016');
console.log(`PASS source timestamp display: ${timestamps.length} schema-valid original timestamps and leap-day display`);
