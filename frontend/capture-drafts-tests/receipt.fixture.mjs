import { createHash } from 'node:crypto';

// Synthetic contract data only. No transport, storage, authority or live IDs.
export const identityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const identityRevision = 3;
export const identityGuard = { record: { recordType: 'identity', recordId: identityId }, expectedRevision: identityRevision };
const evidenceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const assetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const id = n => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`;
const record = (recordType, recordId, revision, payload) => ({ target: { authority: 'atlas', recordType, recordId }, revision, lifecycle: 'active', payload });

export async function draftReceipt(intent, { existingAsset = false } = {}) {
  const records = [
    record('evidence', evidenceId, 1, {
      statement: intent.statement, supersedesEvidenceIds: [], references: [{ kind: 'atlas-asset', assetId }],
      provenance: { source: null, sourceRevision: null, sourceConfidence: null, evidenceBasis: 'unknown', factAt: null,
        retrievedAt: '2026-10-27T12:00:00.000Z', uncertainty: { status: 'unknown', explanation: null },
        vantage: 'Browser selection claim v1: ' + JSON.stringify(intent.capture) },
    }),
    record('identity', identityId, identityRevision + 1, { kind: 'location', evidenceIds: [evidenceId] }),
  ];
  if (!existingAsset) records.unshift(record('asset', assetId, 1, {
    owner: 'atlas', purpose: 'evidence-original', sha256: createHash('sha256').update(new Uint8Array(await intent.file.arrayBuffer())).digest('hex'),
    byteSize: intent.file.size, contentType: intent.file.type, sourceLicense: structuredClone(intent.sourceLicense), availability: 'available',
    previewPolicy: 'download-only', evidenceIds: [],
  }));
  return { schemaVersion: 3, commandId: 'atlas.batch.execute', requestId: intent.requestId, resolvedScope: { ...intent.context },
    status: 'committed', replayed: false, operationId: id(1), data: { auditIds: records.map((_, index) => id(index + 2)), records, requestDigest: 'a'.repeat(64) } };
}
