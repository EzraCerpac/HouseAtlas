// Data-only unit fixture. These identities and observations are synthetic, not an executed run.
import { fixtureFacts, fixtures } from '../harness/fixtures.mjs';
import { METHOD, PROFILE } from '../harness/settings.mjs';
import { policies, schemaSha256, summarize } from './index.mjs';

export function exampleRun() {
  const source = { commit: '1'.repeat(40), tree: '2'.repeat(40), dirty: false };
  const harness = { commit: '3'.repeat(40), tree: '4'.repeat(40), dirty: false };
  return { format: 'houseatlas.perf.run/1', synthetic: true,
    source: { ...source, after: { ...source }, files: [] },
    harness: { ...harness, schemaSha256, filesSha256: '5'.repeat(64), after: { ...harness, filesSha256: '5'.repeat(64) } },
    method: { ...METHOD }, fixtures: fixtureFacts(fixtures()), profile: structuredClone(PROFILE),
    environment: {
      runtime: { node: 'v26.10.0', v8: 'synthetic-v8', npm: '11.19.1', platform: 'linux', arch: 'x64', reactMode: 'production', execArgv: [] },
      host: { cpu: 'Synthetic unit host', logicalCpus: 2, availableParallelism: 2, memoryBytes: 1073741824, cpuQuota: null, memoryLimit: null },
      toolchain: { vite: '8.3.3', react: '19.3.0', reactDom: '19.3.0', three: '0.186.1', ajv: '8.20.0', lockSha256: '6'.repeat(64), buildVite: '8.3.3', buildReact: '19.3.0' },
      browser: { status: 'unsupported', reason: 'supported-browser-tool-unavailable', version: null },
      gpu: { status: 'unsupported', reason: 'no-renderer-executed', renderer: null },
    },
    metrics: policies.map(policy => policy.id.startsWith('browser.') ? { id: policy.id, status: 'unsupported', reason: 'supported-browser-tool-unavailable' }
      : measured(policy.id, policy.kind === 'deterministic' ? [100] : [9,1,8,2,7,3,6,4,5])),
  };
}
export const measured = (id, samples) => ({ id, status: 'measured', samples, summary: summarize(samples) });
