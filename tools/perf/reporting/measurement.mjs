import { fileURLToPath } from 'node:url';
import { compareRuns } from './adapter.mjs';

// Reviewed, immutable measurement source. The unprivileged workflow pins the
// same commit. Contract code in a privileged job is loaded only from default.
export const HARNESS_SHA = '4bb08dfd255c32c385d496ae64705719d5d56e80';
export const SCHEMA_SHA256 = '642af28eacc14e6fdd7b9f7071979f07abc8dcb9a427773f5d74dab672b7056a';

export async function loadTrustedContract() {
  try {
    const contract = await import('../contract/index.mjs');
    const { harnessDigest } = await import('../harness/source.mjs');
    if (contract.schemaSha256 !== SCHEMA_SHA256) return null;
    return { contract, harnessFilesSha256: harnessDigest(fileURLToPath(new URL('../../../', import.meta.url))) };
  } catch { return null; }
}

export async function prepareMeasurements({ api, origin, artifact, bundle }) {
  if (!bundle) return null;
  const harness = await api.getCommit(HARNESS_SHA);
  if (harness.sha !== HARNESS_SHA || !/^[0-9a-f]{40}$/.test(harness.commit?.tree?.sha ?? '') ||
      bundle.contract.schemaSha256 !== SCHEMA_SHA256) throw new Error('Invalid trusted harness identity');
  for (const value of [artifact.baseRun, artifact.headRun]) {
    if (!bundle.contract.validateRun(value) || value.harness.commit !== HARNESS_SHA ||
        value.harness.tree !== harness.commit.tree.sha || value.harness.filesSha256 !== bundle.harnessFilesSha256) throw new Error('Invalid measurement identity');
  }
  const input = { identity: { ...origin.identity, harnessSha: HARNESS_SHA }, baseRun: artifact.baseRun, headRun: artifact.headRun, contract: bundle.contract };
  compareRuns(input); // Validate identities, dirty state and complete normalized data before any write.
  return input;
}
