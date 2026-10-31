// The measurement contract owns the wire schema, validator and normalization.
// This module checks the normalized trust/comparability boundary, not a second
// houseatlas.perf.run/1 schema.
import { makeReport, validateIdentity } from './report.mjs';

const sha = (value, length) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
// Reporter-owned ceilings retain the achieved #522 startup bytes. Keep this
// outside contract/harness: changing those files changes the pinned collector.
const startupMaximums = Object.freeze({
  'frontend.startup_js.bytes': 1843578,
  'frontend.startup_js.gzip_bytes': 303827,
});
function reporterPolicies(policies) {
  return policies.map(policy => {
    if (!Object.hasOwn(startupMaximums, policy.id)) return policy;
    if (policy.kind !== 'deterministic' || policy.unit !== 'bytes' || policy.direction !== 'lower' ||
        policy.maximum !== undefined && (!Number.isFinite(policy.maximum) || policy.maximum < 0)) throw new Error('Invalid startup budget policy');
    // Retain any stricter owner maximum and every other canonical policy field.
    const maximum = Math.min(startupMaximums[policy.id], policy.maximum ?? Infinity);
    return { ...policy, maximum };
  });
}
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
  const result = makeReport({ identity, policies: reporterPolicies(contract.policies), base: normalize(base, 'base'), head: normalize(head, 'head') });
  const profiles = { schemaSha256: contract.schemaSha256,
    baseFixture: base.fixtureFingerprint, headFixture: head.fixtureFingerprint,
    baseComparison: base.comparisonFingerprint, headComparison: head.comparisonFingerprint };
  return { ...result, profiles };
}
