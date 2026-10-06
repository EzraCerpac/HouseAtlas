import { canonicalJson, validateShape, ContractError } from '../../contracts/src/index.mjs';
import { errorResponse, AccessError } from '../../access/src/index.mjs';
import { MAX_BYTES, MediaError, deny, exact, timed, collect } from './bytes.mjs';
import { validateContent } from './content.mjs';
export { AssetVault } from './vault.mjs';
export { captureRecovery, verifyRecovery, restoreRecovery } from './recovery.mjs';
export { MediaError, MAX_BYTES } from './bytes.mjs';
export const MEDIA_VERSION = '0.1.1';

const same = (a,b) => { try { return canonicalJson(a) === canonicalJson(b); } catch { return false; } };
const privateHeaders = {'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'cross-origin-resource-policy':'same-origin','vary':'Cookie, Origin'};
const scopeOf = p => ({workspaceId:p.workspaceId,homeId:p.homeId});
const partitionOf = d => ({...scopeOf(d.entity),sourceInstanceId:d.entity.key.sourceInstanceId,collectionId:d.entity.key.collectionId});
function descriptorShape(d) {
  if (d?.kind === 'atlas-asset') { exact(d,['kind','assetId']); validateShape('recordRef',{recordType:'asset',recordId:d.assetId}); }
  else if (d?.kind === 'homebox-attachment') {
    exact(d,['kind','entity','attachmentId']); validateShape('sourceRef',d.entity);
    validateShape('recordRef',{recordType:'asset',recordId:d.attachmentId}); if (d.entity.key.sourceKind !== 'homebox-entity') deny();
  } else deny();
}

// No listener, arbitrary URL fetcher, provider write or browser credential API.
// The integrator supplies branded access and the authoritative storage instance.
export function createMediaService({ boundary, store, vault, providers = [], sourceEpoch, quarantineSource, timeoutMs = 10000, maxConcurrent = 4 }) {
  if (!boundary || !store || !vault || !Array.isArray(providers) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000 || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 4) throw new TypeError('Media server configuration required');
  if (providers.length && (typeof sourceEpoch !== 'function' || typeof quarantineSource !== 'function')) throw new TypeError('Source epoch and durable quarantine callbacks required');
  const configured = providers.map(provider => {
    validateShape('sourceRegistration',provider.registration);
    let url; try { url = new URL(provider.origin); } catch { throw new TypeError('Exact registered HTTPS origin required'); }
    if (provider.registration.owner !== 'homebox' || url.protocol !== 'https:' || url.origin !== provider.origin || url.username || url.password || typeof provider.readAttachment !== 'function') throw new TypeError('Bound HomeBox provider required');
    return Object.freeze({...provider,registration:structuredClone(provider.registration)});
  });
  if (new Set(configured.map(p=>canonicalJson(p.registration))).size !== configured.length) throw new TypeError('Duplicate media provider');
  let busy = 0;
  const providerFor = descriptor => {
    const partition = partitionOf(descriptor), found = configured.filter(p=>['workspaceId','homeId','sourceInstanceId','collectionId'].every(k=>p.registration[k] === partition[k]));
    if (found.length !== 1) deny(); return found[0];
  };
  const epoch = (principal,descriptor) => {
    const value = sourceEpoch(principal,partitionOf(descriptor));
    if (!Number.isSafeInteger(value) || value < 0) deny(503); return value;
  };
  function lookup(principal,descriptor) {
    descriptorShape(descriptor); boundary.revalidate(principal); const scope = scopeOf(principal);
    if (descriptor.kind === 'atlas-asset') {
      const target = {recordType:'asset',recordId:descriptor.assetId}, record = store.readRecord(principal,scope,target), manifest = store.readAssetManifest(principal,scope,target);
      if (record.lifecycle !== 'active' || manifest.availability !== 'available' || !same(manifest,record.payload)) deny();
      return {metadata:{...scope,kind:descriptor.kind,assetId:descriptor.assetId,...manifest},record,token:canonicalJson(record)};
    }
    const sourceGrant = boundary.authorizeSource(principal,descriptor.entity), provider = providerFor(descriptor), before = epoch(principal,descriptor);
    const snapshot = store.readSnapshot(principal,scope), key = descriptor.entity.key;
    const projection = snapshot.homeboxEntities.find(e=>same(e.source,key));
    const cache = snapshot.caches.find(c=>c.sourceInstanceId === key.sourceInstanceId && c.collectionId === key.collectionId);
    if (!projection || !cache || !cache.generationId || cache.status === 'access-revoked') deny();
    const attachment = projection.attachments.find(a=>a.attachmentId === descriptor.attachmentId);
    if (!attachment || attachment.kind !== 'stored-file' || !Number.isSafeInteger(attachment.byteSize) || attachment.byteSize > MAX_BYTES || !['image/png','application/pdf','text/plain'].includes(attachment.contentType)) deny();
    if (before !== epoch(principal,descriptor)) deny(409);
    boundary.revalidateSource(sourceGrant);
    const metadata = {...scope,...structuredClone(descriptor),contentType:attachment.contentType,byteSize:attachment.byteSize,availability:'available',previewPolicy:attachment.contentType === 'image/png' ? 'safe-rendered' : 'download-only'};
    return {metadata,provider,sourceUpdatedAt:projection.sourceUpdatedAt,sourceGrant,token:canonicalJson({projection,cache,epoch:before})};
  }
  function resolveMetadata(principal,descriptor) {
    try { return structuredClone(lookup(principal,descriptor).metadata); }
    catch (error) {
      if ((error instanceof ContractError && error.code === 'not-found') || (error instanceof MediaError && error.status === 404)) return null;
      throw error;
    }
  }
  function quarantine(principal,descriptor,code) {
    const result = quarantineSource(principal,partitionOf(descriptor),code);
    if (result?.then) deny(503);
    deny(404);
  }
  async function deliver(request,{scope,descriptor,mode = 'preview'}) {
    if (busy >= maxConcurrent) return new Response(JSON.stringify({error:'Media unavailable'}),{status:429,headers:{...privateHeaders,'content-type':'application/json'}});
    busy++;
    try {
      return await timed(request.signal,timeoutMs,async context => {
        if (!(request instanceof Request) || !['GET','HEAD'].includes(request.method) || !['preview','download'].includes(mode) || new URL(request.url).search || new URL(request.url).hash) deny(404);
        validateShape('scope',scope); descriptor = structuredClone(descriptor); descriptorShape(descriptor);
        const {principal} = await context.wait(boundary.authorize(request,{...scope,action:'media'})); context.check();
        const mediaGrant = await context.wait(boundary.authorizeMedia(principal,descriptor,{mode})); context.check();
        const initial = lookup(principal,descriptor);
        if (initial.metadata.contentType !== mediaGrant.contentType || initial.metadata.byteSize !== mediaGrant.byteSize) deny(409);
        let bytes;
        if (descriptor.kind === 'atlas-asset') bytes = vault.readRetained(initial.record);
        else {
          const receipt = await context.wait(initial.provider.readAttachment(Object.freeze({descriptor:structuredClone(descriptor),sourceUpdatedAt:initial.sourceUpdatedAt,method:'GET',headers:Object.freeze({'X-Tenant':descriptor.entity.key.collectionId}),redirect:'error',maxBytes:MAX_BYTES,signal:context.signal}))); context.check();
          if (receipt?.status === 401 || receipt?.status === 403) quarantine(principal,descriptor,'auth');
          if (receipt?.status === 404 || receipt?.status === 410) deny(404);
          if (!receipt || receipt.redirected !== false || receipt.status !== 200 || receipt.url !== undefined || receipt.location !== undefined) deny(503);
          if (receipt.origin !== initial.provider.origin || !same(receipt.descriptor,descriptor) || receipt.sourceUpdatedAt !== initial.sourceUpdatedAt) quarantine(principal,descriptor,'wrong-scope');
          if (receipt.contentType !== initial.metadata.contentType || (receipt.contentLength !== undefined && receipt.contentLength !== initial.metadata.byteSize)) deny(415);
          bytes = await collect(receipt.body,context);
        }
        context.check(); if (bytes.length !== initial.metadata.byteSize || bytes.length > MAX_BYTES) deny(413);
        const rendered = validateContent(bytes,initial.metadata.contentType,{check:context.check}); context.check();
        // Every awaited byte/metadata operation precedes these final checks.
        await context.wait(boundary.revalidateMedia(mediaGrant)); context.check();
        const final = lookup(principal,descriptor);
        if (initial.token !== final.token) deny(409);
        if (initial.sourceGrant) boundary.revalidateSource(initial.sourceGrant);
        boundary.revalidate(principal); context.check();
        const output = mode === 'preview' ? rendered : bytes;
        if (!output) deny(415);
        const extension = {'image/png':'png','application/pdf':'pdf','text/plain':'txt'}[initial.metadata.contentType];
        return new Response(request.method === 'HEAD' ? null : output,{status:200,headers:{...privateHeaders,'content-type':initial.metadata.contentType,'content-length':String(output.length),'content-disposition':`${mode === 'preview' ? 'inline' : 'attachment'}; filename="${mode === 'preview' ? 'preview' : 'original'}.${extension}"`}});
      });
    } catch (error) {
      if (error instanceof AccessError) return errorResponse(error);
      if (error instanceof ContractError && ['not-found','forbidden','unauthenticated','invalid-contract'].includes(error.code)) return new Response(JSON.stringify({error:'Media unavailable'}),{status:({'not-found':404,forbidden:403,unauthenticated:401,'invalid-contract':404})[error.code],headers:{...privateHeaders,'content-type':'application/json'}});
      return new Response(JSON.stringify({error:'Media unavailable'}),{status:error instanceof MediaError ? error.status : 503,headers:{...privateHeaders,'content-type':'application/json'}});
    } finally { busy--; }
  }
  return Object.freeze({resolveMetadata,deliver});
}
