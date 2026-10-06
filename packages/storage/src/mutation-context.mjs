import { canonicalJson } from '../../contracts/src/index.mjs';

export const MUTATION_AUTHORIZATION_CONTEXT_FORMAT = 'atlas-mutation-authorization-context/1';
const sameScope=(a,b)=>a.workspaceId===b.workspaceId&&a.homeId===b.homeId;
const refOf=r=>({recordType:r.recordType,recordId:r.recordId});
const keyOf=r=>canonicalJson([r.recordType,r.recordId]);
const unique=values=>[...new Map(values.map(v=>[canonicalJson(v),v])).entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,v])=>v);
function immutable(value) {
  if(value&&typeof value==='object') {for(const child of Object.values(value)) immutable(child);Object.freeze(value);}
  return value;
}
const scopedSnapshot=(snapshot,scope)=>({...snapshot,...Object.fromEntries(
  ['sources','records','homeboxEntities','caches','networkRelations'].map(field=>[field,snapshot[field].filter(r=>sameScope(r,scope))]))});

// Matches the frozen helper's reference reads; this metadata never replaces it.
function references(payload,target,graph) {
  const refs=[],add=(recordType,recordId)=>{if(recordId) refs.push({recordType,recordId});};
  const p=payload??{};
  for(const id of p.evidenceIds??[]) add('evidence',id);
  for(const id of p.supersedesEvidenceIds??[]) add('evidence',id);
  if(p.atlasId) add('identity',p.atlasId);
  if(p.originalAssetId) add('asset',p.originalAssetId);
  if(p.previousGeometryId) add('geometry',p.previousGeometryId);
  if(p.fromBindingId) add('binding',p.fromBindingId);
  if(p.toBindingId) add('binding',p.toBindingId);
  for(const endpoint of [p.panel,p.from,p.to]) if(endpoint?.kind==='atlas-record') refs.push(refOf(endpoint.ref));
  for(const reference of p.references??[]) if(reference.kind==='atlas-asset') add('asset',reference.assetId);
  for(const mapping of p.mappings??[]) {
    add('identity',mapping.atlasId);
    for(const id of mapping.evidenceIds) add('evidence',id);
    if(mapping.reviewStatus!=='accepted'||!mapping.homeboxEntity) continue;
    const binding=graph.find(r=>r.recordType==='binding'&&sameScope(r,target)&&r.payload.atlasId===mapping.atlasId&&canonicalJson(r.payload.source)===canonicalJson(mapping.homeboxEntity.key));
    if(!binding) continue;
    const visited=new Set(),follow=b=>{
      if(visited.has(b.recordId)) return;visited.add(b.recordId);add('binding',b.recordId);
      for(const journal of graph.filter(r=>r.recordType==='reconciliation'&&sameScope(r,target)&&r.payload.fromBindingId===b.recordId)) {
        add('reconciliation',journal.recordId);add('binding',journal.payload.toBindingId);
        const next=graph.find(r=>r.recordType==='binding'&&sameScope(r,target)&&r.recordId===journal.payload.toBindingId);
        if(next) follow(next);
      }
    };follow(binding);
  }
  return unique(refs);
}
function links(record,graph) {
  const refs=references(record.payload,record,graph),sources=[],p=record.payload??{};
  if(record.recordType==='binding') {
    if(p.source) sources.push({workspaceId:record.workspaceId,homeId:record.homeId,key:p.source});
    for(const journal of graph) if(journal.recordType==='reconciliation'&&sameScope(record,journal)&&journal.payload.fromBindingId===record.recordId) refs.push(refOf(journal));
  }
  if(record.recordType==='evidence'&&p.provenance?.source) sources.push(p.provenance.source);
  for(const reference of p.references??[]) if(reference.kind==='homebox-attachment') sources.push(reference.entity);
  for(const mapping of p.mappings??[]) if(mapping.homeboxEntity) sources.push(mapping.homeboxEntity);
  return {refs:unique(refs),sources};
}
function closure(scope,original,candidate,entries,replay) {
  const submitted=entries.flatMap(({target,command})=>command.value?[{...scope,...target,recordType:command.value.recordType,payload:command.value.payload}]:[]);
  const graph=[...original.records,...(candidate?.records??[]),...submitted,...(replay?.results.map(r=>r.record)??[])];
  const selected=new Set(entries.flatMap(e=>[keyOf(e.target),...e.command.guards.map(g=>keyOf(g.record))]));
  if(replay) for(const result of replay.results) selected.add(keyOf(result.record));
  const affected=new Set(entries.map(e=>keyOf(e.target)));
  let changed=true;
  while(changed) {
    changed=false;
    const add=(ref,isAffected=false)=>{
      const key=keyOf(ref);if(!selected.has(key)){selected.add(key);changed=true;}
      if(isAffected&&!affected.has(key)){affected.add(key);changed=true;}
    };
    for(const record of graph) {
      const direct=links(record,graph);
      if(selected.has(keyOf(record))) for(const ref of direct.refs) add(ref);
      if(direct.refs.some(ref=>affected.has(keyOf(ref)))) add(record,true);
    }
  }
  const records=graph.filter(r=>selected.has(keyOf(r))),sourceRefs=unique(records.flatMap(r=>links(r,graph).sources));
  const recordRefs=[...selected].sort().map(key=>{const [recordType,recordId]=JSON.parse(key);return {recordType,recordId};});
  return {recordRefs,missingRecordRefs:recordRefs.filter(ref=>!records.some(r=>keyOf(r)===keyOf(ref))),sourceRefs,
    sourcePartitions:unique(sourceRefs.map(ref=>({workspaceId:ref.workspaceId,homeId:ref.homeId,sourceInstanceId:ref.key.sourceInstanceId,collectionId:ref.key.collectionId})))};
}
function preconditions(scope,original,entries) {
  const createdInBatch=entries.filter(e=>e.command.operation==='create').map(e=>e.target);
  return {createdInBatch,commands:entries.map(({target,command})=>{
    const current=original.records.find(r=>keyOf(r)===keyOf(target));
    const allRefs=unique([current?.payload,command.value?.payload].flatMap(p=>p?references(p,{...scope,...target},original.records):[]));
    return {target,operation:command.operation,expectedRevision:command.expectedRevision,
      current:current?{revision:current.revision,lifecycle:current.lifecycle}:null,
      requiredGuards:allRefs.filter(ref=>keyOf(ref)!==keyOf(target)&&!createdInBatch.some(created=>keyOf(created)===keyOf(ref))),
      guards:command.guards.map(guard=>({record:guard.record,expectedRevision:guard.expectedRevision,
        currentRevision:original.records.find(r=>keyOf(r)===keyOf(guard.record))?.revision??null}))};
  })};
}

/** Detached private server facts only. The actual scoped snapshots and command
 * entries belong to this active transaction; no store/connection/callback leaks. */
export function mutationAuthorizationContext({contextId,phase,scope,entries,batch,original,cachePartitions,candidate=null,replay=null}) {
  const scopedOriginal=scopedSnapshot(original,scope),scopedCandidate=candidate?scopedSnapshot(candidate,scope):null;
  return immutable(structuredClone({format:MUTATION_AUTHORIZATION_CONTEXT_FORMAT,schemaVersion:1,contextId,phase,scope,entries,
    targets:entries.map(e=>e.target),batch,original:scopedOriginal,candidate:scopedCandidate,
    cachePartitions:unique(cachePartitions.filter(partition=>sameScope(partition,scope))),
    closure:closure(scope,scopedOriginal,scopedCandidate,entries,replay),
    preconditions:['validate','candidate','precommit'].includes(phase)?preconditions(scope,scopedOriginal,entries):null,replay}));
}
