/** Server-joined read-point facts. No source reads or documentary identity inference. */
import { isExactDecimal } from '../src/numeric/decimal';
import { stringifyLosslessJson, type LosslessJson } from '../src/numeric/lossless-json';
import type { NetworkLiveFacts, NetworkOverlayData, NetworkObservationValue } from '../src/lantern/overlays/network/types';
type Row = Record<string, LosslessJson>;
function need(ok: unknown): asserts ok { if (!ok) throw new TypeError('Network live facts are unavailable'); }
function row(value: LosslessJson | undefined, keys: readonly string[]): Row {
  need(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value));
  need(Object.keys(value).length === keys.length && keys.every(k => k in value)); return value;
}
function text(value: LosslessJson | undefined, max = 4096): string { need(typeof value === 'string' && value.length > 0 && [...value].length <= max); return value; }
function date(value: LosslessJson | undefined): string | null { if (value === null) return null; const v = text(value, 128); need(Number.isFinite(Date.parse(v))); return v; }
function choice<T extends string>(value: LosslessJson | undefined, options: readonly T[]): T { need(typeof value === 'string' && options.includes(value as T)); return value as T; }
function list(value: LosslessJson | undefined, max: number): LosslessJson[] { need(Array.isArray(value) && value.length <= max); return value; }
function freshness(value: LosslessJson | undefined) { return choice(value, ['unknown','recent','stale','invalidated'] as const); }
/** Passive Network ingestion defines observation numbers as finite IEEE-754
 * binary64 (provider README); normalize only this already-normalized source
 * value so the existing graph/cache JSON writers can carry it unchanged. */
