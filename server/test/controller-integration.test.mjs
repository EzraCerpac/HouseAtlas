import test from 'node:test';
import assert from 'node:assert/strict';
import { mountAtlas } from '../../web/src/app.mjs';
import { routeHref } from '../../web/src/model.mjs';
import { setup,scope,other,U } from './support.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
// Event/focus model only. This is not a rendered browser or viewport result.
function mount(view,callbacks) {
  const events=new Map(),windowEvents=new Map(),focus=[],doc={title:'',documentElement:{lang:'en'},activeElement:null};
  const win={location:{hash:'#home'},history:{replaceState(_,__,hash){win.location.hash=hash;}},addEventListener:(name,fn)=>windowEvents.set(name,fn),removeEventListener:name=>windowEvents.delete(name)};doc.defaultView=win;
  const decode=v=>v.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
  const root={ownerDocument:doc,innerHTML:'',contains:()=>true,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),querySelectorAll:selector=> {
    const attr={'[data-focus-id]':'data-focus-id','[data-action]':'data-action','[id]':'id'}[selector];assert(attr);
    return [...root.innerHTML.matchAll(new RegExp('(?:^|\\s)'+attr+'="([^"]*)"','g'))].map(m=>({id:attr==='id'?decode(m[1]):undefined,dataset:attr==='id'?{}:{[attr==='data-action'?'action':'focusId']:decode(m[1])},focus:()=>focus.push(attr==='id'?'#'+decode(m[1]):decode(m[1]))}));
  },querySelector:selector=> {assert.equal(selector,'#page-heading');return root.innerHTML.includes('id="page-heading"')?{focus:()=>focus.push('#page-heading')}:null;}};
  const ui=mountAtlas(root,{view,...callbacks});
  const action=name=>events.get('click')({target:{closest:s=>s==='[data-action]'?{dataset:{action:name}}:null},preventDefault(){},button:0});
  const link=href=> {events.get('click')({target:{closest:s=>s==='a'?{getAttribute:()=>href,classList:{contains:()=>false}}:null},preventDefault(){},button:0});windowEvents.get('hashchange')();};
  return {root,doc,win,ui,events,windowEvents,focus,action,link};
}
async function view(c,selected=scope) {
  const response=await c.router(c.request('/api/atlas/'+selected.workspaceId+'/'+selected.homeId+'/view',c.session));
  if(!response.ok)throw Object.assign(new Error('Authorized read unavailable'),{status:response.status});return response.json();
}
test('combined controller keeps rooms/documents during actual source denial and restores Back focus after complete removal',async t=> {
  const c=await setup();t.after(c.close);await c.refresh();await c.refresh('network');const initial=await view(c),item=initial.entries.find(e=>e.entity.id===U(501));
  const h=mount(initial,{refresh:()=>view(c),loadHome:s=>view(c,s)});t.after(h.ui.destroy);
  h.doc.activeElement={dataset:{focusId:'item'+item.key}};h.link(routeHref('item',item.key));assert.match(h.root.innerHTML,/Synthetic manual/);
  c.state.network='auth';await c.refresh('network');h.action('refresh');await tick();assert.match(h.root.innerHTML,/Synthetic manual/);assert.doesNotMatch(h.root.innerHTML,/device-a|member-a/);
  c.metadata.entities=c.metadata.entities.filter(e=>e.id!==U(501));await c.refresh();h.ui.updateAuthorizedView(await view(c));h.win.location.hash='#home';h.windowEvents.get('hashchange')();assert.equal(h.focus.at(-1),'#page-heading');assert.doesNotMatch(h.root.innerHTML,/Synthetic unplaced item/);
});
test('combined pending router read cannot resurrect protected DOM after revocation',async t=> {
  const c=await setup();t.after(c.close);await c.refresh();const initial=await view(c);let release;
  const h=mount(initial,{refresh:()=>new Promise(r=>release=r)});t.after(h.ui.destroy);h.action('refresh');
  h.ui.invalidateAccess('revoked');c.access.setUserEnabled(U(51),false);assert.equal((await c.router(c.request(c.prefix+'/view',c.session))).status,401);
  release(initial);await tick();assert.doesNotMatch(h.root.innerHTML,/Synthetic unplaced item|Example home|search-form/);assert.equal(h.doc.title,'HouseAtlas');assert.equal(h.focus.at(-1),'#page-heading');
});
test('combined Settings home switch clears previous home before the actual scoped read and denies wrong response scope',async t=> {
  const c=await setup();t.after(c.close);await c.refresh();await c.refresh('homebox',other);let release;
  const initial=await view(c),h=mount(initial,{loadHome:()=>new Promise(r=>release=r)});t.after(h.ui.destroy);
  assert.doesNotMatch(h.root.innerHTML,/data-action="home"/);h.link('#settings');assert.match(h.root.innerHTML,/data-action="home"/);assert.equal(h.doc.documentElement.lang,'en');assert.doesNotMatch(h.root.innerHTML,/data-action="language"/);
  h.events.get('change')({target:{dataset:{action:'home'},value:other.homeId}});assert.doesNotMatch(h.root.innerHTML,/Synthetic unplaced item|Example home|Second home/);
  release(await view(c));await tick();assert.doesNotMatch(h.root.innerHTML,/Synthetic unplaced item|Example home/);assert.match(h.root.innerHTML,/do not have access/);
});
test('combined service home switch renders only current source partition and meaningful session expiry clears old data',async t=> {
  const c=await setup();t.after(c.close);await c.refresh();await c.refresh('homebox',other);const h=mount(await view(c),{loadHome:s=>view(c,s),refresh:s=>view(c,s)});t.after(h.ui.destroy);
  h.events.get('change')({target:{dataset:{action:'home'},value:other.homeId}});await tick();assert.match(h.root.innerHTML,/Second synthetic home/);assert.doesNotMatch(h.root.innerHTML,/Synthetic unplaced item/);
  c.setTime(c.getTime()+8*24*3600000);h.action('refresh');await tick();assert.doesNotMatch(h.root.innerHTML,/Second synthetic home|Second home/);assert.equal(h.doc.title,'HouseAtlas');
});
