import type { UploadPlaceEvidence } from '../app/editing.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Local draft receipt is incompatible');
  return value as Record<string, unknown>;
}
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => equal(value, right[index]));
  const a = object(left), b = object(right), keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

/** Additional correlation after the host's closed schema/request/scope checks.
 * No read, authority, recovered request, or acknowledgement of another attempt. */
export function validateDraftReceipt(result: unknown, intent: UploadPlaceEvidence, identityId: string, sha256: string): void {
  const data = object(object(result)['data']), records = data['records'], audits = data['auditIds'];
  if (!Array.isArray(records) || ![2, 3].includes(records.length) || !Array.isArray(audits)
    || audits.length !== records.length || audits.some(id => typeof id !== 'string' || !uuid.test(id))
    || new Set(audits).size !== audits.length) throw new TypeError('Local draft receipt records differ');
  const byType = new Map<string, Record<string, unknown>>();
  for (const raw of records) {
    const record = object(raw), target = object(record['target']), kind = target['recordType'];
    if (target['authority'] !== 'atlas' || typeof kind !== 'string' || !['identity', 'evidence', 'asset'].includes(kind)
      || typeof target['recordId'] !== 'string' || !uuid.test(target['recordId']) || byType.has(kind)
      || record['lifecycle'] !== 'active') throw new TypeError('Local draft receipt targets differ');
    byType.set(kind, record);
  }
  const identity = byType.get('identity'), evidence = byType.get('evidence'), asset = byType.get('asset');
  if (!identity || !evidence || (records.length === 3) !== !!asset) throw new TypeError('Local draft receipt records differ');
  const guards = intent.guards.filter(guard => guard.record.recordType === 'identity' && guard.record.recordId === identityId);
  const ip = object(identity['payload']), ep = object(evidence['payload']), evidenceId = object(evidence['target'])['recordId'];
  const refs = ep['references'];
  if (guards.length !== 1 || !Number.isSafeInteger(guards[0]!.expectedRevision) || guards[0]!.expectedRevision < 1
    || guards[0]!.expectedRevision >= Number.MAX_SAFE_INTEGER || object(identity['target'])['recordId'] !== identityId
    || identity['revision'] !== guards[0]!.expectedRevision + 1 || ip['kind'] !== 'location'
    || !Array.isArray(ip['evidenceIds']) || !ip['evidenceIds'].includes(evidenceId)
    || evidence['revision'] !== 1 || ep['statement'] !== intent.statement || !equal(ep['supersedesEvidenceIds'], [])
    || !Array.isArray(refs) || refs.length !== 1) throw new TypeError('Local draft receipt identity/evidence differs');
  const reference = object(refs[0]), assetId = reference['assetId'];
  if (reference['kind'] !== 'atlas-asset' || typeof assetId !== 'string' || !uuid.test(assetId))
    throw new TypeError('Local draft receipt original reference differs');
  const provenance = object(ep['provenance']), vantage = provenance['vantage'], prefix = 'Browser selection claim v1: ';
  if (!intent.capture || provenance['source'] !== null || provenance['sourceRevision'] !== null
    || provenance['sourceConfidence'] !== null || provenance['factAt'] !== null || provenance['evidenceBasis'] !== 'unknown'
    || !equal(provenance['uncertainty'], { status: 'unknown', explanation: null })
    || typeof vantage !== 'string' || !vantage.startsWith(prefix) || !equal(JSON.parse(vantage.slice(prefix.length)), intent.capture))
    throw new TypeError('Local draft receipt selection provenance differs');
  // An existing authorized original produces evidence+identity only. Do not
  // invent an asset-create row or a new asset read for that server-owned path.
  if (asset) {
    const payload = object(asset['payload']);
    if (object(asset['target'])['recordId'] !== assetId || asset['revision'] !== 1 || payload['sha256'] !== sha256
      || payload['byteSize'] !== intent.file.size || payload['contentType'] !== intent.file.type
      || payload['owner'] !== 'atlas' || payload['purpose'] !== 'evidence-original' || payload['availability'] !== 'available'
      || !equal(payload['sourceLicense'], intent.sourceLicense)
      || (intent.file.type === 'image/jpeg' && payload['previewPolicy'] !== 'download-only'))
      throw new TypeError('Local draft receipt original metadata differs');
  }
}
