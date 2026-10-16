import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { policies } from './policies.mjs';

export { policies };
const require = createRequire(new URL('../harness/package.json', import.meta.url));
const Ajv = require('ajv/dist/2020.js').default;
const schemaBytes = readFileSync(new URL('./run.schema.json', import.meta.url));
export const schemaSha256 = createHash('sha256').update(schemaBytes).digest('hex');
const validateShape = new Ajv({ strict: true, allErrors: false, validateFormats: false }).compile(JSON.parse(schemaBytes));

const median = sorted => sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
  : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

/** All summaries use raw bounded samples; no artifact-provided statistic is trusted. */
export function summarize(samples) {
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > 1000 ||
    !samples.every(value => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER)) throw new Error('Invalid measurement samples');
  const sorted = [...samples].sort((a, b) => a - b), value = median(sorted);
  return { count: samples.length, median: value, p95: sorted[Math.ceil(sorted.length * .95) - 1],
    mad: median(samples.map(sample => Math.abs(sample - value)).sort((a, b) => a - b)), min: sorted[0], max: sorted.at(-1) };
}

const unique = values => new Set(values).size === values.length;
/** Closed JSON Schema plus cross-field invariants; never returns raw diagnostics. */
export function validateRun(value) {
  try {
    if (!validateShape(value) || value.harness.schemaSha256 !== schemaSha256 ||
      !unique(value.metrics.map(row => row.id)) || !unique(value.fixtures.map(row => row.id)) ||
      !unique(value.source.files.map(row => row.path)) ||
      value.source.files.some(row => row.path.split('/').some(part => part === '.' || part === '..' || part === ''))) return false;
    for (const row of value.metrics) {
      if (row.status !== 'measured') continue;
      const policy = policies.find(item => item.id === row.id);
      if (!policy || row.samples.length !== (policy.kind === 'deterministic' ? 1 : value.profile.repetitions)) return false;
      const summary = summarize(row.samples);
      if (Object.keys(summary).some(key => row.summary[key] !== summary[key])) return false;
    }
    return true;
  } catch { return false; }
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const fingerprint = value => createHash('sha256').update(canonical(value)).digest('hex');
const sameGit = (before, after) => before.commit === after.commit && before.tree === after.tree && before.dirty === after.dirty;

/** Adapter expected by PR189. Fingerprints are derived here, never accepted from a run. */
export function reportView(value) {
  if (!validateRun(value) || value.harness.dirty || value.harness.after.dirty ||
    !sameGit(value.harness, value.harness.after) || value.harness.filesSha256 !== value.harness.after.filesSha256) throw new Error('Invalid measurement run');
  return {
    sourceCommit: value.source.commit, sourceTree: value.source.tree,
    dirty: value.source.dirty || value.source.after.dirty || !sameGit(value.source, value.source.after),
    harnessCommit: value.harness.commit, schemaSha256,
    fixtureFingerprint: fingerprint(value.fixtures.map(({ id, bytes, sha256 }) => ({ id, bytes, sha256 }))),
    comparisonFingerprint: fingerprint({ method: value.method, profile: value.profile, environment: value.environment,
      harness: { tree: value.harness.tree, filesSha256: value.harness.filesSha256 }, schemaSha256 }),
    metrics: value.metrics.map(row => row.status === 'measured' ? { id: row.id, status: row.status, samples: [...row.samples] }
      : { id: row.id, status: row.status }),
  };
}
