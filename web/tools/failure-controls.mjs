// Deliberately remove one guard at a time in disposable modules. A canary MUST
// reject the weakened implementation; these are not production/security proof.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { demoSnapshot, demoOptions } from '../demo/fixtures.mjs';
import { prepareAtlasView } from '../src/prepare.mjs';
import { routeHref } from '../src/model.mjs';
const preparePath=new URL('../src/prepare.mjs',import.meta.url),modelPath=new URL('../src/model.mjs',import.meta.url);
const prepare=readFileSync(preparePath,'utf8').replace("'../../packages/contracts/src/index.mjs'",JSON.stringify(new URL('../../packages/contracts/src/index.mjs',import.meta.url).href)).replace("'./model.mjs'",JSON.stringify(modelPath.href));
const model=readFileSync(modelPath,'utf8');
const app=readFileSync(new URL('../src/app.mjs',import.meta.url),'utf8').replace(/'\.\/(model|copy|render)\.mjs'/g,(_,name)=>JSON.stringify(new URL('../src/'+name+'.mjs',import.meta.url).href));
const temp=mkdtempSync(join(tmpdir(),'houseatlas-at10-controls-'));
let caught=0;
async function control(name,source,before,after,canary) {
  assert.ok(source.includes(before),'Control preimage absent: '+name);
  const path=join(temp,name+'.mjs');writeFileSync(path,source.replace(before,after));
  const module=await import(pathToFileURL(path));
  try { await canary(module); } catch(error) { if(error.code!=='ERR_ASSERTION') throw error;caught++;console.log(name+': expected canary rejection');return; }
  throw new Error(name+': weakened guard escaped detection');
}
try {
  await control('cache-revocation',prepare,'if (sourceDenied(p.source)) return false;','',mod=>{
    const s=demoSnapshot('homebox-quarantine');assert.equal(mod.prepareAtlasView(s,demoOptions(s)).entries.length,0);
  });
  await control('network-quarantine',prepare,"b.payload.sourceState === 'present' && !sourceDenied(b.payload.source)","b.payload.sourceState === 'present'",mod=>{
    const s=demoSnapshot('network-quarantine'),v=mod.prepareAtlasView(s,demoOptions(s));assert.equal(v.status,'ready');assert.ok(v.entries.some(p=>p.entity.name==='Portable radio'));assert.equal(v.entries.some(p=>p.networkRelations.length),false);
  });
  await control('home-isolation',prepare,'snapshot.homeboxEntities.filter(p => sameScope(p, scope))','snapshot.homeboxEntities.filter(() => true)',mod=>{
    const s=demoSnapshot(),p=structuredClone(s.homeboxEntities[0]);p.homeId=s.sources[1].homeId;p.entity.id=p.source.externalId='00000000-0000-4000-8000-000000000599';p.entity.parent=null;p.entity.name='Canary other-home secret';p.nativeLinks=[];
    // Valid disjoint home allowlists can share instance+collection. Cache alone
    // cannot authorize an entity; the explicit home filter is still essential.
    s.sources[0].partitionMode='reviewed-entity-allowlist';s.sources[0].allowedExternalIds=s.homeboxEntities.map(p=>p.entity.id);
    s.sources[1]={...s.sources[0],homeId:p.homeId,allowedExternalIds:[p.entity.id]};s.homeboxEntities.push(p);
    s.caches.push({...s.caches[0],homeId:p.homeId});
    assert.equal(mod.prepareAtlasView(s,demoOptions(s)).entries.some(p=>p.entity.name==='Canary other-home secret'),false);
  });
  await control('verified-native-route',model,'l.intent === intent && l.verifiedRoute &&','l.intent === intent &&',mod=>{
    const s=demoSnapshot(),p=s.homeboxEntities[1];const view={...p,key:mod.entityKey(p),sourceState:'present',cacheStatus:'fresh'};assert.equal(mod.nativeLink(view,'edit',true),null);
  });
  await control('media-home-scope',prepare,'sameScope(m.entity, scope) &&','true &&',mod=>{
    const s=demoSnapshot(),options=demoOptions(s);options.media.forEach(m=>m.entity.homeId=s.sources[1].homeId);
    const p=mod.prepareAtlasView(s,options).entries.find(p=>p.entity.name==='Portable radio');assert.equal(p.attachments.at(-1).previewHref,null);
  });
  await control('truthful-age',model,"Date.parse(now) - Date.parse(cache.lastSuccessfulFetchAt) > staleAfterMs ? 'stale' : 'fresh'","'fresh'",mod=>{
    const s=demoSnapshot();assert.equal(mod.sourceState(s.caches[0],'2026-01-02T15:00:00Z'),'stale');
  });
  await control('focus-token-selector',app,"(focus.startsWith('action:') ? [...root.querySelectorAll('[data-action]')].find(el => el.dataset.action === focus.slice(7)) : [...root.querySelectorAll('[id]')].find(el => el.id === focus))","root.querySelector('#' + focus)",mod=>{
    const s=demoSnapshot(),options=demoOptions(s),view=prepareAtlasView(s,options),radio=view.entries.find(p=>p.entity.name==='Portable radio');
    const events=new Map(),windowEvents=new Map(),doc={documentElement:{},activeElement:{dataset:{focusId:'item'+radio.key}}};
    const win={location:{hash:'#home'},addEventListener:(n,fn)=>windowEvents.set(n,fn),removeEventListener:()=>{}};doc.defaultView=win;
    const decode=value=>value.replace(/&quot;/g,'"').replace(/&amp;/g,'&');
    const root={ownerDocument:doc,innerHTML:'',contains:()=>true,addEventListener:(n,fn)=>events.set(n,fn),removeEventListener:()=>{},querySelectorAll(selector){
      const attr={'[data-focus-id]':'data-focus-id','[data-action]':'data-action','[id]':'id'}[selector];
      return [...root.innerHTML.matchAll(new RegExp('(?:^|\\s)'+attr+'="([^"]*)"','g'))].map(m=>({id:attr==='id'?decode(m[1]):undefined,dataset:{[attr==='data-action'?'action':'focusId']:decode(m[1])},focus(){}}));
    },querySelector(selector){if(/^#item\["/.test(selector)) throw new DOMException('Invalid CSS selector','SyntaxError');return {focus(){}};}};
    const ui=mod.mountAtlas(root,{view});events.get('click')({target:{closest:n=>n==='a'?{getAttribute:()=>routeHref('item',radio.key),classList:{contains:()=>false}}:null},preventDefault(){},button:0});windowEvents.get('hashchange')();
    s.homeboxEntities.find(p=>p.entity.id===radio.entity.id).entity.archived=true;ui.updateAuthorizedView(prepareAtlasView(s,options));win.location.hash='#home';assert.doesNotThrow(()=>windowEvents.get('hashchange')());ui.destroy();
  });
  assert.equal(caught,7);console.log('AT-10 failure controls: 7 weakened guards detected');
} finally {rmSync(temp,{recursive:true,force:true});}
