import { same, fail } from './common.mjs';
const sameEvidenceMembership=(before,after)=>same([...new Set(before)].sort(),[...new Set(after)].sort());

/** Parent/AT02 conservative extraction from authoritative transaction records.
 * Review acceptance alone and unchanged retained observations are separate.
 * This function creates no observation, provenance field or authority handle. */
export function newSourcePresenceClaims(context) {
  if(!['candidate','precommit'].includes(context.phase))return [];
  if(!context.candidate)fail('upstream-unavailable');
  return context.entries.flatMap(({target,command})=> {
    if(target.recordType!=='binding')return [];
    const matches=row=>row.recordType==='binding'&&row.recordId===target.recordId;
    const next=context.candidate.records.find(matches),prior=context.original.records.find(matches);
    if(!next||next.lifecycle!=='active'||next.payload.sourceState!=='present')return [];
    const asserted=command.operation==='create'||command.operation==='restore'||prior?.payload.sourceState!=='present'||!sameEvidenceMembership(prior.payload.evidenceIds,next.payload.evidenceIds);
    return asserted?[next]:[];
  });
}

/** Schema1 has no durable typed generation/epoch witness. AT07/AT02 own the
 * additive atomic successor. Until its reviewed composition, fail closed before
 * writes rather than treating a source grant as proof of observed presence. */
export function holdNewSourcePresence(context) {
  if(newSourcePresenceClaims(context).length)fail('upstream-unavailable');
}
