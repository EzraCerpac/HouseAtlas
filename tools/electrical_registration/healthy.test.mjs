// Generated healthy examples only. No private intake, provider, listener or controls suite.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAffine, fitAffine, assessRegistration, projectInventory } from './registration.mjs';
const hash='1'.repeat(64), evidence={sha256:hash,locator:'/generated/evidence'};
const source={sheetId:'sheet',regionId:'region',originalPhotoSha256:hash,renderedPhotoSha256:hash};
const frame={workspaceId:'workspace',homeId:'home',publicationId:'publication',semanticsSha256:hash,modelSha256:hash,coordinateFrameId:'world-once',units:'m',horizontalAxes:['X','Z']};
const binding={roomId:'room',spaceOccurrenceId:'occurrence',buildingId:'building',levelId:'level',planId:'plan'};
const matrix=[4,1,-2,3,10,-5];
const landmark=(id,p)=>({id,targetLandmarkId:`target:${id}`,sourcePoint:p,targetPoint:applyAffine(matrix,p),reviewStatus:'reviewed-correspondence',sourceEvidence:{...evidence,locator:`/generated/source#${id}`},targetEvidence:{...evidence,locator:`/generated/feature#${id}`},reviewEvidence:{...evidence,locator:`/generated/review#${id}`},targetFeatureId:'feature'});
function example(){return {id:'registration',source,target:{...frame,...binding},controls:[[0,0],[1,0],[1,1],[0,1]].map((p,i)=>landmark(`fit-${i}`,p)),checks:[[0.25,0.25],[0.75,0.75]].map((p,i)=>landmark(`check-${i}`,p)),
  reviewStatus:'reviewed-approximate',layoutQualification:'Generated dated unchanged layout, 2026-10-18',reviewEvidence:evidence,
  uncertainty:{sourceXY:[0.01,0.02],targetMetres:0.03,layoutAllowanceMetres:0.04,residualLimitMetres:0.1,basis:'Generated annotation tolerances'}};}
