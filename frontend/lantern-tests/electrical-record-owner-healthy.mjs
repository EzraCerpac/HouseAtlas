import assert from 'node:assert/strict';
import { resolveElectricalRecordClosure } from '../integration/electrical-record-closure.ts';
import { createElectricalRecordOwner } from '../integration/electrical-record-owner.ts';

// The client is the real bounded authenticated topology client supplied by the
// enclosing synthetic topology case. No production session or network is used.
export async function electricalRecordOwnerCases(client, binding, identity, semantics, circuit, evidence) {
  let withdrawn = () => {};
  const frame = new AbortController();
  const pins = [identity, semantics, circuit, evidence].map(row => ({ ...row.target, revision: row.revision }));
  const make = (extra = {}) => createElectricalRecordOwner({ client, binding, pins, frameSignal: frame.signal,
    subscribeDependencies: notify => { withdrawn = notify; return () => {}; }, ...extra });
  const owner = make();
  const result = await owner.read();
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.unavailable, ['canonical-records', 'electrical-projector', 'electrical-review-verifier', 'evidence-assets', 'supersession', 'external-sources']);
  assert.equal(result.records.identities[0].target.recordId, identity.target.recordId);
  assert.equal(result.records.semantics[0].target.recordId, semantics.target.recordId);
  assert.equal(result.records.circuits[0].target.recordId, circuit.target.recordId);
  assert.equal(result.records.evidence[0].payload.provenance.sourceRevision.token, '9007199254740993');
  assert.deepEqual(result.records.evidence[0].payload.provenance.uncertainty, evidence.payload.provenance.uncertainty);
  const pools = { identities: result.records.identities, semantics: result.records.semantics,
    circuits: result.records.circuits, evidence: result.records.evidence };
  const dependencyIds = new Set([identity, semantics, circuit].flatMap(row => row.payload.evidenceIds));
  assert(dependencyIds.size > 0);
  assert([identity, semantics, circuit].flatMap(row => row.payload.evidenceIds).length > dependencyIds.size);
  for (const id of dependencyIds) assert(result.records.evidence.some(row => row.target.recordId === id));
  const selectedEvidenceIds = new Set(result.records.evidence.map(row => row.target.recordId));
  assert.deepEqual(selectedEvidenceIds, new Set([...dependencyIds, evidence.target.recordId]));
  assert.equal(selectedEvidenceIds.size, result.records.evidence.length);
  assert.equal(resolveElectricalRecordClosure([pins[0], { ...pins[0], revision: pins[0].revision + 1 }], pools), null);
  assert.equal(resolveElectricalRecordClosure([pins[0]], { ...pools, evidence: [] }), null);
  assert.equal(resolveElectricalRecordClosure(pins, { ...pools, identities: [...pools.identities, pools.identities[0]] }), null);
  assert.equal(resolveElectricalRecordClosure(pins, { ...pools, identities: [...pools.identities, { ...pools.identities[0], revision: pools.identities[0].revision + 1 }] }), null);
  assert.equal(resolveElectricalRecordClosure(Array(10001).fill(pins[0]), pools), null);
  assert.equal(resolveElectricalRecordClosure(pins, { ...pools, evidence: Array(5001).fill(pools.evidence[0]) }), null);
  const oversized = { ...identity, payload: { ...identity.payload, evidenceIds: Array(10001).fill([...dependencyIds][0]) } };
  assert.equal(resolveElectricalRecordClosure([pins[0]], { ...pools, identities: [oversized] }), null);
  let notices = 0; owner.subscribe(() => { notices++; });
  withdrawn(); assert.equal(notices, 1); assert.equal((await owner.read()).status, 'retired');
  const stale = make({ pins: [{ ...pins[0], revision: pins[0].revision + 1 }] });
  assert.equal((await stale.read()).status, 'unavailable');
  assert.equal((await stale.read()).status, 'retired');
  const missingCircuit = make({ pins: [{ ...pins[2], revision: pins[2].revision + 1 }] });
  assert.equal((await missingCircuit.read()).status, 'unavailable');
  const missingEvidence = make({ pins: [{ ...pins[3], revision: pins[3].revision + 1 }] });
  assert.equal((await missingEvidence.read()).status, 'unavailable');
  const repeated = make({ pins: [pins[0], pins[0]] });
  const repeatedResult = await repeated.read();
  assert.equal(repeatedResult.status, 'partial');
  assert.equal(repeatedResult.records.identities.length, 1);
  let calls = 0;
  const changedClient = { ...client, async listAll(...args) {
    const value = await client.listAll(...args);
    calls++;
    return calls > 4 && value.status === 'ready' ? { ...value, sourceStatus: 'stale' } : value;
  } };
  const changed = make({ client: changedClient });
  assert.equal((await changed.read()).status, 'partial');
  assert.equal((await changed.read()).status, 'unavailable');
  assert.equal((await changed.read()).status, 'retired');
  for (const status of ['withdrawn', 'disputed', 'superseded']) {
    const withheldClient = { ...client, async listAll(...args) {
      const value = await client.listAll(...args);
      if (args[1] !== 'evidence' || value.status !== 'ready') return value;
      return { ...value, records: value.records.map(row => !dependencyIds.has(row.target.recordId) ? row :
        { ...row, payload: { ...row.payload, provenance: { ...row.payload.provenance,
          uncertainty: { status, explanation: null } } } }) };
    } };
    const withheld = make({ client: withheldClient, pins: pins.slice(0, 3) });
    assert.equal((await withheld.read()).status, 'unavailable');
    assert.equal((await withheld.read()).status, 'retired');
  }
  const mismatchClient = { ...client, async listAll(...args) {
    const value = await client.listAll(...args);
    return args[1] === 'identity' && value.status === 'ready' ? { ...value, snapshotSha256: 'b'.repeat(64) } : value;
  } };
  assert.equal((await make({ client: mismatchClient }).read()).status, 'unavailable');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started = 0;
  const delayedClient = { ...client, async listAll(...args) {
    const n = ++started; const value = await client.listAll(...args);
    if (n <= 4) await gate;
    return value;
  } };
  const concurrent = make({ client: delayedClient });
  const older = concurrent.read();
  assert.equal((await concurrent.read()).status, 'partial');
  release(); assert.equal((await older).status, 'unavailable');
  let releaseFlight;
  const flightGate = new Promise(resolve => { releaseFlight = resolve; });
  const flightClient = { ...client, async listAll(...args) {
    const value = await client.listAll(...args); await flightGate; return value;
  } };
  const inflight = make({ client: flightClient });
  const pending = inflight.read();
  const stopped = make(); frame.abort(); releaseFlight();
  assert.equal((await pending).status, 'retired');
  assert.equal((await stopped.read()).status, 'retired');
}
