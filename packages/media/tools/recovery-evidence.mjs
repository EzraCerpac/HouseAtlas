import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AtlasStore } from '../../storage/src/index.mjs';
import { setup, media, scope, U, mutation, pngBytes } from '../test/support.mjs';
const [outputManifest,outputReport]=process.argv.slice(2);
if(!outputManifest||!outputReport)throw new Error('Explicit task-owned evidence outputs required');
const e=await setup();let restoredStore;
try {
  const p=await e.principal('mutate'),target={recordType:'asset',recordId:U(600)},command=mutation('tombstone',8900);
  const committed=e.boundary.withMutationAuthorization(p,()=>e.store.execute(p,scope,target,command));
  const bundle=join(e.dir,'capture');const manifest=await media.captureRecovery({databasePath:e.databasePath,vault:e.vault,destination:bundle});
  media.verifyRecovery({bundle});
  const restored=media.restoreRecovery({bundle,destination:join(e.dir,'restored')}),vault=new media.AssetVault({root:restored.vaultRoot});
  restoredStore=new AtlasStore({path:restored.databasePath,authorize:(principal,r)=>{e.boundary.revalidate(principal);if(r.capability==='mutate')e.boundary.assertMutation(principal);return{...scope,actorId:p.actorId};},verifyAvailableAsset:vault.verifyAvailableAsset});
  assert.deepEqual(restoredStore.readRecord(p,scope,target),committed.record);assert.deepEqual(vault.readRetained(committed.record),pngBytes);
  const replay=e.boundary.withMutationAuthorization(p,()=>restoredStore.execute(p,scope,target,command));assert.equal(replay.replayed,true);assert.deepEqual(replay.record,committed.record);
  assert.deepEqual(restoredStore.history(p,scope,target),e.store.history(p,scope,target));
  const report={synthetic:true,mediaVersion:media.MEDIA_VERSION,databaseSchema:3,fixture:'at06-synthetic/1',result:'pass',checks:['SQLite backup/integrity/migration ledger','exact DB manifest agreement','original SHA-256 and byte count','new empty destination restore','asset ID/home/revision/tombstone retained','history retained','payload-bound receipt replay without new audit'],originalSha256:manifest.assets[0].sha256,databaseSha256:manifest.database.sha256,exclusions:manifest.exclusions,productionClaim:false};
  writeFileSync(outputManifest,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});writeFileSync(outputReport,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}finally{restoredStore?.close();e.close();}
