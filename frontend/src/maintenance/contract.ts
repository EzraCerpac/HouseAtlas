/** Existing updater v1 wire fields. Authority and transport are supplied by the host.
 * See tools/houseatlas-updater/protocol.schema.json and
 * tools/houseatlas-updater/houseatlas_updater/validation.py.
 * The schema, executable parser and decoder use the same dotted-version pattern;
 * this module does not change the wire format.
 */
export type Command = 'check' | 'apply' | 'status';
export interface Release {
  version: string; commit: string; tree: string; releaseId: number; assetId: number;
  assetName: string; archiveSha256: string; manifestSha256: string;
}
export interface Installed {
  revision: string; release: Release; frontendIdentity: string; frontendShellIdentity: string | null;
}
export type Phase = 'checking' | 'checked' | 'staging' | 'staged' | 'stopping' | 'publishing'
  | 'starting' | 'verifying' | 'rolling-back' | 'succeeded' | 'rolled-back' | 'rejected' | 'recovery-needed';
export interface Status {
  format: 'houseatlas.updater.status.v1'; operationId: string; action: 'check' | 'apply';
  sequence: number; updatedAt: string; phase: Phase; code: string; expectedInstalledRevision: string;
  requested: Release; previous: Installed | null; active: Installed | null;
  compatibility: 'unknown' | 'compatible' | 'incompatible'; rollback: 'unknown' | 'eligible' | 'blocked';
  healthVerified: boolean; recoveryNeeded: boolean;
  bundleContract: 'unverified' | 'provisional-fixture' | 'houseatlas.release-bundle.v1';
}
export interface Result { format: 'houseatlas.updater.result.v1'; ok: boolean; code: string; status: Status | null }
export interface Selection { release: Release; expectedInstalledRevision: string }
export interface Operation extends Selection { operationId: string; action: 'check' | 'apply' }
const phases = ['checking', 'checked', 'staging', 'staged', 'stopping', 'publishing', 'starting',
  'verifying', 'rolling-back', 'succeeded', 'rolled-back', 'rejected', 'recovery-needed'];
const codes = ['none', 'invalid-request', 'layout-invalid', 'platform-incompatible', 'busy', 'journal-invalid',
  'journal-full', 'operation-conflict', 'recovery-required', 'acquisition-failed', 'producer-untrusted',
  'digest-mismatch', 'manifest-invalid', 'release-identity-mismatch', 'state-incompatible', 'installed-invalid',
  'installed-changed', 'component-incompatible', 'archive-invalid', 'health-failed', 'boundary-failed',
  'interrupted', 'rollback-incompatible', 'rollback-failed'];
export function need(value: unknown): asserts value { if (!value) throw new TypeError('Invalid maintenance contract'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  need(value !== null && typeof value === 'object' && !Array.isArray(value));
  const row = value as Record<string, unknown>;
  need(Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)));
  return row;
}
function text(value: unknown, max: number): asserts value is string { need(typeof value === 'string' && value.length <= max); }
export function hash(value: unknown): asserts value is string { need(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)); }
export function identifier(value: unknown): asserts value is string {
  need(typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value));
}
function integer(value: unknown): asserts value is number { need(Number.isSafeInteger(value) && Number(value) > 0); }
function member(value: unknown, values: readonly string[]): value is string {
  return typeof value === 'string' && values.includes(value);
}
export function release(value: unknown): Release {
  const r = object(value, ['version', 'commit', 'tree', 'releaseId', 'assetId', 'assetName', 'archiveSha256', 'manifestSha256']);
  text(r.version, 80); need(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(r.version));
  for (const key of ['commit', 'tree']) need(typeof r[key] === 'string' && /^[0-9a-f]{40}$/.test(r[key] as string));
  integer(r.releaseId); integer(r.assetId); text(r.assetName, 200); need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(r.assetName));
  hash(r.archiveSha256); hash(r.manifestSha256);
  return r as unknown as Release;
}
function installed(value: unknown): void {
  if (value === null) return;
  const r = object(value, ['revision', 'release', 'frontendIdentity', 'frontendShellIdentity']);
  hash(r.revision); release(r.release); hash(r.frontendIdentity);
  if (r.frontendShellIdentity !== null) hash(r.frontendShellIdentity);
}
export function fingerprint(value: Selection): string {
  hash(value.expectedInstalledRevision); const r = release(value.release);
  return JSON.stringify([value.expectedInstalledRevision, r.version, r.commit, r.tree, r.releaseId,
    r.assetId, r.assetName, r.archiveSha256, r.manifestSha256]);
}
export function request(command: Command, operation: Operation): string {
  identifier(operation.operationId); fingerprint(operation);
  const raw = JSON.stringify(command === 'status' ? { format: 'houseatlas.updater.status-request.v1', operationId: operation.operationId }
    : { format: `houseatlas.updater.${command}.v1`, operationId: operation.operationId,
      expectedInstalledRevision: operation.expectedInstalledRevision, release: operation.release });
  need(new TextEncoder().encode(raw).length <= 4096); return raw;
}
export function decode(raw: string): Result {
  text(raw, 2 * 1024 * 1024); need(new TextEncoder().encode(raw).length <= 2 * 1024 * 1024);
  const r = object(JSON.parse(raw), ['format', 'ok', 'code', 'status']);
  need(r.format === 'houseatlas.updater.result.v1' && typeof r.ok === 'boolean' && member(r.code, codes));
  if (r.status !== null) {
    const s = object(r.status, ['format', 'operationId', 'action', 'sequence', 'updatedAt', 'phase', 'code',
      'expectedInstalledRevision', 'requested', 'previous', 'active', 'compatibility', 'rollback',
      'healthVerified', 'recoveryNeeded', 'bundleContract']);
    need(s.format === 'houseatlas.updater.status.v1'); identifier(s.operationId); integer(s.sequence); text(s.updatedAt, 40);
    need(member(s.action, ['check', 'apply']) && member(s.phase, phases) && member(s.code, codes));
    hash(s.expectedInstalledRevision); release(s.requested); installed(s.previous); installed(s.active);
    need(member(s.compatibility, ['unknown', 'compatible', 'incompatible']) && member(s.rollback, ['unknown', 'eligible', 'blocked']));
    need(typeof s.healthVerified === 'boolean' && typeof s.recoveryNeeded === 'boolean' && s.recoveryNeeded === (s.phase === 'recovery-needed'));
    need(member(s.bundleContract, ['unverified', 'provisional-fixture', 'houseatlas.release-bundle.v1']));
  }
  return r as unknown as Result;
}
export function correlate(result: Result, op: Operation): void {
  const s = result.status; if (!s) return;
  need(s.operationId === op.operationId && s.action === op.action &&
    fingerprint({ release: s.requested, expectedInstalledRevision: s.expectedInstalledRevision }) === fingerprint(op));
}
export const terminal = (s: Status): boolean => ['checked', 'succeeded', 'rolled-back', 'rejected', 'recovery-needed'].includes(s.phase);
/** Historical reported outcome only; never a fresh installed/readiness assertion. */
export function outcome(result: Result | null): string {
  if (!result?.ok || result.code !== 'none' || !result.status) return 'unknown';
  const s = result.status;
  if (s.recoveryNeeded) return 'recovery-needed';
  if (s.phase === 'succeeded' && s.action === 'apply' && s.healthVerified && s.code === 'none') return 'reported-verified-success';
  if (s.phase === 'checked') return 'advisory-check';
  if (s.phase === 'succeeded') return 'reported-complete-unverified';
  return `reported-${s.phase}`;
}
