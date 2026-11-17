import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CollectorAction, CollectorScope } from '../../../integration/network-collector';
import { InlineTime } from '../components/ui';
import { SPARK_HEIGHT, SPARK_WIDTH } from './network-reachability';
import { collectorResults, outcomeKey, outcomeText, runningText, scopeKey, speedSparkline, speedText, type CollectorStore, type NetworkCollectorPort } from './network-tests';

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
function Answer({ collector, scope, action, own }: { readonly collector: NetworkCollector; readonly scope: CollectorScope; readonly action: CollectorAction; readonly own: (running: CollectorAction) => boolean }) {
  const snapshot = useSyncExternalStore(collector.store.subscribe, collector.store.snapshot, collector.store.snapshot);
  const running = snapshot.running, outcome = snapshot.outcomes.get(outcomeKey(scope, action));
  const answer = outcome ? outcomeText(outcome) : null;
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

/** The host's internet speed from the collector's runs, the Wi-Fi scan state,
 * and the speed test for Editors. A host measurement, not one device's. */
export function InternetSpeed({ collector, scope, label }: { readonly collector: NetworkCollector; readonly scope: CollectorScope; readonly label: string | null }) {
  const snapshot = useCollector(collector, scope);
  const read = collectorResults(snapshot, scope);
  if (!read?.results) return null;
  const { speed, wifi } = read.results, spark = speedSparkline(speed.recent), busy = snapshot.running !== null;
  return <section className="ua-net-speed" aria-label={label ? `Internet speed, ${label}` : 'Internet speed'}>
    <h4>Internet speed{label && <span className="ua-note">{label}</span>}</h4>
    <dl className="ua-facts">
      <div><dt>Latest</dt><dd>{speed.latest ? <>{speedText(speed.latest)}<span className="ua-note">recorded <InlineTime value={speed.latest.recordedAt} /></span></>
        : 'No speed run supplied'}
        {spark && <svg className="ua-net-spark" role="img" aria-label={spark.label} width={SPARK_WIDTH} height={SPARK_HEIGHT} viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}>
          {spark.line && <path className="ua-net-spark-line" d={spark.line} />}
          {spark.dots.map(([x, y]) => <circle key={`${x},${y}`} className="ua-net-spark-dot" cx={x} cy={y} r={1.5} />)}
        </svg>}</dd></div>
      {read.retrievedAt && <div><dt>Retrieved</dt><dd><InlineTime value={read.retrievedAt} /></dd></div>}
    </dl>
    {collector.port.canTest() && <>
      <button type="button" className="btn btn-small" aria-disabled={busy} onClick={() => { if (!busy) collector.store.run(scope, { kind: 'speed' }); }}>Test speed now</button>
      <Answer collector={collector} scope={scope} action={{ kind: 'speed' }} own={action => action.kind === 'speed'} />
    </>}
    {wifi.latest && <p className="ua-net-wifi">Wi-Fi scan unavailable on this collector</p>}
  </section>;
}
