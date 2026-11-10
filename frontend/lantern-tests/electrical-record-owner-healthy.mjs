import assert from 'node:assert/strict';
import { createElectricalRecordOwner } from '../integration/electrical-record-owner.ts';

// The client is the real bounded authenticated topology client supplied by the
// enclosing synthetic topology case. No production session or network is used.
export async function electricalRecordOwnerCases(client, binding, identity, semantics) {
  let withdrawn = () => {};
  const frame = new AbortController();
  const pins = [identity, semantics].map(row => ({ ...row.target, revision: row.revision }));
  const make = (extra = {}) => createElectricalRecordOwner({ client, binding, pins, frameSignal: frame.signal,
    subscribeDependencies: notify => { withdrawn = notify; return () => {}; }, ...extra });
  const owner = make();
  const result = await owner.read();
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.unavailable, ['circuit', 'evidence', 'electrical-review-verifier']);
  assert.equal(result.records.identities[0].target.recordId, identity.target.recordId);
  assert.equal(result.records.semantics[0].target.recordId, semantics.target.recordId);
  let notices = 0; owner.subscribe(() => { notices++; });
  withdrawn(); assert.equal(notices, 1); assert.equal((await owner.read()).status, 'retired');
  const stale = make({ pins: [{ ...pins[0], revision: pins[0].revision + 1 }] });
  assert.equal((await stale.read()).status, 'unavailable');
  assert.equal((await stale.read()).status, 'retired');
  const duplicate = make({ pins: [pins[0], pins[0]] });
  assert.equal((await duplicate.read()).status, 'unavailable');
  let calls = 0;
  const changedClient = { ...client, async listAll(...args) {
    const value = await client.listAll(...args);
    calls++;
    return calls > 2 && value.status === 'ready' ? { ...value, sourceStatus: 'stale' } : value;
  } };
  const changed = make({ client: changedClient });
  assert.equal((await changed.read()).status, 'partial');
  assert.equal((await changed.read()).status, 'unavailable');
  assert.equal((await changed.read()).status, 'retired');
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
    if (n <= 2) await gate;
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
