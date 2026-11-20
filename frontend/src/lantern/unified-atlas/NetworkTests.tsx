import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { CollectorAction, CollectorScope } from '../../../integration/network-collector';
import { InlineTime } from '../components/ui';
import { SPARK_HEIGHT, SPARK_WIDTH } from './network-reachability';
import { actionLabel, collectorResults, listsDiffer, refreshedListsAgree, refreshReconciled, refreshRetired, refreshWithheld, outcomeKey, outcomeText, refreshOutcomeText, runningText, scopeKey, speedSparkline, speedText, speedWithTests, latestSpeed, runStateText, type CollectorSnapshot, type CollectorStore, type NetworkCollectorPort } from './network-tests';

/** The collector the Network layer shows now: its port and its store. */
export interface NetworkCollector { readonly port: NetworkCollectorPort; readonly store: CollectorStore }
/** The collector's own address for a device: its Network source scope and the source's device ID. */
export interface CollectorTarget { readonly scope: CollectorScope; readonly deviceId: string }
/** Ports a check is offered for: the collector's default allowlist. The
 * collector's configured list is not supplied; another list answers Refused. */
export const CHECK_PORTS = [22, 80, 443] as const;

function useCollector(collector: NetworkCollector, scope: CollectorScope) {
  const snapshot = useSyncExternalStore(collector.store.subscribe, collector.store.snapshot, collector.store.snapshot);
  // One read per scope while the layer shows, sent when this card or key section opens; later renders reuse it.
  useEffect(() => { collector.store.ensure(scope); });
  return snapshot;
}

/** The answer line: running, or the latest answer with its time. One live region, kept mounted. */
function Answer({ collector, scope, action, own, brief = false }: { readonly collector: NetworkCollector; readonly scope: CollectorScope; readonly action: CollectorAction; readonly own: (running: CollectorAction) => boolean;
  /** The completed run's values show elsewhere (as Latest): say only that it completed. */
  readonly brief?: boolean }) {
  const snapshot = useSyncExternalStore(collector.store.subscribe, collector.store.snapshot, collector.store.snapshot);
  const running = snapshot.running, outcome = snapshot.outcomes.get(outcomeKey(scope, action));
  const full = outcome ? outcomeText(outcome) : null;
  const answer = full && brief && full.recorded ? { ...full, text: `${actionLabel(action)}: Completed` } : full;
  return <p className="ua-net-test-answer" role="status">
    {running ? running.scope === scopeKey(scope) && own(running.action) ? runningText(running.action) : 'Another test is running'
      : answer && <>{answer.text}<span className="ua-note">{answer.recorded ? 'recorded' : 'answered'} <InlineTime value={answer.at} /></span></>}
  </p>;
}

/** Ping and port check for one device, mounted for Editors only; nothing
 * without the collector's results for its source. */
