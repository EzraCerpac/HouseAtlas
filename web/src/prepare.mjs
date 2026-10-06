import { validateSnapshot } from '../../packages/contracts/src/index.mjs';
import { entityKey, cacheKey, sameScope, sourceState, safeMediaUrl, safeWebUrl } from './model.mjs';

/** Server-only seam. Call AFTER verifying the principal/home in AT-11.
 * authorization is an internal decision, never a browser-supplied object.
 * Navigation/media/hints are independently scoped server capabilities.
 */
export function prepareAtlasView(snapshot, { authorization, homeLabel, homes = [], now = new Date().toISOString(), media = [], hints = [], navigation = [] }) {
  const denied = status => ({ status, homes: [], entries: [], caches: [], network: [], canEdit: false });
  if (!authorization?.allowed) return denied(['expired','revoked'].includes(authorization?.reason) ? authorization.reason : 'denied');
  const scope = {workspaceId: authorization.workspaceId, homeId: authorization.homeId};
  validateSnapshot(snapshot);
  const registrations = snapshot.sources.filter(s => sameScope(s, scope));
  const scopedCaches = snapshot.caches.filter(c => sameScope(c, scope));
  const cacheFor = source => scopedCaches.find(c => cacheKey(c) === cacheKey(source));
  const sourceDenied = source => cacheFor(source)?.status === 'access-revoked';
  const caches = scopedCaches.map(c => {
    const owner = registrations.find(s => s.sourceInstanceId === c.sourceInstanceId && s.collectionId === c.collectionId)?.owner;
    // A source quarantine is independent of home authorization. Emit only a
    // generic status marker for that partition, without its saved evidence.
    if (c.status === 'access-revoked') return {owner, status:'access-revoked', displayStatus:'access-revoked'};
    return {...c, error:c.error ? {code:c.error.code,at:c.error.at} : null, owner, displayStatus:sourceState(c,now)};
  });
  const entries = snapshot.homeboxEntities.filter(p => sameScope(p, scope)).filter(p => {
    if (sourceDenied(p.source)) return false;
    const cache = cacheFor(p.source);
    return cache?.lastSuccessfulFetchAt && cache.generationId;
  }).map(p => {
    const key = entityKey(p), cache = cacheFor(p.source);
    const bindings = snapshot.records.filter(r => sameScope(r, scope) && r.recordType === 'binding' && r.lifecycle === 'active' && r.payload.reviewStatus === 'accepted' && entityKey({source:r.payload.source}) === key);
    const binding = bindings[0];
    const semantic = binding && snapshot.records.find(r => sameScope(r, scope) && r.recordType === 'location-semantics' && r.lifecycle === 'active' && r.payload.reviewStatus === 'accepted' && r.payload.atlasId === binding.payload.atlasId);
    const hint = hints.find(h => sameScope(h.entity, scope) && entityKey({source:h.entity.key}) === key && h.reviewed === true);
    const capabilities = navigation.filter(l => sameScope(l.entity, scope) && entityKey({source:l.entity.key}) === key);
    const networkBindings = binding ? snapshot.records.filter(r => sameScope(r, scope) && r.recordType === 'binding' && r.lifecycle === 'active' && r.payload.reviewStatus === 'accepted' && r.payload.atlasId === binding.payload.atlasId && r.payload.source.sourceKind === 'network-device') : [];
    const allowedNetworkBindings = networkBindings.filter(b => b.payload.sourceState === 'present' && !sourceDenied(b.payload.source));
    const networkStates = [...new Set(allowedNetworkBindings.map(b => sourceState(cacheFor(b.payload.source),now)))];
    return {
      ...p, key, kind: p.entity.entityType === null ? 'unknown' : p.entity.entityType.isLocation ? 'place' : 'item',
      semanticKind: semantic?.payload.semanticKind || 'unclassified',
      sourceState: binding?.payload.sourceState || 'unreviewed', cacheStatus: sourceState(cache,now),
      aliases: Array.isArray(hint?.aliases) ? hint.aliases.filter(a => typeof a === 'string') : [],
      mobility: hint?.mobility === 'mobile' ? 'mobile' : 'unknown',
      // Never expose opaque proxy refs to the browser, even when bytes are missing.
      attachments: p.attachments.map(a => {
        if (a.kind === 'external-link') {
          // Browser DTO only: preserve an allowed source URL exactly; withhold
          // rejected URL bytes before serialization without rewriting/fetching.
          return {attachmentId:a.attachmentId, kind:a.kind, title:a.title,
            url:safeWebUrl(a.url) ? a.url : null, archived:a.archived};
        }
        const cap = media.find(m => sameScope(m.entity, scope) && entityKey({source:m.entity.key}) === key && m.attachmentId === a.attachmentId && m.authorized === true);
        const {proxyRef, ...reference} = a;
        return {...reference, downloadHref: safeMediaUrl(cap?.downloadHref), previewHref: ['image/png','image/jpeg','image/webp'].includes(a.contentType) && cap?.previewValidated === true ? safeMediaUrl(cap.previewHref) : null};
      }),
      nativeLinks: authorization.canEditHomebox === true ? [...p.nativeLinks, ...capabilities] : [],
      networkBound: allowedNetworkBindings.length > 0,
      networkStates,
      networkRelations: snapshot.networkRelations.filter(n => sameScope(n,scope) && allowedNetworkBindings.some(b => b.payload.source.sourceInstanceId === n.sourceInstanceId && b.payload.source.collectionId === n.collectionId && [n.from,n.to].some(endpoint => endpoint.kind === 'device' && endpoint.id === b.payload.source.externalId)))
    };
  }).filter(p => p.sourceState !== 'access-revoked');
  return {
    status: 'ready', scope, homeLabel, now, canEdit: authorization.canEditHomebox === true,
    homes: [{...scope,label:homeLabel},...homes.filter(h => h.workspaceId === scope.workspaceId && h.homeId !== scope.homeId && authorization.allowedHomeIds?.includes(h.homeId)).map(h => ({workspaceId:h.workspaceId, homeId:h.homeId, label:h.label}))],
    entries, caches
  };
}
