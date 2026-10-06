import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setup,scope,other,U } from '../../server/test/support.mjs';
const c=await setup();
try {
  await c.refresh();await c.refresh('network');await c.refresh('homebox',other);
  const route=selected=>'/api/atlas/'+selected.workspaceId+'/'+selected.homeId+'/view';
  const normal=await (await c.router(c.request(route(scope),c.session))).json(),otherView=await (await c.router(c.request(route(other),c.session))).json();
  c.state.network='auth';await c.refresh('network');const networkDenied=await (await c.router(c.request(route(scope),c.session))).json();
  c.metadata.entities=c.metadata.entities.filter(e=>e.id!==U(501));await c.refresh();const removed=await (await c.router(c.request(route(scope),c.session))).json();
  const moduleUrls=new Map();
  function embedded(name) {
    if(moduleUrls.has(name))return moduleUrls.get(name);
    let text=readFileSync(new URL('../../web/src/'+name,import.meta.url),'utf8');
    text=text.replace(/from '\.\/([^']+)'/g,(_,dep)=>"from '"+embedded(dep)+"'");
    const url='data:text/javascript;base64,'+Buffer.from(text).toString('base64');moduleUrls.set(name,url);return url;
  }
  const data=JSON.stringify({normal,otherView,networkDenied,removed}).replaceAll('<','\\u003c');
  const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HouseAtlas offline checks</title><style>'+readFileSync(new URL('../../web/src/styles.css',import.meta.url),'utf8')+'</style><body><aside aria-label="Synthetic test controls"><button id="hold">Hold next read</button><button id="revoke">Revoke access</button><button id="complete">Complete pending read</button><button id="remove">Remove item</button><button id="network">Network denial</button><button id="reset">Reset view</button><output id="test-status">Synthetic router view</output></aside><div id="root"></div><script type="module">import {mountAtlas} from '+JSON.stringify(embedded('app.mjs'))+';const views='+data+';const root=document.querySelector("#root"),status=document.querySelector("#test-status");let ui,pending,hold=false;const read=scope=>hold?(hold=false,new Promise(resolve=>pending=resolve)):Promise.resolve(scope.homeId===views.otherView.scope.homeId?views.otherView:views.normal);function reset(){ui?.destroy();location.hash="#home";ui=mountAtlas(root,{view:views.normal,refresh:read,loadHome:read});status.textContent="Synthetic router view";}document.querySelector("#hold").onclick=()=>{hold=true;status.textContent="Next read pending";};document.querySelector("#revoke").onclick=()=>{ui.invalidateAccess("revoked");status.textContent="Access revoked";};document.querySelector("#complete").onclick=()=>{pending?.(views.normal);status.textContent="Late read completed";};document.querySelector("#remove").onclick=()=>{ui.updateAuthorizedView(views.removed);status.textContent="Item removed from complete generation";};document.querySelector("#network").onclick=()=>{ui.updateAuthorizedView(views.networkDenied);status.textContent="Network source denied";};document.querySelector("#reset").onclick=reset;reset();</script></body></html>';
  const target=resolve(process.argv[2]??'../evidence/browser-harness.html');writeFileSync(target,html);
  writeFileSync(target.replace(/\.html$/,'.views.json'),JSON.stringify({normal,otherView,networkDenied,removed},null,2)+'\n');
  console.log(target);
} finally {c.close();}
