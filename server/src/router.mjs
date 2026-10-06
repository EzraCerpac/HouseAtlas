import { readFileSync } from 'node:fs';
import { validateShape } from '../../packages/contracts/src/index.mjs';
import { AccessError } from '../../packages/access/src/index.mjs';
import { privateHeaders, jsonResponse, coreError, fail } from './common.mjs';
import { createReadPages, requireMutationPreconditions, requireBatchPreconditions } from './http-contract.mjs';

const assets=new Map([
  ['/assets/atlas/app.mjs',new URL('../../web/src/app.mjs',import.meta.url)],
  ['/assets/atlas/render.mjs',new URL('../../web/src/render.mjs',import.meta.url)],
  ['/assets/atlas/model.mjs',new URL('../../web/src/model.mjs',import.meta.url)],
  ['/assets/atlas/copy.mjs',new URL('../../web/src/copy.mjs',import.meta.url)],
  ['/assets/atlas/styles.css',new URL('../../web/src/styles.css',import.meta.url)],
  ['/assets/atlas/host.mjs',new URL('../browser/host.mjs',import.meta.url)],
]);
const shell='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HouseAtlas</title><link rel="stylesheet" href="/assets/atlas/styles.css"><body><main id="sign-in"><h1>Sign in</h1><form id="login-form"><label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button>Sign in</button><p id="login-error" role="alert"></p></form></main><div id="atlas-root" hidden></div><script type="module" src="/assets/atlas/host.mjs"></script></body></html>';
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const scoped=new RegExp('^/api/atlas/v1/workspaces/('+uuid+')/homes/('+uuid+')/(.+)$');
const recordRoute=new RegExp('^records/([a-z-]+)/('+uuid+')(\/(mutations|history))?$');
const media=new RegExp('^/api/atlas/media/('+uuid+')/('+uuid+')/([0-9a-f]{64})/(preview|download)$');

/** Request/Response dispatcher only; trusted future host supplies exact URL,
 * connection bounds and clientKey. No socket/listener is started here. */
export function createCoreRouter({service,origins,now=Date.now}) {
  const allowed=new Set(origins),readPage=createReadPages({now});
  return async function handle(request,{clientKey}={}) {
    try {
      if(!(request instanceof Request))fail();
      const u=new URL(request.url);
      if(!allowed.has(u.origin)||u.username||u.password||u.hash||u.pathname.includes('%'))throw new AccessError(403,'forbidden');
      return await service.run(async()=> {
        if(u.search&&!scoped.test(u.pathname))throw new AccessError(403,'forbidden');
        if(u.pathname==='/api/atlas/auth/login') return service.boundary.login(request,{clientKey});
        if(u.pathname==='/api/atlas/auth/session') return service.boundary.sessionInfo(request);
        if(u.pathname==='/api/atlas/auth/logout') return service.boundary.logout(request);
        if(u.pathname==='/api/atlas/homes') {
          if(request.method!=='GET')fail();return jsonResponse(await service.choices(request));
        }
        if(u.pathname==='/'||assets.has(u.pathname)) {
          if(request.method!=='GET')fail();
          const path=assets.get(u.pathname),body=path?readFileSync(path):shell;
          return new Response(body,{headers:{...privateHeaders,'content-type':path?(u.pathname.endsWith('.css')?'text/css':'text/javascript'):'text/html','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});
        }
        const m=media.exec(u.pathname);
        if(m) return service.deliverMedia(request,{workspaceId:m[1],homeId:m[2]},m[3],m[4]);
        const match=scoped.exec(u.pathname);if(!match)fail('not-found');
        const scope={workspaceId:match[1],homeId:match[2]},route=match[3],record=recordRoute.exec(route),target=record?{recordType:record[1],recordId:record[2]}:null;
        const list=['records','homebox/entities','network/relations'].includes(route);
        // /view and /network/facet are browser assembly extensions. They do not
        // replace the six frozen HTTP operations or their response envelopes.
        if(!record&&!list&&!['mutations','view','network/facet'].includes(route))fail('not-found');
        if(u.search&&!list)throw new AccessError(403,'forbidden');
        if(target)validateShape('recordRef',target);
        const mutation=route==='mutations'||record?.[4]==='mutations',action=mutation?'mutate':record?.[4]==='history'?'history':'read';
        if(request.method!==(mutation?'POST':'GET'))throw new AccessError(405,'invalid-contract');
        const {principal,payload}=await service.boundary.authorize(request,{...scope,action});
        if(record?.[4]==='mutations') return jsonResponse(service.execute(principal,target,requireMutationPreconditions(payload)));
        if(route==='mutations') return jsonResponse(service.executeBatch(principal,requireBatchPreconditions(payload)));
        if(route==='view') return jsonResponse(await service.view(principal,await service.choices(request)));
        if(route==='network/facet') return jsonResponse(service.network(principal));
        if(list)return jsonResponse(readPage(request,principal,route,service.snapshot(principal)));
        if(record?.[4]==='history')return jsonResponse(service.history(principal,target));
        return jsonResponse(service.readRecord(principal,target));
      });
    } catch(error) {return coreError(error);}
  };
}
