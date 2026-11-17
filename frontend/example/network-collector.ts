/** Invented Network collector answers for the example's reachability source
 * (./synthetic-overlays). No collector, command or request leaves the page.
 * `?role=viewer` shows the house as a viewer: no test controls.
 *
 * Presses answer by target: Ping on the printer times out, any test on the
 * streaming box is refused (its device list changed), Port 22 answers busy,
 * Port 80 completes with an unknown result, Port 443 is open, other pings are
 * reachable and the speed test completes. Every other source has no collector. */
import type { CollectorActionResponse, CollectorResults, SpeedResult } from '../integration/network-collector';
import type { NetworkCollectorPort } from '../src/lantern/unified-atlas/network-tests';

const COLLECTION = 'example-reachability';
const night = (i: number) => new Date(Date.parse('2026-01-02T03:00:00Z') - (29 - i) * 86_400_000).toISOString().replace('.000Z', 'Z');
/** Thirty invented nightly runs: nights 8 and 9 missed, night 17 failed. */
const RUNS: readonly SpeedResult[] = Array.from({ length: 30 }, (_, i) => i).filter(i => i !== 8 && i !== 9).map(i => i === 17
  ? { state: 'failed', recordedAt: night(i), downloadBitsPerSecond: null, uploadBitsPerSecond: null, latencyMs: null, reason: 'command-unavailable' }
  : { state: 'measured', recordedAt: night(i), downloadBitsPerSecond: Math.round((310 + 28 * Math.sin(i / 3)) * 1e6),
    uploadBitsPerSecond: Math.round((41 + 3 * Math.cos(i / 4)) * 1e6), latencyMs: 11 + (i % 4), reason: null });
const RESULTS: CollectorResults = {
  status: 'available', retrievedAt: '2026-01-02T09:01:00Z', inventoryRevision: 3, servedInventoryRevision: 3, measurementReason: null,
  results: { version: 1, speed: { latest: RUNS[RUNS.length - 1]!, recent: RUNS },
    wifi: { latest: { state: 'unavailable', recordedAt: '2026-01-02T08:45:00Z', networks: null, reason: 'no-dependable-unprivileged-scanner' } }, actions: [] },
};
const LATENCY: Readonly<Record<string, number>> = { 'example-root': 1.3, 'example-switch': 2.0, 'example-desk-computer': 11.8 };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function createExampleCollector(params: URLSearchParams): NetworkCollectorPort {
  const viewer = params.get('role') === 'viewer';
  return {
    canTest: () => !viewer,
    async read(scope, signal) {
      await wait(150); signal.throwIfAborted();
      return scope.collectionId === COLLECTION ? RESULTS : { status: 'unavailable' };
    },
    async act(scope, action): Promise<CollectorActionResponse> {
      await wait(action.kind === 'speed' ? 2500 : 1200);
      if (scope.collectionId !== COLLECTION) return { status: 'unavailable' };
      const at = new Date().toISOString(), revision = { inventoryRevision: 3, recordedAt: at, version: 1 as const };
      if (action.kind === 'speed') return { status: 'completed', collectorStatus: 200, result: { kind: 'speed', recordedAt: at, version: 1,
        result: { state: 'measured', recordedAt: at, downloadBitsPerSecond: 1_040_000_000, uploadBitsPerSecond: 48_200_000, latencyMs: 9.6, reason: null } } };
      if (action.deviceId === 'example-streaming-box') return { status: 'refused', collectorStatus: 409, reason: 'inventory-revision-mismatch' };
      if (action.kind === 'port') {
        if (action.port === 22) return { status: 'busy', reason: 'process-limit' };
        return { status: 'completed', collectorStatus: 200, result: { kind: 'port', deviceId: action.deviceId, port: action.port, ...revision,
          result: action.port === 443 ? { state: 'open', reason: null } : { state: 'unknown', reason: 'command-unavailable' } } };
      }
      if (action.deviceId === 'example-printer') return { status: 'timeout', reason: 'outcome-unknown' };
      return { status: 'completed', collectorStatus: 200, result: { kind: 'ping', deviceId: action.deviceId, ...revision,
        result: { state: 'reachable', latencyMs: LATENCY[action.deviceId] ?? 3.1, loss: 0, measuredAt: at, recordedAt: at, reason: null } } };
    },
  };
}
