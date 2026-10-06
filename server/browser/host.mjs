import { mountAtlas } from './app.mjs';
const root=document.querySelector('#atlas-root'),signIn=document.querySelector('#sign-in'),form=document.querySelector('#login-form');
let ui;
async function read(path) {
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw Object.assign(new Error('Read unavailable'),{status:response.status});
  return response.json();
}
const loadHome=scope=>read('/api/atlas/v1/workspaces/'+scope.workspaceId+'/homes/'+scope.homeId+'/view');
const showSignIn=()=>{ui?.destroy();ui=null;root.hidden=true;signIn.hidden=false;form.elements.username.focus();};
async function start() {
  try {
    const homes=await read('/api/atlas/homes');
    if(!homes.length)throw Object.assign(new Error('No authorized home'),{status:403});
    const view=await loadHome(homes[0]);signIn.hidden=true;root.hidden=false;
    ui=mountAtlas(root,{view,loadHome,refresh:loadHome,signIn:showSignIn});
  } catch {showSignIn();}
}
form.addEventListener('submit',async event=> {
  event.preventDefault();form.querySelector('button').disabled=true;
  try {
    const response=await fetch('/api/atlas/auth/login',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({username:form.elements.username.value,password:form.elements.password.value})});
    form.elements.password.value='';
    if(!response.ok)throw new Error('Sign in failed');document.querySelector('#login-error').textContent='';await start();
  } catch {document.querySelector('#login-error').textContent='Sign in failed';}
  finally {form.querySelector('button').disabled=false;}
});
start();
