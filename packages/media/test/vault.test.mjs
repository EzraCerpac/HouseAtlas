import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, chmodSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';
import { setup, media, content, scope, U, pngBytes, png, recordFor, mutation, assetDescriptor } from './support.mjs';

test('repeated original staging preserves exact digest and isolates homes',async t=>{
  const e=await setup();t.after(e.close);
  const input={scope,purpose:'evidence-original',contentType:'image/png',body:pngBytes};
  const a=await e.vault.prepareOriginal(input),b=await e.vault.prepareOriginal(input),foreign=await e.vault.prepareOriginal({...input,scope:{...scope,homeId:U(3)}});
  assert.deepEqual(a,b);assert.equal(a.sha256,foreign.sha256);assert.notEqual(a.storageKey,foreign.storageKey);
  assert.throws(()=>e.vault.readRetained({...recordFor(a),homeId:U(3)}));assert.equal(readdirSync(join(e.dir,'media','staging')).length,0);
});
test('forged storage path and digest cannot commit available assets or leak bytes',async t=>{
  const e=await setup();t.after(e.close);const p=await e.principal('mutate'),target={recordType:'asset',recordId:U(601)},current=e.snapshot.records.find(r=>r.recordType==='asset');
  const command={...mutation('create',8200,null),value:{recordType:'asset',payload:{...current.payload,storageKey:'/etc/passwd'}}};
  assert.throws(()=>e.boundary.withMutationAuthorization(p,()=>e.store.execute(p,scope,target,command)));
  assert.throws(()=>e.store.readRecord(p,scope,target));assert.deepEqual(e.vault.readRetained(current),pngBytes);
});
test('original corruption denies delivery and recovery',async t=>{
  const e=await setup();t.after(e.close);const folder=join(e.dir,'media','blobs'),partition=readdirSync(folder)[0],path=join(folder,partition,readdirSync(join(folder,partition))[0]);
  chmodSync(path,0o600);const bad=Buffer.from(pngBytes);bad[45]^=1;const crcOffset=33+8+bad.readUInt32BE(33);bad.writeUInt32BE(content.crc32(bad.subarray(37,crcOffset)),crcOffset);assert(content.renderPng(bad).length>0);writeFileSync(path,bad);
  assert.equal((await e.deliver(assetDescriptor,{mode:'download'})).status,503);
  await assert.rejects(media.captureRecovery({databasePath:e.databasePath,vault:e.vault,destination:join(e.dir,'bad-capture')}));
});
test('symlink originals are rejected; failing stages do not publish a manifest',async t=>{
  const dir=mkdtempSync('/tmp/atlas-media-symlink-');t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const vault=new media.AssetVault({root:join(dir,'vault'),fault:phase=>{if(phase==='after-stage')throw new Error('synthetic interruption');}});
  await assert.rejects(vault.prepareOriginal({scope,purpose:'evidence-original',contentType:'image/png',body:pngBytes}));assert.equal(readdirSync(join(dir,'vault','staging')).length,0);
  symlinkSync(join(dir,'vault'),join(dir,'linked'));assert.throws(()=>new media.AssetVault({root:join(dir,'linked')}));
});
test('PNG CRC, structural ordering, critical chunks, animation and oversized dimensions are rejected',()=>{
  const bad=Buffer.from(pngBytes);bad[45]^=1;assert.throws(()=>content.renderPng(bad));
  const signature=pngBytes.subarray(0,8),ihdr=pngBytes.subarray(8,33),iend=content.pngChunk('IEND',Buffer.alloc(0));
  for(const type of ['acTL','fcTL','fdAT','tRNS','FAKE'])assert.throws(()=>content.renderPng(Buffer.concat([signature,ihdr,content.pngChunk(type,Buffer.alloc(4)),pngBytes.subarray(33)])));
  const large=Buffer.from(ihdr.subarray(8,21));large.writeUInt32BE(25000001,0);large.writeUInt32BE(1,4);
  assert.throws(()=>content.renderPng(Buffer.concat([signature,content.pngChunk('IHDR',large),iend])));
  assert.throws(()=>content.renderPng(Buffer.concat([pngBytes,Buffer.from('trailing')]))) ;
  for(const color of [0,3,4])assert.throws(()=>content.renderPng(png({color})));
});
test('PNG filters decode to canonical zero-filter output and RGBA remains bounded',()=>{
  for(let filter=0;filter<=4;filter++){
    const input=png({filter,metadata:false});const result=content.renderPng(input);assert.deepEqual(content.renderPng(result),result);
  }
  assert(content.renderPng(png({color:6})).length>0);
  assert.throws(()=>content.renderPng(png({filter:5})));
});
test('inflated bytes must fit exact decoded pixel budget',()=>{
  const input=png({metadata:false}),header=input.subarray(8,33);
  const bomb=Buffer.concat([input.subarray(0,8),header,content.pngChunk('IDAT',deflateSync(Buffer.alloc(500000))),content.pngChunk('IEND',Buffer.alloc(0))]);assert.throws(()=>content.renderPng(bomb));
});
test('filter reconstruction agrees with independently specified pixel bytes',()=>{
  const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
  const signature=Buffer.from([137,80,78,71,13,10,26,10]);
  const expected=[[5,7,9],[5,7,9],[15,27,39],[10,17,24],[15,27,39]];
  for(let f=0;f<5;f++){
    const input=Buffer.concat([signature,content.pngChunk('IHDR',header),content.pngChunk('IDAT',deflateSync(Buffer.from([f,10,20,30,f,5,7,9]))),content.pngChunk('IEND',Buffer.alloc(0))]);
    const output=content.renderPng(input),length=output.readUInt32BE(33),raw=inflateSync(output.subarray(41,41+length));
    assert.deepEqual([...raw],[0,10,20,30,0,...expected[f]]);
  }
});
test('staging enforces actual bytes, UTF-8 validity, original ownership and cancellation',async t=>{
  const e=await setup();t.after(e.close);
  await assert.rejects(e.vault.prepareOriginal({scope,purpose:'homebox-original',contentType:'text/plain',body:Buffer.from('x')}));
  await assert.rejects(e.vault.prepareOriginal({scope,purpose:'derived-preview',contentType:'image/png',body:pngBytes}));
  await assert.rejects(e.vault.prepareOriginal({scope,purpose:'evidence-original',contentType:'text/plain',body:[new Uint8Array(media.MAX_BYTES),new Uint8Array(1)]}));
  const controller=new AbortController();controller.abort();await assert.rejects(e.vault.prepareOriginal({scope,purpose:'evidence-original',contentType:'image/png',body:pngBytes,signal:controller.signal}));
});
