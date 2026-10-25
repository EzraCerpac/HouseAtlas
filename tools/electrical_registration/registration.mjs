/** Offline mathematical registration only. No filesystem, transport, native receipt or UI. */
const finite = n => typeof n === 'number' && Number.isFinite(n);
const point = p => Array.isArray(p) && p.length === 2 && p.every(finite);
const sha = s => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const need = (v, message) => { if (!v) throw new TypeError(message); };
const text = s => typeof s === 'string' && s.length > 0;
const copy = v => structuredClone(v);
const pinEqual = (a, b, keys) => keys.every(k => a?.[k] === b?.[k]);
const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function hull(points) {
  const sorted = points.map(p => [...p]).sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const half = ps => { const out=[]; for (const p of ps) { while(out.length>1 && cross(out.at(-2),out.at(-1),p)<=0) out.pop(); out.push(p); } return out; };
  const lo=half(sorted), hi=half([...sorted].reverse()); return [...lo.slice(0,-1),...hi.slice(0,-1)];
}
function inside(p, polygon) { return polygon.length>=3 && polygon.every((a,i)=>cross(a,polygon[(i+1)%polygon.length],p)>=-1e-12); }
export function applyAffine(matrix, p) {
  need(Array.isArray(matrix) && matrix.length===6 && matrix.every(finite) && point(p),'Finite affine matrix and point required');
  const [a,b,c,d,e,f]=matrix; return [a*p[0]+c*p[1]+e,b*p[0]+d*p[1]+f];
}
/** Modified Gram-Schmidt QR; no corner/bounds fitting or inferred correspondences. */
export function fitAffine(controls) {
  need(Array.isArray(controls) && controls.length<=64,'At most 64 explicit controls');
  for(const c of controls) need(text(c.id) && point(c.sourcePoint) && point(c.targetPoint),'Named finite control pairs required');
  if(controls.length<3) return null;
  const columns=[controls.map(c=>c.sourcePoint[0]),controls.map(c=>c.sourcePoint[1]),controls.map(()=>1)], q=[], r=Array.from({length:3},()=>[0,0,0]);
  for(let j=0;j<3;j++) {
    const v=[...columns[j]];
    for(let k=0;k<j;k++) { r[k][j]=q[k].reduce((s,n,i)=>s+n*v[i],0); for(let i=0;i<v.length;i++)v[i]-=r[k][j]*q[k][i]; }
    r[j][j]=Math.hypot(...v); if(r[j][j]<1e-12)return null; q[j]=v.map(n=>n/r[j][j]);
  }
  const solve=axis=>{const z=q.map(col=>col.reduce((s,n,i)=>s+n*controls[i].targetPoint[axis],0)), x=[0,0,0];
    for(let j=2;j>=0;j--)x[j]=(z[j]-r[j].reduce((s,n,k)=>s+(k>j?n*x[k]:0),0))/r[j][j]; return x;};
  const x=solve(0), y=solve(1), matrix=[x[0],y[0],x[1],y[1],x[2],y[2]];
  if(!matrix.every(finite))return null;
  const residuals=controls.map(c=>({id:c.id,distance:Math.hypot(...applyAffine(matrix,c.sourcePoint).map((n,i)=>n-c.targetPoint[i]))}));
  const [a,b,c,d]=matrix, det=a*d-b*c, trace=a*a+b*b+c*c+d*d, disc=Math.sqrt(Math.max(0,trace*trace-4*det*det));
  const scales=[Math.sqrt(Math.max(0,(trace-disc)/2)),Math.sqrt((trace+disc)/2)];
  return {matrix, residuals, rms:Math.hypot(...residuals.map(r=>r.distance))/Math.sqrt(controls.length), maxResidual:Math.max(...residuals.map(r=>r.distance)),
    determinant:det, mirrored:det<0, singularScales:scales, anisotropy:scales[0]>0?scales[1]/scales[0]:null, sourceControlHull:hull(controls.map(c=>c.sourcePoint))};
}
const frameKeys=['workspaceId','homeId','publicationId','semanticsSha256','modelSha256','coordinateFrameId','units','horizontalAxes'];
const sourceKeys=['sheetId','regionId','originalPhotoSha256','renderedPhotoSha256'];
const bindingKeys=['roomId','spaceOccurrenceId','buildingId','levelId','planId'];
const validSource=s=>s && ['sheetId','regionId'].every(k=>text(s[k])) && ['originalPhotoSha256','renderedPhotoSha256'].every(k=>sha(s[k]));
const validBinding=b=>b && bindingKeys.every(k=>text(b[k]));
const validFrame=f=>f && ['workspaceId','homeId','publicationId','coordinateFrameId'].every(k=>text(f[k])) && ['semanticsSha256','modelSha256'].every(k=>sha(f[k])) && f.units==='m' && JSON.stringify(f.horizontalAxes)==='["X","Z"]';
function sameFrame(a,b) { return validFrame(a) && validFrame(b) && frameKeys.every(k=>JSON.stringify(a[k])===JSON.stringify(b[k])); }
function sameSource(a,b) { return validSource(a) && validSource(b) && pinEqual(a,b,sourceKeys); }
function sameBinding(a,b) { return validBinding(a) && validBinding(b) && pinEqual(a,b,bindingKeys); }
function validateContext(context) {
  need(context && validFrame(context.frame) && Array.isArray(context.sources) && context.sources.every(validSource) && Array.isArray(context.occurrences),'Explicit complete current publication/frame and source context required');
  need(context.occurrences.every(o=>validBinding(o)&&Array.isArray(o.featureIds)&&o.featureIds.every(text)),'Complete current room/occurrence/building/level/plan and feature IDs required');
  need(new Set(context.occurrences.map(o=>JSON.stringify(bindingKeys.map(k=>o[k])))).size===context.occurrences.length,'Unique current occurrence/plan bindings required');
  const withdrawals=context.withdrawnNominations===undefined?[]:context.withdrawnNominations;
  need(Array.isArray(withdrawals)&&withdrawals.length<=256,'Bounded explicit nomination withdrawals required');
  need(withdrawals.every(w=>text(w.id)&&w.id.length<=256&&w.status==='invalid-nomination'&&validSource(w.source)
    &&validFrame(w.target)&&validBinding(w.target)&&Array.isArray(w.targetFeatureIds)&&w.targetFeatureIds.length>0&&w.targetFeatureIds.length<=32
    &&w.targetFeatureIds.every(text)&&new Set(w.targetFeatureIds).size===w.targetFeatureIds.length
    &&text(w.reason)&&w.reason.length<=4096&&evidence(w.evidence)),'Pinned source/target/feature withdrawal evidence required');
  need(new Set(withdrawals.map(w=>w.id)).size===withdrawals.length,'Unique nomination withdrawal identities required');
}
function evidence(e) { return e && sha(e.sha256) && text(e.locator); }
function nominationWithdrawals(context,source,target,featureIds) {
  return (context.withdrawnNominations??[]).filter(w=>{
    if(!sameBinding(w.target,target)||!pinEqual(w.target,target,['workspaceId','homeId'])
      ||!pinEqual(w.source,source,['sheetId','regionId']))return false;
    // Revision changes cannot reconcile a retained invalid nomination. Keep the
    // original evidence pinned, without claiming it describes the new geometry.
    if(!sameSource(w.source,source)||!sameFrame(w.target,target))return true;
    return w.targetFeatureIds.some(id=>featureIds.includes(id));
  });
}
/** Context is an independently supplied offline observation, never a native grant.
 * Incomplete but well-formed evidence is retained as a withheld registration. */
