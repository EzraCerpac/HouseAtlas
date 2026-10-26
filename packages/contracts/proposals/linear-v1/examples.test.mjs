// Proposal-only, pure synthetic checks. Not registered in ordinary CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLinearProposal as validate } from './validate.mjs';
const load = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const { records, syntheticGeometry } = load('examples.json');
const check = record => assert.equal(validate(record), true);

test('six explicit synthetic proposals retain exact source facts without mutation', () => {
  for (const record of Object.values(records)) {
    const before = structuredClone(record); check(record); assert.deepEqual(record, before);
  }
  assert.deepEqual(records.enteredSpan.value, { decimal: '300.00', unit: 'cm' });
  assert.equal(records.enteredSpan.provenance.testimony, 'user-reported-measured');
  assert.equal(records.enteredSpan.provenance.support, 'unverified');
  assert.equal(records.documentHeight.provenance.support, 'evidence-linked');
  assert.equal(records.unknownHeight.value, null);
});

test('declared irregular boundary includes the hole and preserves disconnected coverage', () => {
  // Fixture arithmetic only: these closed orthogonal rings are explicitly given.
  // No topology inference, production calculation or stable feature allocation.
  const ringLength = ring => ring.reduce((sum, point, at) => {
    const next = ring[(at + 1) % ring.length];
    return sum + Math.hypot(next[0] - point[0], next[1] - point[1]);
  }, 0);
  assert.equal(ringLength(syntheticGeometry.outer), 22);
  assert.equal(ringLength(syntheticGeometry.hole), 4);
  assert.equal(ringLength(syntheticGeometry.disconnectedPart), 8);
  assert.equal(Number(records.outerAndHole.value.decimal), 26);
  assert.equal(Number(records.partialOccurrence.value.decimal), 22);
  assert.equal(records.partialOccurrence.coverage.status, 'partial');
  assert.deepEqual(records.partialOccurrence.definition.excludedBoundaryRefs, ['synthetic-hole']);
  assert.deepEqual(records.outerAndHole.definition.holeRingRefs, ['synthetic-hole']);
});

test('replacement example retains the prior proposal and original units', () => {
  const prior = structuredClone(records.enteredSpan);
  const replacement = records.replacedTarget;
  check(replacement);
  assert.equal(replacement.target.logicalTargetId, prior.target.logicalTargetId);
  assert.equal(replacement.target.artifactSha256, prior.target.artifactSha256);
  assert.notEqual(replacement.target.observedArtifactSha256, prior.target.artifactSha256);
  assert.equal(replacement.target.correspondence, 'replaced');
  assert.deepEqual(replacement.value, prior.value);
  assert.deepEqual(records.enteredSpan, prior);
  // This is correspondence data, not native correction/history/reopen evidence.
});

test('proposal shape refuses incompatible quantities, units and ambiguous numbers', () => {
  const reject = mutate => { const record = structuredClone(records.enteredSpan); mutate(record); assert.equal(validate(record), false); };
  reject(r => { r.value.unit = 'm2'; });
  reject(r => { r.quantity = 'area'; });
  reject(r => { r.quantity = 'height'; });
  reject(r => { r.quantity = 'perimeter'; });
  for (const decimal of ['0', '0.00', '-1', '1e3', 'NaN', '1,5']) reject(r => { r.value.decimal = decimal; });
  reject(r => { r.definition.endpointRefs = ['same', 'same']; });
  reject(r => { r.definition = { kind: 'unresolved', reason: 'No selected endpoints.' }; });
  reject(r => { r.provenance.origin = 'model-derived'; });
  reject(r => { r.provenance.support = 'evidence-linked'; });
  reject(r => { r.coverage.status = 'partial'; });
  reject(r => { r.target.roomLabel = 'Synthetic room'; });
});

test('decimal text cannot carry LF, CR or CRLF suffixes', () => {
  for (const suffix of ['\n', '\r', '\r\n']) {
    const record = structuredClone(records.enteredSpan);
    record.value.decimal += suffix;
    assert.equal(validate(record), false, `Refuse decimal suffix ${JSON.stringify(suffix)}`);
  }
});

test('height datum tokens must differ without resolving physical identity', () => {
  const record = structuredClone(records.documentHeight);
  record.definition.upperDatumRef = record.definition.lowerDatumRef;
  const before = structuredClone(record);
  assert.equal(validate(record), false);
  assert.deepEqual(record, before);
});

test('outer, hole and excluded boundary token sets are pairwise disjoint', () => {
  for (const [left, right] of [
    ['outerRingRefs', 'holeRingRefs'],
    ['outerRingRefs', 'excludedBoundaryRefs'],
    ['holeRingRefs', 'excludedBoundaryRefs'],
  ]) {
    const record = structuredClone(records.outerAndHole);
    record.definition[right].push(record.definition[left][0]);
    if (right === 'excludedBoundaryRefs') record.definition.exclusionReason = 'Synthetic exclusion.';
    const before = structuredClone(record);
    assert.equal(validate(record), false, `Refuse shared token between ${left} and ${right}`);
    assert.deepEqual(record, before);
  }
});
