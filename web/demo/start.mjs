import { mountAtlas } from './app.mjs';
const scenario=new URL(location.href).searchParams.get('scenario')||'normal';
async function read(refresh=false) {
  const response=await fetch('/api/demo/view?'+new URLSearchParams({scenario,...(refresh?{refresh:'1'}:{})}),{cache:'no-store'});
  if(!response.ok) {const error=new Error('Synthetic read failed');error.status=response.status;throw error;}
  return response.json();
}
const app=mountAtlas(document.querySelector('#atlas'),{refresh:()=>read(true)});
try {app.updateAuthorizedView(await read());}catch {app.invalidateAccess('denied');}
