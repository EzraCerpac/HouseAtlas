import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url).pathname,source=readFileSync(join(root,'server/src/service.mjs'),'utf8');
const cases=[
  ['writer-fence',"boundary.withMutationAuthorization(principal,()=>fn())","fn()",'actual fenced storage command'],
  ['epoch-rebase','expectedCacheEpoch:prior.cacheEpoch','expectedCacheEpoch:store.readCacheForPublication(token,scope,partitionOf(r)).cacheEpoch','an intervening failure epoch'],
  ['sticky-quarantine',"accessStore.setSourceEnabled(scope.workspaceId,scope.homeId,registration.sourceInstanceId,registration.collectionId,false)",'void 0','auth/wrong-scope failure'],
  ['complete-sidecar','sidecar.stage(r,state);','void 0;','Network staged orphan'],
  ['observation-policy',"for(const row of generation.observations) boundary.authorizeSource(principal,reference(registration,'network-segment',row.externalId));",'void 0;','Network observation-only policy'],
];
const dir=mkdtempSync('/tmp/atlas-core-controls-'),results=[];
try {
  mkdirSync(join(dir,'server'));mkdirSync(join(dir,'server/src'));
  for(const name of ['packages','adapters','web'])symlinkSync(join(root,name),join(dir,name));
  for(const file of readdirSync(join(root,'server/src')).filter(f=>f.endsWith('.mjs')&&f!=='service.mjs'))writeFileSync(join(dir,'server/src',file),readFileSync(join(root,'server/src',file)));
  for(const [name,from,to,pattern] of cases) {
    assert(source.includes(from),'Missing mutant anchor '+name);const path=join(dir,'server/src/service.mjs');writeFileSync(path,source.replace(from,to));
    const r=spawnSync(process.execPath,['--test','--test-concurrency=1','--test-name-pattern='+pattern,'server/test/core.test.mjs'],{cwd:root,env:{...process.env,ATLAS_CORE_MODULE:path},encoding:'utf8',timeout:15000});
    const output=r.stdout+r.stderr;assert.notEqual(r.status,0,'Undetected '+name);assert.match(output,/AssertionError/,'Must fail a behavioral assertion '+name);assert.doesNotMatch(output,/ERR_MODULE_NOT_FOUND|SyntaxError/);
    results.push({name,detected:true,exitCode:r.status,pattern});
    if(process.env.ATLAS_CORE_EVIDENCE)writeFileSync(join(process.env.ATLAS_CORE_EVIDENCE,'control-'+name+'.txt'),output);
  }
  console.log(JSON.stringify({controls:results.length,results},null,2));
} finally {rmSync(dir,{recursive:true,force:true});}
