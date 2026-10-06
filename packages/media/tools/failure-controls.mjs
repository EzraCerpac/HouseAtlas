import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, symlinkSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const controls=[
  ['actual-byte-bound','bytes.mjs','if (size > maxBytes) deny(413);','if (false) deny(413);','actual byte ceiling'],
  ['actual-chunk-bound','bytes.mjs','if (++count > 65536) deny(413);','count++;','excessive empty stream chunks'],
  ['owned-chunk-copy','bytes.mjs','chunks.push(new Uint8Array(part.value));','chunks.push(part.value);','producer may reuse'],
  ['source-epoch','index.mjs','epoch:before','epoch:0','stale source epoch'],
  ['old-source-grant','index.mjs','if (initial.sourceGrant) boundary.revalidateSource(initial.sourceGrant);','','source revoke and reenable'],
  ['final-awaited-media-grant','index.mjs','await context.wait(boundary.revalidateMedia(mediaGrant)); context.check();','','revocation during final awaited metadata'],
  ['exact-source-receipt','index.mjs',"if (receipt.origin !== initial.provider.origin || !same(receipt.descriptor,descriptor) || receipt.sourceUpdatedAt !== initial.sourceUpdatedAt) quarantine(principal,descriptor,'wrong-scope');",'','auth/wrong-source receipts'],
  ['zero-redirects','index.mjs',"if (!receipt || receipt.redirected !== false || receipt.status !== 200 || receipt.url !== undefined || receipt.location !== undefined) deny(503);",'','redirects and response URLs'],
  ['original-digest','vault.mjs','if (bytes.length !== p.byteSize || sha256(bytes) !== p.sha256) deny(503);','if (bytes.length !== p.byteSize) deny(503);','original corruption'],
  ['png-crc','content.mjs'," || crc32(bytes.subarray(offset+4,end-4)) !== bytes.readUInt32BE(end-4)",'','PNG CRC, structural'],
  ['manifest-ownership','recovery.mjs',"if (canonicalJson(assetEntry(record,blob)) !== canonicalJson(entry) || (record.payload.availability === 'available' && blob === null)) deny(503);",'','recovery rejects corrupted blobs'],
  ['recovery-original-digest','recovery.mjs','if (original.length !== record.payload.byteSize || sha256(original) !== record.payload.sha256) deny(503);','if (original.length !== record.payload.byteSize) deny(503);','recovery rejects corrupted blobs'],
  ['recovery-database-digest','recovery.mjs','if (sha256(bytes) !== manifest.database.sha256 || bytes.length !== manifest.database.byteSize || assets.length !== manifest.assets.length) deny(503);','if (bytes.length !== manifest.database.byteSize || assets.length !== manifest.assets.length) deny(503);','recovery rejects corrupted blobs'],
  ['stored-contract-metadata','recovery.mjs',"db.prepare(\"SELECT value FROM atlas_metadata WHERE key='contractVersion'\").get()?.value",'CONTRACT_VERSION','stored contract metadata'],
  ['pinned-vault-root','vault.mjs','assertDirectory(this.#rootPin); assertDirectory(this.#blobsPin); assertDirectory(this.#stagingPin);','assertDirectory(this.#blobsPin); assertDirectory(this.#stagingPin);','pinned root identity'],
  ['pinned-vault-blobs','vault.mjs','assertDirectory(this.#rootPin); assertDirectory(this.#blobsPin); assertDirectory(this.#stagingPin);','assertDirectory(this.#rootPin); assertDirectory(this.#stagingPin);','pinned blobs identity'],
  ['pinned-vault-staging','vault.mjs','assertDirectory(this.#rootPin); assertDirectory(this.#blobsPin); assertDirectory(this.#stagingPin);','assertDirectory(this.#rootPin); assertDirectory(this.#blobsPin);','pinned staging identity'],
  ['publication-scope-identity','vault.mjs','this.#assertHierarchy(); assertDirectory(directory); assertDirectory(transaction);','this.#assertHierarchy(); assertDirectory(transaction);','vault substitutions after staging'],
  ['raw-png-marker','content.mjs',"type = name.toString('latin1')","type = name.toString('ascii')",'raw PNG marker bytes'],
  ['raw-pdf-header','content.mjs',"data.subarray(0,12).toString('latin1')","data.subarray(0,12).toString('ascii')",'raw PDF marker bytes'],
  ['raw-pdf-eof','content.mjs',"data.subarray(-1024).toString('latin1')","data.subarray(-1024).toString('ascii')",'raw PDF marker bytes'],
];
const run=(pattern,module)=>spawnSync(process.execPath,['--test',`--test-name-pattern=${pattern}`,join(root,'media/test/media.test.mjs'),join(root,'media/test/vault.test.mjs'),join(root,'media/test/recovery.test.mjs'),join(root,'media/test/review-regressions.test.mjs')],{encoding:'utf8',timeout:30000,env:{...process.env,...(module?{ATLAS_MEDIA_MODULE:module}:{})}});
const results=[];
for(const [name,file,from,to,pattern] of controls){
  const original=run(pattern);assert.equal(original.status,0,`${name} positive: ${original.stdout}${original.stderr}`);
  const temp=mkdtempSync('/tmp/atlas-media-control-');
  try {
    mkdirSync(join(temp,'packages','media'),{recursive:true});cpSync(join(root,'media/src'),join(temp,'packages/media/src'),{recursive:true});
    for(const dependency of ['contracts','storage','access'])symlinkSync(join(root,dependency),join(temp,'packages',dependency));
    const path=join(temp,'packages/media/src',file),source=readFileSync(path,'utf8');assert.equal(source.split(from).length,2,`${name}: exactly one guard`);writeFileSync(path,source.replace(from,to));
    const mutant=run(pattern,join(temp,'packages/media/src/index.mjs'));
    assert(mutant.status!==0 && /AssertionError|ERR_ASSERTION/.test(mutant.stdout+mutant.stderr),`${name} survived or failed for a non-assertion reason: ${mutant.stdout}${mutant.stderr}`);
    results.push({name,positive:'pass',mutant:'rejected-by-assertion'});
  } finally {rmSync(temp,{recursive:true,force:true});}
}
console.log(JSON.stringify({passed:results.length,controls:results,independentReviewer:false},null,2));
