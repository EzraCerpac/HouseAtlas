// Synthetic reference harness only. No storage, services, credentials or production auth.
import { ContractError, assertTransition, assertGuards, assertFinalMutation, validateSnapshot, validateResult, validateShape, canonicalJson, recordDigest } from '../src/index.mjs';
const clone = structuredClone;
const canonical = canonicalJson, digest = recordDigest;
const error = (code, message) => { throw new ContractError(code, message); };
export const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const context = { role: 'editor', actorId: U(50), workspaceId: U(1), homeId: U(2), now: '2026-01-03T12:00:00Z' };
const sameTarget = (r, t) => ['workspaceId', 'homeId', 'recordType', 'recordId'].every(k => r[k] === t[k]);
export class SyntheticHarness {
  constructor(snapshot) { this.snapshot = clone(validateSnapshot(snapshot)); this.audits = []; this.receipts = new Map(); this.batchReceipts = new Map(); }
  mutate(target, command, session = context, fault = false) { return this.batch([{ target, command }], session, fault)[0]; }
  batch(commands, session = context, fault = false, batchId = null, batchReason = 'Synthetic reviewed batch') {
    if (!session.actorId) error('unauthenticated', 'Session missing');
    if (session.role !== 'editor') error('forbidden', 'Viewer cannot mutate');
    for (const { target } of commands) if (target.workspaceId !== session.workspaceId || target.homeId !== session.homeId) error('not-found', 'No foreign home detail');
    if (batchId !== null) validateShape('batchMutation', { schemaVersion: 1, batchId, reason: batchReason, commands: commands.map(({ target, command }) => ({ target: { recordType: target.recordType, recordId: target.recordId }, command })) });
    const batchKey = batchId === null ? null : JSON.stringify([session.workspaceId, session.homeId, session.actorId, batchId]);
    const batchHash = batchId === null ? null : digest({ schemaVersion: 1, batchId, reason: batchReason, commands });
    if (batchKey && this.batchReceipts.has(batchKey)) {
      const receipt = this.batchReceipts.get(batchKey);
      if (receipt.hash !== batchHash) error('idempotency-conflict', 'Batch ID already committed with different ordered envelope');
      return clone(receipt.results).map(result => ({ ...result, replayed: true }));
    }
    const keys = commands.map(({ command }) => JSON.stringify([session.workspaceId, session.homeId, session.actorId, command.mutationId]));
    if (new Set(keys).size !== keys.length) error('invalid-contract', 'Duplicate mutation IDs in batch');
    if (new Set(commands.map(({ target }) => canonical(target))).size !== commands.length) error('invalid-contract', 'Duplicate record target in batch');
    const hashes = commands.map(c => digest({ ...c, batchId, batchHash }));
    if (keys.some(k => this.receipts.has(k))) {
      if (keys.some((k, i) => !this.receipts.has(k) || this.receipts.get(k).hash !== hashes[i])) error('idempotency-conflict', 'Receipt content or batch changed');
      return keys.map(k => ({ ...clone(this.receipts.get(k).result), replayed: true }));
    }
    const candidate = clone(this.snapshot), results = [];
    const created = commands.filter(c => c.command.operation === 'create').map(c => c.target);
    for (const { target, command } of commands) {
      const current = this.snapshot.records.find(r => sameTarget(r, target));
      const { nextRevision } = assertTransition(current, command, target);
      assertGuards(this.snapshot, current, command, target, created);
      const auditId = U(20000 + this.audits.length + results.length);
      const next = { schemaVersion: 1, ...target, revision: nextRevision, lifecycle: command.operation === 'tombstone' ? 'tombstoned' : 'active', createdAt: current?.createdAt ?? session.now, updatedAt: session.now, lastAuditId: auditId, payload: clone(command.value?.payload ?? current.payload) };
      const audit = { schemaVersion: 1, auditId, workspaceId: target.workspaceId, homeId: target.homeId, record: { recordType: target.recordType, recordId: target.recordId }, operation: command.operation, previousRevision: current?.revision ?? null, resultRevision: nextRevision, actorId: session.actorId, at: session.now, reason: command.reason, mutationId: command.mutationId, beforeDigest: current ? digest(current) : null, afterDigest: digest(next) };
      const index = candidate.records.findIndex(r => sameTarget(r, target));
      if (index === -1) candidate.records.push(next); else candidate.records[index] = next;
      results.push(validateResult({ schemaVersion: 1, record: next, audit, replayed: false }, current ?? null));
    }
    validateSnapshot(candidate);
    for (const { target, command } of commands) assertFinalMutation(candidate, this.snapshot.records.find(r => sameTarget(r, target)), command, target);
    if (fault) error('synthetic-fault', 'Simulated failure between candidate and atomic commit');
    this.snapshot = candidate;
    this.audits.push(...results.map(r => r.audit));
    keys.forEach((k, i) => this.receipts.set(k, { hash: hashes[i], result: clone(results[i]) }));
    if (batchKey) this.batchReceipts.set(batchKey, { hash: batchHash, results: clone(results) });
    return clone(results);
  }
}
