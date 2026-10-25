/** Synthetic fixture definitions only, not a mounted capability or automatic test.
 * CI/integration may invoke this exported case group. No provider or endpoint.
 */
import { MaintenanceCaller } from './caller';
import type { MaintenanceTransport } from './caller';
import { decode, need } from './contract';
import type { Operation, Phase, Result, Selection, Status } from './contract';

const selected: Selection = { expectedInstalledRevision: 'a'.repeat(64), release: {
  version: '1.2.3', commit: 'b'.repeat(40), tree: 'c'.repeat(40), releaseId: 1, assetId: 2,
  assetName: 'generated.tar.gz', archiveSha256: 'd'.repeat(64), manifestSha256: 'e'.repeat(64),
} };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function response(op: Operation, phase: Phase, sequence = 1): string {
  const status: Status = { format: 'houseatlas.updater.status.v1', operationId: op.operationId,
    action: op.action, sequence, updatedAt: '2026-01-01T00:00:00Z', phase, code: 'none',
    expectedInstalledRevision: op.expectedInstalledRevision, requested: op.release,
    previous: null, active: null, compatibility: 'compatible', rollback: 'eligible',
    healthVerified: phase === 'succeeded', recoveryNeeded: phase === 'recovery-needed',
    bundleContract: 'provisional-fixture' };
  const result: Result = { format: 'houseatlas.updater.result.v1', ok: true, code: 'none', status };
  return JSON.stringify(result);
}
function operation(raw: string, action: 'check' | 'apply'): Operation {
  const packet = JSON.parse(raw) as Operation; return { ...packet, action };
}
async function refused(action: () => Promise<void>): Promise<void> {
  let rejected = false; try { await action(); } catch { rejected = true; } need(rejected);
}
export async function maintenanceSyntheticCases(): Promise<string[]> {
  const done: string[] = [];
  const unavailable = new MaintenanceCaller(); unavailable.select('generated-owner', selected);
  await refused(() => unavailable.check(id(1))); need(unavailable.snapshot().availability === 'unavailable');
  done.push('unavailable without transport');

  const calls: Array<{ command: string; raw: string }> = [];
  let applied: Operation | null = null; let polls = 0;
  const transport: MaintenanceTransport = async (command, raw) => {
    calls.push({ command, raw });
    if (command === 'check') return response(operation(raw, 'check'), 'checked');
    if (command === 'apply') { applied = operation(raw, 'apply'); throw new Error('Generated lost reply'); }
    need(applied && JSON.parse(raw).operationId === applied.operationId);
    return response(applied, ++polls === 1 ? 'verifying' : 'succeeded', polls + 1);
  };
  const caller = new MaintenanceCaller(transport); caller.select('generated-owner', selected);
  await refused(() => caller.apply(id(2)));
  await caller.check(id(3)); need(caller.snapshot().outcome === 'advisory-check');
  await caller.apply(id(4)); need(caller.snapshot().outcome === 'unknown' && caller.pending()?.operation.operationId === id(4));
  await refused(() => caller.apply(id(5)));
  await caller.poll(); need(caller.snapshot().outcome === 'reported-verifying');
  await caller.poll(); need(caller.snapshot().outcome === 'reported-verified-success' && caller.pending() === null);
  need(calls.map(c => c.command).join(',') === 'check,apply,status,status');
  need(calls.slice(2).every(c => JSON.parse(c.raw).operationId === id(4)));
  done.push('check before apply; lost reply followed only by same-operation status');

  let late!: (raw: string) => void; let captured!: Operation;
  const deferred = new MaintenanceCaller(async (_command, raw) => {
    captured = operation(raw, 'check'); return new Promise<string>(resolve => { late = resolve; });
  });
  deferred.select('generated-owner', selected); const pendingCheck = deferred.check(id(6));
  await Promise.resolve(); deferred.select('new-owner', selected);
  late(response(captured, 'checked')); await pendingCheck;
  need(deferred.snapshot().result === null); await refused(() => deferred.apply(id(7)));
  done.push('late check cannot authorize a new owner');

  const retiring = new MaintenanceCaller(async (command, raw, signal) => {
    if (command === 'check') return response(operation(raw, 'check'), 'checked');
    if (command === 'status') return response({ ...selected, operationId: id(9), action: 'apply' }, 'recovery-needed', 2);
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Generated local retirement')), { once: true });
    });
  });
  retiring.select('generated-owner', selected); await retiring.check(id(8));
  const sending = retiring.apply(id(9)); await Promise.resolve(); retiring.retire(); await sending;
  need(retiring.pending()?.operation.operationId === id(9) && retiring.snapshot().result === null);
  retiring.select('another-owner', selected); await refused(() => retiring.poll());
  retiring.select('generated-owner', selected); await retiring.recover(1);
  need(retiring.snapshot().outcome === 'recovery-needed' && retiring.pending()?.operation.operationId === id(9));
  done.push('retirement retains unresolved identity; explicit same-owner recovery');

  const timed = new MaintenanceCaller(async (command, raw) => {
    if (command === 'check') return response(operation(raw, 'check'), 'checked');
    return new Promise<string>(() => { /* Finite caller deadline; no real work. */ });
  }, 1);
  timed.select('generated-owner', selected); await timed.check(id(10)); await timed.apply(id(11));
  need(timed.pending()?.operation.operationId === id(11) && timed.snapshot().outcome === 'unknown');
  timed.retire(); done.push('bounded timeout does not erase apply identity');

  const stale = new MaintenanceCaller(async (_command, raw) => response(operation(raw, 'check'), 'checked'));
  stale.select('generated-owner', selected); await stale.check(id(12));
  stale.select('generated-owner', { ...selected, expectedInstalledRevision: 'f'.repeat(64) });
  await refused(() => stale.apply(id(13))); need(!stale.snapshot().canApply);
  done.push('revision/selection change invalidates advisory check');

  let finishStatus!: (raw: string) => void;
  const lateStatus = new MaintenanceCaller(async (command, raw) => {
    if (command === 'check') return response(operation(raw, 'check'), 'checked');
    if (command === 'apply') throw new Error('Generated lost response');
    return new Promise<string>(resolve => { finishStatus = resolve; });
  });
  lateStatus.select('generated-owner', selected); await lateStatus.check(id(14)); await lateStatus.apply(id(15));
  const reading = lateStatus.poll(); await Promise.resolve(); lateStatus.retire();
  finishStatus(response({ ...selected, operationId: id(15), action: 'apply' }, 'succeeded', 2)); await reading;
  need(lateStatus.snapshot().result === null && lateStatus.pending()?.operation.operationId === id(15));
  done.push('late status after retirement cannot repaint or erase unknown identity');

  // Response reactions can be queued before abort rejection, but retirement
  // still runs before the exchange's await continuation. Cover both mutation
  // sites through a Promise-returning transport, not a manually late resolver.
  for (const terminalCommand of ['apply', 'status'] as const) {
    let settled!: MaintenanceCaller; let dispatched: Operation | null = null;
    const commands: string[] = [];
    const operationId = id(terminalCommand === 'apply' ? 17 : 19);
    settled = new MaintenanceCaller((command, raw) => {
      commands.push(command);
      if (command === 'check') return Promise.resolve(response(operation(raw, 'check'), 'checked'));
      if (command === 'apply') dispatched = operation(raw, 'apply');
      need(dispatched);
      if (command === 'apply' && terminalCommand === 'status') return Promise.reject(new Error('Generated lost reply'));
      queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => settled.retire())));
      return Promise.resolve(response(dispatched, 'succeeded', 2));
    });
    settled.select('generated-owner', selected); await settled.check(id(terminalCommand === 'apply' ? 16 : 18));
    await settled.apply(operationId);
    if (terminalCommand === 'status') await settled.poll();
    need(settled.pending()?.operation.operationId === operationId && settled.pending()?.last === null);
    need(settled.snapshot().result === null && settled.snapshot().selection === null);
    need(commands.join(',') === (terminalCommand === 'apply' ? 'check,apply' : 'check,apply,status'));
  }
  done.push('settled apply/status responses cannot mutate retired pending ownership');

  type EnumFixture = { code: unknown; status: Record<string, unknown> };
  const fixture = () => JSON.parse(response({ ...selected, operationId: id(20), action: 'apply' }, 'succeeded', 2)) as EnumFixture;
  const enumFields = [
    { key: 'code', values: ['none', 'boundary-failed'], top: true },
    { key: 'code', values: ['none', 'health-failed'], top: false },
    { key: 'action', values: ['check', 'apply'], top: false },
    { key: 'phase', values: ['checking', 'checked', 'staging', 'staged', 'stopping', 'publishing',
      'starting', 'verifying', 'rolling-back', 'succeeded', 'rolled-back', 'rejected', 'recovery-needed'], top: false },
    { key: 'compatibility', values: ['unknown', 'compatible', 'incompatible'], top: false },
    { key: 'rollback', values: ['unknown', 'eligible', 'blocked'], top: false },
    { key: 'bundleContract', values: ['unverified', 'provisional-fixture', 'houseatlas.release-bundle.v1'], top: false },
  ];
  for (const field of enumFields) for (const literal of field.values) {
    const valid = fixture();
    if (field.top) valid.code = literal; else valid.status[field.key] = literal;
    if (field.key === 'phase') valid.status.recoveryNeeded = literal === 'recovery-needed';
    decode(JSON.stringify(valid)); // Literal enum arms retain their original type.
    for (const malformed of [[literal], 1, true, null, {}]) {
      const invalid = structuredClone(valid);
      if (field.top) invalid.code = malformed; else invalid.status[field.key] = malformed;
      await refused(async () => { decode(JSON.stringify(invalid)); });
    }
  }
  done.push('enum decoding accepts literal strings and rejects arrays and other non-strings');

  // Malformed correlated terminal status must retain the original apply ID,
  // its unknown outcome and its ability to consult status without resending.
  for (const field of enumFields) {
    let invalid!: MaintenanceCaller; let attempts = 0;
    invalid = new MaintenanceCaller(async (command, raw) => {
      if (command === 'check') return response(operation(raw, 'check'), 'checked');
      if (command === 'apply') { attempts++; throw new Error('Generated lost reply'); }
      need(JSON.parse(raw).operationId === id(20));
      const terminalResponse = fixture();
      const literal = field.top ? terminalResponse.code : terminalResponse.status[field.key];
      if (field.top) terminalResponse.code = [literal]; else terminalResponse.status[field.key] = [literal];
      return JSON.stringify(terminalResponse);
    });
    invalid.select('generated-owner', selected); await invalid.check(id(21)); await invalid.apply(id(20));
    await invalid.poll();
    need(invalid.pending()?.operation.operationId === id(20) && invalid.pending()?.last === null);
    need(invalid.snapshot().outcome === 'unknown' && invalid.snapshot().canPoll && attempts === 1);
  }
  done.push('malformed terminal enum fields never clear retained apply identity');
  return done;
}
