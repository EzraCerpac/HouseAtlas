import { AccessStore, createAccessBoundary, hashPassword } from '../src/index.mjs';
export const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const ids=Object.freeze({workspace:id(1),home:id(2),otherHome:id(3),user:id(4),actor:id(5),editor:id(6),editorActor:id(7),instance:id(8),entity:id(9),otherEntity:id(10),attachment:id(11),asset:id(12),otherWorkspace:id(13)});
export const origin='https://atlas.synthetic.invalid';
export const password='Synthetic-test-password-only!';
const verifier=await hashPassword(password);
export const source=(homeId=ids.home,externalId=ids.entity)=>({workspaceId:ids.workspace,homeId,key:{sourceInstanceId:ids.instance,collectionId:'synthetic-shared',sourceKind:'homebox-entity',externalId}});
export const descriptor=()=>({kind:'homebox-attachment',entity:source(),attachmentId:ids.attachment});
export const resource=()=>({...descriptor(),workspaceId:ids.workspace,homeId:ids.home,contentType:'image/png',byteSize:64,previewPolicy:'safe-rendered',availability:'available'});
export const registration=(homeId=ids.home,externalId=ids.entity)=>({workspaceId:ids.workspace,homeId,sourceInstanceId:ids.instance,collectionId:'synthetic-shared',owner:'homebox',partitionMode:'reviewed-entity-allowlist',allowedExternalIds:[externalId]});
export function request(path='/',{method='GET',cookie,csrf,body,headers={},requestOrigin=origin,noOrigin=false}={}) {
  return new Request(requestOrigin+path,{method,headers:{...(!noOrigin?{origin:requestOrigin}:{}),...(cookie?{cookie}:{}),...(csrf?{'x-atlas-csrf':csrf}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
}
export async function setup({filename,limits={},resolveMedia=async()=>resource()}={}) {
  const store=new AccessStore({filename}); let clock=1800000000000;
  store.putUser({userId:ids.user,actorId:ids.actor,username:'synthetic-viewer',passwordVerifier:verifier});
  store.putUser({userId:ids.editor,actorId:ids.editorActor,username:'synthetic-editor',passwordVerifier:verifier});
  store.setMembership({userId:ids.user,workspaceId:ids.workspace,homeId:ids.home,role:'viewer'});
  store.setMembership({userId:ids.editor,workspaceId:ids.workspace,homeId:ids.home,role:'editor'});
  store.putSource(registration()); store.putSource(registration(ids.otherHome,ids.otherEntity));
  const config={store,origins:[origin],now:()=>clock,limits:{loginLimit:1000,globalLoginLimit:10000,...limits},resolveMedia};
  const boundary=createAccessBoundary(config);
  const login=async (username='synthetic-viewer',options={})=>{
    const response=await boundary.login(request('/auth/login',{method:'POST',body:{username,password},...options}),{clientKey:'synthetic-loopback'});
    const json=await response.json();return {response,json,cookie:response.headers.get('set-cookie').split(';')[0],csrf:json.csrfToken};
  };
  const authorize=async(session,action='read',route={})=>boundary.authorize(request('/api/atlas/v1',{cookie:session.cookie,csrf:session.csrf,...(action==='mutate'?{method:'POST',body:{syntheticCommand:true}}:{})}),{workspaceId:ids.workspace,homeId:ids.home,action,...route});
  return {store,boundary,config,login,authorize,setClock:value=>{clock=value;},advance:ms=>{clock+=ms;},time:()=>clock};
}
