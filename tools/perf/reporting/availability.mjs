import { readReportZip } from './archive.mjs';
import { COMMENT_MARKER, reportEvidence, validateIdentity } from './report.mjs';

const reasons = new Map([
  ['measurement-harness-unavailable', 'The measurement harness and canonical run contract have not been supplied.'],
  ['artifact-unavailable', 'The originating run did not supply the expected availability artifact.'],
  ['artifact-invalid', 'The availability artifact failed provenance, size, archive or content validation.'],
  ['origin-run-failed', 'The originating run did not complete successfully.'],
  ['measurement-bootstrap-unavailable', 'The isolated measurement dependencies or source checkouts were unavailable.'],
  ['measurement-contract-unavailable', 'The exact canonical measurement contract is not installed in the trusted default branch.'],
]);
export function validateAvailabilityRecord(value, identity) {
  const keys = ['format', 'repository', 'prNumber', 'baseSha', 'headSha', 'runId', 'runAttempt', 'status', 'reason'];
  if (!value || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) ||
      value.format !== 'houseatlas.perf.availability/1' || value.status !== 'blocked' ||
      !['measurement-harness-unavailable', 'measurement-bootstrap-unavailable'].includes(value.reason) ||
      ['repository', 'prNumber', 'baseSha', 'headSha', 'runId', 'runAttempt'].some(key => value[key] !== identity[key])) throw new Error('Invalid availability artifact');
  return { reason: value.reason };
}
export function parseAvailabilityZip(bytes, identity) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > 65536) throw new Error();
    const value = readReportZip(bytes);
    if (value.kind !== 'availability') throw new Error();
    return { ...validateAvailabilityRecord(value.record, identity), artifactSha256: value.artifactSha256 };
  } catch { throw new Error('Invalid availability artifact'); }
}

export function makeAvailabilityReport({ identity, availability }) {
  validateIdentity(identity);
  if (identity.harnessSha !== null || !/^[0-9a-f]{40}$/.test(identity.reporterSha ?? '') || !reasons.has(availability?.reason) ||
      Object.keys(availability).some(key => !['reason', 'artifactId', 'artifactSha256'].includes(key)) ||
      (availability.artifactId !== undefined && (!Number.isSafeInteger(availability.artifactId) || availability.artifactId < 1)) ||
      (availability.artifactSha256 !== undefined && !/^[0-9a-f]{64}$/.test(availability.artifactSha256))) throw new Error('Invalid availability report');
  const labels = new Map([
    ['measurement-harness-unavailable', 'Harness unavailable'], ['artifact-unavailable', 'Artifact unavailable'],
    ['artifact-invalid', 'Invalid artifact'], ['origin-run-failed', 'Workflow failed'],
    ['measurement-bootstrap-unavailable', 'Measurement setup unavailable'], ['measurement-contract-unavailable', 'Contract unavailable'],
  ]);
  const evidence = [reasons.get(availability.reason),
    ...(availability.artifactId ? [`[Artifact](https://github.com/${identity.repository}/actions/runs/${identity.runId}/artifacts/${availability.artifactId})`] : []),
    ...(availability.artifactSha256 ? [`Archive SHA-256 \`${availability.artifactSha256}\``] : [])];
  const markdown = [COMMENT_MARKER, '### Synthetic performance', '', '⚪ No comparable measurements.', '',
    '| Metric | Base | Head | Change | Result |', '| --- | ---: | ---: | ---: | --- |',
    `| Benchmark suite | — | — | — | ⚪ ${labels.get(availability.reason)} |`, '', reportEvidence(identity, evidence)].join('\n');
  return { markdown, failed: ['artifact-invalid', 'origin-run-failed'].includes(availability.reason) };
}
