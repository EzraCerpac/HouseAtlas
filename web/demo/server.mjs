// Disposable loopback synthetic harness; never a production server/auth adapter.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { prepareAtlasView } from '../src/prepare.mjs';
import { demoSnapshot, demoOptions } from './fixtures.mjs';

const scenarios=new Set(['normal','editor','outage','stale','no-cache','empty','unresolved','revoked','denied','expired','media-unavailable','refresh-failure','homebox-quarantine','network-quarantine','focus-removed','focus-archived']);
const assets=new Map(['app.mjs','model.mjs','render.mjs','copy.mjs','styles.css'].map(name=>['/assets/'+name,{content:readFileSync(new URL('../src/'+name,import.meta.url)),type:name.endsWith('.css')?'text/css':'text/javascript'}]));
assets.set('/assets/demo.mjs',{content:readFileSync(new URL('./start.mjs',import.meta.url)),type:'text/javascript'});
const shell='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HouseAtlas · Synthetic example</title><link rel="stylesheet" href="/assets/styles.css"></head><body><div id="atlas"><p>Loading synthetic example…</p></div><script type="module" src="/assets/demo.mjs"></script></body></html>';
const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN9sAAAAASUVORK5CYII=','base64');
export function createDemoServer() {
  return createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    res.setHeader('Cache-Control','private, no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    if(req.method!=='GET') {res.writeHead(405);res.end();return;}
    if(url.pathname==='/api/demo/view') {
      const scenario=scenarios.has(url.searchParams.get('scenario'))?url.searchParams.get('scenario'):'normal';
      if(url.searchParams.has('refresh') && scenario==='refresh-failure') {res.writeHead(503);res.end();return;}
      const snapshot=demoSnapshot(url.searchParams.has('refresh') && ['focus-removed','focus-archived'].includes(scenario) ? scenario+'-after' : scenario);const view=prepareAtlasView(snapshot,demoOptions(snapshot,scenario));
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(view));return;
    }
    if(url.pathname==='/api/atlas/media/example-photo') {res.writeHead(200,{'Content-Type':'image/png'});res.end(photo);return;}
    if(url.pathname==='/api/atlas/media/example-manual') {res.writeHead(200,{'Content-Type':'text/plain','Content-Disposition':'attachment; filename="synthetic-manual.txt"'});res.end('Invented example manual. No real household instructions.');return;}
    if(url.pathname.startsWith('/synthetic-homebox/')) {res.writeHead(200,{'Content-Type':'text/plain'});res.end('Synthetic native-link destination only. HomeBox editor is not connected.');return;}
    const asset=assets.get(url.pathname);
    if(asset) {res.writeHead(200,{'Content-Type':asset.type});res.end(asset.content);return;}
    if(url.pathname==='/') {res.writeHead(200,{'Content-Type':'text/html'});res.end(shell);return;}
    res.writeHead(404);res.end();
  });
}
if(process.argv[1] === new URL(import.meta.url).pathname) {
  const server=createDemoServer();server.listen(4310,'127.0.0.1',()=>console.log('AT-10 synthetic harness: http://127.0.0.1:4310 (loopback only)'));
}