export function DeviceTestRow({ collector, target }: { readonly collector: NetworkCollector; readonly target: CollectorTarget }) {
  const snapshot = useCollector(collector, target.scope);
  const [port, setPort] = useState<number>(443);
  if (!collectorResults(snapshot, target.scope) || refreshWithheld(snapshot, target.scope)) return null;
  const busy = snapshot.running !== null;
  const press = (action: CollectorAction) => { if (!busy) collector.store.run(target.scope, action); };
  return <div className="ua-net-test"><dt>Test</dt><dd>
    <div className="ua-net-test-actions">
      <button type="button" className="btn btn-small" aria-disabled={busy} onClick={() => press({ kind: 'ping', deviceId: target.deviceId })}>Ping</button>
      <span className="ua-net-test-port">
        <select aria-label="Port" value={port} onChange={event => setPort(Number(event.target.value))}>
          {CHECK_PORTS.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <button type="button" className="btn btn-small" aria-disabled={busy} onClick={() => press({ kind: 'port', deviceId: target.deviceId, port })}>Check port</button>
      </span>
    </div>
    <Answer collector={collector} scope={target.scope} action={{ kind: 'ping', deviceId: target.deviceId }}
      own={action => action.kind !== 'speed' && action.deviceId === target.deviceId} />
  </dd></div>;
}

/** One speed block per Network source whose collector answered. Several are
 * named by their source, by the collection where source names repeat, and by a
 * number where both repeat. */
export function InternetSpeeds({ collector, rows }: { readonly collector: NetworkCollector;
  readonly rows: readonly { readonly scope: CollectorScope; readonly label: string; readonly mismatches?: readonly (string | null)[] }[] }) {
  const snapshot = useSyncExternalStore(collector.store.subscribe, collector.store.snapshot, collector.store.snapshot);
  useEffect(() => { for (const row of rows) collector.store.ensure(row.scope); });
  // A source whose post-refresh re-read retired its results still shows that refresh's answer.
  const shown = rows.filter(row => collectorResults(snapshot, row.scope) || refreshRetired(snapshot, row.scope));
  const distinct = new Set(shown.map(row => row.label)).size === shown.length;
  // Sources that share a name and a collection are numbered in the order of their source identity, never by the identity itself.
  const full = (row: (typeof shown)[number]) => distinct ? row.label : `${row.label} · ${row.scope.collectionId}`;
  const twins = (row: (typeof shown)[number]) => shown.filter(other => full(other) === full(row)).map(other => other.scope.sourceInstanceId).sort();
  return shown.map(row => <InternetSpeed key={scopeKey(row.scope)} collector={collector} scope={row.scope} mismatches={row.mismatches ?? []}
    label={shown.length < 2 ? null : twins(row).length < 2 ? full(row) : `${full(row)} · ${twins(row).indexOf(row.scope.sourceInstanceId) + 1}`} />);
}

/** The host's internet speed from the collector's runs, the Wi-Fi scan state,
 * and the speed test for Editors. A host measurement, not one device's. */
export function InternetSpeed({ collector, scope, label, mismatches = [] }: { readonly collector: NetworkCollector; readonly scope: CollectorScope; readonly label: string | null;
  /** Retrieval times of current-frame facts that report a changed device list. */
  readonly mismatches?: readonly (string | null)[] }) {
  const snapshot = useCollector(collector, scope), head = useRef<HTMLHeadingElement>(null);
  const read = collectorResults(snapshot, scope);
  // The heading takes focus only when a focused refresh control leaves with its whole row.
  const heading = <h4 tabIndex={-1} ref={head}>Internet speed{label && <span className="ua-note">{label}</span>}</h4>, name = label ? `Internet speed, ${label}` : 'Internet speed';
  // A refresh reported quarantine, or its re-read failed and retired the results: only its answer shows.
  if (refreshWithheld(snapshot, scope) || refreshRetired(snapshot, scope)) return <section className="ua-net-speed" aria-label={name}>{heading}
    <DeviceListRefresh key="device-list" collector={collector} scope={scope} snapshot={snapshot} mismatches={mismatches} fallback={head} /></section>;
  if (!read?.results) return null;
  const { wifi } = read.results, speed = speedWithTests(read.results.speed, snapshot.speedRuns.get(scopeKey(scope)) ?? []);
  const spark = speedSparkline(speed.recent), busy = snapshot.running !== null, shown = latestSpeed(speed.latest, speed.recent);
  // The answer line repeats nothing when its run (by recorded time, as in the history) is the one shown as Last measured.
  const answer = snapshot.outcomes.get(outcomeKey(scope, { kind: 'speed' }))?.response;
  const shownAbove = answer?.status === 'completed' && answer.result.kind === 'speed' && answer.result.result.recordedAt === shown.measured?.recordedAt;
  return <section className="ua-net-speed" aria-label={name}>
    {heading}
    <dl className="ua-facts">
      <div><dt>Last measured</dt><dd>{shown.measured ? <>{speedText(shown.measured)}<span className="ua-note">recorded <InlineTime value={shown.measured.recordedAt} /></span></>
        : shown.unmeasured ? 'No measured run supplied' : 'No speed run supplied'}
        {shown.unmeasured && <span className="ua-note">Newest run: {runStateText(shown.unmeasured)} · recorded <InlineTime value={shown.unmeasured.recordedAt} /></span>}
        {spark && <svg className="ua-net-spark" role="img" aria-label={spark.label} width={SPARK_WIDTH} height={SPARK_HEIGHT} viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}>
          {spark.line && <path className="ua-net-spark-line" d={spark.line} />}
          {spark.dots.map(([x, y]) => <circle key={`${x},${y}`} className="ua-net-spark-dot" cx={x} cy={y} r={1.5} />)}
        </svg>}</dd></div>
      {read.retrievedAt && <div><dt>Retrieved</dt><dd><InlineTime value={read.retrievedAt} /></dd></div>}
    </dl>
    {collector.port.canTest() && <>
      <button type="button" className="btn btn-small" aria-disabled={busy} onClick={() => { if (!busy) collector.store.run(scope, { kind: 'speed' }); }}>Test speed now</button>
      <Answer collector={collector} scope={scope} action={{ kind: 'speed' }} own={action => action.kind === 'speed'} brief={shownAbove} />
    </>}
    {wifi.latest && <p className="ua-net-wifi">Wi-Fi scan unavailable on this collector</p>}
    {/* The same key in both branches keeps this disclosure (and its focus state) when the other rows are withheld. */}
    <DeviceListRefresh key="device-list" collector={collector} scope={scope} snapshot={snapshot} mismatches={mismatches} fallback={head} />
  </section>;
}

