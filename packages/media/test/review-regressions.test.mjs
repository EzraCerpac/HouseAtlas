import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, renameSync, symlinkSync, readFileSync, writeFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AtlasStore } from '../../storage/src/index.mjs';
import { setup, media, content, scope, U, pngBytes, recordFor, mutation, homeboxDescriptor } from './support.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const input = {scope,purpose:'evidence-original',contentType:'text/plain',body:Buffer.from('Synthetic review replacement original\n')};
function tree(path) {
  const stat=lstatSync(path);
  if (stat.isDirectory()) return readdirSync(path).sort().map(name=>[name,tree(join(path,name))]);
  return [stat.mode,digest(readFileSync(path))];
}

for (const variant of ['future','missing']) test(`stored contract metadata ${variant} rejects capture, forged verification and restore`,async t=>{
  const e=await setup();t.after(e.close);const bundle=join(e.dir,'bundle');
  await media.captureRecovery({databasePath:e.databasePath,vault:e.vault,destination:bundle});
  const path=join(bundle,'atlas.sqlite'),db=new DatabaseSync(path);
  try { db.exec(variant==='future'?"UPDATE atlas_metadata SET value='2.0.0' WHERE key='contractVersion'":"DELETE FROM atlas_metadata WHERE key='contractVersion'"); } finally {db.close();}
  assert.throws(()=>new AtlasStore({path,authorize:()=>scope}),{code:'schema-incompatible'});
  const before=readFileSync(path),manifestPath=join(bundle,'manifest.json'),manifest=JSON.parse(readFileSync(manifestPath));
  // Recompute the digest so hash validation cannot conceal a missing semantic guard.
  manifest.database.sha256=digest(before);manifest.database.byteSize=before.length;writeFileSync(manifestPath,JSON.stringify(manifest));
  await assert.rejects(media.captureRecovery({databasePath:path,vault:e.vault,destination:join(e.dir,'bad-capture')}));
  assert.throws(()=>media.verifyRecovery({bundle}));
  assert.throws(()=>media.restoreRecovery({bundle,destination:join(e.dir,'bad-restore')}));
  assert(!existsSync(join(e.dir,'bad-capture')));assert(!existsSync(join(e.dir,'bad-restore')));
  assert.deepEqual(readFileSync(path),before);assert.deepEqual(e.vault.readRetained(e.snapshot.records.find(r=>r.recordType==='asset')),pngBytes);
  assert(!readdirSync(e.dir).some(name=>name.startsWith('.atlas-')));
});

function substitute(path,outside,kind) {
  cpSync(path,outside,{recursive:true});renameSync(path,path+'-retained');
  if (kind==='symlink') symlinkSync(outside,path);
  else {mkdirSync(path,{mode:0o700});for(const name of readdirSync(outside))renameSync(join(path+'-retained',name),join(path,name));}
}
function partitionPath(e,kind) {
  const root=join(e.dir,'media'),blobs=join(root,'blobs'),partition=readdirSync(blobs)[0];
  return kind==='root'?root:kind==='scope'?join(blobs,partition):join(root,kind);
}
function retainedOriginal(e,record,component,replacement,path) {
  const root=join(e.dir,'media'),key=record.payload.storageKey.split(':')[1],file=record.payload.sha256+'.blob';
  if(replacement==='symlink') {
    if(component==='root')return join(path+'-retained','blobs',key,file);
    if(component==='blobs')return join(path+'-retained',key,file);
    if(component==='scope')return join(path+'-retained',file);
  }
  return join(root,'blobs',key,file);
}
test('vault substitutions before operations reject writes, reads, verification, restore and cleanup without external changes',async t=>{
  for(const component of ['root','blobs','staging','scope'])for(const replacement of ['symlink','directory']) {
    const e=await setup();t.after(e.close);const record=e.snapshot.records.find(r=>r.recordType==='asset'),path=partitionPath(e,component),outside=join(e.dir,'outside');
    substitute(path,outside,replacement);const before=tree(outside);
    await assert.rejects(e.vault.prepareOriginal(input),`${component}/${replacement}: prepare`);
    assert.throws(()=>e.vault.readRetained(record),`${component}/${replacement}: read`);
    assert.throws(()=>e.vault.verifyAvailableAsset(record),`${component}/${replacement}: verifier`);
    assert.throws(()=>e.vault.restoreRetained(record,pngBytes),`${component}/${replacement}: restore`);
    if(component!=='scope')assert.throws(()=>e.vault.cleanupStagingAfterDrain(),`${component}/${replacement}: cleanup`);
    const p=await e.principal('mutate'),command={...mutation('create',9400,null),value:{recordType:'asset',payload:record.payload}};
    assert.throws(()=>e.boundary.withMutationAuthorization(p,()=>e.store.execute(p,scope,{recordType:'asset',recordId:U(601)},command)));
    assert.throws(()=>e.store.readRecord(p,scope,{recordType:'asset',recordId:U(601)}));
    assert.deepEqual(tree(outside),before,`${component}/${replacement}: outside retained`);
    // Substitution only moved/copied the originals; no installed bytes may be purged.
    assert.deepEqual(readFileSync(retainedOriginal(e,record,component,replacement,path)),pngBytes,`${component}/${replacement}: exact owned original`);
  }
});

