import type { CollectorAction, CollectorActionResponse, CollectorResults, CollectorScope, SpeedResult } from '../../../integration/network-collector';
import type { NetworkInventoryRefreshResult } from '../../../integration/network-inventory-refresh';
import { fmtDateTimeReadable } from '../data/time';
import { plural } from './atlas-text';
import { latencyText, sparkPaths, SPARK_HEIGHT, SPARK_WIDTH } from './network-reachability';

/** The host's Network collector: stored results and explicit Editor tests.
 * Absent where no collector route exists (a saved copy, the stored copy). */
export interface NetworkCollectorPort {
  /** The signed-in caller may request tests (the view's Editor hint); the server still decides. */
  readonly canTest: () => boolean;
  /** One passive GET of stored results; no collection. */
  readonly read: (scope: CollectorScope, signal: AbortSignal) => Promise<CollectorResults>;
  /** One POST, sent only on a press and never retried. */
  readonly act: (scope: CollectorScope, action: CollectorAction) => Promise<CollectorActionResponse>;
  /** One device-list refresh POST, sent only on a named Editor's press and never retried; absent without the route. */
  readonly refresh?: (scope: CollectorScope) => Promise<NetworkInventoryRefreshResult>;
}

export type ResultsRead = { readonly status: 'loading' | 'failed' } | { readonly status: 'read'; readonly value: CollectorResults };
export interface ActionOutcome {
  readonly action: CollectorAction;
  /** Null: the request failed without a readable answer. */
  readonly response: CollectorActionResponse | null;
  /** When this browser received the answer. */
  readonly answeredAt: string;
}
export interface RefreshOutcome {
  /** Null: no readable answer; `lost` says whether the request timed out. */
  readonly response: NetworkInventoryRefreshResult | null;
  readonly lost: 'timeout' | 'unknown' | null;
  /** When this browser received the answer. */
  readonly answeredAt: string;
  /** The one results re-read a refreshed answer sends; null when none was sent.
   * Unconfirmed: it failed or carried no results, and the earlier results stay. */
  readonly reread: 'pending' | 'read' | 'unconfirmed' | null;
}
export interface CollectorSnapshot {
  readonly reads: ReadonlyMap<string, ResultsRead>;
  /** The one test in flight, for every device and the speed test. */
  readonly running: { readonly scope: string; readonly action: CollectorAction } | null;
  /** The latest answer per device, and for the speed test. */
  readonly outcomes: ReadonlyMap<string, ActionOutcome>;
  /** Every run this browser's completed speed tests returned, per scope, whatever its state. */
  readonly speedRuns: ReadonlyMap<string, readonly SpeedResult[]>;
  /** The one device-list refresh in flight (with its re-read), by scope key. */
  readonly refreshing: string | null;
  /** The latest device-list refresh answer per scope. */
  readonly refreshes: ReadonlyMap<string, RefreshOutcome>;
  /** Per scope, the server fetch time (or null) of this browser's latest refresh
   * whose re-read affirmed agreement; later answers without a re-read keep it. */
  readonly agreed: ReadonlyMap<string, string | null>;
}
export interface CollectorStore {
  readonly snapshot: () => CollectorSnapshot;
  readonly subscribe: (changed: () => void) => () => void;
  /** Reads a scope's results once for this store; later calls reuse that read. */
  readonly ensure: (scope: CollectorScope) => void;
  /** Sends one action unless one is already in flight; true when sent. */
  readonly run: (scope: CollectorScope, action: CollectorAction) => boolean;
  /** Sends one device-list refresh unless one is in flight; a refreshed answer
   * re-reads that scope's results once. True when sent. */
  readonly refresh: (scope: CollectorScope) => boolean;
  readonly dispose: () => void;
}

export const scopeKey = (scope: CollectorScope) => JSON.stringify([scope.workspaceId, scope.homeId, scope.sourceInstanceId, scope.collectionId]);
export const outcomeKey = (scope: CollectorScope, action: CollectorAction) =>
  `${scopeKey(scope)}\n${action.kind === 'speed' ? 'speed' : `device:${action.deviceId}`}`;
/** The scope's results when the collector answered with them; otherwise null and nothing is shown. */
export function collectorResults(snapshot: CollectorSnapshot, scope: CollectorScope) {
  const read = snapshot.reads.get(scopeKey(scope));
  return read?.status === 'read' && read.value.status === 'available' && read.value.results ? read.value : null;
}

