// The measurement contract owns the wire schema, validator and normalization.
// This module checks the normalized trust/comparability boundary, not a second
// houseatlas.perf.run/1 schema.
import { makeReport, validateIdentity } from './report.mjs';

const sha = (value, length) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
function checkedView(run, contract, commit, tree, harness) {
  try {
    if (!contract.validateRun(run)) throw new Error();
    const view = contract.reportView(run);
    if (!view || view.sourceCommit !== commit || view.sourceTree !== tree || view.dirty !== false || view.harnessCommit !== harness ||
        view.schemaSha256 !== contract.schemaSha256 || !sha(view.fixtureFingerprint, 64) || !sha(view.comparisonFingerprint, 64) ||
        !Array.isArray(view.metrics) || view.metrics.length > 64) throw new Error();
    const ids = new Set();
    for (const row of view.metrics) {
      if (!row || typeof row.id !== 'string' || !contract.policies.some(policy => policy.id === row.id) || ids.has(row.id) || !['measured', 'unsupported', 'blocked', 'failed'].includes(row.status) ||
          (row.status === 'measured' && !Array.isArray(row.samples)) ||
          (row.status !== 'measured' && row.samples !== undefined && row.samples !== null)) throw new Error();
      ids.add(row.id);
    }
    return view;
  } catch { throw new Error('Invalid measurement contract, source identity or data'); }
}

export function compareRuns({ identity, baseRun, headRun, contract }) {
  validateIdentity(identity);
  if (!contract || typeof contract.validateRun !== 'function' || typeof contract.reportView !== 'function' ||
      !sha(contract.schemaSha256, 64) || !Array.isArray(contract.policies)) throw new Error('Measurement contract unavailable');
  const base = checkedView(baseRun, contract, identity.baseSha, identity.baseTree, identity.harnessSha);
  const head = checkedView(headRun, contract, identity.headSha, identity.headTree, identity.harnessSha);
  const mismatch = base.fixtureFingerprint !== head.fixtureFingerprint ? 'fixture-mismatch' :
    base.comparisonFingerprint !== head.comparisonFingerprint ? 'method-or-environment-mismatch' : null;
  const normalize = (view, side) => new Map(contract.policies.map(policy => {
    const row = view.metrics.find(metric => metric.id === policy.id);
    if (!row) return [policy.id, { skipReason: `${side}-metric-unavailable` }];
    if (row.status !== 'measured') return [policy.id, { skipReason: `${side}-${row.status}`, failed: row.status === 'failed' }];
    return [policy.id, { samples: row.samples, ...(mismatch ? { skipReason: mismatch } : {}) }];
  }));
  const result = makeReport({ identity, policies: contract.policies, base: normalize(base, 'base'), head: normalize(head, 'head') });
  const profiles = { schemaSha256: contract.schemaSha256,
    baseFixture: base.fixtureFingerprint, headFixture: head.fixtureFingerprint,
    baseComparison: base.comparisonFingerprint, headComparison: head.comparisonFingerprint };
  result.markdown += `\n\nSchema SHA-256: \`${profiles.schemaSha256}\`  \nFixture fingerprints (base → head): \`${profiles.baseFixture}\` → \`${profiles.headFixture}\`  \nMethod/environment fingerprints (base → head): \`${profiles.baseComparison}\` → \`${profiles.headComparison}\``;
  return { ...result, profiles };
}
