import { fmtDateTimeReadable } from '../data/time';
import type { NetworkLiveFacts } from '../overlays/network/types';
import { plural } from './atlas-text';

/** The collector's observation kind; its `value.state` is `reachable` or `no-reply`. */
export const REACHABILITY_KIND = 'measured-reachability';
const STATE = { reachable: 'Reachable', 'no-reply': 'No reply' } as const;
const QUALIFIER = { stale: 'stale', invalidated: 'invalidated', unknown: 'freshness unknown' } as const;
type Observation = NonNullable<NetworkLiveFacts['observedState']>[number];

export interface Reachability {
  /** "Reachable", "No reply" or "Not measured", with a freshness qualifier unless recent. */
  readonly state: string;
  readonly old: boolean;
  /** The latest measured values that were supplied: "2.4 ms", "0% loss". */
  readonly metrics: readonly string[];
  /** When the latest reachability fact was measured. */
  readonly measuredAt: string | null;
  readonly series: readonly NonNullable<NetworkLiveFacts['recentSeries']>[number][];
}

const measuredState = (item: Observation) => {
  const value = item.value;
  if (item.kind !== REACHABILITY_KIND || value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = (value as { readonly state?: unknown }).state;
  return state === 'reachable' || state === 'no-reply' ? state : null;
};
export const latencyText = (ms: number) => `${ms < 10 ? ms.toFixed(1) : Math.round(ms).toLocaleString()} ms`;
export const lossText = (loss: number) =>
  `${loss > 0 && loss < 0.01 ? '<1' : loss < 1 && loss > 0.99 ? '>99' : Math.round(loss * 100)}% loss`;

/** The measured reachability joined to a device, or null when the frame
 * carries none (an old frame or a source without the collector). A missing
 * latest fact is "Not measured": an unknown, never a failure or a reply. */
export function reachability(facts: NetworkLiveFacts): Reachability | null {
  if (facts.recentSeries === undefined) return null;
  const latest = (facts.observedState ?? []).filter(item => measuredState(item) !== null)
    .sort((a, b) => Date.parse(b.factAt) - Date.parse(a.factAt))[0];
  const freshness = latest === undefined ? 'recent' : latest.freshness !== 'recent' ? latest.freshness : facts.freshness;
  const qualifier = freshness === 'recent' ? null : QUALIFIER[freshness];
  return {
    state: latest === undefined ? 'Not measured' : [STATE[measuredState(latest)!], qualifier].filter(Boolean).join(' · '),
    old: latest === undefined || qualifier !== null,
    metrics: [facts.latencyMs == null ? null : latencyText(facts.latencyMs), facts.loss == null ? null : lossText(facts.loss)]
      .filter((text): text is string => text !== null),
    measuredAt: latest?.factAt ?? null,
    series: facts.recentSeries,
  };
}

const HOUR = 3_600_000;
export const SPARK_WIDTH = 120, SPARK_HEIGHT = 24;
const LINE_TOP = 2, LINE_BOTTOM = 15, TICK_BOTTOM = SPARK_HEIGHT, TICK_MAX = 6, PAD = 2;

/** The hourly series as a sparkline: latency as a line that breaks at every
 * missing or unmeasured hour (never interpolated, never drawn as zero), lone
 * hours as dots, latency scaled from 0 ms, and loss as a tick under its hour. */
export function sparkline(series: Reachability['series']) {
  if (series.length === 0) return null;
  const start = Date.parse(series[0]!.hour), end = Date.parse(series[series.length - 1]!.hour);
  const span = Math.round((end - start) / HOUR) + 1;
  const x = (hour: string) => {
    const at = Math.round((Date.parse(hour) - start) / HOUR);
    return span === 1 ? SPARK_WIDTH / 2 : PAD + at * (SPARK_WIDTH - 2 * PAD) / (span - 1);
  };
  const latencies = series.flatMap(point => point.latencyMs === null ? [] : [point.latencyMs]);
  const hi = Math.max(0, ...latencies);
  const y = (ms: number) => hi === 0 ? LINE_BOTTOM : LINE_BOTTOM - ms / hi * (LINE_BOTTOM - LINE_TOP);
  const runs: (readonly [number, number])[][] = [];
  let previous: number | null = null;
  for (const point of series) {
    const at = Date.parse(point.hour);
    if (point.latencyMs === null) { previous = null; continue; }
    const xy = [x(point.hour), y(point.latencyMs)] as const;
    if (previous !== null && at - previous === HOUR) runs[runs.length - 1]!.push(xy); else runs.push([xy]);
    previous = at;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  const measured = series.filter(point => point.latencyMs !== null || point.loss !== null).length;
  const lossy = series.filter(point => point.loss !== null && point.loss > 0);
  return {
    line: runs.filter(run => run.length > 1).map(run => run.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${r(px)} ${r(py)}`).join('')).join(''),
    dots: runs.filter(run => run.length === 1).map(([point]) => [r(point![0]), r(point![1])] as const),
    ticks: lossy.map(point => [r(x(point.hour)), r(TICK_BOTTOM - Math.max(2, point.loss! * TICK_MAX))] as const),
    label: `Hourly latency, ${span === 1 ? fmtDateTimeReadable(series[0]!.hour)
      : `${fmtDateTimeReadable(series[0]!.hour)} to ${fmtDateTimeReadable(series[series.length - 1]!.hour)}`}: `
      + `${measured.toLocaleString()} of ${plural(span, 'hour')} measured${lossy.length > 0 ? `, ${lossy.length.toLocaleString()} with loss` : ''}`,
  };
}
