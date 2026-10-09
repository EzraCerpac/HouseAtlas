import type {
  AtlasView,
  Attachment,
  Cache,
  CacheStatus,
  Entity,
  Entry,
  Maintenance,
  NativeLink,
  NetworkEndpoint,
  NetworkRelation,
  Scope,
  SourceKey,
} from "./types";
import { sameScope, sourceKey } from "./model";

// Browser structural decoding is not source admission or authorization. Only
// consume the server-prepared DTO; never accept raw snapshots in this client.
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Expected view object");
  return value as ObjectValue;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Expected view text");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new TypeError("Expected view flag");
  return value;
}
const nullableString = (value: unknown): string | null =>
  value === null || value === undefined ? null : string(value);
function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new TypeError("Expected view number");
  return value;
}
function list<T>(value: unknown, decode: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new TypeError("Expected view list");
  return value.map(decode);
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  const selected = allowed.find((item) => item === value);
  if (selected === undefined) throw new TypeError("Unknown view state");
  return selected;
}
const statuses: readonly CacheStatus[] = [
  "fresh",
  "stale",
  "error",
  "empty",
  "access-revoked",
];
function scope(value: ObjectValue): Scope {
  return {
    workspaceId: string(value.workspaceId),
    homeId: string(value.homeId),
  };
}
function source(value: unknown): SourceKey {
  const o = object(value);
  return {
    sourceInstanceId: string(o.sourceInstanceId),
    collectionId: string(o.collectionId),
    sourceKind: choice(o.sourceKind, ["homebox-entity"]),
    externalId: string(o.externalId),
  };
}
function entity(value: unknown): Entity {
  const o = object(value),
    type = o.entityType === null ? null : object(o.entityType),
    parent = o.parent === null ? null : object(o.parent);
  return {
    id: string(o.id),
    name: string(o.name),
    description: string(o.description),
    entityType: type && {
      id: string(type.id),
      name: string(type.name),
      isLocation: boolean(type.isLocation),
    },
    parent: parent && { id: string(parent.id) },
    archived: boolean(o.archived),
    quantity: nullableNumber(o.quantity),
    manufacturer: nullableString(o.manufacturer),
    modelNumber: nullableString(o.modelNumber),
    serialNumber: nullableString(o.serialNumber),
    notes: nullableString(o.notes),
  };
}
function attachment(value: unknown): Attachment {
  const o = object(value),
    base = {
      attachmentId: string(o.attachmentId),
      title: nullableString(o.title),
    };
  const kind = choice(o.kind, ["stored-file", "external-link"]);
  return kind === "external-link"
    ? {
        ...base,
        kind,
        url: nullableString(o.url),
        archived: boolean(o.archived),
      }
    : {
        ...base,
        kind,
        contentType: nullableString(o.contentType),
        byteSize: nullableNumber(o.byteSize),
        downloadHref: nullableString(o.downloadHref),
        previewHref: nullableString(o.previewHref),
      };
}
function maintenance(value: unknown): Maintenance {
  const o = object(value);
  return {
    entryId: string(o.entryId),
    name: string(o.name),
    description: string(o.description),
    scheduledDate: nullableString(o.scheduledDate),
    completedDate: nullableString(o.completedDate),
    cost: nullableNumber(o.cost),
  };
}
function native(value: unknown): NativeLink {
  const o = object(value),
    ref = object(o.entity);
  return {
    kind: choice(o.kind, ["homebox-native"]),
    intent: choice(o.intent, ["view", "edit", "maintenance"]),
    entity: { ...scope(ref), key: source(ref.key) },
    href: string(o.href),
    verifiedRoute: boolean(o.verifiedRoute),
  };
}
function endpoint(value: unknown): NetworkEndpoint {
  const o = object(value);
  return {
    kind: choice(o.kind, ["device", "interface", "segment", "unresolved"]),
    id: nullableString(o.id),
    description: nullableString(o.description),
  };
}
function network(value: unknown): NetworkRelation {
  const o = object(value);
  return {
    kind: choice(o.kind, [
      "network-segment-membership",
      "network-association",
      "network-connection",
    ]),
    from: endpoint(o.from),
    to: endpoint(o.to),
    medium: choice(o.medium, [
      "ethernet",
      "wifi",
      "powerline",
      "wan",
      "other",
      "unknown",
    ]),
    temporalStatus: choice(o.temporalStatus, [
      "current-claim",
      "historical",
      "withdrawn",
      "disputed",
    ]),
    sourceRevision: nullableNumber(o.sourceRevision),
    sourceConfidence: nullableString(o.sourceConfidence),
    evidenceBasis: nullableString(o.evidenceBasis),
    factAt: nullableString(o.factAt),
    retrievedAt: string(o.retrievedAt),
    sourceSnapshotAt: nullableString(o.sourceSnapshotAt),
    vantage: nullableString(o.vantage),
    notes: nullableString(o.notes),
  };
}
function entry(value: unknown): Entry {
  const o = object(value);
  const result: Entry = {
    ...scope(o),
    key: string(o.key),
    source: source(o.source),
    entity: entity(o.entity),
    kind: choice(o.kind, ["place", "item", "unknown"]),
    semanticKind: choice(o.semanticKind, [
      "room",
      "floor",
      "building",
      "container",
      "unclassified",
      "site",
      "other",
    ]),
    sourceState: choice(o.sourceState, [
      "present",
      "archived",
      "unresolved",
      "confirmed-deleted",
      "unreviewed",
    ]),
    cacheStatus: choice(o.cacheStatus, statuses),
    sourceUpdatedAt: nullableString(o.sourceUpdatedAt),
    retrievedAt: string(o.retrievedAt),
    aliases: list(o.aliases, string),
    mobility: choice(o.mobility, ["mobile", "unknown"]),
    attachments: list(o.attachments, attachment),
    maintenance: list(o.maintenance, maintenance),
    nativeLinks: list(o.nativeLinks, native),
    networkBound: boolean(o.networkBound),
    networkStates: list(o.networkStates, (value) => choice(value, statuses)),
    networkRelations: list(o.networkRelations, network),
  };
  if (
    result.key !== sourceKey(result.source) ||
    result.entity.id !== result.source.externalId
  )
    throw new TypeError("Inconsistent entry key");
  return result;
}
function cache(value: unknown): Cache {
  const o = object(value),
    owner = choice(o.owner, ["homebox", "network"]),
    status = choice(o.status, statuses);
  // Quarantine markers intentionally contain no saved partition evidence.
  if (status === "access-revoked")
    return { owner, status, displayStatus: status };
  return {
    owner,
    status,
    displayStatus: choice(o.displayStatus, statuses),
    sourceInstanceId: string(o.sourceInstanceId),
    collectionId: string(o.collectionId),
    lastSuccessfulFetchAt: nullableString(o.lastSuccessfulFetchAt),
  };
}
export function decodeAtlasView(value: unknown): AtlasView {
  const o = object(value),
    status = choice(o.status, [
      "ready",
      "loading",
      "unavailable",
      "denied",
      "expired",
      "revoked",
    ]);
  if (status !== "ready") return { status };
  const currentScope = scope(object(o.scope));
  const entries = list(o.entries, entry),
    homes = list(o.homes, (value) => {
      const h = object(value);
      return { ...scope(h), label: string(h.label) };
    });
  if (
    entries.some((p) => !sameScope(p, currentScope)) ||
    homes.some((h) => h.workspaceId !== currentScope.workspaceId)
  )
    throw new TypeError("Inconsistent view scope");
  if (!homes.some((h) => sameScope(h, currentScope)))
    throw new TypeError("Current home missing");
  return {
    status,
    scope: currentScope,
    homeLabel: string(o.homeLabel),
    now: string(o.now),
    canEdit: boolean(o.canEdit),
    entries,
    homes,
    caches: list(o.caches, cache),
  };
}
