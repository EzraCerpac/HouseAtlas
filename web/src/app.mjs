import { parseRoute, routeHref, sameScope } from './model.mjs';
import { copy } from './copy.mjs';
import { renderAtlas } from './render.mjs';

/** Mount ordinary UI. The host supplies authorized reads; no source transport,
 * inventory editor, mutation queue, role toggles or browser storage exists here.
 */
export function mountAtlas(root, { view: initialView, loadHome, refresh, signIn, window: win = root.ownerDocument.defaultView } = {}) {
  let view = initialView || {status:'loading'};
  const language = 'en';
  let route = parseRoute(win.location.hash), busy = false, notice = '', generation = 0, failedHome = null;
  const focusByRoute = new Map();
  const denied = reason => ({status:['expired','revoked'].includes(reason) ? reason : 'denied', homes:[], entries:[], caches:[], canEdit:false});
  const paint = (focus = null) => {
    root.innerHTML = renderAtlas(view,route,{language,refreshing:busy,notice,canRefresh:typeof refresh==='function',canSignIn:typeof signIn==='function',canSwitchHome:typeof loadHome==='function',canRetryHome:!!failedHome && typeof loadHome==='function'});
    root.ownerDocument.documentElement.lang = language;
    root.ownerDocument.title = view.status==='ready' ? 'HouseAtlas · ' + view.homeLabel : 'HouseAtlas';
    if (focus) {
      // Qualified route keys are data, never CSS selectors. A remembered link
      // may disappear after refresh, archive filtering or source quarantine.
      const target = [...root.querySelectorAll('[data-focus-id]')].find(el => el.dataset.focusId === focus)
        || (focus.startsWith('action:') ? [...root.querySelectorAll('[data-action]')].find(el => el.dataset.action === focus.slice(7)) : [...root.querySelectorAll('[id]')].find(el => el.id === focus))
        || root.querySelector('#page-heading');
      target?.focus();
    }
  };
  const rememberFocus = () => {
    const active = root.ownerDocument.activeElement;
    if (active && root.contains(active)) focusByRoute.set(win.location.hash, active.dataset?.focusId || (active.dataset?.action ? 'action:' + active.dataset.action : active.id));
  };
  const navigate = href => { rememberFocus(); if(win.location.hash === href) paint('page-heading'); else win.location.hash = href; };
  const invalidateAccess = reason => { generation++; view=denied(reason); busy=false; notice=''; failedHome=null; focusByRoute.clear(); paint('page-heading'); };
  const adopt = next => {
    if (!next || !['ready','denied','expired','revoked','loading','unavailable'].includes(next.status)) throw new TypeError('Host must return an authorized Atlas view');
    view=next;
    if (next.status!=='ready') focusByRoute.clear();
  };
  const doRead = async (operation, changeHome = false, expectedScope = view.scope) => {
    const attempt = ++generation;
    const focus = changeHome ? 'page-heading' : 'action:refresh';
    busy=true; notice=copy(language,'refreshing');
    if (changeHome) { view={status:'loading'}; route=parseRoute('#home'); }
    paint(changeHome?'page-heading':null);
    try {
      const next = await operation();
      if (attempt!==generation) return;
      if(next?.status==='ready' && !sameScope(next.scope || {},expectedScope || {})) { view=denied('denied'); focusByRoute.clear(); notice=''; return; }
      adopt(next); notice=''; failedHome=null;
    } catch (error) {
      if (attempt!==generation) return;
      if (error?.status===401 || error?.code==='session-expired') { view=denied('expired'); focusByRoute.clear(); notice=''; }
      else if (error?.status===403 || error?.code==='access-revoked') { view=denied('revoked'); focusByRoute.clear(); notice=''; }
      else if(changeHome) { view={status:'unavailable'}; failedHome=expectedScope; notice=''; }
      else notice=copy(language,'refreshFailed');
    } finally { if (attempt===generation) { busy=false; paint(view.status==='ready'?focus:'page-heading'); } }
  };
  const onClick = event => {
    const action = event.target.closest?.('[data-action]')?.dataset.action;
    if (action==='refresh' && !busy && view.status==='ready' && refresh) { event.preventDefault(); doRead(()=>refresh(view.scope)); }
    if (action==='retry-home' && !busy && view.status==='unavailable' && failedHome && loadHome) { event.preventDefault(); const scope={...failedHome}; doRead(()=>loadHome(scope),true,scope); }
    if (action==='sign-in' && signIn) { event.preventDefault(); signIn(); }
    const anchor = event.target.closest?.('a');
    if (anchor?.getAttribute('href')?.startsWith('#') && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button===0) {
      if(anchor.classList.contains('skip')) { event.preventDefault(); root.querySelector('#page-heading')?.focus(); }
      else { event.preventDefault(); navigate(anchor.getAttribute('href')); }
    }
  };
  const onChange = event => {
    const action=event.target.dataset?.action;
    if (action==='home' && loadHome) {
      const homeId=event.target.value;
      // Only authorized choices from the current server-prepared home list.
      if(!view.homes.some(h=>h.homeId===homeId)) return;
      const workspaceId=view.scope.workspaceId;
      focusByRoute.clear(); win.history.replaceState(null,'',routeHref('home'));
      doRead(()=>loadHome({workspaceId,homeId}),true,{workspaceId,homeId});
    }
    if (event.target.name==='archived') { route={...route,archived:event.target.checked}; const href=routeHref(route.page,route.key,route); focusByRoute.set(href,'atlas-archives'); navigate(href); }
  };
  const onSubmit = event => {
    if(event.target.id!=='search-form') return;
    event.preventDefault();
    const form=event.target;
    const query=form.querySelector('[name="q"]').value.slice(0,512);
    const archived=form.querySelector('[name="archived"]').checked;
    navigate(routeHref('search',null,{query,archived}));
  };
  const onMediaError = event => {
    const img=event.target;
    if(img.matches?.('img[data-media]')) {
      const placeholder=root.ownerDocument.createElement('p');
      placeholder.className='warning'; placeholder.textContent=copy(language,img.dataset.mediaKind === 'place' ? 'placeFileUnavailable' : 'fileUnavailable'); img.replaceWith(placeholder);
    }
  };
  const routeFocus = () => route.documentId ? 'doc-heading-' + route.documentId : 'page-heading';
  const onRoute = () => { route=parseRoute(win.location.hash); notice=''; paint(focusByRoute.get(win.location.hash)||routeFocus()); };
  root.addEventListener('click',onClick); root.addEventListener('change',onChange); root.addEventListener('submit',onSubmit); root.addEventListener('error',onMediaError,true); win.addEventListener('hashchange',onRoute);
  paint(initialView ? null : 'page-heading');
  return {
    invalidateAccess,
    updateAuthorizedView(next) { generation++; busy=false; notice=''; failedHome=null; adopt(next); paint(routeFocus()); },
    destroy() { generation++; view=denied('denied'); failedHome=null; focusByRoute.clear(); root.innerHTML=''; root.ownerDocument.title='HouseAtlas'; root.removeEventListener('click',onClick); root.removeEventListener('change',onChange); root.removeEventListener('submit',onSubmit); root.removeEventListener('error',onMediaError,true); win.removeEventListener('hashchange',onRoute); }
  };
}
