// Explicitly authorized, disposable loopback QA adapter. It never mounts a
// provisioning/login endpoint or a real household/provider/credential input.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { setup,scope,other,U } from '../../server/test/support.mjs';
let c,hold=false,pending,closing=false;
async function reset() {
  pending?.();pending=undefined;hold=false;
  c?.close();c=await setup();await c.refresh();await c.refresh('network');await c.refresh('homebox',other);
}
await reset();
const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HouseAtlas synthetic QA</title><link rel="stylesheet" href="/styles.css"><body><aside aria-label="Synthetic test controls"><button data-test="hold">Hold next read</button><button data-test="revoke">Revoke access</button><button data-test="complete">Complete pending read</button><button data-test="remove">Remove item</button><button data-test="network">Network denial</button><button data-test="reset">Reset view</button><output id="test-status">Synthetic core ready</output></aside><div id="root"></div><script type="module" src="/preview-client.mjs"></script></body></html>';
const assets=new Map(['app.mjs','render.mjs','model.mjs','copy.mjs','styles.css'].map(f=>['/'+f,readFileSync(new URL('../../web/src/'+f,import.meta.url))]));
assets.set('/preview-client.mjs',readFileSync(new URL('./preview-client.mjs',import.meta.url)));
let base;
const server=createServer(async(req,res)=> {
  const reply=(status,body,type='application/json')=>{res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(body);};
  try {
    if(closing||req.headers.host!==new URL(base).host)return reply(403,'{}');
    const url=new URL(req.url,base);
    if(req.method==='GET'&&url.pathname==='/')return reply(200,html,'text/html; charset=utf-8');
    if(req.method==='GET'&&assets.has(url.pathname)&&!url.search)return reply(200,assets.get(url.pathname),url.pathname.endsWith('.css')?'text/css':'text/javascript');
    if(req.method==='POST'&&req.headers.origin===base&&/^\/synthetic\/(hold|revoke|complete|remove|network|reset)$/.test(url.pathname)&&!url.search) {
      const action=url.pathname.split('/').at(-1);
      if(action==='hold')hold=true;
      if(action==='revoke')c.access.setUserEnabled(U(51),false);
      if(action==='complete'){pending?.();pending=undefined;}
      if(action==='network'){c.state.network='auth';await c.refresh('network');}
      if(action==='remove'){c.metadata.entities=c.metadata.entities.filter(e=>e.id!==U(501));await c.refresh();}
      if(action==='reset')await reset();
      console.log('synthetic action '+action);return reply(200,'{}');
    }
    let response;
    if(req.method==='GET'&&url.pathname==='/synthetic/view') {
      const selected=url.searchParams.get('home')===other.homeId?other:scope;
      response=await c.router(c.request('/api/atlas/'+selected.workspaceId+'/'+selected.homeId+'/view',c.session));
      if(hold){hold=false;console.log('synthetic view held '+response.status);await new Promise(resolve=>{pending=resolve;});}
    } else if(req.method==='GET'&&url.pathname.startsWith('/api/atlas/media/')&&!url.search) response=await c.router(c.request(url.pathname,c.session));
    else return reply(404,'{}');
    console.log('synthetic response '+url.pathname+' '+response.status);
    reply(response.status,Buffer.from(await response.arrayBuffer()),response.headers.get('content-type')??'application/json');
  } catch(error){console.log('synthetic QA failure '+(error.code??error.name));reply(503,'{}');}
});
server.listen(0,'127.0.0.1',()=>{base='http://127.0.0.1:'+server.address().port;console.log('AT13_SYNTHETIC_PREVIEW='+base);});
async function stop(){if(closing)return;closing=true;pending?.();server.closeAllConnections();await new Promise(r=>server.close(r));c.close();console.log('AT13_SYNTHETIC_PREVIEW_STOPPED');}
process.on('SIGINT',()=>{void stop();});process.on('SIGTERM',()=>{void stop();});
setTimeout(()=>{void stop();},10*60*1000).unref();
