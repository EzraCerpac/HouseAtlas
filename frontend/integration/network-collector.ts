/** Property-level collector clients. GET reads memory only; POST is an explicit
 * Editor diagnostic. A completed request may still contain an unknown fact. */
import { isExactDecimal } from '../src/numeric/decimal';
import { parseLosslessJson, stringifyLosslessJson, type LosslessJson } from '../src/numeric/lossless-json';
export interface CollectorScope { readonly workspaceId:string; readonly homeId:string; readonly sourceInstanceId:string; readonly collectionId:string }
export type CollectorAction = {readonly kind:'speed'} | {readonly kind:'ping';readonly deviceId:string} | {readonly kind:'port';readonly deviceId:string;readonly port:number};
export interface SpeedResult { readonly state:'measured'|'unknown'|'failed'; readonly recordedAt:string; readonly downloadBitsPerSecond:number|null; readonly uploadBitsPerSecond:number|null; readonly latencyMs:number|null; readonly reason:string|null }
export interface WifiResult { readonly state:'unavailable'; readonly recordedAt:string; readonly networks:null; readonly reason:'no-dependable-unprivileged-scanner' }
export interface PingResult {readonly state:'reachable'|'no-reply'|'not-measured';readonly latencyMs:number|null;readonly loss:number|null;readonly measuredAt:string|null;readonly recordedAt:string|null;readonly reason:string|null}
export type ActionEntry = {readonly recordedAt:string} & (
  {readonly kind:'speed'; readonly result:SpeedResult} |
  {readonly kind:'ping';readonly deviceId:string;readonly inventoryRevision:number; readonly result:PingResult} |
  {readonly kind:'port';readonly deviceId:string;readonly port:number;readonly inventoryRevision:number;readonly result:{readonly state:'open'|'unknown';readonly reason:string|null}});
export type MeasurementReason = 'not-observed'|'inventory-revision-mismatch'|'observations-expired'|null;
export type CollectorResults = {readonly status:'unavailable'} | {
  readonly status:'available'|'unknown'; readonly retrievedAt:string|null;
  readonly inventoryRevision:number|null; readonly servedInventoryRevision:number|null; readonly measurementReason:MeasurementReason;
  readonly results:{readonly version:1;readonly speed:{readonly latest:SpeedResult|null;readonly recent:readonly SpeedResult[]};readonly wifi:{readonly latest:WifiResult|null};readonly actions:readonly ActionEntry[]}|null;
};
export type CollectorActionResponse = {readonly status:'completed';readonly collectorStatus:200;readonly result:ActionEntry & {readonly version:1}} |
  {readonly status:'unavailable'} | {readonly status:'busy'|'refused';readonly reason:string;readonly collectorStatus?:number} |
  {readonly status:'unknown'|'timeout';readonly reason:string};
