// Generated healthy examples only. No private intake, provider, listener or controls suite.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAffine, fitAffine, assessRegistration, projectInventory } from './registration.mjs';
const hash='1'.repeat(64), evidence={sha256:hash,locator:'/generated/evidence'};
const source={sheetId:'sheet',regionId:'region',originalPhotoSha256:hash,renderedPhotoSha256:hash};
const frame={workspaceId:'workspace',homeId:'home',publicationId:'publication',semanticsSha256:hash,modelSha256:hash,coordinateFrameId:'world-once',units:'m',horizontalAxes:['X','Z']};
const binding={roomId:'room',spaceOccurrenceId:'occurrence',buildingId:'building',levelId:'level',planId:'plan'};
const matrix=[4,1,-2,3,10,-5];
const landmark=(id,p)=>({id,sourcePoint:p,targetPoint:applyAffine(matrix,p),reviewStatus:'reviewed-correspondence',sourceEvidence:evidence,targetEvidence:evidence,reviewEvidence:evidence,targetFeatureId:'feature'});
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
  const a=assessRegistration(example(),context);
  const rows=[{...source,fixtureId:'one',sourcePoint:[0.5,0.5],sourceToleranceXY:[0.02,0.03],bindings:[binding],sourceMeaning:'socket',installedCount:null},
    {...source,fixtureId:'two',sourcePoint:[0.5,0.5],bindings:[],sourceMeaning:'unresolved',installedCount:null},
    {...source,fixtureId:'three',sourcePoint:[1.2,0.5],bindings:[binding],sourceMeaning:'light',installedCount:null}];
  const before=structuredClone(rows),all=projectInventory(rows,[a]),selected=projectInventory(rows,[a],{roomId:'another-room'});
  assert.deepEqual(all.counts,{inventory:3,withApproximateScenePlacement:1,withoutApproximateScenePlacement:2,surveyedPhysicalPoints:0,currentCircuits:0});
  assert.equal(selected.records.length,3);assert.ok(selected.records.every(r=>!r.highlighted));
  assert.deepEqual(selected.records.map(r=>r.placements),all.records.map(r=>r.placements));
  all.records[0].placements[0].scenePointXZ.forEach((n,i)=>assert.ok(Math.abs(n-[11,-3][i])<1e-12));
  assert.ok(all.records[0].placements[0].annotationToleranceXZ[0]>=0.21);
  assert.equal(all.records[1].sourceMeaning,'unresolved');assert.ok(all.records[2].unsupported.length>0);
  assert.deepEqual(rows,before);assert.ok(all.records.every(r=>r.physicalCoordinate===null&&r.currentCircuitId===null));
});
test('healthy documentary-only intake explicitly enumerates pending landmark evidence without dropping inventory',()=>{
  const p=example();p.controls=[];p.checks=[];p.reviewStatus='pending';p.reviewEvidence=null;
  const a=assessRegistration(p,context);assert.equal(a.status,'withheld');assert.equal(a.fit,null);
  assert.ok(a.reasons.includes('Three spanning nondegenerate fitted controls are required'));
  const r=projectInventory([{...source,fixtureId:'documentary',sourcePoint:[0.3,0.7],bindings:[binding]}],[a]);
  assert.equal(r.counts.inventory,1);assert.equal(r.records[0].placements.length,0);assert.equal(r.counts.withoutApproximateScenePlacement,1);
});
