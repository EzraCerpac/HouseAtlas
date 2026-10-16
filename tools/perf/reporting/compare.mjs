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
  const sorted = [...samples].sort((a, b) => a - b);
  return { value, count: samples.length, p95: sorted[Math.ceil(samples.length * 0.95) - 1], mad,
    min: sorted[0], max: sorted.at(-1), noisePercent: value === 0 ? (mad === 0 ? 0 : null) : 100 * 1.4826 * mad / value };
}

// Compare the shortest round-trip decimal forms exactly. This avoids a false
// gate failure such as (0.33 - 0.3) / 0.3 * 100 > 10 due to binary round-off,
// while retaining strict integer/byte budgets without a broad noise tolerance.
function decimal(value) {
  const [coefficient, power = '0'] = value.toString().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const exponent = Number(power) - fraction.length;
  const digits = BigInt(whole + fraction);
  return exponent >= 0 ? { n: digits * 10n ** BigInt(exponent), d: 1n } : { n: digits, d: 10n ** BigInt(-exponent) };
}
function exceedsRegression(base, head, limit) {
  const before = decimal(base), after = decimal(head), budget = decimal(limit);
  const change = after.n * before.d - before.n * after.d;
  const absolute = change < 0n ? -change : change;
  return before.n === 0n || absolute * 100n * budget.d > after.d * before.n * budget.n;
}

export function compareMetric(policy, base, head) {
  const missing = [...new Set([base?.skipReason, head?.skipReason,
    !base ? 'base-metric-unavailable' : null, !head ? 'head-metric-unavailable' : null].filter(Boolean))].join('; ') || null;
  if (missing) return { id: policy.id, status: 'skipped', reason: missing,
    base: base?.samples ? summarize(base.samples) : null, head: head?.samples ? summarize(head.samples) : null, deltaAbsolute: null, deltaPercent: null, failed: base?.failed === true || head?.failed === true };
  const before = summarize(base.samples), after = summarize(head.samples);
  const deltaAbsolute = after.value - before.value;
  const deltaPercent = before.value === 0 ? (after.value === 0 ? 0 : null) : 100 * deltaAbsolute / before.value;
  const signedChange = (after.value - before.value) * (policy.direction === 'lower' ? 1 : -1);
  let status = signedChange === 0 ? 'unchanged' : signedChange > 0 ? 'degraded' : 'improved';
  let failed = false;
  if (policy.kind === 'deterministic') {
    if ([base.samples, head.samples].some(samples => !samples.every(value => value === samples[0]))) {
      const budgeted = ['maximum', 'minimum', 'maxRegressionPercent'].some(key => policy[key] !== undefined);
      return { id: policy.id, status: 'skipped', reason: 'deterministic-samples-disagree', base: before, head: after, deltaAbsolute: null, deltaPercent: null, failed: budgeted };
    }
    failed = policy.maximum !== undefined && after.value > policy.maximum;
    failed ||= policy.minimum !== undefined && after.value < policy.minimum;
    failed ||= policy.maxRegressionPercent !== undefined && signedChange > 0 &&
      exceedsRegression(before.value, after.value, policy.maxRegressionPercent);
  } else {
    // A hosted-runner timing is descriptive. MAD is a noise indicator, not a CI.
    const noise = Math.max(5, 2 * ((before.noisePercent ?? Infinity) + (after.noisePercent ?? Infinity)));
    if (Math.min(before.count, after.count) < 5) status = 'insufficient-samples';
    else if (deltaPercent !== null && deltaPercent !== 0 && Math.abs(deltaPercent) <= noise) status = 'within-noise';
  }
  return { id: policy.id, status, base: before, head: after, deltaAbsolute, deltaPercent, failed };
}

const number = value => value === null ? 'n/a' : new Intl.NumberFormat('en-US', {
  maximumSignificantDigits: 17, notation: value !== 0 && (Math.abs(value) < 1e-6 || Math.abs(value) >= 1e12) ? 'scientific' : 'standard'
}).format(value);
const percent = value => value === null ? 'n/a (zero base)' : `${value > 0 ? '+' : ''}${number(value)}%`;
// Escape all external labels, including Markdown punctuation and GitHub mentions.
export function cell(value) {
  return String(value).replace(/[&<>|`\\\[\]*_!#@:.\r\n]/g, character => `&#${character.charCodeAt(0)};`);
}

export function renderTable(policies, comparisons) {
  const rows = ['| Metric | Base median / p95 | Head median / p95 | Delta | Delta % | Direction | Samples / noise (base → head) | Result / budget |',
    '| --- | ---: | ---: | ---: | ---: | --- | --- | --- |'];
  for (const policy of policies) {
    const result = comparisons.find(row => row.id === policy.id);
    if (!result) throw new Error('Missing comparison');
    const direction = policy.direction === 'lower' ? '↓ lower is better' : '↑ higher is better';
    const sample = value => value ? `${value.count} / ${value.noisePercent === null ? 'n/a' : number(value.noisePercent) + '%'}` : '—';
    const hasBudget = ['maximum', 'minimum', 'maxRegressionPercent'].some(key => policy[key] !== undefined);
    const budget = result.failed ? 'FAIL' : policy.kind === 'deterministic' ? result.status === 'skipped' ? 'unavailable' : hasBudget ? 'pass' : 'no budget' : 'informational';
    const limits = policy.kind === 'deterministic' ? [policy.maximum === undefined ? '' : `max ${number(policy.maximum)} ${cell(policy.unit)}`,
      policy.minimum === undefined ? '' : `min ${number(policy.minimum)} ${cell(policy.unit)}`,
      policy.maxRegressionPercent === undefined ? '' : `regression ≤ ${number(policy.maxRegressionPercent)}%`].filter(Boolean).join(', ') : '';
    const absolute = value => value ? `${number(value.value)} ${cell(policy.unit)}${policy.kind === 'timing' ? ' / ' + number(value.p95) + ' ' + cell(policy.unit) : ''}` : '—';
    const absoluteDelta = result.deltaAbsolute === null ? '—' : `${result.deltaAbsolute > 0 ? '+' : ''}${number(result.deltaAbsolute)} ${cell(policy.unit)}`;
    rows.push(`| ${cell(policy.label)} | ${absolute(result.base)} | ${absolute(result.head)} | ${absoluteDelta} | ${result.status === 'skipped' ? '—' : percent(result.deltaPercent)} | ${direction} | ${sample(result.base)} → ${sample(result.head)} | ${cell(result.reason ?? result.status)}; ${budget}${limits ? ' (' + limits + ')' : ''} |`);
  }
  return rows.join('\n');
}
