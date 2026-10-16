import { compareMetric, renderTable } from './compare.mjs';

export const COMMENT_MARKER = '<!-- houseatlas-performance-v1 -->';
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const repository = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
export function validateIdentity(identity) {
  const keys = ['repository', 'baseSha', 'headSha', 'harnessSha', 'reporterSha', 'baseTree', 'headTree', 'prNumber', 'runId', 'runAttempt'];
  if (!identity || !repository(identity.repository) || !sha(identity.baseSha) || !sha(identity.headSha) || (identity.harnessSha !== null && !sha(identity.harnessSha)) ||
      (identity.reporterSha !== undefined && !sha(identity.reporterSha)) ||
      !sha(identity.baseTree) || !sha(identity.headTree) ||
      Object.keys(identity).some(key => !keys.includes(key)) ||
      !Number.isSafeInteger(identity.prNumber) || identity.prNumber < 1 ||
      !Number.isSafeInteger(identity.runId) || identity.runId < 1 ||
      !Number.isSafeInteger(identity.runAttempt) || identity.runAttempt < 1) throw new Error('Invalid report identity');
  return identity;
}

export function makeReport({ identity, policies, base, head }) {
  validateIdentity(identity);
  if (!sha(identity.harnessSha)) throw new Error('Measurement harness identity unavailable');
  if (!Array.isArray(policies) || policies.length < 1 || policies.length > 64 || new Set(policies.map(p => p.id)).size !== policies.length) throw new Error('Invalid metric policy');
  for (const policy of policies) {
    if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(policy.id) || !['timing', 'deterministic'].includes(policy.kind) || !['lower', 'higher'].includes(policy.direction) ||
        typeof policy.label !== 'string' || policy.label.length > 160 || typeof policy.unit !== 'string' || policy.unit.length > 32) throw new Error('Invalid metric policy');
    for (const key of ['maximum', 'minimum', 'maxRegressionPercent']) {
      if (policy[key] !== undefined && (!Number.isFinite(policy[key]) || policy[key] < 0)) throw new Error('Invalid metric budget');
    }
  }
  const comparisons = policies.map(policy => compareMetric(policy, base?.get(policy.id), head?.get(policy.id)));
  const runUrl = `https://github.com/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}`;
  const link = commit => `[\`${commit}\`](https://github.com/${identity.repository}/commit/${commit})`;
  const markdown = [COMMENT_MARKER, '### Synthetic performance comparison', '',
    `Base: ${link(identity.baseSha)} (tree \`${identity.baseTree}\`)  `, `Head: ${link(identity.headSha)} (tree \`${identity.headTree}\`)  `,
    `Harness source: ${link(identity.harnessSha)}  `,
    `[Measurement run ${identity.runId}, attempt ${identity.runAttempt}](${runUrl})`, '',
    renderTable(policies, comparisons), '',
    'Delta = (head − base) / base × 100; the direction column identifies improvement. Values are medians; p95 uses the nearest rank. Noise is 1.4826 × MAD / median; it is descriptive, not a confidence interval.', '',
    'Hosted-runner timings are informational. Changes within max(5%, 2 × summed relative MAD) are labeled within-noise; fewer than five samples are labeled insufficient-samples. Timing movement alone never fails; configured deterministic budgets and failed measurements can fail this check.', '',
    'Scope: checked-in public or generated synthetic fixtures. No household data, credentials, provider calls or deployment. Uploaded measurements are untrusted observations.'].join('\n');
  return { markdown, comparisons, failed: comparisons.some(row => row.failed) };
}
