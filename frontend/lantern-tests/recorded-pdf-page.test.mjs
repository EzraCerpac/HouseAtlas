/** Named synthetic source checks only; no PDF, browser, listener or native owner. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

assert.equal(process.version, 'v26.10.0', 'Use pinned Node 26.10.0');
const args = process.argv.slice(2);
const names = ['valid-pages', 'missing-recorded-pages', 'invalid-numbers'];
assert(args.length === 2 && args[0] === '--case' && names.includes(args[1]),
  'Select exactly one named recorded PDF page case');

const path = new URL('../src/lantern/scans/native-ui/recorded-pdf-page.ts', import.meta.url);
const code = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'strip' });
const { resolveRecordedPdfPage } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const cases = {
  'valid-pages'() {
    const fixtures = [
      { label: 'only page', page: 1, count: 1 },
      { label: 'first page', page: 1, count: 18 },
      { label: 'recorded middle page', page: 12, count: 18 },
      { label: 'last page', page: 18, count: 18 },
      { label: 'maximum safe integer boundary', page: Number.MAX_SAFE_INTEGER, count: Number.MAX_SAFE_INTEGER },
    ];
    for (const { label, page, count } of fixtures)
      assert.equal(resolveRecordedPdfPage(page, count), page, label);
  },
  'missing-recorded-pages'() {
    const fixtures = [
      { label: 'recorded page absent in shorter PDF', page: 12, count: 5 },
      { label: 'one beyond last page', page: 6, count: 5 },
      { label: 'safe integer far beyond last page', page: Number.MAX_SAFE_INTEGER, count: 1 },
    ];
    for (const { label, page, count } of fixtures)
      assert.equal(resolveRecordedPdfPage(page, count), null, label);
  },
  'invalid-numbers'() {
    const fixtures = [
      { label: 'zero', value: 0 },
      { label: 'negative zero', value: -0 },
      { label: 'negative integer', value: -1 },
      { label: 'fraction below one', value: 0.5 },
      { label: 'fraction above one', value: 1.5 },
      { label: 'NaN', value: Number.NaN },
      { label: 'positive infinity', value: Number.POSITIVE_INFINITY },
      { label: 'negative infinity', value: Number.NEGATIVE_INFINITY },
      { label: 'unsafe integer', value: Number.MAX_SAFE_INTEGER + 1 },
    ];
    for (const { label, value } of fixtures) {
      assert.equal(resolveRecordedPdfPage(value, 18), null, `invalid recorded page: ${label}`);
      assert.equal(resolveRecordedPdfPage(1, value), null, `invalid page count: ${label}`);
    }
    assert.equal(resolveRecordedPdfPage(Number.NaN, Number.NaN), null, 'both inputs invalid');
  },
};

cases[args[1]]();
console.log(`recorded PDF page: ${args[1]} passed`);