/** One store per Network layer showing: at most one results GET per scope,
 * and one action at a time. Nothing is read until a card or the key asks. */
export function createCollectorStore(port: NetworkCollectorPort, now: () => string = () => new Date().toISOString()): CollectorStore {
  let state: CollectorSnapshot = { reads: new Map(), running: null, outcomes: new Map(), speedRuns: new Map(), refreshing: null, refreshes: new Map(), agreed: new Map() };
  let disposed = false;
  const listeners = new Set<() => void>(), controller = new AbortController();
  const set = (next: CollectorSnapshot) => { if (disposed) return; state = next; for (const changed of [...listeners]) changed(); };
  const setRead = (key: string, read: ResultsRead) => set({ ...state, reads: new Map(state.reads).set(key, read) });
  // Sent now, in the caller's turn; a synchronous throw is a failed request.
  const send = <T,>(request: () => Promise<T>): Promise<T> => { try { return request(); } catch (error) { return Promise.reject(error); } };
  return {
    snapshot: () => state,
    subscribe(changed) { listeners.add(changed); return () => { listeners.delete(changed); }; },
    ensure(scope) {
      const key = scopeKey(scope);
      if (disposed || state.reads.has(key)) return;
      setRead(key, { status: 'loading' });
      send(() => port.read(scope, controller.signal))
        .then(value => setRead(key, { status: 'read', value }), () => setRead(key, { status: 'failed' }));
    },
    run(scope, action) {
      if (disposed || state.running) return false;
      set({ ...state, running: { scope: scopeKey(scope), action } });
      send(() => port.act(scope, action)).then(response => response, () => null).then(response => {
        const key = scopeKey(scope), run = response?.status === 'completed' && response.result.kind === 'speed' ? response.result.result : null;
        set({ ...state, running: null, outcomes: new Map(state.outcomes).set(outcomeKey(scope, action), { action, response, answeredAt: now() }),
          speedRuns: run ? new Map(state.speedRuns).set(key, [...state.speedRuns.get(key) ?? [], run]) : state.speedRuns });
      });
      return true;
    },
    refresh(scope) {
      const key = scopeKey(scope), request = port.refresh;
      if (disposed || state.refreshing || !request) return false;
      set({ ...state, refreshing: key });
      const record = (outcome: RefreshOutcome, extra: Partial<CollectorSnapshot> = {}) =>
        set({ ...state, ...extra, refreshing: outcome.reread === 'pending' ? key : null, refreshes: new Map(state.refreshes).set(key, outcome) });
      send(() => request(scope)).then(response => ({ response, lost: null }),
        (error: unknown) => ({ response: null, lost: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' as const : 'unknown' as const }))
        .then(({ response, lost }) => {
          // Only a published refresh changes what the results say; that answer re-reads them once.
          const outcome: RefreshOutcome = { response, lost, answeredAt: now(), reread: response?.status === 'refreshed' || response?.status === 'unchanged' ? 'pending' : null };
          record(outcome);
          if (outcome.reread === null || disposed) return;
          send(() => port.read(scope, controller.signal)).then(
            value => {
              const prior = state.reads.get(key);
              // A result-less reply still says who may refresh, whether review is needed and, when known, both
              // revisions; earlier measurements stay, and known unequal revisions end the earlier agreement.
              if (!(value.status === 'available' && value.results)) {
                if (value.status !== 'unknown' || prior?.status !== 'read' || prior.value.status === 'unavailable') return record({ ...outcome, reread: 'unconfirmed' });
                const known = value.inventoryRevision !== null && value.servedInventoryRevision !== null, agreed = new Map(state.agreed);
                if (known && value.inventoryRevision !== value.servedInventoryRevision) agreed.delete(key);
                return record({ ...outcome, reread: 'unconfirmed' }, { agreed, reads: new Map(state.reads).set(key, { status: 'read', value: { ...prior.value,
                  mayRefresh: value.mayRefresh, needsReview: value.needsReview, reviewedInventoryRevision: value.reviewedInventoryRevision,
                  ...(known ? { inventoryRevision: value.inventoryRevision, servedInventoryRevision: value.servedInventoryRevision } : {}) } }) });
              }
              const agreed = new Map(state.agreed), fetched = response?.status === 'refreshed' || response?.status === 'unchanged' ? response.cache.lastSuccessfulFetchAt : null;
              if (affirmsAgreement(value)) agreed.set(key, fetched); else agreed.delete(key);
              record({ ...outcome, reread: 'read' }, { reads: new Map(state.reads).set(key, { status: 'read', value }), agreed });
            },
            // The client's rule: a failed read (a denial looks the same as any other) retires the results.
            () => record({ ...outcome, reread: 'unconfirmed' }, { reads: new Map(state.reads).set(key, { status: 'failed' }) }));
        });
      return true;
    },
    dispose() { disposed = true; listeners.clear(); controller.abort(); },
  };
}

const TEST_REASON: Readonly<Record<string, string>> = {
  'no-target': 'no address to test',
  'not-at-home': 'the collector is not on the home network',
  'command-unavailable': 'the test command is unavailable',
  shutdown: 'the collector was stopping',
  'speed-test-in-progress': 'a speed test was running',
  'no-history': 'no result',
  'missing-fields': 'the speed tool left out values',
  'malformed-output': 'the speed tool’s output was unreadable',
  'tool-error': 'the speed tool reported an error',
};
const ANSWER_REASON: Readonly<Record<string, string>> = {
  'inventory-revision-mismatch': 'the device list changed and needs a refresh',
  'unknown-device': 'the collector does not list this device',
  'port-not-allowed': 'this port is not allowed on this collector',
  'observations-changed': 'the collector’s results changed during the request',
  'not-observed': 'the collector has no current results',
  'observations-expired': 'the collector’s results expired',
  'invalid-collector-response': 'the collector’s answer was unreadable',
  'collector-unavailable': 'the collector did not answer',
  'outcome-unknown': 'outcome unknown',
};
const reasonText = (table: Readonly<Record<string, string>>, reason: string | null) =>
  reason === null ? null : Object.prototype.hasOwnProperty.call(table, reason) ? table[reason]! : reason.replaceAll('-', ' ');
const withReason = (state: string, reason: string | null) => [state, reasonText({ ...TEST_REASON, ...ANSWER_REASON }, reason)].filter(Boolean).join(', ');

/** The collector's results say its device list differs from the one served: by their reason, or by known, unequal revisions. */
export const listsDiffer = (results: CollectorResults) => results.status !== 'unavailable' && (results.measurementReason === 'inventory-revision-mismatch'
  || results.inventoryRevision !== null && results.servedInventoryRevision !== null && results.inventoryRevision !== results.servedInventoryRevision);
/** After this store's own refresh and its one re-read, the results no longer say the lists differ. */
/** Usable results that affirm agreement: equal known revisions and no changed-list reason. */
const affirmsAgreement = (value: CollectorResults) => value.status === 'available' && value.results !== null
  && value.inventoryRevision !== null && value.inventoryRevision === value.servedInventoryRevision && !listsDiffer(value);
export function refreshedListsAgree(snapshot: CollectorSnapshot, scope: CollectorScope) {
  const key = scopeKey(scope), read = snapshot.reads.get(key);
  // A later answer without a re-read (busy, failed, unreadable) leaves the agreement and the results it read in place.
  return snapshot.agreed.has(key) && read?.status === 'read' && affirmsAgreement(read.value);
}
/** The re-read after this browser's refresh failed, so the results were retired; only the refresh answer remains. */
export function refreshRetired(snapshot: CollectorSnapshot, scope: CollectorScope) {
  const key = scopeKey(scope);
  return snapshot.reads.get(key)?.status === 'failed' && snapshot.refreshes.get(key)?.reread === 'unconfirmed';
}
/** This browser's latest refresh reported quarantine: the results read earlier are withheld. */
export function refreshWithheld(snapshot: CollectorSnapshot, scope: CollectorScope) {
  const response = snapshot.refreshes.get(scopeKey(scope))?.response;
  return response?.status === 'failed' && response.quarantined;
}
/** Whether that refresh reconciled a frame's changed-list reason: the re-read
 * agreed and the frame's facts come from a source read retrieved before the
 * refresh's own successful fetch (both server times). A later frame, or one
 * without a retrieval time, keeps its own reason. */
export function refreshReconciled(snapshot: CollectorSnapshot, scope: CollectorScope, retrievedAt: string | null) {
  if (retrievedAt === null || !refreshedListsAgree(snapshot, scope)) return false;
  const fetched = snapshot.agreed.get(scopeKey(scope)) ?? null;
  return fetched !== null && Date.parse(retrievedAt) < Date.parse(fetched);
}
const REFRESH_REASON: Readonly<Record<string, string>> = {
  'not-approved': 'this account is not approved to refresh this source',
  'access-revoked': 'access to this source is revoked',
  'registration-unavailable': 'the source could not be registered here',
  transport: 'the collector could not be reached',
  timeout: 'the collector did not answer in time',
  auth: 'the collector refused the credential',
};
/** A refresh answer in words, and its time: the server's recorded time where
 * it gives one, otherwise when this browser received the answer. */
export function refreshOutcomeText(outcome: RefreshOutcome): { readonly text: string; readonly at: string; readonly recorded: boolean } {
  const response = outcome.response, answered = (text: string) => ({ text, at: outcome.answeredAt, recorded: false });
  if (response === null) return answered(outcome.lost === 'timeout' ? 'Timed out, outcome unknown' : 'Outcome unknown, no readable answer');
  switch (response.status) {
    case 'refreshed': case 'unchanged': {
      const at = response.cache.lastSuccessfulFetchAt;
      const text = [response.status === 'unchanged' ? 'Refreshed, unchanged' : 'Refreshed', outcome.reread === 'unconfirmed' ? 'state not confirmed' : null].filter(Boolean).join(', ');
      return at ? { text, at, recorded: true } : answered(text);
    }
    case 'needs-review': return answered('Not refreshed, needs review');
    case 'running': return answered('Busy, a refresh is already running');
    case 'not-configured': return answered('Not refreshed, refresh is not set up for this source');
    case 'refused': return answered(`Refused, ${reasonText(REFRESH_REASON, response.reason)}`);
    case 'failed': {
      const text = `Failed, ${reasonText(REFRESH_REASON, response.reason)}; ${response.quarantined ? 'stored Network data is withheld' : 'the previous device list is kept'}`;
      const at = response.cache?.lastAttemptAt ?? null;
      return at ? { text, at, recorded: true } : answered(text);
    }
  }
}

/** Bits per second as Mbit/s, or Gbit/s from 1000 Mbit/s. */
export function rateText(bitsPerSecond: number) {
  const mbit = bitsPerSecond / 1e6;
  if (Math.round(mbit) >= 1000) { const gbit = mbit / 1000; return `${gbit < 10 ? gbit.toFixed(2) : gbit.toFixed(1)} Gbit/s`; }
  return `${mbit > 0 && mbit < 0.1 ? '<0.1' : mbit < 10 ? mbit.toFixed(1) : Math.round(mbit).toLocaleString()} Mbit/s`;
}
/** A speed run in words; null values are left out, never shown as zero. */
export function speedText(result: SpeedResult) {
  const metrics = [result.downloadBitsPerSecond === null ? null : `${rateText(result.downloadBitsPerSecond)} down`,
    result.uploadBitsPerSecond === null ? null : `${rateText(result.uploadBitsPerSecond)} up`,
    result.latencyMs === null ? null : latencyText(result.latencyMs)].filter((text): text is string => text !== null);
  if (result.state === 'measured') return metrics.join(' · ');
  return [withReason(result.state === 'unknown' ? 'Unknown' : 'Failed', result.reason), ...metrics].join(' · ');
}

export const actionLabel = (action: CollectorAction) => action.kind === 'ping' ? 'Ping' : action.kind === 'port' ? `Port ${action.port}` : 'Speed test';
export const runningText = (action: CollectorAction) =>
  action.kind === 'ping' ? 'Running ping…' : action.kind === 'port' ? `Checking port ${action.port}…` : 'Running speed test…';
/** An answer in words, and its time: when the collector recorded a completed
 * test, otherwise when this browser received the answer. Only a completed
 * test carries a result; every other answer is stated as what it is. */
export function outcomeText(outcome: ActionOutcome): { readonly text: string; readonly at: string; readonly recorded: boolean } {
  const label = actionLabel(outcome.action), response = outcome.response;
  const answered = (text: string) => ({ text: `${label}: ${text}`, at: outcome.answeredAt, recorded: false });
  if (response === null) return answered('Outcome unknown, no readable answer');
  switch (response.status) {
    case 'completed': {
      const entry = response.result;
      const text = entry.kind === 'speed' ? speedText(entry.result)
        : entry.kind === 'port' ? withReason(entry.result.state === 'open' ? 'Open' : 'Unknown', entry.result.reason)
        : entry.result.state === 'reachable' ? ['Reachable', entry.result.latencyMs === null ? null : latencyText(entry.result.latencyMs)].filter(Boolean).join(', ')
        : entry.result.state === 'no-reply' ? 'No reply' : withReason('Not measured', entry.result.reason);
      return { text: `${label}: ${text}`, at: entry.recordedAt, recorded: true };
    }
    case 'busy': return answered('Busy, another test is running or just finished');
    case 'refused': return answered(withReason('Refused', response.reason));
    case 'timeout': return answered('Timed out, outcome unknown');
    case 'unknown': return answered(withReason('Outcome unknown', response.reason === 'outcome-unknown' ? null : response.reason));
    case 'unavailable': return answered('Unavailable, no collector for this source');
  }
}

/** The stored runs plus the runs this browser's speed tests returned (their
 * own answers; no further read), in time order, keeping the 30 newest. A test
 * without a run (busy, refused, timed out) adds nothing and removes nothing. */
export function speedWithTests(speed: { readonly latest: SpeedResult | null; readonly recent: readonly SpeedResult[] }, tested: readonly SpeedResult[]) {
  // A tested run the stored history already holds (after a re-read) counts once, as stored.
  const stored = new Set(speed.recent.map(run => run.recordedAt));
  const all = [...speed.recent, ...tested.filter(run => !stored.has(run.recordedAt))].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt)), recent = all.slice(-30);
  // The newest measured run stays the one shown even when later failed runs push it out of the chart's window.
  const measured = all.findLast(run => run.state === 'measured');
  return { latest: measured && !recent.includes(measured) ? measured : speed.latest, recent };
}

/** A run's download only when the run was measured: a failed or unknown run
 * can keep a parsed value, but it is a gap, never a good point. */
const downloadOf = (run: SpeedResult) => run.state === 'measured' ? run.downloadBitsPerSecond : null;
/** A run's state in words, without values: "Failed, the speed tool reported an error". */
export const runStateText = (run: SpeedResult) => run.state === 'measured' ? 'Measured' : withReason(run.state === 'unknown' ? 'Unknown' : 'Failed', run.reason);
/** The newest measured run, and the newest run when it was not measured. */
export function latestSpeed(latest: SpeedResult | null, recent: readonly SpeedResult[]) {
  const runs = [...recent, ...(latest ? [latest] : [])].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const newest = runs.at(-1) ?? null;
  return { measured: runs.findLast(run => run.state === 'measured') ?? null, unmeasured: newest && newest.state !== 'measured' ? newest : null };
}

/** The collector's nightly schedule: a longer wait between runs is a missed night. */
const MISSED_RUN_MS = 36 * 3_600_000;
const PAD = 2, LINE_TOP = 2, LINE_BOTTOM = SPARK_HEIGHT - 2;
/** Download per run, in time order: the line breaks at a run without a value
 * and across a missed night, never drawn as zero; lone runs are dots. */
export function speedSparkline(runs: readonly SpeedResult[]) {
  if (runs.length === 0) return null;
  const sorted = [...runs].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const start = Date.parse(sorted[0]!.recordedAt), end = Date.parse(sorted[sorted.length - 1]!.recordedAt);
  const x = (at: number) => end === start ? SPARK_WIDTH / 2 : PAD + (at - start) / (end - start) * (SPARK_WIDTH - 2 * PAD);
  const hi = Math.max(0, ...sorted.flatMap(run => downloadOf(run) === null ? [] : [downloadOf(run)!]));
  const y = (v: number) => hi === 0 ? LINE_BOTTOM : LINE_BOTTOM - v / hi * (LINE_BOTTOM - LINE_TOP);
  const segments: (readonly [number, number])[][] = [];
  let previous: number | null = null, joined = false;
  for (const run of sorted) {
    const at = Date.parse(run.recordedAt);
    const near = previous !== null && at - previous <= MISSED_RUN_MS;
    previous = at;
    const download = downloadOf(run);
    if (download === null) { joined = false; continue; }
    const point = [x(at), y(download)] as const;
    if (joined && near) segments[segments.length - 1]!.push(point); else segments.push([point]);
    joined = true;
  }
  const measured = sorted.filter(run => downloadOf(run) !== null).length;
  const first = fmtDateTimeReadable(sorted[0]!.recordedAt), last = fmtDateTimeReadable(sorted[sorted.length - 1]!.recordedAt);
  return { ...sparkPaths(segments),
    label: `Download per run, ${start === end ? first : `${first} to ${last}`}: ${measured.toLocaleString()} of ${plural(sorted.length, 'run')} measured` };
}
