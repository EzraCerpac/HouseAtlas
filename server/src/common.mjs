import { randomUUID, createHash } from 'node:crypto';
import { ContractError, canonicalJson, validateShape } from '../../packages/contracts/src/index.mjs';
import { AccessError, errorResponse } from '../../packages/access/src/index.mjs';

export const CORE_VERSION = '0.1.1-at13.3';
export const partitionOf = r => ({workspaceId:r.workspaceId,homeId:r.homeId,sourceInstanceId:r.sourceInstanceId,collectionId:r.collectionId});
export const scopeOf = r => ({workspaceId:r.workspaceId,homeId:r.homeId});
export const keyOf = r => canonicalJson(partitionOf(r));
export const same = (a,b) => canonicalJson(a) === canonicalJson(b);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const fail = (code='invalid-contract') => { throw new ContractError(code,'Core request rejected'); };
export function exact(value,fields) {
  if (!value || Object.getPrototypeOf(value)!==Object.prototype || Object.keys(value).sort().join(',')!==[...fields].sort().join(',')) fail();
}
export function reference(registration,kind,externalId) {
  return {...scopeOf(registration),key:{sourceInstanceId:registration.sourceInstanceId,collectionId:registration.collectionId,sourceKind:kind,externalId}};
}
export const privateHeaders = {'cache-control':'private, no-store','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'same-origin','vary':'Cookie, Origin, Sec-Fetch-Site'};
export const jsonResponse = body => Response.json(body,{headers:privateHeaders});
// Only server-authorized transaction context may attach a revision. Never copy
// this field from a submitted body or a raw upstream error.
export class CorePreconditionError extends ContractError {
  constructor(code,currentRevision=null) {
    super(code,'Review the current record before issuing a new mutation');
    this.currentRevision=currentRevision;
  }
}
export function coreError(error) {
  if (error instanceof AccessError) return errorResponse(error);
  if (!(error instanceof ContractError)) return errorResponse(error);
  const status = {'unauthenticated':401,'forbidden':403,'not-found':404,'invalid-contract':422,'revision-required':428,'revision-conflict':412,'guard-conflict':412,'idempotency-conflict':409,'identity-conflict':409,'invalid-transition':409}[error.code] ?? 503;
  const currentRevision=error instanceof CorePreconditionError?error.currentRevision:null;
  const body = {schemaVersion:1,code:status===503?'upstream-unavailable':error.code,message:[412,428].includes(status)?'Review the current record before editing':status===409?'Record or cache changed':status===404?'Resource unavailable':'Request rejected',requestId:randomUUID(),currentRevision};
  validateShape('apiError',body);
  return Response.json(body,{status,headers:privateHeaders});
}
