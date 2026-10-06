import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, mkdtempSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { captureRecovery, verifyRecovery, restoreRecovery } from '../../packages/media/src/index.mjs';
import { readPrivate, writePrivate, privateDirectory, syncDirectory } from '../../packages/media/src/vault.mjs';
import { buildNetworkFacet } from '../../adapters/network/src/index.mjs';
import { canonicalJson } from '../../packages/contracts/src/index.mjs';
import { NetworkSidecar } from './network-sidecar.mjs';
import { CORE_VERSION, sha256, keyOf, same, exact, fail } from './common.mjs';

const MAX_PACKET=16*1024*1024;
function absent(path) {try{lstatSync(path);fail('idempotency-conflict');}catch(e){if(e.code!=='ENOENT')throw e;}}
function readNetworkPointers(databasePath,packet) {
  exact(packet,['format','rows']);if(packet.format!=='houseatlas-network-sidecar/1'||!Array.isArray(packet.rows)||packet.rows.length>10000)fail();
  const db=new DatabaseSync(databasePath,{readOnly:true});
  try {
    const sources=db.prepare('SELECT body FROM sources').all().map(r=>JSON.parse(r.body)),caches=db.prepare('SELECT body FROM caches').all().map(r=>JSON.parse(r.body)),relations=db.prepare('SELECT body FROM network_relations').all().map(r=>JSON.parse(r.body));
    const seen=new Set();
    for(const row of packet.rows) {
      exact(row,['partition_key','generation_id','sha256','body']);
      if(typeof row.body!=='string'||sha256(row.body)!==row.sha256)fail();
      const registration=sources.find(s=>s.owner==='network'&&keyOf(s)===row.partition_key),state=JSON.parse(row.body),id=canonicalJson([row.partition_key,row.generation_id]);
      if(!registration||state.cache?.generationId!==row.generation_id||state.cache.status!=='fresh'||!state.generation||seen.has(id))fail();
      seen.add(id);buildNetworkFacet({registration,state,now:state.cache.lastSuccessfulFetchAt});
    }
    for(const s of sources.filter(s=>s.owner==='network')) {
      const cache=caches.find(c=>keyOf(c)===keyOf(s));if(!cache?.generationId)continue;
      const row=packet.rows.find(r=>r.partition_key===keyOf(s)&&r.generation_id===cache.generationId);if(!row)fail();
      const state=JSON.parse(row.body);
      if(!same(state.generation.networkRelations,relations.filter(r=>keyOf(r)===keyOf(s))) || state.cache.lastSuccessfulFetchAt!==cache.lastSuccessfulFetchAt)fail();
    }
    return sources;
  } finally {db.close();}
}
// Caller owns a drained core. No source/network/access configuration is copied.
export async function captureCoreRecovery({databasePath,vault,sidecar,destination}) {
  destination=resolve(destination);absent(destination);
  const parent=privateDirectory(dirname(destination)),staged=mkdtempSync(join(parent,'.core-capture-'));let published=false;
  try {
    await captureRecovery({databasePath,vault,destination:join(staged,'owned')});
    const packet=sidecar.export(),bytes=Buffer.from(canonicalJson(packet));if(bytes.length>MAX_PACKET)fail();
    readNetworkPointers(join(staged,'owned','atlas.sqlite'),packet);
    writePrivate(join(staged,'network.json'),bytes);
    const owned=readPrivate(join(staged,'owned','manifest.json'),MAX_PACKET);
    const manifest={format:'houseatlas-core-recovery/1',coreVersion:CORE_VERSION,ownedManifestSha256:sha256(owned),networkSha256:sha256(bytes),captureMethod:'drained-core-with-owned-sqlite-backup-and-durable-network-generations',exclusions:['access database and sessions','credentials','server configuration','HomeBox originals','Network source state']};
    writePrivate(join(staged,'manifest.json'),Buffer.from(canonicalJson(manifest)));syncDirectory(staged);
    verifyCoreRecovery({bundle:staged});absent(destination);renameSync(staged,destination);published=true;syncDirectory(parent);return manifest;
  } finally {if(!published)rmSync(staged,{recursive:true,force:true});}
}
export function verifyCoreRecovery({bundle}) {
  if(lstatSync(bundle).isSymbolicLink()||!lstatSync(bundle).isDirectory()||!same(readdirSync(bundle).sort(),['manifest.json','network.json','owned']))fail();
  const manifest=JSON.parse(readPrivate(join(bundle,'manifest.json'),MAX_PACKET));
  exact(manifest,['format','coreVersion','ownedManifestSha256','networkSha256','captureMethod','exclusions']);
  if(manifest.format!=='houseatlas-core-recovery/1'||manifest.coreVersion!==CORE_VERSION||manifest.captureMethod!=='drained-core-with-owned-sqlite-backup-and-durable-network-generations'||!same(manifest.exclusions,['access database and sessions','credentials','server configuration','HomeBox originals','Network source state']))fail();
  verifyRecovery({bundle:join(bundle,'owned')});
  if(sha256(readPrivate(join(bundle,'owned','manifest.json'),MAX_PACKET))!==manifest.ownedManifestSha256)fail();
  const bytes=readPrivate(join(bundle,'network.json'),MAX_PACKET);if(sha256(bytes)!==manifest.networkSha256)fail();
  const packet=JSON.parse(bytes),registrations=readNetworkPointers(join(bundle,'owned','atlas.sqlite'),packet);
  return {manifest,packet,registrations};
}
export function restoreCoreRecovery({bundle,destination}) {
  const verified=verifyCoreRecovery({bundle});destination=resolve(destination);absent(destination);
  const parent=privateDirectory(dirname(destination)),staged=mkdtempSync(join(parent,'.core-restore-'));let published=false,sidecar;
  try {
    restoreRecovery({bundle:join(bundle,'owned'),destination:join(staged,'owned')});
    sidecar=new NetworkSidecar({path:join(staged,'network.sqlite')});sidecar.import(verified.packet,verified.registrations);sidecar.close();sidecar=null;
    syncDirectory(staged);absent(destination);renameSync(staged,destination);published=true;syncDirectory(parent);
    return {databasePath:join(destination,'owned','atlas.sqlite'),vaultRoot:join(destination,'owned','media'),sidecarPath:join(destination,'network.sqlite'),manifest:verified.manifest};
  } finally {sidecar?.close();if(!published)rmSync(staged,{recursive:true,force:true});}
}
