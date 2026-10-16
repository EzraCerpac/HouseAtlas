import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COMMENT_MARKER, validateIdentity } from './report.mjs';

const reasons = new Map([
  ['measurement-harness-unavailable', 'The measurement harness and canonical run contract have not been supplied.'],
  ['artifact-unavailable', 'The originating run did not supply the expected availability artifact.'],
  ['artifact-invalid', 'The availability artifact failed provenance, size, archive or content validation.'],
  ['origin-run-failed', 'The originating run did not complete successfully.'],
]);
export function parseAvailabilityZip(bytes, identity) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > 65536) throw new Error();
    const payload = execFileSync('python3', ['-I', fileURLToPath(new URL('./read-availability-zip.py', import.meta.url))],
      { input: bytes, maxBuffer: 8192, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, LANG: 'C.UTF-8' } });
    const value = JSON.parse(payload.toString('utf8'));
    const keys = ['format', 'repository', 'prNumber', 'baseSha', 'headSha', 'runId', 'runAttempt', 'status', 'reason'];
    if (!value || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) ||
        value.format !== 'houseatlas.perf.availability/1' || value.status !== 'blocked' || value.reason !== 'measurement-harness-unavailable' ||
        ['repository', 'prNumber', 'baseSha', 'headSha', 'runId', 'runAttempt'].some(key => value[key] !== identity[key])) throw new Error();
    return { reason: value.reason, artifactSha256: createHash('sha256').update(bytes).digest('hex') };
  } catch { throw new Error('Invalid availability artifact'); }
}

export function makeAvailabilityReport({ identity, availability }) {
  validateIdentity(identity);
  if (identity.harnessSha !== null || !/^[0-9a-f]{40}$/.test(identity.reporterSha ?? '') || !reasons.has(availability?.reason) ||
      Object.keys(availability).some(key => !['reason', 'artifactId', 'artifactSha256'].includes(key)) ||
      (availability.artifactId !== undefined && (!Number.isSafeInteger(availability.artifactId) || availability.artifactId < 1)) ||
      (availability.artifactSha256 !== undefined && !/^[0-9a-f]{64}$/.test(availability.artifactSha256))) throw new Error('Invalid availability report');
  const link = commit => `[\`${commit}\`](https://github.com/${identity.repository}/commit/${commit})`;
  const markdown = [COMMENT_MARKER, '### Synthetic performance comparison', '',
    `Base: ${link(identity.baseSha)} (tree \`${identity.baseTree}\`)  `,
    `Head: ${link(identity.headSha)} (tree \`${identity.headTree}\`)  `,
    `Reporter source: ${link(identity.reporterSha)}  `,
    `[Measurement run ${identity.runId}, attempt ${identity.runAttempt}](https://github.com/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.runAttempt})`, '',
    '| Metric | Base | Head | Delta | Delta % | Direction | Samples / noise | Status / reason |',
    '| --- | ---: | ---: | ---: | ---: | --- | --- | --- |',
    `| Synthetic benchmark suite | — | — | — | — | — | — | blocked: ${reasons.get(availability.reason)} |`, '',
    'No performance measurements or speedup/degradation claims are available. Missing values are unavailable, never zero. The harness, fixture profile, settings and environment must be supplied and validated before comparisons can run.', '',
    'Scope: synthetic/public PR reporting only; no household data, provider calls or deployment.',
    ...(availability.artifactId ? ['', `Artifact id: \`${availability.artifactId}\``] : []),
    ...(availability.artifactSha256 ? [`Artifact archive SHA-256: \`${availability.artifactSha256}\``] : []),
  ].join('\n');
  return { markdown, failed: ['artifact-invalid', 'origin-run-failed'].includes(availability.reason) };
}