/** The device-list refresh, closed under the source's speed block: only for
 * a caller the results name as a refresh Editor (`mayRefresh`), and only while
 * the collector's device list differs from the one served, or to keep this
 * browser's latest answer in view. A changed list that needs review first
 * offers no control. One POST per press; a refreshed answer re-reads the
 * results once, and the control goes when they say the lists agree. Opening
 * it reads and sends nothing; while a press is pending or answered it stays
 * open, so the answer is not hidden. */
function DeviceListRefresh({ collector, scope, snapshot, mismatches, fallback }: { readonly collector: NetworkCollector; readonly scope: CollectorScope; readonly snapshot: CollectorSnapshot;
  readonly mismatches: readonly (string | null)[]; readonly fallback: RefObject<HTMLHeadingElement | null> }) {
  const read = collectorResults(snapshot, scope), key = scopeKey(scope), outcome = snapshot.refreshes.get(key);
  // After an agreeing refresh, a later frame that reports a changed list again brings the control back.
  const again = refreshedListsAgree(snapshot, scope) && mismatches.some(at => !refreshReconciled(snapshot, scope, at));
  // After a quarantine the earlier results are withheld: no state or control from them.
  const pending = snapshot.refreshing === key, differ = read !== null && !refreshWithheld(snapshot, scope) && (listsDiffer(read) || again);
  const review = differ && (read.needsReview || outcome?.response?.status === 'needs-review');
  // A retired read leaves only the answer to the press it followed.
  const shown = !!collector.port.refresh && !!(read?.mayRefresh || refreshRetired(snapshot, scope)) && (differ || !!outcome || pending);
  const offered = shown && differ && !review;
  const status = useRef<HTMLParagraphElement>(null), wasOffered = useRef(offered), focused = useRef(false);
  // Closed by default, open while a press is pending or answered: each new answer (or its re-read) opens it again,
  // even if it was closed while pending. Once an answer shows, the reader may close it.
  const [open, setOpen] = useState(pending || !!outcome), [answered, setAnswered] = useState(outcome);
  if (outcome !== answered) { setAnswered(outcome); if (outcome) setOpen(true); }
  // The control leaves when the lists agree or need review; only focus the disclosure held (its summary or button) moves to the answer,
  // or to the block's heading when permission is withdrawn and the whole row leaves.
  useEffect(() => {
    if (wasOffered.current && !offered && focused.current && (document.activeElement === document.body || document.activeElement === null)) (status.current ?? fallback.current)?.focus();
    if (!offered) focused.current = false;
    wasOffered.current = offered;
  }, [offered]);
  if (!shown) return null;
  const answer = outcome && refreshOutcomeText(outcome);
  return <details className="ua-source ua-net-refresh" open={open} onToggle={event => setOpen(event.currentTarget.open)}
    onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }}><summary>Device list</summary><div>
    {differ && <span>{review ? 'Changed; it needs review before it can be refreshed' : 'Changed, needs a refresh'}</span>}
    {offered && <button type="button" className="btn btn-small" aria-disabled={snapshot.refreshing !== null}
      onClick={() => { if (snapshot.refreshing === null) collector.store.refresh(scope); }}>{pending ? 'Refreshing device list…' : 'Refresh device list'}</button>}
    <p className="ua-net-test-answer" role="status" tabIndex={-1} ref={status}>
      {answer && <>{answer.text}<span className="ua-note">{answer.recorded ? 'recorded' : 'answered'} <InlineTime value={answer.at} /></span></>}
    </p>
  </div></details>;
}
