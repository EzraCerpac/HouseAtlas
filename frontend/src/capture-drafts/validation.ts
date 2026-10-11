import { DRAFT_LIMITS, type DraftRow, type DraftOwner, type DraftForm } from './types.ts';
import type { SourceRef } from '../api/generated/contracts.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const kinds = ['homebox-entity', 'network-device', 'network-group', 'network-interface', 'network-segment', 'magicplan-room'];
function keys(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name)))
    throw new TypeError('Local draft format is unavailable');
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > max)
    throw new TypeError('Local draft field is incompatible');
}
function id(value: unknown): void {
  if (typeof value !== 'string' || !uuid.test(value)) throw new TypeError('Local draft identity is incompatible');
}
export function timestamp(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) throw new TypeError('Local draft time is incompatible');
}
export function validateOwner(value: unknown): asserts value is DraftOwner {
  keys(value, ['actorId', 'workspaceId', 'homeId']);
  text(value['actorId'], 255); id(value['workspaceId']); id(value['homeId']);
}
export function validateSource(value: unknown): asserts value is SourceRef {
  keys(value, ['workspaceId', 'homeId', 'key']);
  id(value['workspaceId']); id(value['homeId']);
  const key = value['key']; keys(key, ['sourceInstanceId', 'collectionId', 'sourceKind', 'externalId']);
  id(key['sourceInstanceId']); text(key['collectionId'], 4096); text(key['externalId'], 4096);
  if (typeof key['sourceKind'] !== 'string' || !kinds.includes(key['sourceKind']))
    throw new TypeError('Local draft source is incompatible');
}
export function validateForm(value: unknown): asserts value is DraftForm {
  keys(value, ['statement', 'reason', 'sourceLicense']);
  text(value['statement'], 4096); text(value['reason'], 1024);
  const license = value['sourceLicense']; keys(license, ['status', 'reference']);
  if (typeof license['status'] !== 'string' || !['unknown', 'permitted', 'restricted'].includes(license['status']))
    throw new TypeError('Local draft license is incompatible');
  if (license['reference'] !== null) text(license['reference'], 4096);
}
export function validateRow(value: unknown): asserts value is DraftRow {
  keys(value, ['format', 'id', 'owner', 'targetSourceRef', 'recordId', 'original', 'contentType', 'lastModified',
    'sha256', 'capture', 'form', 'createdAt', 'expiresAt', 'state', 'attempt']);
  if (value['format'] !== 'houseatlas-local-capture-draft/1') throw new TypeError('Local draft version is unavailable');
  id(value['id']); id(value['recordId']); validateOwner(value['owner']); validateSource(value['targetSourceRef']);
  const owner = value['owner'], source = value['targetSourceRef'];
  if (owner.workspaceId !== source.workspaceId || owner.homeId !== source.homeId) throw new TypeError('Local draft scope differs');
  const blob = value['original'];
  if (!(blob instanceof Blob) || blob.size < 1 || blob.size > DRAFT_LIMITS.fileBytes)
    throw new TypeError('Local original bytes are unavailable');
  text(value['contentType'], 255);
  if (value['contentType'] !== blob.type || typeof value['sha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(value['sha256'])
    || !Number.isSafeInteger(value['lastModified']) || Number(value['lastModified']) < 0)
    throw new TypeError('Local original metadata is incompatible');
  const capture = value['capture']; keys(capture, ['schemaVersion', 'selectionMethod', 'selectedAt', 'filename', 'reportedContentType', 'byteOrigin']);
  text(capture['filename'], 255); timestamp(capture['selectedAt']);
  if (/[\/\\\u0000-\u001f]/u.test(capture['filename']) || capture['byteOrigin'] !== 'browser-returned-unmodified'
    || capture['schemaVersion'] !== 1 || typeof capture['reportedContentType'] !== 'string'
    || Array.from(capture['reportedContentType']).length > 255 || /[\u0000-\u001f\u007f-\u009f]/u.test(capture['reportedContentType'])
    || typeof capture['selectionMethod'] !== 'string' || !['camera-request', 'photo-picker', 'file-picker'].includes(capture['selectionMethod']))
    throw new TypeError('Local capture provenance is incompatible');
  validateForm(value['form']); timestamp(value['createdAt']); timestamp(value['expiresAt']);
  if (Date.parse(value['expiresAt']) !== Date.parse(value['createdAt']) + DRAFT_LIMITS.unsentLifetimeMs)
    throw new TypeError('Local draft lifetime is incompatible');
  if (value['state'] === 'unsent') {
    if (value['attempt'] !== null) throw new TypeError('Local unsent state is incompatible');
  } else if (value['state'] === 'outcome-unknown') {
    const attempt = value['attempt']; keys(attempt, ['requestId', 'idempotencyKey', 'startedAt']);
    id(attempt['requestId']); id(attempt['idempotencyKey']); timestamp(attempt['startedAt']);
  } else throw new TypeError('Local draft state is incompatible');
  const { original: _, ...metadata } = value;
  if (new TextEncoder().encode(JSON.stringify(metadata)).byteLength > DRAFT_LIMITS.metadataBytes)
    throw new RangeError('Local draft metadata exceeds its limit');
}
export function validateRows(rows: readonly DraftRow[]): void {
  let total = 0;
  const ids = new Set<string>();
  for (const row of rows) {
    validateRow(row);
    if (ids.has(row.id)) throw new TypeError('Duplicate local draft identity');
    ids.add(row.id); total += row.original.size;
  }
  if (rows.length > DRAFT_LIMITS.count || total > DRAFT_LIMITS.totalBytes)
    throw new RangeError('Local draft storage limit reached');
}
export async function digest(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
