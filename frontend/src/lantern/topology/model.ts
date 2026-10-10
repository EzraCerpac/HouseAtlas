import type { Entry, ReadyView } from '../../app/types';
import type { TopologyRecord, AtlasReadStatus } from '../../api/topology-client';
import type { RelationPayloadLocationMembership, RelationPayloadPhysicalAccess } from '../../api/generated/contracts';
import type { DecodedLocationElevation } from '../../numeric/stock-decoded';
import { ExactDecimal } from '../../numeric/decimal';
import { stringifyLosslessJson, type JsonForSerialization } from '../../numeric/lossless-json';

export interface TopologyData {
  readonly identities: readonly TopologyRecord<'identity'>[];
  readonly bindings: readonly TopologyRecord<'binding'>[];
  readonly semantics: readonly TopologyRecord<'location-semantics'>[];
  readonly relations: readonly TopologyRecord<'relation'>[];
  readonly sourceStatuses: readonly AtlasReadStatus[];
}
export interface Location {
  readonly id: string;
  readonly name: string;
  label: string;
  readonly entry: Entry | undefined;
  readonly selectId: string | undefined;
  readonly bindings: readonly TopologyRecord<'binding'>[];
  readonly semantics: readonly TopologyRecord<'location-semantics'>[];
}
export type Membership = TopologyRecord<'relation'> & { readonly payload: RelationPayloadLocationMembership };
export type Access = TopologyRecord<'relation'> & { readonly payload: RelationPayloadPhysicalAccess };
export interface TopologyIndex {
  readonly data: TopologyData;
  readonly locations: ReadonlyMap<string, Location>;
  readonly buildings: readonly Location[];
  readonly membership: readonly Membership[];
  readonly access: readonly Access[];
}
const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);
export function buildTopologyIndex(data: TopologyData, view: ReadyView, selectable: ReadonlyMap<string, Entry>): TopologyIndex {
  const locations = new Map<string, Location>();
  for (const identity of data.identities) {
    if (identity.lifecycle !== 'active' || identity.payload.kind !== 'location') continue;
    const id = identity.target.recordId;
    const bindings = data.bindings.filter(b => b.lifecycle === 'active' && b.payload.reviewStatus === 'accepted' && b.payload.atlasId === id)
      .sort((a, b) => a.target.recordId.localeCompare(b.target.recordId));
    // Names remain HomeBox source facts; only a complete qualified binding joins.
    let entry: Entry | undefined;
    for (const binding of bindings) {
      const ref = binding.payload.source;
      entry = view.entries.find(e => e.workspaceId === view.scope.workspaceId && e.homeId === view.scope.homeId
        && e.source.sourceInstanceId === ref.sourceInstanceId && e.source.collectionId === ref.collectionId
        && e.source.sourceKind === ref.sourceKind && e.source.externalId === ref.externalId);
      if (entry) break;
    }
    const selectId = entry ? [...selectable].find(([, value]) => value === entry)?.[0] : undefined;
    const name = entry?.entity.name.trim() || 'Unnamed Atlas location';
    locations.set(id, { id, name, label: name, entry, selectId, bindings,
      semantics: data.semantics.filter(s => s.lifecycle === 'active' && s.payload.reviewStatus === 'accepted' && s.payload.atlasId === id) });
  }
  for (const location of locations.values()) {
    const sameName = [...locations.values()].filter(l => l.name === location.name);
    if (sameName.length > 1) {
      // Expand the suffix if two complete identities happen to share its tail.
      let length = 8;
      while (length < 32 && sameName.some(l => l.id !== location.id && l.id.replaceAll('-', '').slice(-length) === location.id.replaceAll('-', '').slice(-length))) length += 4;
      location.label = `${location.name} · …${location.id.replaceAll('-', '').slice(-length)}`;
    }
  }
  const membership = data.relations.filter((r): r is Membership => r.lifecycle === 'active'
    && r.payload.kind === 'location-membership' && r.payload.reviewStatus === 'accepted');
  const access = data.relations.filter((r): r is Access => r.lifecycle === 'active'
    && r.payload.kind === 'physical-access' && r.payload.reviewStatus === 'accepted');
  return { data, locations, buildings: [...locations.values()].filter(l => l.semantics.some(s => s.payload.semanticKind === 'building')).sort(byId), membership, access };
}
export type ElevationDisplay =
  | { readonly status: 'known'; readonly elevation: Extract<DecodedLocationElevation, { status: 'known' }> }
  | { readonly status: 'unknown' | 'omitted' | 'multiple' };