for(const component of ['root','blobs','staging'])test(`pinned ${component} identity rejects an ordinary directory replacement with identical children`,async t=>{
  const e=await setup();t.after(e.close);const path=partitionPath(e,component),outside=join(e.dir,'outside');substitute(path,outside,'directory');
  const before=tree(path);await assert.rejects(e.vault.prepareOriginal(input));assert.deepEqual(tree(path),before);
});

test('vault substitutions after staging reject installation and retain exact originals and substituted trees',async t=>{
  for(const component of ['root','blobs','staging','scope','transaction'])for(const replacement of ['symlink','directory']) {
    let armed=false,before,outside,path;
    const e=await setup({fault:phase=>{
      if(!armed || phase!=='after-stage')return;
      path=component==='transaction'?join(e.dir,'media','staging',readdirSync(join(e.dir,'media','staging'))[0]):partitionPath(e,component);
      outside=join(e.dir,'outside');substitute(path,outside,replacement);before=tree(outside);
    }});t.after(e.close);const record=e.snapshot.records.find(r=>r.recordType==='asset');armed=true;
    await assert.rejects(e.vault.prepareOriginal(input),`${component}/${replacement}: publication`);
    assert.deepEqual(tree(outside),before,`${component}/${replacement}: no outside change`);
    // Exactly the original PNG must survive, whether the hierarchy was moved or copied.
    assert.deepEqual(readFileSync(retainedOriginal(e,record,component,replacement,path)),pngBytes,`${component}/${replacement}: exact owned original`);
  }
});

function foldedPng(type) {
  const bytes=Buffer.from(pngBytes);let offset=8;
  while(offset<bytes.length){const length=bytes.readUInt32BE(offset),end=offset+length+12;
    if(bytes.subarray(offset+4,offset+8).toString('latin1')===type){bytes[offset+4]|=128;bytes.writeUInt32BE(content.crc32(bytes.subarray(offset+4,end-4)),end-4);return bytes;}offset=end;
  }throw new Error('Fixture chunk absent');
}
test('raw PNG marker bytes reject high-bit IHDR IDAT IEND in validation, staging and authorized delivery',async t=>{
  assert(content.validateContent(pngBytes,'image/png').length>0);
  for(const type of ['IHDR','IDAT','IEND']) {
    const bytes=foldedPng(type);assert.throws(()=>content.validateContent(bytes,'image/png'),{status:415});
    const e=await setup({attachmentBody:bytes});t.after(e.close);
    await assert.rejects(e.vault.prepareOriginal({...input,contentType:'image/png',body:bytes}),{status:415});
    for(const mode of ['preview','download'])assert.equal((await e.deliver(homeboxDescriptor,{mode})).status,415);
  }
});
test('raw PDF marker bytes reject high-bit header and EOF in validation, staging and authorized download',async t=>{
  const valid=Buffer.from('%PDF-1.7\nSynthetic marker fixture\n%%EOF\n');assert.equal(content.validateContent(valid,'application/pdf'),null);
  const good=await setup({attachmentType:'application/pdf',attachmentBody:valid});t.after(good.close);assert.equal((await good.deliver(homeboxDescriptor,{mode:'download'})).status,200);
  for(const location of ['header','EOF']) {
    const bytes=Buffer.from(valid);bytes[location==='header'?0:bytes.length-6]|=128;assert.throws(()=>content.validateContent(bytes,'application/pdf'),{status:415});
    const e=await setup({attachmentType:'application/pdf',attachmentBody:bytes});t.after(e.close);
    await assert.rejects(e.vault.prepareOriginal({...input,contentType:'application/pdf',body:bytes}),{status:415});
    assert.equal((await e.deliver(homeboxDescriptor,{mode:'download'})).status,415);
  }
});