const context={frame, sources:[source],occurrences:[{...binding,featureIds:['feature']}]};
test('healthy affine QR preserves known rotation, scale and translation with independent residuals',()=>{
  const p=example(),before=structuredClone(p),a=assessRegistration(p,context);
  assert.equal(a.status,'reviewed-approximate-scene-registration');
  a.fit.matrix.forEach((v,i)=>assert.ok(Math.abs(v-matrix[i])<1e-12));
  assert.ok(a.fit.rms<1e-12 && a.maxCheckResidual<1e-12);
  assert.equal(a.fit.mirrored,false);assert.equal(a.fit.sourceControlHull.length,4);
  assert.deepEqual(p,before);assert.equal(a.physicalRegistration,null);assert.equal(a.nativeQualified,false);
});
test('healthy overdetermined approximate fit reports actual residual and scale rather than perfect accuracy',()=>{
  const p=example();p.controls[0].targetPoint[0]+=0.04;
  const f=fitAffine(p.controls);assert.ok(f.rms>0 && f.rms<0.04);assert.ok(f.singularScales[0]>0);
  const a=assessRegistration(p,context);assert.equal(a.status,'reviewed-approximate-scene-registration');
  assert.ok(a.maxCheckResidual>0);assert.ok(a.fit.anisotropy>1);
});
test('healthy property inventory retains registered, unresolved and uncovered source marks across selections',()=>{
  const proposal=example(),a=assessRegistration(proposal,context);
  const rows=[{...source,fixtureId:'one',sourcePoint:[0.5,0.5],sourceToleranceXY:[0.02,0.03],bindings:[binding],sourceMeaning:'socket',installedCount:null},
    {...source,fixtureId:'two',sourcePoint:[0.5,0.5],bindings:[],sourceMeaning:'unresolved',installedCount:null},
    {...source,fixtureId:'three',sourcePoint:[1.2,0.5],bindings:[binding],sourceMeaning:'light',installedCount:null}];
  const before=structuredClone(rows),all=projectInventory(rows,[a],context),selected=projectInventory(rows,[a],context,{roomId:'another-room'});
  assert.deepEqual(all.counts,{inventory:3,withApproximateScenePlacement:1,withoutApproximateScenePlacement:2,surveyedPhysicalPoints:0,currentCircuits:0});
  assert.equal(selected.records.length,3);assert.ok(selected.records.every(r=>!r.highlighted));
  assert.deepEqual(selected.records.map(r=>r.placements),all.records.map(r=>r.placements));
  all.records[0].placements[0].scenePointXZ.forEach((n,i)=>assert.ok(Math.abs(n-[11,-3][i])<1e-12));
  assert.ok(all.records[0].placements[0].annotationToleranceXZ[0]>=0.21);
  assert.equal(all.records[1].sourceMeaning,'unresolved');assert.ok(all.records[2].unsupported.length>0);
  assert.deepEqual(rows,before);assert.ok(all.records.every(r=>r.physicalCoordinate===null&&r.currentCircuitId===null));
  assert.deepEqual(all.currentFrame,frame);assert.deepEqual(all.records[0].placements[0].registrationReviewEvidence,evidence);
  assert.equal(a.layoutQualification,proposal.layoutQualification);
  assert.equal(all.records[0].placements[0].layoutQualification,proposal.layoutQualification);
  assert.deepEqual(all.records[0].placements[0].registrationUncertainty,proposal.uncertainty);
  // A second fully pinned current publication has its own freshly assessed fit,
  // even while logical room/occurrence IDs remain stable.
  const nextFrame={...frame,publicationId:'publication-two',semanticsSha256:'2'.repeat(64),modelSha256:'3'.repeat(64),coordinateFrameId:'world-two-once'};
  const nextContext={...context,frame:nextFrame},nextProposal=example();nextProposal.id='registration-two';nextProposal.target={...nextFrame,...binding};
  for(const c of [...nextProposal.controls,...nextProposal.checks])c.targetEvidence={...c.targetEvidence,sha256:nextFrame.semanticsSha256};
  const nextAssessment=assessRegistration(nextProposal,nextContext),next=projectInventory(rows,[nextAssessment],nextContext,{buildingId:binding.buildingId,levelId:binding.levelId,roomId:binding.roomId});
  assert.equal(nextAssessment.status,'reviewed-approximate-scene-registration');assert.deepEqual(next.currentFrame,nextFrame);
  assert.deepEqual(next.records[0].placements[0].target,{...nextFrame,...binding});assert.equal(next.records[0].placements[0].registrationId,'registration-two');
  assert.equal(next.records.length,3);assert.equal(next.records[0].highlighted,true);assert.equal(next.counts.withApproximateScenePlacement,1);
});
test('healthy documentary-only intake explicitly enumerates pending landmark evidence without dropping inventory',()=>{
  const p=example();p.controls=[];p.checks=[];p.reviewStatus='pending';p.reviewEvidence=null;
  const a=assessRegistration(p,context);assert.equal(a.status,'withheld');assert.equal(a.fit,null);
  assert.ok(a.reasons.includes('Three spanning nondegenerate fitted controls are required'));
  const r=projectInventory([{...source,fixtureId:'documentary',sourcePoint:[0.3,0.7],bindings:[binding]}],[a],context);
  assert.equal(r.counts.inventory,1);assert.equal(r.records[0].placements.length,0);assert.equal(r.counts.withoutApproximateScenePlacement,1);
});

