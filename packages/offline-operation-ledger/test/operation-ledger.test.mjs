import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { OperationLedger, LedgerError, createOperationId } from '../src/operation-ledger.mjs';

const payload = text => new TextEncoder().encode(text);
const request = () => ({ workspaceId: 'synthetic-workspace', homeId: 'synthetic-home',
  actorId: 'synthetic-actor', operationId: createOperationId(), payload: payload('{"label":"Alpha"}') });
const conflict = code => error => error instanceof LedgerError && error.code === code;

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'houseatlas-operation-ledger-'));
  const path = join(directory, 'ledger.sqlite');
  const ledger = new OperationLedger({ path });
  t.after(() => { ledger.close(); rmSync(directory, { recursive: true, force: true }); });
  return { ledger, path };
}

test('duplicate pending requests retain the original reservation', t => {
  const { ledger, path } = fixture(t), intent = request();
  const first = ledger.reserve(intent);
  assert.equal(first.disposition, 'reserved');
  assert.equal(first.record.state, 'pending');
  assert.equal(first.record.outcome, null);
  assert.deepEqual(ledger.reserve(intent), { disposition: 'pending', record: first.record });
  const secondHandle = new OperationLedger({ path });
  try {
    assert.deepEqual(secondHandle.reserve(intent), { disposition: 'pending', record: first.record });
  } finally { secondHandle.close(); }
});

test('conflicting payloads preserve pending and completed records', t => {
  const { ledger } = fixture(t), intent = request();
  const original = ledger.reserve(intent).record;
  const changed = { ...intent, payload: payload('{"label":"Beta"}') };
  assert.throws(() => ledger.reserve(changed), conflict('payload-conflict'));
  assert.throws(() => ledger.complete(changed, payload('wrong')), conflict('payload-conflict'));
  assert.deepEqual(ledger.inspect(intent), original);
  const completed = ledger.complete(intent, payload('synthetic-receipt')).record;
  assert.throws(() => ledger.reserve(changed), conflict('payload-conflict'));
  assert.throws(() => ledger.complete(changed, payload('wrong')), conflict('payload-conflict'));
  assert.deepEqual(ledger.inspect(intent), completed);
});

test('terminal outcomes are retained once and duplicate completion is stable', t => {
  const { ledger } = fixture(t), intent = request(), outcome = payload('synthetic-receipt');
  ledger.reserve(intent);
  const completed = ledger.complete(intent, outcome);
  assert.equal(completed.disposition, 'recorded');
  assert.equal(completed.record.state, 'completed');
  assert.deepEqual(completed.record.outcome, outcome);
  assert.deepEqual(ledger.complete(intent, outcome), { disposition: 'duplicate', record: completed.record });
  assert.deepEqual(ledger.reserve(intent), { disposition: 'completed', record: completed.record });
  assert.throws(() => ledger.complete(intent, payload('different-receipt')), conflict('outcome-conflict'));
  assert.deepEqual(ledger.inspect(intent), completed.record);
  const absent = { ...intent, operationId: createOperationId() };
  assert.throws(() => ledger.complete(absent, outcome), conflict('unknown-operation'));
  assert.equal(ledger.inspect(absent), null);
});

test('operation IDs are partitioned by workspace home and actor', t => {
  const { ledger } = fixture(t), intent = request();
  ledger.reserve(intent);
  ledger.complete(intent, payload('first-receipt'));
  for (const field of ['workspaceId', 'homeId', 'actorId']) {
    const independent = { ...intent, [field]: `other-${field}`, payload: payload(field) };
    assert.equal(ledger.inspect(independent), null);
    assert.equal(ledger.reserve(independent).disposition, 'reserved');
    assert.equal(ledger.inspect(independent).state, 'pending');
  }
  assert.deepEqual(ledger.inspect(intent).outcome, payload('first-receipt'));
});

test('restart recovers pending reservations and completed outcomes in fresh processes', t => {
  const { ledger, path } = fixture(t);
  ledger.close();
  const moduleUrl = new URL('../src/operation-ledger.mjs', import.meta.url).href;
  const intent = request(), saved = { ...intent, operationId: createOperationId() };
  const child = source => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { OperationLedger } from ${JSON.stringify(moduleUrl)};
      const ledger = new OperationLedger({path: process.argv[1]});
      const decode = item => ({...item, payload: Uint8Array.from(item.payload)});
      const intent = decode(JSON.parse(process.argv[2]));
      const saved = decode(JSON.parse(process.argv[3]));
      try { ${source} } finally { ledger.close(); }
    `, path, JSON.stringify({ ...intent, payload: [...intent.payload] }),
    JSON.stringify({ ...saved, payload: [...saved.payload] })], { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  };
  child(`
    assert.equal(ledger.reserve(intent).disposition, 'reserved');
    assert.equal(ledger.reserve(saved).disposition, 'reserved');
    ledger.complete(saved, Uint8Array.of(0, 255, 1));
  `);
  child(`
    assert.equal(ledger.reserve(intent).disposition, 'pending');
    assert.equal(ledger.inspect(intent).outcome, null);
    assert.equal(ledger.reserve(saved).disposition, 'completed');
    assert.deepEqual(ledger.inspect(saved).outcome, Uint8Array.of(0, 255, 1));
    assert.equal(ledger.complete(saved, Uint8Array.of(0, 255, 1)).disposition, 'duplicate');
  `);
});

test('exact byte identity and detached results survive caller mutation', t => {
  const { ledger } = fixture(t), intent = request(), original = intent.payload.slice();
  const reserved = ledger.reserve(intent);
  reserved.record.payload.fill(0);
  intent.payload.fill(1);
  assert.deepEqual(ledger.inspect(intent).payload, original);
  assert.throws(() => ledger.reserve(intent), conflict('payload-conflict'));
  const unchanged = { ...intent, payload: original };
  const outcome = Uint8Array.of();
  assert.equal(ledger.complete(unchanged, outcome).record.state, 'completed');
  const completed = ledger.inspect(intent);
  completed.payload.fill(2);
  assert.deepEqual(ledger.inspect(intent).payload, original);
  assert.deepEqual(ledger.inspect(intent).outcome, outcome);
  assert.equal(ledger.reserve(unchanged).disposition, 'completed');
});
