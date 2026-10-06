import { canonicalJson } from '../../packages/contracts/src/index.mjs';
import { fail, same, CorePreconditionError } from './common.mjs';

/** Only AT07's post-receipt validate phase supplies these facts. The core does
 * not read SQLite, reconstruct a candidate or rerun old guards on exact replay. */
export function checkMutationPreconditions(context) {
  const facts=context.preconditions;
  if(!facts||facts.commands.length!==context.entries.length)fail('upstream-unavailable');
  for(let index=0;index<facts.commands.length;index++) {
    const row=facts.commands[index],entry=context.entries[index];
    if(!same(row.target,entry.target)||row.operation!==entry.command.operation||row.expectedRevision!==entry.command.expectedRevision)fail('upstream-unavailable');
    if(row.operation!=='create') {
      if(!row.current)fail('not-found');
      if(row.current.revision!==row.expectedRevision)throw new CorePreconditionError('revision-conflict',row.current.revision);
      // Preserve the frozen helper's lifecycle/exhaustion conflict ordering.
      if(row.current.revision===Number.MAX_SAFE_INTEGER||(row.operation==='restore'?row.current.lifecycle!=='tombstoned':row.current.lifecycle!=='active'))return;
    } else if(row.current)return;
    const guards=new Set();
    for(const guard of row.guards) {
      const key=canonicalJson(guard.record);if(guards.has(key))fail();guards.add(key);
      if(guard.currentRevision===null)fail('not-found');
      if(guard.currentRevision!==guard.expectedRevision)throw new CorePreconditionError('guard-conflict',guard.currentRevision);
    }
    for(const ref of row.requiredGuards)if(!guards.has(canonicalJson(ref)))throw new CorePreconditionError('revision-required',row.current?.revision??null);
  }
}