export function assessRegistration(proposal, context) {
  need(proposal && text(proposal.id) && Array.isArray(proposal.controls) && Array.isArray(proposal.checks),'Explicit proposal and control/check arrays required');
  validateContext(context);
  need(validSource(proposal.source),'Exact source IDs and SHA-256 pins required');
  need(validFrame(proposal.target)&&validBinding(proposal.target),'Exact current target IDs, frame and SHA-256 pins required');
  const all=[...proposal.controls,...proposal.checks];
  need(all.length<=128,'At most 128 total landmarks');
  for(const c of all) need(text(c.id)&&text(c.targetLandmarkId)&&point(c.sourcePoint)&&point(c.targetPoint),'Named source/target landmarks and finite pairs required');
  const targetFeatureIds=[...new Set(all.map(c=>c.targetFeatureId))];
  const withdrawals=nominationWithdrawals(context,proposal.source,proposal.target,targetFeatureIds);
  const pendingReconciliation=withdrawals.some(w=>!sameSource(w.source,proposal.source)||!sameFrame(w.target,proposal.target));
  if(withdrawals.length) return {id:proposal.id,status:pendingReconciliation?'withheld-withdrawal-reconciliation':'withdrawn-invalid-nomination',reasons:[...withdrawals.map(w=>w.reason),...(pendingReconciliation?['Retained invalid nomination requires explicit owner reconciliation after source or target revision change']:[])],
    source:copy(proposal.source),target:copy(proposal.target),reviewEvidence:copy(proposal.reviewEvidence??null),
    layoutQualification:copy(proposal.layoutQualification??null),targetFeatureIds,targetLandmarkIds:all.map(c=>c.targetLandmarkId),
    fit:null,checks:[],maxCheckResidual:null,uncertainty:copy(proposal.uncertainty??null),withdrawnNominations:copy(withdrawals),
    physicalRegistration:null,nativeQualified:false};
  const reasons=[], add=s=>reasons.push(s), fit=fitAffine(proposal.controls);
  if(!sameFrame(proposal.target,context.frame))add('Current publication, model or coordinate-frame pins differ');
  if(proposal.target.units!=='m' || JSON.stringify(proposal.target.horizontalAxes)!=='["X","Z"]')add('Target must explicitly use scene XZ metres');
  if(!context.sources.some(s=>sameSource(s,proposal.source)))add('Exact source sheet/region/photo tuple unavailable');
  const occurrence=context.occurrences.find(o=>sameBinding(o,proposal.target));
  if(!occurrence)add('Exact current room/occurrence/building/level/plan tuple unavailable');
  if(new Set(all.map(c=>c.id)).size!==all.length)add('Landmark identities are not independent');
  if(new Set(all.map(c=>c.targetLandmarkId)).size!==all.length)add('Target landmark identities are not independent');
  if(proposal.checks.length<2)add('Two independent held-out landmarks are required');
  if(new Set(proposal.checks.map(c=>JSON.stringify(c.sourcePoint))).size!==proposal.checks.length)add('Held-out source locations must differ from each other');
  if(proposal.checks.some(c=>proposal.controls.some(f=>JSON.stringify(f.sourcePoint)===JSON.stringify(c.sourcePoint))))add('Held-out source locations must differ from fitted locations');
  if(new Set(proposal.checks.map(c=>JSON.stringify(c.targetPoint))).size!==proposal.checks.length)add('Held-out target locations must differ from each other');
  if(proposal.checks.some(c=>proposal.controls.some(f=>JSON.stringify(f.targetPoint)===JSON.stringify(c.targetPoint))))add('Held-out target locations must differ from fitted locations');
  if(!fit || !finite(fit.determinant) || Math.abs(fit.determinant)<1e-12)add('Three spanning nondegenerate fitted controls are required');
  for(const c of all) {
    if(c.sourcePoint.some(n=>n<0||n>1))add(`Landmark ${c.id} is outside normalized source coordinates`);
    if(c.reviewStatus!=='reviewed-correspondence' || !evidence(c.sourceEvidence) || !evidence(c.targetEvidence) || !evidence(c.reviewEvidence))add(`Landmark ${c.id} lacks reviewed source/target correspondence evidence`);
    if(c.sourceEvidence?.sha256!==proposal.source.originalPhotoSha256 && c.sourceEvidence?.sha256!==proposal.source.renderedPhotoSha256)add(`Landmark ${c.id} source evidence does not pin the registered photo`);
    if(c.targetEvidence?.sha256!==proposal.target.semanticsSha256 && c.targetEvidence?.sha256!==proposal.target.modelSha256)add(`Landmark ${c.id} target evidence does not pin the current geometry`);
    if(!occurrence?.featureIds.includes(c.targetFeatureId))add(`Landmark ${c.id} target feature is outside the bound plan`);
  }
  if(!text(proposal.layoutQualification) || !evidence(proposal.reviewEvidence) || proposal.reviewStatus!=='reviewed-approximate')add('Dated layout qualification and explicit approximate registration review required');
  const uncertainty=proposal.uncertainty;
  if(!uncertainty || !point(uncertainty.sourceXY) || uncertainty.sourceXY.some(n=>n<0) || ![uncertainty.targetMetres,uncertainty.layoutAllowanceMetres,uncertainty.residualLimitMetres].every(n=>finite(n)&&n>=0) || !text(uncertainty.basis))add('Explicit source, target, layout and residual tolerances required');
  const checks=fit?proposal.checks.map(c=>({id:c.id,distance:Math.hypot(...applyAffine(fit.matrix,c.sourcePoint).map((n,i)=>n-c.targetPoint[i]))})):[];
  const maxCheckResidual=checks.length?Math.max(...checks.map(c=>c.distance)):null;
  if(fit && uncertainty && finite(uncertainty.residualLimitMetres) && Math.max(fit.maxResidual,maxCheckResidual??0)>uncertainty.residualLimitMetres)add('Observed fitted/held-out residual exceeds declared tolerance');
  return {id:proposal.id,status:reasons.length?'withheld':'reviewed-approximate-scene-registration',reasons:[...new Set(reasons)],source:copy(proposal.source),target:copy(proposal.target),
    reviewEvidence:copy(proposal.reviewEvidence??null),layoutQualification:copy(proposal.layoutQualification??null),targetFeatureIds:[...new Set(all.map(c=>c.targetFeatureId))],
    targetLandmarkIds:all.map(c=>c.targetLandmarkId),fit,checks,maxCheckResidual,uncertainty:copy(uncertainty??null),physicalRegistration:null,nativeQualified:false};
}
/** Preserve every inventory row; selection only adds highlight state. No circuit,
 * height, installed-count or surveyed physical-coordinate inference. */
