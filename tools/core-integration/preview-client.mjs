import { mountAtlas } from '/app.mjs';
const root=document.querySelector('#root'),status=document.querySelector('#test-status');let ui,current;
async function read(scope){const response=await fetch('/synthetic/view'+(scope?'?home='+scope.homeId:''),{cache:'no-store'});if(!response.ok)throw Object.assign(new Error('Scoped read denied'),{status:response.status});const view=await response.json();current=view.scope;return view;}
async function reset(){ui?.destroy();location.hash='#home';ui=mountAtlas(root,{view:await read(),refresh:read,loadHome:read});status.textContent='Synthetic core ready';}
document.querySelector('aside').addEventListener('click',async event=> {
  const action=event.target.dataset.test;if(!action)return;
  await fetch('/synthetic/'+action,{method:'POST'});
  if(action==='revoke'){ui.invalidateAccess('revoked');status.textContent='Current core access revoked';}
  if(action==='hold')status.textContent='Next core read will wait';
  if(action==='complete')status.textContent='Previously authorized late read released';
  if(['remove','network'].includes(action)){ui.updateAuthorizedView(await read(current));status.textContent=action==='remove'?'Complete generation removed item':'Network partition denied';}
  if(action==='reset')await reset();
});
await reset();
