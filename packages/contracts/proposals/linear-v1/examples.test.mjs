// Proposal-only, pure synthetic checks. Not registered in ordinary CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLinearProposal as validate, validateMetricLengthValue, validateStraightWallReference } from './validate.mjs';
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

test('linear decimals align with the published candidate without normalizing entry text', () => {
  for (const decimalToken of ['0003.500', '000.000000000000000001', '9'.repeat(64)]) {
    const value = { decimalToken, unit: 'm', quantityKind: 'length' };
    const before = structuredClone(value);
    assert.equal(validateMetricLengthValue(value), true);
    assert.deepEqual(value, before);
    const proposal = structuredClone(records.enteredSpan);
    proposal.value.decimal = decimalToken;
    assert.equal(validate(proposal), true);
    assert.equal(proposal.value.decimal, decimalToken);
  }
  for (const decimalToken of ['0', '000', '000.000', '1.' + '1'.repeat(19), '9'.repeat(65),
    '1.0\n', '1.0\r', '1.0\r\n', '1e3', '-1', '.5', '1.']) {
    const value = { decimalToken, unit: 'm', quantityKind: 'length' };
    assert.equal(validateMetricLengthValue(value), false);
    const proposal = structuredClone(records.enteredSpan);
    proposal.value.decimal = decimalToken;
    assert.equal(validate(proposal), false);
  }
});

test('metric scalar compatibility preserves six proposals and does not adopt broader units', () => {
  for (const proposal of Object.values(records)) {
    const before = structuredClone(proposal);
    assert.equal(validate(proposal), true);
    if (proposal.value !== null) {
      const value = { decimalToken: proposal.value.decimal, unit: proposal.value.unit, quantityKind: 'length' };
      assert.equal(validateMetricLengthValue(value), true);
    }
    assert.deepEqual(proposal, before);
  }
  for (const unit of ['mm', 'cm', 'm']) {
    assert.equal(validateMetricLengthValue({ decimalToken: '0001.00', unit, quantityKind: 'length' }), true);
  }
  for (const unit of ['ft', 'in', 'm2']) {
    assert.equal(validateMetricLengthValue({ decimalToken: '1', unit, quantityKind: 'length' }), false);
  }
  const imperialProposal = structuredClone(records.enteredSpan);
  imperialProposal.value.unit = 'ft';
  assert.equal(validate(imperialProposal), true); // Still only a broader proposal.
});

test('metric scalar validation accepts no server fields or area reinterpretation', () => {
  const value = { decimalToken: '1.000', unit: 'm', quantityKind: 'length' };
  for (const field of ['revision', 'actorId', 'receiptSha256', 'attestation', 'target']) {
    assert.equal(validateMetricLengthValue({ ...value, [field]: 'synthetic' }), false);
  }
  assert.equal(validateMetricLengthValue({ ...value, quantityKind: 'area' }), false);
  assert.equal(validateMetricLengthValue({ ...value, decimalToken: 1 }), false);
  assert.equal(validateMetricLengthValue(null), false);
});

test('documentary wall reference uses the published internal token grammar and canonical pair', () => {
  const reference = { kind: 'wall', wallId: 'synthetic:Wall$A',
    endpointIds: ['synthetic:End$A', 'synthetic:End$B'] };
  const before = structuredClone(reference);
  assert.equal(validateStraightWallReference(reference), true);
  assert.deepEqual(reference, before);
  assert.equal(validateStraightWallReference({ ...reference, endpointIds: [...reference.endpointIds].reverse() }), false);
  assert.equal(validateStraightWallReference({ ...reference, endpointIds: ['same', 'same'] }), false);
  for (const token of ['has space', 'has/slash', 'endpoint\n', 'endpoint\r', 'x'.repeat(129)]) {
    assert.equal(validateStraightWallReference({ ...reference, wallId: token }), false);
    assert.equal(validateStraightWallReference({ ...reference, endpointIds: ['A', token] }), false);
  }
  assert.equal(validateStraightWallReference({ ...reference, endpointIds: [[0, 0], [1, 1]] }), false);
  assert.equal(validateStraightWallReference({ ...reference, meshIndex: 0 }), false);
  assert.equal(validateStraightWallReference({ ...reference, kind: 'room' }), false);
  // Syntax alone cannot distinguish an authored numeric ID from an ordinal.
  // Even these well-shaped tokens require the source owner's independent review.
  assert.equal(validateStraightWallReference({ kind: 'wall', wallId: '0', endpointIds: ['1', '2'] }), true);
});