test('healthy reviewed nomination withdrawal retains provenance and inventory without fitting the withdrawn association',()=>{
  const p=example(),otherSource={...source,regionId:'other-region'},other=example();other.id='other-registration';other.source=otherSource;
  const base={...context,sources:[source,otherSource]},prior=assessRegistration(p,base),unrelated=assessRegistration(other,base);
  const withdrawal={id:'withdrawal',status:'invalid-nomination',source,target:{...frame,...binding},targetFeatureIds:['feature'],
    reason:'Generated reviewed correction: nominated opening does not belong to this room',evidence:{sha256:'4'.repeat(64),locator:'/generated/withdrawal-review'}};
  const current={...base,withdrawnNominations:[withdrawal]},before=structuredClone(current),proposalBefore=structuredClone(p);
  const withdrawn=assessRegistration(p,current);
  assert.equal(withdrawn.status,'withdrawn-invalid-nomination');assert.equal(withdrawn.fit,null);assert.deepEqual(withdrawn.checks,[]);
  assert.deepEqual(withdrawn.withdrawnNominations,[withdrawal]);assert.deepEqual(withdrawn.source,p.source);assert.deepEqual(withdrawn.target,p.target);
  assert.deepEqual(withdrawn.layoutQualification,p.layoutQualification);assert.deepEqual(withdrawn.uncertainty,p.uncertainty);
  const rows=[{...source,fixtureId:'withdrawn-record',sourcePoint:[0.5,0.5],bindings:[binding],sourceMeaning:'socket'},
    {...otherSource,fixtureId:'unrelated-record',sourcePoint:[0.5,0.5],bindings:[binding],sourceMeaning:'light'}];
  const rowsBefore=structuredClone(rows),r=projectInventory(rows,[prior,unrelated],current);
  assert.deepEqual(r.counts,{inventory:2,withApproximateScenePlacement:1,withoutApproximateScenePlacement:1,surveyedPhysicalPoints:0,currentCircuits:0});
  assert.equal(r.records[0].placements.length,0);assert.equal(r.records[1].placements[0].registrationId,other.id);
  const fresh=projectInventory(rows,[withdrawn,unrelated],current);
  assert.equal(fresh.records[0].placements.length,0);
  assert.equal(fresh.records[0].unsupported.length,1);
  assert.equal(fresh.records[0].unsupported[0].registrationId,p.id);
  assert.equal(fresh.records[0].unsupported[0].status,'withdrawn-invalid-nomination');
  assert.deepEqual(fresh.records[0].unsupported[0].withdrawnNominations,[withdrawal]);
  assert.deepEqual(fresh.records[0].unsupported[0].source,p.source);
  assert.deepEqual(fresh.records[0].unsupported[0].target,p.target);
  assert.equal(fresh.records[1].placements[0].registrationId,other.id);
  assert.deepEqual(rows,rowsBefore);assert.deepEqual(current,before);assert.deepEqual(p,proposalBefore);
});

test('retained withdrawal requires reconciliation after each source or target revision change',()=>{
  const withdrawal={id:'historical-withdrawal',status:'invalid-nomination',source,target:{...frame,...binding},targetFeatureIds:['feature'],
    reason:'Generated withdrawn nomination',evidence};
  const row={...source,fixtureId:'retained',sourcePoint:[0.5,0.5],bindings:[binding]};
  for(const key of ['publicationId','semanticsSha256','modelSha256','coordinateFrameId','originalPhotoSha256','renderedPhotoSha256']) {
    const p=example();p.id=`revised-${key}`;
    const nextFrame={...frame},nextSource={...source};
    const value=key.endsWith('Sha256')?'2'.repeat(64):`revised-${key}`;
    if(key in nextFrame)nextFrame[key]=value;else nextSource[key]=value;
    p.source=nextSource;p.target={...nextFrame,...binding};
    for(const c of [...p.controls,...p.checks]){
      c.sourceEvidence={...c.sourceEvidence,sha256:nextSource.originalPhotoSha256};
      c.targetEvidence={...c.targetEvidence,sha256:nextFrame.semanticsSha256};
    }
    const revised={frame:nextFrame,sources:[nextSource],occurrences:context.occurrences};
    // Without the retained history this numerically valid candidate is accepted.
    const prior=assessRegistration(p,revised);
    assert.equal(prior.status,'reviewed-approximate-scene-registration',key);
    const current={...revised,withdrawnNominations:[withdrawal]};
    const a=assessRegistration(p,current);
    assert.equal(a.status,'withheld-withdrawal-reconciliation',key);
    assert.equal(a.fit,null);assert.deepEqual(a.withdrawnNominations,[withdrawal]);
    const result=projectInventory([{...row,...nextSource}],[prior],current);
    assert.equal(result.records.length,1);assert.equal(result.records[0].placements.length,0,key);
    assert.deepEqual(result.records[0].unsupported[0].withdrawnNominations,[withdrawal]);
    // Exercise the normal assess-then-project path, whose fit is null, rather
    // than supplying only a cached accepted assessment to the projector.
    const freshRow={...row,...nextSource},unboundRow={...freshRow,fixtureId:'unbound',bindings:[]};
    const freshRows=[freshRow,unboundRow],before=structuredClone({freshRows,a,current});
    const fresh=projectInventory(freshRows,[a],current,{roomId:'another-room'});
    assert.equal(fresh.counts.inventory,2);assert.equal(fresh.counts.withApproximateScenePlacement,0);
    assert.equal(fresh.records[0].placements.length,0);assert.equal(fresh.records[0].highlighted,false);
    assert.deepEqual(fresh.records[0].unsupported,[{
      registrationId:p.id,status:'withheld-withdrawal-reconciliation',
      reason:'Retained invalid nomination requires withdrawal or revision reconciliation',
      reasons:a.reasons,source:p.source,target:p.target,targetFeatureIds:a.targetFeatureIds,withdrawnNominations:[withdrawal]
    }]);
    assert.equal(fresh.records[1].unsupported[0].registrationId,null);
    assert.ok(!('withdrawnNominations' in fresh.records[1].unsupported[0]));
    assert.ok(fresh.records.every(r=>r.placements.length===0&&r.physicalCoordinate===null&&r.nativeQualified===false));
    assert.deepEqual({freshRows,a,current},before);
  }
});

