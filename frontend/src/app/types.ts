/** Proposed browser projection of the published contracts. Server preparation
 * owns authorization, review decisions, quarantine and capability issuance.
 * AT51 owns reconciliation with the eventual generated wire contracts. */
export interface Scope {
  workspaceId: string;
  homeId: string;
}
export interface Home extends Scope {
  label: string;
}
export interface SourceKey {
  sourceInstanceId: string;
  collectionId: string;
  sourceKind: "homebox-entity";
  externalId: string;
}
export type CacheStatus =
  "fresh" | "stale" | "error" | "empty" | "access-revoked";
export interface Cache {
  owner: "homebox" | "network";
  status: CacheStatus;
  displayStatus: CacheStatus;
  sourceInstanceId?: string;
  collectionId?: string;
  lastSuccessfulFetchAt?: string | null;
}
export interface Entity {
  id: string;
  name: string;
  description: string;
  entityType: { id: string; name: string; isLocation: boolean } | null;
  parent: { id: string } | null;
  archived: boolean;
  quantity: number | null;
  manufacturer: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  notes: string | null;
}
export type Attachment =
  | {
      attachmentId: string;
      title: string | null;
      kind: "external-link";
      url: string | null;
      archived: boolean;
    }
  | {
      attachmentId: string;
      title: string | null;
      kind: "stored-file";
      contentType: string | null;
      byteSize: number | null;
      downloadHref: string | null;
      previewHref: string | null;
    };
export interface Maintenance {
  entryId: string;
  name: string;
  description: string;
  scheduledDate: string | null;
  completedDate: string | null;
  cost: number | null;
}
export interface NativeLink {
  kind: "homebox-native";
  intent: "view" | "edit" | "maintenance";
  entity: Scope & { key: SourceKey };
  href: string;
  verifiedRoute: boolean;
}
export interface NetworkEndpoint {
  kind: "device" | "interface" | "segment" | "unresolved";
  id: string | null;
  description: string | null;
}
export interface NetworkRelation {
  kind:
    "network-segment-membership" | "network-association" | "network-connection";
  from: NetworkEndpoint;
  to: NetworkEndpoint;
  medium: "ethernet" | "wifi" | "powerline" | "wan" | "other" | "unknown";
  temporalStatus: "current-claim" | "historical" | "withdrawn" | "disputed";
  sourceRevision: number | null;
  sourceConfidence: string | null;
  evidenceBasis: string | null;
  factAt: string | null;
  retrievedAt: string;
  sourceSnapshotAt: string | null;
  vantage: string | null;
  notes: string | null;
}
export interface Entry extends Scope {
  key: string;
  source: SourceKey;
  entity: Entity;
  kind: "place" | "item" | "unknown";
  semanticKind:
    | "room"
    | "floor"
    | "building"
    | "container"
    | "unclassified"
    | "site"
    | "other";
  sourceState:
    "present" | "archived" | "unresolved" | "confirmed-deleted" | "unreviewed";
  cacheStatus: CacheStatus;
  sourceUpdatedAt: string | null;
  retrievedAt: string;
  aliases: string[];
  mobility: "mobile" | "unknown";
  attachments: Attachment[];
  maintenance: Maintenance[];
  nativeLinks: NativeLink[];
  networkBound: boolean;
  networkStates: CacheStatus[];
  networkRelations: NetworkRelation[];
}
export interface ReadyView {
  status: "ready";
  scope: Scope;
  homeLabel: string;
  now: string;
  canEdit: boolean;
  homes: Home[];
  entries: Entry[];
  caches: Cache[];
}
export type UnavailableStatus =
  "loading" | "unavailable" | "denied" | "expired" | "revoked";
export type AtlasView = ReadyView | { status: UnavailableStatus };
export interface AtlasClient {
  load(signal: AbortSignal): Promise<AtlasView>;
  loadHome(scope: Scope, signal: AbortSignal): Promise<AtlasView>;
}