function need(ok:unknown):asserts ok {if(!ok) throw new TypeError('Collector response unavailable');}
function row(v:LosslessJson|undefined, keys:readonly string[]) {need(v!==null && typeof v==='object' && !Array.isArray(v) && !isExactDecimal(v)); need(Object.keys(v).length===keys.length && keys.every(k=>k in v));return v;}
function text(v:LosslessJson|undefined):string {need(typeof v==='string' && v.length>0 && v.length<=4096);return v;}
function choice<T extends string>(v:LosslessJson|undefined, choices:readonly T[]):T {need(typeof v==='string' && choices.includes(v as T));return v as T;}
function number(v:LosslessJson|undefined,max:number):number {const n=isExactDecimal(v)?Number(v.token):v;need(typeof n==='number' && Number.isFinite(n) && n>=0 && n<=max);return n;}
function nullableNumber(v:LosslessJson|undefined,max:number):number|null {return v===null?null:number(v,max);}
function date(v:LosslessJson|undefined):string {const at=text(v);need(Number.isFinite(Date.parse(at)));return at;}
function reason(v:LosslessJson|undefined):string|null {return v===null?null:text(v);}
function list(v:LosslessJson|undefined,max:number):LosslessJson[] {need(Array.isArray(v) && v.length<=max);return v;}
function revision(v:LosslessJson|undefined):number|null {
  if(v===null) return null;
  const n=isExactDecimal(v)?v.toSafeInteger():v;
  need(typeof n==='number' && Number.isSafeInteger(n) && n>=0);return n;
}
function speed(v:LosslessJson|undefined):SpeedResult {
  const r=row(v,['state','recordedAt','downloadBitsPerSecond','uploadBitsPerSecond','latencyMs','reason']);
  const result={state:choice(r.state,['measured','unknown','failed'] as const),recordedAt:date(r.recordedAt),downloadBitsPerSecond:nullableNumber(r.downloadBitsPerSecond,1e13),uploadBitsPerSecond:nullableNumber(r.uploadBitsPerSecond,1e13),latencyMs:nullableNumber(r.latencyMs,120000),reason:reason(r.reason)};
  need(result.state!=='measured' || result.reason===null && result.downloadBitsPerSecond!==null && result.uploadBitsPerSecond!==null && result.latencyMs!==null);
  need(result.state!=='unknown' || ['missing-fields','malformed-output'].includes(result.reason??''));
  need(result.state!=='failed' || ['command-unavailable','tool-error'].includes(result.reason??''));return Object.freeze(result);
}
function ping(v:LosslessJson|undefined):PingResult {
  const r=row(v,['state','latencyMs','loss','measuredAt','recordedAt','reason']);
  const result={state:choice(r.state,['reachable','no-reply','not-measured'] as const),latencyMs:nullableNumber(r.latencyMs,Number.MAX_VALUE),loss:nullableNumber(r.loss,1),measuredAt:r.measuredAt===null?null:date(r.measuredAt),recordedAt:r.recordedAt===null?null:date(r.recordedAt),reason:reason(r.reason)};
  if(result.state==='reachable') need(result.latencyMs!==null && result.loss===0 && result.measuredAt && result.recordedAt && result.reason===null);
  if(result.state==='no-reply') need(result.latencyMs===null && result.loss===1 && result.measuredAt && result.recordedAt && result.reason===null);
  if(result.state==='not-measured') need(result.latencyMs===null && result.loss===null && result.measuredAt===null && ['no-target','not-at-home','command-unavailable','shutdown','speed-test-in-progress','no-history'].includes(result.reason??'') && (result.recordedAt!==null || result.reason==='no-history'));
  return Object.freeze(result);
}
function entry(v:LosslessJson|undefined,versioned=false):ActionEntry {
  need(v!==null && typeof v==='object' && !Array.isArray(v) && !isExactDecimal(v));
  const kind=choice(v.kind,['speed','ping','port'] as const);
  const r=row(v,['kind','recordedAt','result',...(kind!=='speed'?['deviceId','inventoryRevision']:[]),...(kind==='port'?['port']:[]),...(versioned?['version']:[])]);
  if(versioned) need(number(r.version,1)===1);
  const recordedAt=date(r.recordedAt);
  if(kind==='speed') return Object.freeze({kind,recordedAt,result:speed(r.result)});
  const deviceId=text(r.deviceId),inventoryRevision=revision(r.inventoryRevision);need(inventoryRevision!==null);
  if(kind==='ping') return Object.freeze({kind,deviceId,inventoryRevision,recordedAt,result:ping(r.result)});
  const port=number(r.port,65535);need(Number.isInteger(port)&&port>0);
  const p=row(r.result,['state','reason']),state=choice(p.state,['open','unknown'] as const),why=reason(p.reason);
  need(state==='open'?why===null:['no-target','not-at-home','command-unavailable'].includes(why??''));
  return Object.freeze({kind,deviceId,port,inventoryRevision,recordedAt,result:Object.freeze({state,reason:why})});
}
export function decodeNetworkCollectorResults(v:LosslessJson):CollectorResults {
  need(stringifyLosslessJson(v).length<=10*1024*1024);
  need(v!==null && typeof v==='object' && !Array.isArray(v) && !isExactDecimal(v));
  if(v.status==='unavailable') {row(v,['status']);return Object.freeze({status:'unavailable'});}
  const r=row(v,['status','retrievedAt','results','inventoryRevision','servedInventoryRevision','measurementReason']);
  const status=choice(r.status,['available','unknown'] as const),retrievedAt=r.retrievedAt===null?null:date(r.retrievedAt);
  const inventoryRevision=revision(r.inventoryRevision),servedInventoryRevision=revision(r.servedInventoryRevision),measurementReason=r.measurementReason===null?null:choice(r.measurementReason,['not-observed','inventory-revision-mismatch','observations-expired'] as const);
  if(status==='unknown') {need(r.results===null && retrievedAt===null);return Object.freeze({status,retrievedAt,results:null,inventoryRevision,servedInventoryRevision,measurementReason});}
  need(retrievedAt!==null);
  const b=row(r.results,['version','speed','wifi','actions']);need(number(b.version,1)===1);
  const s=row(b.speed,['latest','recent']),w=row(b.wifi,['latest']);
  let wifi:WifiResult|null=null;
  if(w.latest!==null) {const q=row(w.latest,['state','recordedAt','networks','reason']);need(q.state==='unavailable'&&q.networks===null&&q.reason==='no-dependable-unprivileged-scanner');wifi=Object.freeze({state:'unavailable',recordedAt:date(q.recordedAt),networks:null,reason:'no-dependable-unprivileged-scanner'});}
  const recent=Object.freeze(list(s.recent,30).map(speed)),actions=Object.freeze(list(b.actions,30).map(v=>entry(v)));
  return Object.freeze({status,retrievedAt,inventoryRevision,servedInventoryRevision,measurementReason,results:Object.freeze({version:1,speed:Object.freeze({latest:s.latest===null?null:speed(s.latest),recent}),wifi:Object.freeze({latest:wifi}),actions})});
}
export function decodeNetworkCollectorAction(v:LosslessJson):CollectorActionResponse {
  need(v!==null && typeof v==='object' && !Array.isArray(v) && !isExactDecimal(v));
  const status=choice(v.status,['completed','busy','refused','unavailable','unknown','timeout'] as const);
  if(status==='unavailable'){row(v,['status']);return Object.freeze({status});}
  if(status==='completed'){const r=row(v,['status','collectorStatus','result']);need(number(r.collectorStatus,200)===200);return Object.freeze({status,collectorStatus:200,result:Object.freeze({...entry(r.result,true),version:1})});}
  const hasCollector='collectorStatus' in v;
  const r=row(v,['status','reason',...(hasCollector?['collectorStatus']:[])]),why=text(r.reason);
  if(status==='timeout'||status==='unknown') {need(!hasCollector);return Object.freeze({status,reason:why});}
  let collectorStatus:number|undefined;
  if(hasCollector){collectorStatus=number(r.collectorStatus,599);need(Number.isInteger(collectorStatus) && (status==='busy'?collectorStatus===409:[400,403,409,413,415,503].includes(collectorStatus)));}
  return Object.freeze({status,reason:why,...(collectorStatus===undefined?{}:{collectorStatus})});
}
function route(s:CollectorScope,kind:'results'|'actions') {return `/api/atlas/providers/network/workspaces/${encodeURIComponent(s.workspaceId)}/homes/${encodeURIComponent(s.homeId)}/sources/${encodeURIComponent(s.sourceInstanceId)}/${kind}?collection=${encodeURIComponent(s.collectionId)}`;}
const options={credentials:'same-origin',cache:'no-store',redirect:'error'} as const;
/** HTTP auth/scope failures throw; callers must retire results on failed reads. */
export async function readNetworkCollectorResults(scope:CollectorScope,transport:typeof fetch=fetch,signal?:AbortSignal):Promise<CollectorResults> {
  const response=await transport(route(scope,'results'),{...options,headers:{Accept:'application/json'},signal:signal??AbortSignal.timeout(30_000)});
  if(!response.ok) throw new Error('Collector results refused');
  return decodeNetworkCollectorResults(parseLosslessJson(await response.text()));
}
/** Supply the current session's CSRF token. Never retry automatically: a lost
 * response/timeout can follow a completed diagnostic. */
export async function requestNetworkCollectorAction(scope:CollectorScope,action:CollectorAction,csrf:string,transport:typeof fetch=fetch,signal?:AbortSignal):Promise<CollectorActionResponse> {
  const response=await transport(route(scope,'actions'),{...options,method:'POST',headers:{Accept:'application/json','Content-Type':'application/json','X-Atlas-CSRF':csrf},body:JSON.stringify(action),signal:signal??AbortSignal.timeout(135_000)});
  if(!response.ok) throw new Error('Collector action refused or outcome unknown');
  return decodeNetworkCollectorAction(parseLosslessJson(await response.text()));
}
