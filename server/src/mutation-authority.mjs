import { validateShape, canonicalJson } from '../../packages/contracts/src/index.mjs';
import { fail, same, scopeOf } from './common.mjs';

const phases=new Set(['intake','validate','candidate','precommit','replay','replay-precommit']);
const finalPhases=new Set(['precommit','replay-precommit']);

/** Actual AT07 transaction context is the sole graph source. Grant handles live
 * for this synchronous writer-fenced call; a later phase never replaces one. */
export function authorizeMutationContext(boundary,principal,context,state) {
  if(!context||context.format!=='atlas-mutation-authorization-context/1'||context.schemaVersion!==1||!phases.has(context.phase)||!same(context.scope,scopeOf(principal)))fail('upstream-unavailable');
  if(state.contextId===null) {
    if(context.phase!=='intake')fail('upstream-unavailable');
    state.contextId=context.contextId;
  } else if(state.contextId!==context.contextId)fail('upstream-unavailable');
  if(!same(context.entries,state.entries))fail('upstream-unavailable');
  for(const saved of state.grants.values())saved.kind==='entity'?boundary.revalidateSource(saved.grant):boundary.revalidateSourcePartition(saved.grant);
  const authorize=(kind,ref)=> {
    if(!same(scopeOf(ref),scopeOf(principal)))fail('not-found');
    if(kind==='entity')validateShape('sourceRef',ref);
    const key=kind+':'+canonicalJson(ref);
    if(state.grants.has(key))return;
    if(finalPhases.has(context.phase))fail('upstream-unavailable');
    const grant=kind==='entity'?boundary.authorizeSource(principal,ref):boundary.authorizeSourcePartition(principal,ref);
    state.grants.set(key,{kind,grant});
  };
  for(const ref of context.closure.sourceRefs)authorize('entity',ref);
  for(const ref of context.closure.sourcePartitions)authorize('partition',ref);
  return context;
}
