import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CollectorAction, CollectorScope } from '../../../integration/network-collector';
import { InlineTime } from '../components/ui';
import { SPARK_HEIGHT, SPARK_WIDTH } from './network-reachability';
import { actionLabel, collectorResults, outcomeKey, outcomeText, runningText, scopeKey, speedSparkline, speedText, speedWithTests, latestSpeed, runStateText, type CollectorStore, type NetworkCollectorPort } from './network-tests';

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
  if (!collectorResults(snapshot, target.scope)) return null;
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
 * named by their source, and by the collection where source names repeat. */
export function InternetSpeeds({ collector, rows }: { readonly collector: NetworkCollector; readonly rows: readonly { readonly scope: CollectorScope; readonly label: string }[] }) {
  const snapshot = useSyncExternalStore(collector.store.subscribe, collector.store.snapshot, collector.store.snapshot);
  useEffect(() => { for (const row of rows) collector.store.ensure(row.scope); });
  const shown = rows.filter(row => collectorResults(snapshot, row.scope));
  const distinct = new Set(shown.map(row => row.label)).size === shown.length;
  return shown.map(row => <InternetSpeed key={scopeKey(row.scope)} collector={collector} scope={row.scope}
    label={shown.length < 2 ? null : distinct ? row.label : `${row.label} · ${row.scope.collectionId}`} />);
}

/** The host's internet speed from the collector's runs, the Wi-Fi scan state,
 * and the speed test for Editors. A host measurement, not one device's. */
export function InternetSpeed({ collector, scope, label }: { readonly collector: NetworkCollector; readonly scope: CollectorScope; readonly label: string | null }) {
  const snapshot = useCollector(collector, scope);
  const read = collectorResults(snapshot, scope);
  if (!read?.results) return null;
  const { wifi } = read.results, speed = speedWithTests(read.results.speed, snapshot.speedRuns.get(scopeKey(scope)) ?? []);
  const spark = speedSparkline(speed.recent), busy = snapshot.running !== null, shown = latestSpeed(speed.latest, speed.recent);
  // The answer line repeats nothing when its run is the one shown as Last measured.
  const answer = snapshot.outcomes.get(outcomeKey(scope, { kind: 'speed' }))?.response;
  const shownAbove = answer?.status === 'completed' && answer.result.kind === 'speed' && answer.result.result === shown.measured;
  return <section className="ua-net-speed" aria-label={label ? `Internet speed, ${label}` : 'Internet speed'}>
    <h4>Internet speed{label && <span className="ua-note">{label}</span>}</h4>
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
  </section>;
}
