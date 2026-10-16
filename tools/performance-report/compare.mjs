// Pure report arithmetic. The measurement owner supplies validated, normalized rows.
// Budget policy is owned by the trusted caller, never by uploaded measurements.
export function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarize(samples) {
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > 1000 ||
      !samples.every(value => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER)) {
    throw new Error('Invalid bounded nonnegative measurement samples');
  }
  const value = median(samples);
  const mad = median(samples.map(sample => Math.abs(sample - value)));
  return { value, count: samples.length, noisePercent: value === 0 ? (mad === 0 ? 0 : null) : 100 * 1.4826 * mad / value };
}

export function compareMetric(policy, base, head) {
  const missing = base?.skipReason || head?.skipReason || (!base || !head ? 'metric-unavailable' : null);
  if (missing) return { id: policy.id, status: 'skipped', reason: missing,
    base: base?.samples ? summarize(base.samples) : null, head: head?.samples ? summarize(head.samples) : null, deltaPercent: null, failed: false };
  const before = summarize(base.samples), after = summarize(head.samples);
  const deltaPercent = before.value === 0 ? (after.value === 0 ? 0 : null) : 100 * (after.value - before.value) / before.value;
  const signedChange = (after.value - before.value) * (policy.direction === 'lower' ? 1 : -1);
  let status = signedChange === 0 ? 'unchanged' : signedChange > 0 ? 'degraded' : 'improved';
  let failed = false;
  if (policy.kind === 'deterministic') {
    if ([base.samples, head.samples].some(samples => !samples.every(value => value === samples[0]))) {
      return { id: policy.id, status: 'skipped', reason: 'deterministic-samples-disagree', base: before, head: after, deltaPercent, failed: true };
    }
    failed = policy.maximum !== undefined && after.value > policy.maximum;
    failed ||= policy.minimum !== undefined && after.value < policy.minimum;
    failed ||= policy.maxRegressionPercent !== undefined && signedChange > 0 &&
      (deltaPercent === null || Math.abs(deltaPercent) > policy.maxRegressionPercent);
  } else {
    // A hosted-runner timing is descriptive. MAD is a noise indicator, not a CI.
    const noise = Math.max(5, 2 * ((before.noisePercent ?? Infinity) + (after.noisePercent ?? Infinity)));
    if (Math.min(before.count, after.count) < 5) status = 'insufficient-samples';
    else if (deltaPercent !== null && deltaPercent !== 0 && Math.abs(deltaPercent) <= noise) status = 'within-noise';
  }
  return { id: policy.id, status, base: before, head: after, deltaPercent, failed };
}

const number = value => value === null ? 'n/a' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
const percent = value => value === null ? 'n/a (zero base)' : `${value > 0 ? '+' : ''}${number(value)}%`;
// Escape all external labels, including Markdown punctuation and GitHub mentions.
export function cell(value) {
  return String(value).replace(/[&<>|`\\\[\]*_!#@\r\n]/g, character => `&#${character.charCodeAt(0)};`);
}

export function renderTable(policies, comparisons) {
  const rows = ['| Metric | Base | Head | Delta | Direction | Samples / noise (base → head) | Result / budget |',
    '| --- | ---: | ---: | ---: | --- | --- | --- |'];
  for (const policy of policies) {
    const result = comparisons.find(row => row.id === policy.id);
    if (!result) throw new Error('Missing comparison');
    const direction = policy.direction === 'lower' ? '↓ lower is better' : '↑ higher is better';
    const sample = value => value ? `${value.count} / ${value.noisePercent === null ? 'n/a' : number(value.noisePercent) + '%'}` : '—';
    const hasBudget = ['maximum', 'minimum', 'maxRegressionPercent'].some(key => policy[key] !== undefined);
    const budget = policy.kind === 'deterministic' ? result.failed ? 'FAIL' : result.status === 'skipped' ? 'unavailable' : hasBudget ? 'pass' : 'no budget' : 'informational';
    const limits = policy.kind === 'deterministic' ? [policy.maximum === undefined ? '' : `max ${number(policy.maximum)} ${cell(policy.unit)}`,
      policy.minimum === undefined ? '' : `min ${number(policy.minimum)} ${cell(policy.unit)}`,
      policy.maxRegressionPercent === undefined ? '' : `regression ≤ ${number(policy.maxRegressionPercent)}%`].filter(Boolean).join(', ') : '';
    rows.push(`| ${cell(policy.label)} | ${result.base ? number(result.base.value) + ' ' + cell(policy.unit) : '—'} | ${result.head ? number(result.head.value) + ' ' + cell(policy.unit) : '—'} | ${result.status === 'skipped' ? '—' : percent(result.deltaPercent)} | ${direction} | ${sample(result.base)} → ${sample(result.head)} | ${cell(result.reason ?? result.status)}; ${budget}${limits ? ' (' + limits + ')' : ''} |`);
  }
  return rows.join('\n');
}