function observationValue(value: LosslessJson): NetworkObservationValue {
  if (isExactDecimal(value)) { const number = Number(value.token); need(Number.isFinite(number)); return number; }
  if (Array.isArray(value)) return Object.freeze(value.map(observationValue));
  if (value !== null && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([k,v])=>[k,observationValue(v)])));
  return value;
}
function metric(value: LosslessJson | undefined, loss = false): number | null {
  if (value === null) return null;
  const n = isExactDecimal(value) ? Number(value.token) : value;
  need(typeof n === 'number' && Number.isFinite(n) && n >= 0 && (!loss || n <= 1)); return n;
}
function facts(value: LosslessJson): NetworkLiveFacts {
  const extended = value !== null && typeof value === 'object' && 'recentSeries' in value;
  const reason = value !== null && typeof value === 'object' && 'measurementReason' in value;
  const r = row(value, ['status','source','addresses','observedState','lastSeenAt','sourceSnapshotAt','retrievedAt','freshness', ...(extended ? ['latencyMs','loss','recentSeries'] : []), ...(reason ? ['measurementReason'] : [])]);
  need(new TextEncoder().encode(stringifyLosslessJson(value)).length <= 64 * 1024);
  const s = row(r.source, ['workspaceId','homeId','sourceInstanceId','collectionId','sourceKind','externalId']);
  for (const key of ['workspaceId','homeId','sourceInstanceId']) need(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text(s[key])));
  need(s.sourceKind === 'network-device');
  const source = Object.freeze({workspaceId:text(s.workspaceId),homeId:text(s.homeId),sourceInstanceId:text(s.sourceInstanceId),collectionId:text(s.collectionId),sourceKind:'network-device' as const,externalId:text(s.externalId)});
  const addresses = r.addresses === null ? null : Object.freeze(list(r.addresses,32).map(a=>{ need(typeof a === 'string' && a.length <= 200); return a; }));
  need(addresses === null || new Set(addresses).size === addresses.length);
  const observedState = r.observedState === null ? null : Object.freeze(list(r.observedState,64).map(item=>{
    const o = row(item,['id','kind','value','factAt','sourceSnapshotAt','retrievedAt','vantage','invalidatedAt','freshness']);
    need(o.value !== null && typeof o.value === 'object' && !Array.isArray(o.value) && !isExactDecimal(o.value));
    const factAt = date(o.factAt), retrievedAt = date(o.retrievedAt); need(factAt && retrievedAt);
    return Object.freeze({id:text(o.id),kind:text(o.kind),value:observationValue(o.value),factAt,sourceSnapshotAt:date(o.sourceSnapshotAt),retrievedAt,vantage:text(o.vantage),invalidatedAt:date(o.invalidatedAt),freshness:choice(o.freshness,['recent','stale','invalidated'] as const)});
  }));
  const status = choice(r.status,['available','absent','unknown','stale'] as const), fresh = freshness(r.freshness);
  const lastSeenAt = date(r.lastSeenAt), sourceSnapshotAt = date(r.sourceSnapshotAt), retrievedAt = date(r.retrievedAt);
  need(status !== 'absent' || addresses === null && observedState === null && lastSeenAt === null && fresh === 'unknown');
  need(status === 'absent' || addresses !== null && retrievedAt !== null);
  need(status !== 'available' || fresh === 'recent' && observedState !== null && observedState.length > 0);
  need(status !== 'unknown' || fresh === 'unknown' && observedState === null);
  need(status !== 'stale' || fresh === 'stale' || fresh === 'invalidated' || fresh === 'unknown');
  const measurements = extended ? {latencyMs:metric(r.latencyMs),loss:metric(r.loss,true),recentSeries:Object.freeze(list(r.recentSeries,48).map(item=>{
    const point = row(item,['hour','latencyMs','loss']); const hour = date(point.hour); need(hour && Date.parse(hour) % 3600000 === 0);
    return Object.freeze({hour,latencyMs:metric(point.latencyMs),loss:metric(point.loss,true)});
  }))} : {};
  if (extended) { const series = measurements.recentSeries!; need(series.every((p,i)=>i === 0 || Date.parse(p.hour) > Date.parse(series[i-1]!.hour))); }
  return Object.freeze({status,source,addresses,observedState,lastSeenAt,sourceSnapshotAt,retrievedAt,freshness:fresh,...measurements,...(reason ? {measurementReason:r.measurementReason === null ? null : choice(r.measurementReason,['not-observed','inventory-revision-mismatch','observations-expired'] as const)} : {})});
}
export interface NetworkLiveFactsFrame {
  readonly schema: 'houseatlas.network-overlay-live-facts.v2';
  readonly sceneOriginalSha256: string;
  readonly devices: readonly Readonly<{id:string;liveFacts:NetworkLiveFacts}>[];
}
export function decodeNetworkLiveFacts(value: LosslessJson, sha: string, workspaceId: string, homeId: string): NetworkLiveFactsFrame {
  need(new TextEncoder().encode(stringifyLosslessJson(value)).length <= 512 * 1024);
  const r = row(value,['schema','sceneOriginalSha256','devices']);
  need(r.schema === 'houseatlas.network-overlay-live-facts.v2' && r.sceneOriginalSha256 === sha && /^[a-f0-9]{64}$/.test(sha));
  const ids = new Set<string>(); let count = 0;
  const devices = Object.freeze(list(r.devices,512).map(item=>{
    const d = row(item,['id','liveFacts']); const id = text(d.id,256); need(!ids.has(id)); ids.add(id);
    const liveFacts = facts(d.liveFacts!); need(liveFacts.source.workspaceId === workspaceId && liveFacts.source.homeId === homeId);
    count += liveFacts.addresses?.length ?? 0; need(count <= 16384);
    return Object.freeze({id,liveFacts});
  }));
  return Object.freeze({schema:'houseatlas.network-overlay-live-facts.v2',sceneOriginalSha256:sha,devices});
}
export function applyNetworkLiveFacts(data: NetworkOverlayData, frame: NetworkLiveFactsFrame | undefined): NetworkOverlayData {
  if (!frame) return data;
  need(data.devices.length <= 512);
  const ids = new Set(data.devices.map(d=>d.id)); need(ids.size === data.devices.length && frame.devices.every(d=>ids.has(d.id)));
  const joined = new Map(frame.devices.map(d=>[d.id,d.liveFacts]));
  return Object.freeze({...data,schema:'houseatlas.network-overlay.v2',devices:Object.freeze(data.devices.map(d=>{
    const liveFacts = joined.get(d.id); return liveFacts ? Object.freeze({...d,liveFacts}) : d;
  }))});
}
