import { createTopologyClient, type TopologyClient, type TopologyRecord } from '../src/api/topology-client';
import { createStockSchemas } from './stock-schemas';
import type { SceneAssociationContext } from './native-scene-association-client';
import type { IdentityPayload, RelationPayload } from '../src/api/generated/contracts';
import type { DecodedLocationSemanticsPayload } from '../src/numeric/stock-decoded';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function need(value: unknown): asserts value { if (!value) throw new TypeError('Reviewed scene place is not current in the selected building'); }

/**
 * Resolves only identities whose active, accepted Atlas topology agrees with
 * the server's reviewed_scene_place predicate. All reads use the existing
 * bounded Stock list owner and its full-scope, same-snapshot contracts.
 */
export interface NativeSceneReviewedPlaceReader {
  validate(buildingId: string, placeIds: readonly string[], signal: AbortSignal,
    currentOwner: () => boolean): Promise<void>;
  dispose(): void;
}

export function createNativeSceneReviewedPlaceReader(options: {
  getContext(): SceneAssociationContext | null;
  subscribe(changed: () => void): () => void;
  transport: typeof fetch;
}): NativeSceneReviewedPlaceReader {
  const topology: TopologyClient = createTopologyClient({
    schemas: createStockSchemas(),
    getSessionBinding: () => {
      const context = options.getContext();
      return context ? { session: context.session, scope: context.view.scope } : null;
    },
    subscribeSessionBinding: options.subscribe,
    transport: options.transport,
  });
  let disposed = false;
  const guard = (signal: AbortSignal, owner: ReturnType<TopologyClient['getBinding']>, currentOwner: () => boolean) => {
    signal.throwIfAborted(); need(!disposed && currentOwner() && owner && topology.getBinding() === owner);
  };
  const acceptedSemantics = (records: readonly TopologyRecord<'location-semantics'>[]) => {
    const byIdentity = new Map<string, DecodedLocationSemanticsPayload[]>();
    for (const record of records) {
      const payload = record.payload;
      if (payload.reviewStatus !== 'accepted') continue;
      const rows = byIdentity.get(payload.atlasId) ?? [];
      rows.push(payload); byIdentity.set(payload.atlasId, rows);
    }
    return byIdentity;
  };
  const endpoint = (value: unknown): string => {
    need(value !== null && typeof value === 'object' && !Array.isArray(value));
    const endpoint = value as { kind?: unknown; ref?: { recordType?: unknown; recordId?: unknown } };
    need(endpoint.kind === 'atlas-record' && endpoint.ref?.recordType === 'identity'
      && typeof endpoint.ref.recordId === 'string' && UUID.test(endpoint.ref.recordId));
    return endpoint.ref.recordId;
  };

  return {
    async validate(buildingId, placeIds, signal, currentOwner) {
      signal.throwIfAborted(); need(!disposed && UUID.test(buildingId) && Array.isArray(placeIds)
        && placeIds.length <= 256 && placeIds.every(id => typeof id === 'string' && UUID.test(id))
        && new Set(placeIds).size === placeIds.length && currentOwner());
      if (placeIds.length === 0) return;
      const owner = topology.getBinding(); need(owner && owner.scope.workspaceId && owner.scope.homeId);
      const context = options.getContext(); need(context && context.sessionIdentity && context.view.scope.workspaceId === owner.scope.workspaceId
        && context.view.scope.homeId === owner.scope.homeId);
      guard(signal, owner, currentOwner);

      const [members, semanticRead, relationRead] = await Promise.all([
        topology.buildingMembers(owner, buildingId, signal),
        topology.listAll(owner, 'location-semantics', signal),
        topology.listAll(owner, 'relation', signal),
      ]);
      guard(signal, owner, currentOwner);
      need(members.status === 'ready' && semanticRead.status === 'ready' && relationRead.status === 'ready'
        && members.sourceStatus === 'current' && semanticRead.sourceStatus === 'current' && relationRead.sourceStatus === 'current'
        && members.snapshotSha256 === semanticRead.snapshotSha256 && members.snapshotSha256 === relationRead.snapshotSha256);

      const identities = new Map<string, TopologyRecord<'identity'>>();
      for (const record of members.records) identities.set(record.target.recordId, record);
      const semantics = acceptedSemantics(semanticRead.records);
      const exactlyOneAccepted = (id: string) => { const rows = semantics.get(id); need(rows?.length === 1); return rows[0]!; };
      const exactlyOne = (id: string, kind: DecodedLocationSemanticsPayload['semanticKind']) => {
        const row = exactlyOneAccepted(id); need(row.semanticKind === kind); return row;
      };
      const building = identities.get(buildingId);
      need(building && (building.payload as IdentityPayload).kind === 'location');
      exactlyOne(buildingId, 'building');

      // Match backend/src/domain/stock/native_scene_associations.rs: accepted
      // memberships have one parent for each (child, membershipKind) pair.
      const parents = new Map<string, string>();
      for (const record of relationRead.records) {
        const payload = record.payload as RelationPayload;
        if (payload.kind !== 'location-membership' || payload.reviewStatus !== 'accepted') continue;
        const from = endpoint(payload.from), to = endpoint(payload.to);
        const membershipKind = payload.membershipKind;
        const key = `${to}\u0000${membershipKind}`;
        need(!parents.has(key)); parents.set(key, from);
      }
      const parent = (id: string, kind: 'building' | 'level') => parents.get(`${id}\u0000${kind}`);
      for (const id of placeIds) {
        const place = identities.get(id); need(place && (place.payload as IdentityPayload).kind === 'location');
        // Documentary "room" is a package concept. Native membership may
        // classify the accepted Atlas location as `other` (e.g. circulation).
        // Preserve that owner classification instead of relabelling it.
        const semanticKind = exactlyOneAccepted(id).semanticKind;
        need(semanticKind !== 'building');
        if (parent(id, 'building') === buildingId) continue;
        const direct = parent(id, 'building'); need(direct === undefined || direct === buildingId);
        need(semanticKind !== 'floor');
        const floorId = parent(id, 'level'); need(floorId && identities.has(floorId)
          && (identities.get(floorId)!.payload as IdentityPayload).kind === 'location');
        exactlyOne(floorId, 'floor');
        need(parent(floorId, 'building') === buildingId);
      }
      guard(signal, owner, currentOwner);
    },
    dispose() { disposed = true; },
  };
}
