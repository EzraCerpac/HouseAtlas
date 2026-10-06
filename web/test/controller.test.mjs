import test from 'node:test';
import assert from 'node:assert/strict';
import { mountAtlas } from '../src/app.mjs';
import { prepareAtlasView } from '../src/prepare.mjs';
import { demoSnapshot, demoOptions } from '../demo/fixtures.mjs';
import { routeHref } from '../src/model.mjs';
const view=()=>{const s=demoSnapshot();return prepareAtlasView(s,demoOptions(s));};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(options={}) {
  const handlers=new Map(),windowHandlers=new Map(),focus=[];
  const doc={title:'',documentElement:{lang:'en'},activeElement:null};
  const win={location:{hash:'#home'},history:{replaceState(_,__,hash){win.location.hash=hash;}},addEventListener:(name,fn)=>windowHandlers.set(name,fn),removeEventListener:name=>windowHandlers.delete(name)};
  doc.defaultView=win;
  const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  const root={ownerDocument:doc,innerHTML:'',contains:()=>true,addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name),
    querySelectorAll(selector) {
      const attr={'[data-focus-id]':'data-focus-id','[data-action]':'data-action','[id]':'id'}[selector];assert.ok(attr,'Unexpected selector '+selector);
      return [...root.innerHTML.matchAll(new RegExp('(?:^|\\s)'+attr+'="([^"]*)"','g'))].map(match=>{
        const value=decode(match[1]), label=attr==='id'?'#'+value:attr==='data-action'?'[data-action="'+value+'"]':value;
        return {id:attr==='id'?value:undefined,dataset:attr==='id'?{}:{[attr==='data-action'?'action':'focusId']:value},focus:()=>focus.push(label)};
      });
    },
    querySelector(selector) {
      if (/^#(?:item|place)\["/.test(selector)) throw new DOMException('Invalid CSS selector','SyntaxError');
      assert.equal(selector,'#page-heading');return root.innerHTML.includes('id="page-heading"')?{focus:()=>focus.push(selector)}:null;
    }
  };
  const app=mountAtlas(root,{view:view(),...options});
  const refresh=()=>handlers.get('click')({target:{closest:selector=>selector==='[data-action]'?{dataset:{action:'refresh'}}:null},preventDefault(){},button:0});
  const changeHome=homeId=>handlers.get('change')({target:{dataset:{action:'home'},value:homeId}});
  return {root,doc,win,app,handlers,windowHandlers,focus,refresh,changeHome};
}
test('a timeout preserves saved names/date and returns focus to refresh control',async()=>{
  const h=harness({refresh:async()=>{throw new Error('timeout');}});h.refresh();await tick();
  assert.match(h.root.innerHTML,/Portable radio/);assert.match(h.root.innerHTML,/kept its previous date/);assert.match(h.root.innerHTML,/2 Jan 2026, 12:00 UTC/);assert.equal(h.focus.at(-1),'[data-action="refresh"]');
});
test('401 and 403 erase previously rendered private data, title and authorized home choices',async()=>{
  for(const status of [401,403]) {
    const h=harness({refresh:async()=>{throw Object.assign(new Error('auth'),{status});}});h.refresh();await tick();
    assert.doesNotMatch(h.root.innerHTML,/Portable radio|Example home|search-form|sourceInstanceId/);assert.equal(h.doc.title,'HouseAtlas');assert.equal(h.focus.at(-1),'#page-heading');
  }
});
test('revocation during a pending refresh prevents late successful data resurrection',async()=>{
  let resolve;const h=harness({refresh:()=>new Promise(r=>{resolve=r;})});h.refresh();h.app.invalidateAccess('revoked');resolve(view());await tick();
  assert.match(h.root.innerHTML,/revoked/);assert.doesNotMatch(h.root.innerHTML,/Portable radio|Example home/);
});
test('unexpected refresh home is denied before displaying its names',async()=>{
  const other=view();other.scope.homeId='00000000-0000-4000-8000-000000000003';other.homeLabel='Wrong home secret';
  const h=harness({refresh:async()=>other});h.refresh();await tick();assert.doesNotMatch(h.root.innerHTML,/Wrong home secret|Portable radio/);assert.match(h.root.innerHTML,/do not have access/);
});
test('home selection clears old content before awaiting authorization and rejects forged selections',async()=>{
  const v=view(),otherHome={workspaceId:v.scope.workspaceId,homeId:'00000000-0000-4000-8000-000000000003',label:'Second authorized home'};v.homes.push(otherHome);
  let requests=0,resolve;const h=harness({view:v,loadHome:()=>{requests++;return new Promise(r=>{resolve=r;});}});
  h.changeHome('forged');assert.equal(requests,0);h.changeHome(otherHome.homeId);assert.equal(requests,1);assert.doesNotMatch(h.root.innerHTML,/Portable radio|Example home|Second authorized home/);
  resolve({status:'denied'});await tick();assert.match(h.root.innerHTML,/do not have access/);
});
test('destroy cancels pending work, removes event handlers and clears private DOM/title',async()=>{
  let resolve;const h=harness({refresh:()=>new Promise(r=>{resolve=r;})});h.refresh();h.app.destroy();resolve(view());await tick();assert.equal(h.root.innerHTML,'');assert.equal(h.doc.title,'HouseAtlas');assert.equal(h.handlers.size,0);assert.equal(h.windowHandlers.size,0);
});
test('English-only UI ignores a forged former language control',()=>{
  const h=harness();h.handlers.get('change')({target:{dataset:{action:'language'},value:'nl'}});assert.equal(h.doc.documentElement.lang,'en');assert.match(h.root.innerHTML,/Sitting room/);assert.doesNotMatch(h.root.innerHTML,/data-action="language"/);
});
test('Back restores an existing qualified-key link without CSS interpolation',()=>{
  const h=harness(),radio=view().entries.find(p=>p.entity.name==='Portable radio'),focusId='item'+radio.key;
  h.doc.activeElement={dataset:{focusId}};
  h.handlers.get('click')({target:{closest:s=>s==='a'?{getAttribute:()=>routeHref('item',radio.key),classList:{contains:()=>false}}:null},preventDefault(){},button:0});h.windowHandlers.get('hashchange')();
  h.win.location.hash='#home';h.windowHandlers.get('hashchange')();assert.equal(h.focus.at(-1),focusId);
});
for (const change of ['removed','archived','quarantined']) test('Back safely falls back when remembered item is '+change,()=>{
  const snapshot=demoSnapshot(),options=demoOptions(snapshot),v=prepareAtlasView(snapshot,options),radio=v.entries.find(p=>p.entity.name==='Portable radio');
  const h=harness({view:v});h.doc.activeElement={dataset:{focusId:'item'+radio.key}};
  h.handlers.get('click')({target:{closest:s=>s==='a'?{getAttribute:()=>routeHref('item',radio.key),classList:{contains:()=>false}}:null},preventDefault(){},button:0});h.windowHandlers.get('hashchange')();
  if(change==='removed') snapshot.homeboxEntities=snapshot.homeboxEntities.filter(p=>p.entity.id!==radio.entity.id);
  if(change==='archived') snapshot.homeboxEntities.find(p=>p.entity.id===radio.entity.id).entity.archived=true;
  if(change==='quarantined') snapshot.caches[0].status='access-revoked';
  h.app.updateAuthorizedView(prepareAtlasView(snapshot,options));h.win.location.hash='#home';assert.doesNotThrow(()=>h.windowHandlers.get('hashchange')());assert.equal(h.focus.at(-1),'#page-heading');assert.doesNotMatch(h.root.innerHTML,/Portable radio/);
});
test('archive filter preserves its checkbox focus while announcing updated results',()=>{
  const h=harness();h.handlers.get('change')({target:{dataset:{},name:'archived',checked:true}});h.windowHandlers.get('hashchange')();assert.equal(h.focus.at(-1),'#atlas-archives');assert.match(h.root.innerHTML,/id="atlas-archives" type="checkbox" name="archived" checked/);
});
test('home-switch transport failure ends loading and offers a bounded authorized retry',async()=>{
  const v=view(),homeId='00000000-0000-4000-8000-000000000003';v.homes.push({workspaceId:v.scope.workspaceId,homeId,label:'Second home'});
  let calls=0;const h=harness({view:v,loadHome:async()=>{calls++;throw new Error('timeout');}});h.changeHome(homeId);await tick();assert.match(h.root.innerHTML,/could not be loaded/);assert.match(h.root.innerHTML,/data-action="retry-home"/);assert.doesNotMatch(h.root.innerHTML,/Portable radio|Second home|Loading saved/);
  h.handlers.get('click')({target:{closest:selector=>selector==='[data-action]'?{dataset:{action:'retry-home'}}:null},preventDefault(){},button:0});await tick();assert.equal(calls,2);assert.match(h.root.innerHTML,/could not be loaded/);
});
