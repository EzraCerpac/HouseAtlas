import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AtlasStore } from '../../storage/src/index.mjs';
import { setup, media, scope, U, pngBytes, mutation } from './support.mjs';

test('coherent database and original manifest restores IDs, hashes, history, receipts and tombstones',async t=>{
  const e=await setup();t.after(e.close);const p=await e.principal('mutate'),target={recordType:'asset',recordId:U(600)},command=mutation('tombstone',8300);
  const committed=e.boundary.withMutationAuthorization(p,()=>e.store.execute(p,scope,target,command));
  const bundle=join(e.dir,'bundle');const manifest=await media.captureRecovery({databasePath:e.databasePath,vault:e.vault,destination:bundle});
  assert.equal(manifest.databaseSchema,3);assert.equal(manifest.assets.length,1);assert.equal(manifest.assets[0].lifecycle,'tombstoned');assert.equal(manifest.assets[0].blob,'0.blob');
  const restored=media.restoreRecovery({bundle,destination:join(e.dir,'restored')}),vault=new media.AssetVault({root:restored.vaultRoot});
  const store=new AtlasStore({path:restored.databasePath,authorize:(principal,r)=>{e.boundary.revalidate(principal);if(r.capability==='mutate')e.boundary.assertMutation(principal);return{...scope,actorId:U(50)};},verifyAvailableAsset:vault.verifyAvailableAsset});t.after(()=>store.close());
  assert.deepEqual(store.readRecord(p,scope,target),committed.record);assert.deepEqual(vault.readRetained(committed.record),pngBytes);
  assert.deepEqual(store.history(p,scope,target),e.store.history(p,scope,target));assert.deepEqual(e.boundary.withMutationAuthorization(p,()=>store.execute(p,scope,target,command)),{...committed,replayed:true});
  assert.throws(()=>media.restoreRecovery({bundle,destination:join(e.dir,'restored')}));
});
test('capture stays coherent with a concurrent post-backup lifecycle edit',async t=>{
  const e=await setup();t.after(e.close);const p=await e.principal('mutate'),target={recordType:'asset',recordId:U(600)};
  const manifest=await media.captureRecovery({databasePath:e.databasePath,vault:e.vault,destination:join(e.dir,'concurrent'),fault:phase=>{if(phase==='after-database')e.boundary.withMutationAuthorization(p,()=>e.store.execute(p,scope,target,mutation('tombstone',8301)));}});
  assert.equal(manifest.assets[0].lifecycle,'active');assert.equal(e.store.readRecord(p,scope,target).lifecycle,'tombstoned');assert.equal(media.verifyRecovery({bundle:join(e.dir,'concurrent')}).assets[0].lifecycle,'active');
});
test('missing legacy manifest stays explicit without inventing recoverable bytes',async t=>{
  const e=await setup();t.after(e.close);const p=await e.principal('mutate'),target={recordType:'asset',recordId:U(604)},record=e.snapshot.records.find(r=>r.recordType==='asset');
  const payload={...record.payload,storageKey:'synthetic-unavailable-legacy-original',sha256:'a'.repeat(64),byteSize:0,contentType:'application/octet-stream',availability:'missing',previewPolicy:'blocked'};
  e.boundary.withMutationAuthorization(p,()=>e.store.execute(p,scope,target,{...mutation('create',8310,null),value:{recordType:'asset',payload}}));
  const bundle=join(e.dir,'missing');const manifest=await media.captureRecovery({databasePath:e.databasePath,vault:e.vault,destination:bundle});assert.equal(manifest.assets[1].blob,null);assert.equal(manifest.assets[1].availability,'missing');
  assert.equal(media.verifyRecovery({bundle}).assets[1].recordId,U(604));assert.equal(media.restoreRecovery({bundle,destination:join(e.dir,'missing-restored')}).manifest.assets[1].blob,null);
});
test('interrupted and repeated capture/restore never publish partial or overwrite existing state',async t=>{
  const e=await setup();t.after(e.close);const bundle=join(e.dir,'bundle'),failed=join(e.dir,'failed');
  await assert.rejects(media.captureRecovery({databasePath:e.databasePath,vault:e.vault,destination:failed,fault:phase=>{if(phase==='before-publish')throw new Error('synthetic crash');}}));assert(!existsSync(failed));
  await media.captureRecovery({databasePath:e.databasePath,vault:e.vault,destination:bundle});await assert.rejects(media.captureRecovery({databasePath:e.databasePath,vault:e.vault,destination:bundle}));
  assert.throws(()=>media.restoreRecovery({bundle,destination:failed,fault:()=>{throw new Error('synthetic interruption');}}));assert(!existsSync(failed));
  assert(!readdirSync(e.dir).some(n=>n.startsWith('.atlas-')));assert.equal(media.restoreRecovery({bundle,destination:failed}).manifest.assets.length,1);
});
test('recovery rejects corrupted blobs, database bytes and altered manifest ownership',async t=>{
  const e=await setup();t.after(e.close);const bundle=join(e.dir,'bundle');await media.captureRecovery({databasePath:e.databasePath,vault:e.vault,destination:bundle});
  const original=join(bundle,'originals','0.blob'),bytes=readFileSync(original);chmodSync(original,0o600);const bad=Buffer.from(bytes);bad[30]^=1;writeFileSync(original,bad);assert.throws(()=>media.verifyRecovery({bundle}));writeFileSync(original,bytes);
  const manifestPath=join(bundle,'manifest.json'),manifestBytes=readFileSync(manifestPath),manifest=JSON.parse(manifestBytes);manifest.assets[0].homeId=U(3);writeFileSync(manifestPath,JSON.stringify(manifest));assert.throws(()=>media.verifyRecovery({bundle}));writeFileSync(manifestPath,manifestBytes);
  const databasePath=join(bundle,'atlas.sqlite'),databaseBytes=readFileSync(databasePath),badDatabase=Buffer.from(databaseBytes);badDatabase[24]^=1;writeFileSync(databasePath,badDatabase);assert.throws(()=>media.verifyRecovery({bundle}));
});
test('SIGKILL staging/install interruption is recoverable; lost committed response replays',async t=>{
  const e=await setup();t.after(e.close);const worker=new URL('./process-worker.mjs',import.meta.url);
  for(const phase of ['after-stage','after-install','after-commit']){
    const result=spawnSync(process.execPath,[worker.pathname,e.databasePath,join(e.dir,'media'),phase],{encoding:'utf8',timeout:10000});assert.equal(result.signal,'SIGKILL',result.stderr);
    e.vault.cleanupStagingAfterDrain();
  }
  const p=await e.principal('mutate'),target={recordType:'asset',recordId:U(601)},record=e.store.readRecord(p,scope,target);
  assert.equal(e.vault.readRetained(record).toString(),'synthetic interrupted original\n');
  const command={...mutation('create',8800,null),value:{recordType:'asset',payload:record.payload}};
  assert.equal(e.boundary.withMutationAuthorization(p,()=>e.store.execute(p,scope,target,command)).record.recordId,U(601));
  const manifest=await media.captureRecovery({databasePath:e.databasePath,vault:e.vault,destination:join(e.dir,'post-crash')});assert.equal(manifest.assets.length,2);
});