test('cached assessment loses placement on every changed current identity while retaining inventory',()=>{
  const a=assessRegistration(example(),context),row={...source,fixtureId:'retained',sourcePoint:[0.5,0.5],bindings:[binding]};
  for(const key of ['workspaceId','homeId','publicationId','semanticsSha256','modelSha256','coordinateFrameId',
    'sheetId','regionId','originalPhotoSha256','renderedPhotoSha256',...Object.keys(binding),'featureIds']) {
    const current=structuredClone(context);
    if(key in frame)current.frame[key]=key.endsWith('Sha256')?'2'.repeat(64):`changed-${key}`;
    else if(key in source)current.sources[0][key]=key.endsWith('Sha256')?'2'.repeat(64):`changed-${key}`;
    else current.occurrences[0][key]=key==='featureIds'?['different-feature']:`changed-${key}`;
    const r=projectInventory([row],[a],current);
    assert.equal(r.counts.inventory,1,key);assert.equal(r.records[0].placements.length,0,key);
    assert.deepEqual(r.records[0].sourcePoint,row.sourcePoint);assert.equal(r.records[0].nativeQualified,false);
  }
});

test('source uncertainty must fit entirely within control coverage including slanted edges',()=>{
  const p=example();p.controls=[[0,0],[1,0],[0,1]].map((v,i)=>landmark(`triangle-${i}`,v));
  p.checks=[[0.2,0.2],[0.4,0.3]].map((v,i)=>landmark(`check-${i}`,v));
  const a=assessRegistration(p,context);assert.equal(a.status,'reviewed-approximate-scene-registration');
  const rows=[[0.3,0.3],[0.49,0.49],[0.6,0.6]].map((sourcePoint,i)=>({...source,fixtureId:`coverage-${i}`,sourcePoint,bindings:[binding]}));
  const r=projectInventory(rows,[a],context);
  assert.equal(r.records[0].placements.length,1);
  assert.equal(r.records[1].placements.length,0);assert.match(r.records[1].unsupported[0].reason,/uncertainty/);
  assert.equal(r.records[2].placements.length,0);assert.match(r.records[2].unsupported[0].reason,/outside/);
  const larger=projectInventory([{...rows[0],sourceToleranceXY:[0.5,0.5]}],[a],context);
  assert.equal(larger.records[0].placements.length,0);
  for(const sourceToleranceXY of [null,[0.1],[-1,0],[NaN,0],[Infinity,0]])
    assert.throws(()=>projectInventory([{...rows[0],sourceToleranceXY}],[a],context),/finite nonnegative pair/);
});
