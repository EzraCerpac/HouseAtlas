import { randomUUID } from 'node:crypto';
import { CONTRACT_VERSION, canonicalJson, validateShape } from '../../packages/contracts/src/index.mjs';
import { CorePreconditionError, fail, sha256, scopeOf } from './common.mjs';
import { publicHomeboxProjection } from './public-dto.mjs';

export const canonicalPrefix=scope=>'/api/atlas/v1/workspaces/'+scope.workspaceId+'/homes/'+scope.homeId;

// Authentication/body bounds precede this classification. Actual revisions and
// required referenced guards are checked inside the storage transaction.
export function requireMutationPreconditions(command) {
  if(!command || Object.getPrototypeOf(command)!==Object.prototype)fail();
  if(!Object.hasOwn(command,'expectedRevision')||!Object.hasOwn(command,'guards'))throw new CorePreconditionError('revision-required');
  if(Array.isArray(command.guards)&&command.guards.some(g=>g&&Object.getPrototypeOf(g)===Object.prototype&&!Object.hasOwn(g,'expectedRevision')))throw new CorePreconditionError('revision-required');
  validateShape('mutation',command);
  return command;
}

export function requireBatchPreconditions(batch) {
  if(batch&&Array.isArray(batch.commands))for(const entry of batch.commands)requireMutationPreconditions(entry?.command);
  return validateShape('batchMutation',batch);
}

/** Bounded, process-local opaque cursors. Bind to the current session, actor,
 * scope, collection, limit and authorized snapshot; never encode source data. */
export function createReadPages({now=Date.now,maxCursors=1000,cursorLifetimeMs=300000}={}) {
  const cursors=new Map();
  return function readPage(request,principal,collection,snapshot) {
    const params=new URL(request.url).searchParams;
    if([...params.keys()].some(k=>!['limit','cursor'].includes(k))||['limit','cursor'].some(k=>params.getAll(k).length>1))fail();
    const limitText=params.get('limit')??'50';
    if(!/^(?:[1-9][0-9]?|100)$/.test(limitText))fail();
    const limit=Number(limitText),field={records:'records','homebox/entities':'homeboxEntities','network/relations':'networkRelations'}[collection];
    if(!field)fail();
    const items=snapshot[field].map(item=>field==='homeboxEntities'?publicHomeboxProjection(item):structuredClone(item));
    const sourceStatuses=structuredClone(snapshot.caches);
    const context={...scopeOf(principal),actorId:principal.actorId,session:sha256(request.headers.get('cookie')??''),collection,limit,digest:sha256(canonicalJson({items,sourceStatuses}))};
    let offset=0;
    const cursor=params.get('cursor'),time=now();
    for(const [key,value] of cursors)if(value.expiresAt<=time)cursors.delete(key);
    if(cursor!==null) {
      const saved=cursors.get(cursor);
      if(!saved||saved.expiresAt<=time||canonicalJson(saved.context)!==canonicalJson(context))fail();
      offset=saved.offset;
    }
    let nextCursor=null;
    if(offset+limit<items.length) {
      while(cursors.size>=maxCursors)cursors.delete(cursors.keys().next().value);
      nextCursor=randomUUID();cursors.set(nextCursor,{context,offset:offset+limit,expiresAt:time+cursorLifetimeMs});
    }
    return {contractVersion:CONTRACT_VERSION,items:items.slice(offset,offset+limit),nextCursor,sourceStatuses};
  };
}
