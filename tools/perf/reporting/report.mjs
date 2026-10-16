import { cell, compareMetric, renderSummary, renderTable, unsupportedBrowser } from './compare.mjs';

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

export function appendReportEvidence(markdown, lines) {
  const end = '\n</details>';
  if (!markdown.endsWith(end)) throw new Error('Missing report evidence section');
  return markdown.slice(0, -end.length) + '\n' + lines.join('\n') + end;
}

export function reportEvidence(identity, lines = []) {
  const link = (label, commit) => `[${label} \`${commit.slice(0, 7)}\`](https://github.com/${identity.repository}/commit/${commit})`;
  const method = identity.reporterSha
    ? `https://github.com/${identity.repository}/blob/${identity.reporterSha}/docs/ci-performance.md`
    : identity.harnessSha ? `https://github.com/${identity.repository}/blob/${identity.harnessSha}/tools/perf/harness/README.md` : null;
  return ['<details>', '<summary>Evidence</summary>', '',
    `${link('Base', identity.baseSha)} → ${link('Head', identity.headSha)}${identity.harnessSha ? ' · ' + link('Harness', identity.harnessSha) : ''}${identity.reporterSha ? ' · ' + link('Reporter', identity.reporterSha) : ''}  `,
    `[Measurement run ${identity.runId}, attempt ${identity.runAttempt}](https://github.com/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.runAttempt})${method ? ` · [Method / noise thresholds](${method})` : ''}`,
    ...lines, '', '</details>'].join('\n');
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
  const visible = comparisons.filter(row => !unsupportedBrowser(policies.find(policy => policy.id === row.id), row));
  const unsupported = comparisons.length - visible.length;
  const failed = comparisons.some(row => row.failed);
  const budgets = policies.filter(policy => policy.kind === 'deterministic').flatMap(policy => {
    const limits = [policy.maximum === undefined ? '' : `max ${policy.maximum} ${cell(policy.unit)}`,
      policy.minimum === undefined ? '' : `min ${policy.minimum} ${cell(policy.unit)}`,
      policy.maxRegressionPercent === undefined ? '' : `regression ≤ ${policy.maxRegressionPercent}%`].filter(Boolean);
    return limits.length ? [`Budget (${cell(policy.label)}): ${limits.join(', ')}.`] : [];
  });
  const markdown = [COMMENT_MARKER, '### Synthetic performance', '', renderSummary(visible),
    ...(failed ? ['', '**❌ Budget or measurement failed.**'] : []), '',
    renderTable(policies, comparisons), '', 'Medians · ↓ lower / ↑ higher is better · timings informational.',
    ...(unsupported ? ['', `⚪ Browser/GPU: ${unsupported} ${unsupported === 1 ? 'metric' : 'metrics'} unsupported.`] : []), '',
    reportEvidence(identity, [...budgets, 'Synthetic, untrusted observations.'])].join('\n');
  return { markdown, comparisons, failed };
}