export function elevationOf(location: Location): ElevationDisplay {
  const facts = location.semantics.filter(s => s.payload.semanticKind === 'floor');
  if (facts.length > 1) return { status: 'multiple' };
  const elevation = facts[0]?.payload.elevation;
  if (elevation === undefined) return { status: 'omitted' };
  return elevation.status === 'known' ? { status: 'known', elevation } : { status: 'unknown' };
}
export interface LevelGroup { readonly location: Location; readonly elevation: ElevationDisplay; readonly members: readonly Location[] }
export interface BuildingModel {
  readonly building: Location;
  readonly memberCount: number;
  readonly levels: readonly LevelGroup[];
  readonly direct: readonly Location[];
  readonly outsideUnassigned: readonly Location[];
  readonly outsideElsewhere: readonly Location[];
}
/** Cross-read coherence checks do not replace the native selected member set. */
export function buildBuildingModel(index: TopologyIndex, buildingId: string, records: readonly TopologyRecord<'identity'>[]): BuildingModel | null {
  const building = index.buildings.find(b => b.id === buildingId);
  if (!building) return null;
  const members = new Set(records.map(r => r.target.recordId));
  if (!members.has(buildingId) || members.size !== records.length) return null;
  const original = new Map(index.data.identities.map(r => [r.target.recordId, r]));
  for (const record of records) {
    const prior = original.get(record.target.recordId);
    if (!prior || !index.locations.has(record.target.recordId) || record.lifecycle !== 'active' || record.payload.kind !== 'location'
      || record.revision !== prior.revision || stringifyLosslessJson(record.payload as unknown as JsonForSerialization) !== stringifyLosslessJson(prior.payload as unknown as JsonForSerialization)) return null;
  }
  const endpoints = (r: Membership | Access) => [r.payload.from.ref.recordId, r.payload.to.ref.recordId];
  for (const relation of index.membership) if (endpoints(relation).some(id => !index.locations.has(id))) return null;
  for (const location of index.locations.values()) for (const fact of location.semantics)
    if (fact.payload.elevation?.status === 'known' && !index.locations.has(fact.payload.elevation.datumAtlasId)) return null;
  for (const relation of index.access)
    if (endpoints(relation).some(id => !index.locations.has(id))) return null;
  // Reconstruct only to compare independently read edges against server membership.
  const reached = new Set([buildingId]), pending = [buildingId];
  while (pending.length) {
    const parent = pending.pop()!;
    for (const edge of index.membership.filter(r => r.payload.from.ref.recordId === parent)) {
      const child = edge.payload.to.ref.recordId;
      if (!reached.has(child)) { reached.add(child); pending.push(child); }
    }
  }
  if (reached.size !== members.size || [...reached].some(id => !members.has(id))) return null;
  const floors = [...members].map(id => index.locations.get(id)!).filter(l => l.id !== buildingId && l.semantics.some(s => s.payload.semanticKind === 'floor'));
  const levelMembers = new Set<string>();
  const levels: LevelGroup[] = floors.map(location => {
    const children = index.membership.filter(e => e.payload.membershipKind === 'level' && e.payload.from.ref.recordId === location.id)
      .map(e => index.locations.get(e.payload.to.ref.recordId)!).sort(byId);
    children.forEach(c => levelMembers.add(c.id));
    return { location, elevation: elevationOf(location), members: children };
  });
  levels.sort((a, b) => {
    if (a.elevation.status === 'known' && b.elevation.status === 'known') {
      const datum = a.elevation.elevation.datumAtlasId.localeCompare(b.elevation.elevation.datumAtlasId);
      if (datum) return datum;
      return b.elevation.elevation.metres.compare(a.elevation.elevation.metres) || byId(a.location, b.location);
    }
    if (a.elevation.status === 'known') return -1;
    if (b.elevation.status === 'known') return 1;
    return byId(a.location, b.location);
  });
  const floorIds = new Set(floors.map(f => f.id));
  const direct = [...members].filter(id => id !== buildingId && !floorIds.has(id) && !levelMembers.has(id)).map(id => index.locations.get(id)!).sort(byId);
  const outside = [...index.locations.values()].filter(l => !members.has(l.id)).sort(byId);
  const assigned = (l: Location) => index.buildings.some(b => b.id === l.id) || index.membership.some(e => e.payload.to.ref.recordId === l.id);
  return { building, memberCount: members.size, levels, direct,
    outsideUnassigned: outside.filter(l => !assigned(l)), outsideElsewhere: outside.filter(assigned) };
}
export function metres(value: ExactDecimal): string {
  const zero = ExactDecimal.parse('0');
  const token = value.toString();
  return `${value.compare(zero) > 0 ? '+' : ''}${token.startsWith('-') ? `−${token.slice(1)}` : token} m`;
}
