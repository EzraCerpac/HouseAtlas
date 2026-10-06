import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, lstatSync } from 'node:fs';
import { canonicalJson } from '../../packages/contracts/src/index.mjs';
import { buildNetworkFacet } from '../../adapters/network/src/index.mjs';
import { keyOf, sha256, same, fail } from './common.mjs';

// Separate schema; no AT07 migration or approval participant. A fully durable
// staged generation precedes the Atlas generationId publication pointer.
export class NetworkSidecar {
  #db;
  constructor({path}) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) fail();
    this.#db = new DatabaseSync(path);
    try {
      const tables=this.#db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
      if (tables.length && (!tables.some(t=>t.name==='core_network_meta') || this.#db.prepare('SELECT version FROM core_network_meta').get()?.version!==1)) fail();
      this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS core_network_meta(version INTEGER PRIMARY KEY CHECK(version=1)); INSERT OR IGNORE INTO core_network_meta VALUES(1); CREATE TABLE IF NOT EXISTS core_network_generations(partition_key TEXT NOT NULL,generation_id TEXT NOT NULL,sha256 TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(partition_key,generation_id)); CREATE TRIGGER IF NOT EXISTS core_network_no_update BEFORE UPDATE ON core_network_generations BEGIN SELECT RAISE(ABORT,\'immutable generation\'); END; CREATE TRIGGER IF NOT EXISTS core_network_no_delete BEFORE DELETE ON core_network_generations BEGIN SELECT RAISE(ABORT,\'immutable generation\'); END;');
      chmodSync(path,0o600);
    } catch(error) { this.#db.close(); throw error; }
  }
  close() { this.#db.close(); }
  stage(registration,state) {
    if (!state?.generation || state.cache.status!=='fresh' || !state.cache.generationId) fail();
    buildNetworkFacet({registration,state,now:state.cache.lastSuccessfulFetchAt});
    const body=canonicalJson(state), digest=sha256(body), key=keyOf(registration);
    if(Buffer.byteLength(body)>10*1024*1024) fail();
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const prior=this.#db.prepare('SELECT body,sha256 FROM core_network_generations WHERE partition_key=? AND generation_id=?').get(key,state.cache.generationId);
      if (prior && (prior.body!==body || prior.sha256!==digest)) fail('idempotency-conflict');
      if (!prior) {
        const packet=this.export();packet.rows.push({partition_key:key,generation_id:state.cache.generationId,sha256:digest,body});
        if(packet.rows.length>10000||Buffer.byteLength(canonicalJson(packet))>16*1024*1024)fail();
        this.#db.prepare('INSERT INTO core_network_generations VALUES(?,?,?,?)').run(key,state.cache.generationId,digest,body);
      }
      this.#db.exec('COMMIT');
    } catch(error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  read(registration,cache,relations,configuredReview) {
    if (!cache?.generationId) return {cache:cache??null,generation:null};
    const row=this.#db.prepare('SELECT body,sha256 FROM core_network_generations WHERE partition_key=? AND generation_id=?').get(keyOf(registration),cache.generationId);
    if (!row || sha256(row.body)!==row.sha256) fail('invalid-contract');
    const state=JSON.parse(row.body);
    if(configuredReview?.revision===state.generation?.sourceRevision && !same(configuredReview,state.generation.linkReview))fail();
    if (!same(state.cache,{...cache,status:'fresh',lastAttemptAt:state.cache.lastAttemptAt,error:null}) || !same(state.generation.networkRelations,relations)) fail('invalid-contract');
    const result={cache:structuredClone(cache),generation:state.generation};
    buildNetworkFacet({registration,state:result,now:cache.lastSuccessfulFetchAt});
    return result;
  }
  export() {
    return {format:'houseatlas-network-sidecar/1',rows:this.#db.prepare('SELECT partition_key,generation_id,sha256,body FROM core_network_generations ORDER BY partition_key,generation_id').all().map(r=>({...r}))};
  }
  import(packet,registrations) {
    if (packet?.format!=='houseatlas-network-sidecar/1' || !Array.isArray(packet.rows) || packet.rows.length>10000 || this.export().rows.length) fail();
    const seen=new Set();
    // Validate the whole packet before any imported generation is committed.
    const decoded=packet.rows.map(r=> {
      if (Object.keys(r).sort().join(',')!=='body,generation_id,partition_key,sha256' || typeof r.body!=='string' || Buffer.byteLength(r.body)>10*1024*1024 || sha256(r.body)!==r.sha256) fail();
      const registration=registrations.find(s=>keyOf(s)===r.partition_key),state=JSON.parse(r.body),key=canonicalJson([r.partition_key,r.generation_id]);
      if (!registration || registration.owner!=='network' || state.cache?.generationId!==r.generation_id || seen.has(key)) fail();
      seen.add(key); buildNetworkFacet({registration,state,now:state.cache.lastSuccessfulFetchAt});
      return r;
    });
    this.#db.exec('BEGIN IMMEDIATE');
    try { for (const r of decoded) this.#db.prepare('INSERT INTO core_network_generations VALUES(?,?,?,?)').run(r.partition_key,r.generation_id,r.sha256,r.body); this.#db.exec('COMMIT'); }
    catch(error) {this.#db.exec('ROLLBACK');throw error;}
  }
}