export function projectInventory(records, assessments, currentContext, selection={}) {
  need(Array.isArray(records)&&records.length<=10000&&Array.isArray(assessments),'Bounded inventory and explicit assessments required');
  validateContext(currentContext);
  need(assessments.every(a=>text(a.id))&&new Set(assessments.map(a=>a.id)).size===assessments.length,'Unique explicit registration transform IDs required');
  need(new Set(records.map(r=>r.fixtureId)).size===records.length,'Unique inventory identities required');
  const output=records.map(row=>{
    need(text(row.fixtureId)&&point(row.sourcePoint)&&Array.isArray(row.bindings),'Explicit source point and bindings required');
    need(row.sourceToleranceXY===undefined||(point(row.sourceToleranceXY)&&row.sourceToleranceXY.every(n=>n>=0)),'Explicit row tolerance must be a finite nonnegative pair');
    need(row.physicalCoordinate==null&&row.currentCircuitId==null&&row.wireRoute==null&&row.heightMetres==null,'Known physical/circuit facts require a separate contract; they cannot be overwritten by this documentary projector');
    const placements=[], unsupported=[];
    const matches=assessments.filter(a=>{
      if(a.status!=='reviewed-approximate-scene-registration'||!sameFrame(a.target,currentContext.frame)||!sameSource(a.source,row)||!currentContext.sources.some(s=>sameSource(s,a.source)))return false;
      if(!Array.isArray(a.targetFeatureIds))return false;
      const withdrawals=nominationWithdrawals(currentContext,a.source,a.target,a.targetFeatureIds);
      if(withdrawals.length){
        if(row.bindings.some(b=>sameBinding(a.target,b)))unsupported.push({registrationId:a.id,reason:'Retained invalid nomination requires withdrawal or revision reconciliation',withdrawnNominations:copy(withdrawals)});
        return false;
      }
      const occurrence=currentContext.occurrences.find(o=>sameBinding(o,a.target));
      return occurrence && evidence(a.reviewEvidence) && text(a.layoutQualification) && Array.isArray(a.targetFeatureIds) && a.targetFeatureIds.every(id=>occurrence.featureIds.includes(id))
        && row.bindings.some(b=>sameBinding(a.target,b));
    });
    for(const a of matches) {
      if(!inside(row.sourcePoint,a.fit.sourceControlHull)){unsupported.push({registrationId:a.id,reason:'Source point lies outside fitted-control coverage'});continue;}
      const [aa,b,c,d]=a.fit.matrix,u=a.uncertainty;
      const residual=Math.max(a.fit.maxResidual,a.maxCheckResidual), extra=u.targetMetres+u.layoutAllowanceMetres+residual;
      const sourceTolerance=point(row.sourceToleranceXY)?row.sourceToleranceXY:u.sourceXY;
      need(sourceTolerance.every(n=>n>=0),'Nonnegative source annotation tolerance required');
      const tolerance=sourceTolerance.map((n,i)=>Math.max(n,u.sourceXY[i]));
      // A convex hull covers the entire annotation rectangle only when all
      // four corners are covered. A centre inside the hull is insufficient.
      const covered=[-1,1].every(x=>[-1,1].every(y=>inside([row.sourcePoint[0]+x*tolerance[0],row.sourcePoint[1]+y*tolerance[1]],a.fit.sourceControlHull)));
      if(!covered){unsupported.push({registrationId:a.id,reason:'Source annotation uncertainty extends outside fitted-control coverage'});continue;}
      placements.push({registrationId:a.id,registrationReviewEvidence:copy(a.reviewEvidence),layoutQualification:copy(a.layoutQualification),registrationUncertainty:copy(a.uncertainty),target:copy(a.target),targetFeatureIds:copy(a.targetFeatureIds),scenePointXZ:applyAffine(a.fit.matrix,row.sourcePoint),
        annotationToleranceXZ:[Math.abs(aa)*tolerance[0]+Math.abs(c)*tolerance[1]+extra,Math.abs(b)*tolerance[0]+Math.abs(d)*tolerance[1]+extra],
        qualification:'reviewed approximate source alignment; tolerance is not surveyed accuracy',physicalCoordinate:null});
    }
    if(!matches.length)unsupported.push({registrationId:null,reason:'No reviewed registration matching the explicit current publication/model/frame, source and complete occurrence binding'});
    const highlighted=row.bindings.some(b=>Object.entries(selection).every(([k,v])=>v==null||b[k]===v));
    return {...copy(row),placements,unsupported,highlighted,physicalCoordinate:null,currentCircuitId:null,wireRoute:null,heightMetres:null,nativeQualified:false};
  });
  return {profile:'houseatlas.electrical-registration-candidates.v1',currentFrame:copy(currentContext.frame),records:output,counts:{inventory:output.length,withApproximateScenePlacement:output.filter(r=>r.placements.length).length,
    withoutApproximateScenePlacement:output.filter(r=>!r.placements.length).length,surveyedPhysicalPoints:0,currentCircuits:0},availabilityScope:'property-wide; selection highlights only'};
}
