import { isExactDecimal } from '../numeric/decimal';
import { parseLosslessJson, type LosslessJson } from '../numeric/lossless-json';
import { canonicalPack, jsonRow, needPack, readPackManifest, type JsonRow, type PackManifest, type PackSection } from './manifest';
import type { SavedPackSections } from './saved-pack-sections';
import { savedDigest, validateSavedHouse, type SavedHouseStore, type SavedResource } from './store';

export interface SavedInventoryItem {
  readonly key: string; readonly title: string;
  readonly sourceUpdatedAt: string | null; readonly retrievedAt: string | null;
  /** Captured fields, attachments, upkeep and links are inert documentary data. */
  readonly raw: JsonRow;
}
export interface SavedDocumentItem {
  readonly key: string; readonly title: string; readonly revision: string;
  readonly createdAt: string | null; readonly updatedAt: string | null; readonly lifecycle: string | null;
  readonly original: Readonly<{ state: 'retained-unverified' | 'unavailable'; reason: string | null; resource: SavedResource | null }>;
  readonly raw: JsonRow;
}
export interface SavedCatalogSection<T> extends PackSection {
  readonly items: readonly T[];
  readonly exclusions: PackManifest['exclusions']; readonly reasons: readonly string[];
  readonly caches: readonly LosslessJson[]; readonly sources: readonly LosslessJson[];
}
export interface SavedCatalog {
  readonly kind: 'saved'; readonly key: string; readonly snapshotId: string;
  readonly localRevision: string; readonly capturedAt: string;
  readonly completeness: PackManifest['completeness'];
  readonly exclusions: PackManifest['exclusions'];
  readonly inventory: SavedCatalogSection<SavedInventoryItem>;
  readonly documents: SavedCatalogSection<SavedDocumentItem>;
}
export interface SavedCatalogOriginal {
  readonly kind: 'saved-original'; readonly capturedAt: string; readonly snapshotId: string; readonly localRevision: string;
  readonly documentId: string; readonly documentRevision: string;
  readonly assetId: string; readonly assetRevision: string;
  readonly sha256: string; readonly contentType: string; readonly bytes: ArrayBuffer;
}
export interface SavedCatalogRead {
  readonly catalog: SavedCatalog;
  inventoryDetail(key: string): SavedInventoryItem | null;
  documentDetail(key: string): SavedDocumentItem | null;
  openOriginal(key: string, signal: AbortSignal): Promise<SavedCatalogOriginal>;
  /** Call on selection replacement/unmount; also abort the read's selection signal. */
  withdraw(): void;
}
const object = (value: LosslessJson | undefined): JsonRow | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value) ? value : null;
const rows = (value: LosslessJson | undefined): readonly LosslessJson[] => Array.isArray(value) ? value : [];
const text = (value: LosslessJson | undefined): string | null => typeof value === 'string' ? value : null;
const revision = (value: LosslessJson | undefined): string | null =>
  isExactDecimal(value) && /^[1-9][0-9]*$/.test(value.token) ? value.token : null;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Local-only catalog. No native port, session, URL opener or live transport is
 * accepted. Section completeness describes the captured export, never current
 * authorization or verified original availability. Keep selectionSignal alive
 * for this result's entire lifetime and abort it whenever selection changes.
 * The mounting owner must withdraw/re-read on store notifications as well.
 * An initial corrupt original still fails the existing section reader; this
 * adapter preserves metadata already admitted before a later byte loss. */
export function createSavedCatalogAdapter(store: Pick<SavedHouseStore, 'list' | 'asset'>) {
  return {
    async read(input: SavedPackSections, selectionSignal: AbortSignal): Promise<SavedCatalogRead> {
      const house = structuredClone(input.house); validateSavedHouse(house);
      // The section owner has already verified these trees. Own a lossless copy
      // before awaiting; structuredClone cannot preserve ExactDecimal branding.
      const ownRoot = (value: JsonRow | null) => value === null ? null : jsonRow(parseLosslessJson(canonicalPack(value)));
      const inventoryRoot = ownRoot(input.roots.inventory), documentRoot = ownRoot(input.roots.documents);
      const availability = new Map(input.availability);
      needPack(input.manifest.snapshotId === house.snapshotId && input.manifest.capturedAt === house.capturedAt);
      const lifetime = new AbortController(), selected = AbortSignal.any([selectionSignal, lifetime.signal]);
      const guard = async (signal: AbortSignal) => {
        signal.throwIfAborted();
        const current = (await store.list()).find(row => row.key === house.key);
        signal.throwIfAborted();
        needPack(current?.localRevision === house.localRevision && current.snapshotId === house.snapshotId);
      };
      await guard(selected);
      const manifest = await readPackManifest(house.manifest, house.scope, true); await guard(selected);
      needPack(manifest.snapshotId === house.snapshotId && manifest.capturedAt === house.capturedAt
        && manifest.resources.length === house.resources.length);
      for (const pin of manifest.resources) {
        const held = house.resources.find(row => row.id === pin.id);
        needPack(held && held.sha256 === pin.sha256 && held.bytes === pin.bytes && held.contentType === pin.contentType
          && held.role === pin.role && held.label === pin.label);
        if (held.record !== undefined) needPack(held.record === null && pin.record === null
          || held.record?.recordType === pin.record?.recordType && held.record?.recordId === pin.record?.recordId
          && held.record?.revision === pin.record?.revision);
      }
      const read = async (pin: SavedResource, signal: AbortSignal) => {
        await guard(signal); const blob = await store.asset(house, pin.id); await guard(signal);
        needPack(blob.size === pin.bytes && blob.type === pin.contentType);
        const bytes = await blob.arrayBuffer(); await guard(signal);
        needPack(bytes.byteLength === pin.bytes && await savedDigest(bytes) === pin.sha256); await guard(signal);
        return bytes;
      };
      for (const [name, data] of [['inventory', inventoryRoot], ['documents', documentRoot]] as const) {
        const sha = manifest.sections[name].resourceSha256;
        needPack(sha === null ? data === null : data !== null && availability.get(sha) === true);
      }
      if (inventoryRoot) needPack(Array.isArray(inventoryRoot.entities));
      if (documentRoot) needPack(documentRoot.profile === 'houseatlas.home-read-pack.documents.v1'
        && Array.isArray(documentRoot.documents) && Array.isArray(documentRoot.originals)
        && Array.isArray(documentRoot.previews) && Array.isArray(documentRoot.exclusions));
      const scoped = (row: JsonRow) => row.workspaceId === house.scope.workspaceId && row.homeId === house.scope.homeId;
      const inventory: SavedInventoryItem[] = [], documents: SavedDocumentItem[] = [];
      const inventoryReasons: string[] = [], documentReasons: string[] = [];
      for (const value of rows(inventoryRoot?.entities)) {
        const raw = object(value), source = object(raw?.source), entity = object(raw?.entity);
        if (!raw || !scoped(raw) || !source || !entity || !text(entity.name)
          || !text(source.sourceInstanceId) || !text(source.collectionId) || !text(source.sourceKind) || !text(source.externalId)) {
          inventoryReasons.push('A captured inventory record cannot be listed'); continue;
        }
        inventory.push({ key: JSON.stringify([house.scope.workspaceId, house.scope.homeId,
          source.sourceInstanceId, source.collectionId, source.sourceKind, source.externalId]),
          title: text(entity.name)!, sourceUpdatedAt: text(raw.sourceUpdatedAt), retrievedAt: text(raw.retrievedAt), raw });
      }
      const originalPins = new Map<string, { resource: SavedResource; assetId: string; assetRevision: string }>();
      for (const value of rows(documentRoot?.documents)) {
        const raw = object(value), payload = object(raw?.payload), documentRevision = revision(raw?.revision);
        if (!raw || !scoped(raw) || raw.recordType !== 'geodata-document' || !text(raw.recordId) || !documentRevision || !payload) {
          documentReasons.push('A captured document record cannot be listed'); continue;
        }
        const key = JSON.stringify([house.scope.workspaceId, house.scope.homeId, raw.recordType, raw.recordId, documentRevision]), original = object(payload.original);
        const references = rows(documentRoot?.originals).map(object).filter(row => row !== null && row.documentId === raw.recordId
          && revision(row.documentRevision) === documentRevision);
        const reference = references.length === 1 ? references[0] : null;
        const resource = manifest.resources.find(row => row.sha256 === original?.sha256);
        const assetId = text(original?.assetId), assetRevision = revision(original?.revision), size = original?.bytes;
        const pinned = reference?.availability === 'available' && reference.assetId === assetId
          && reference.resourceSha256 === original?.sha256 && assetId && assetRevision
          && resource && availability.get(resource.sha256) === true && isExactDecimal(size) && size.toSafeInteger() === resource.bytes;
        if (pinned) originalPins.set(key, { resource, assetId, assetRevision });
        else documentReasons.push('A captured document original is unavailable');
        documents.push({ key, title: text(payload.title) ?? text(raw.recordId)!, revision: documentRevision,
          createdAt: text(raw.createdAt), updatedAt: text(raw.updatedAt), lifecycle: text(raw.lifecycle),
          original: { state: pinned ? 'retained-unverified' : 'unavailable',
            reason: pinned ? null : 'No unique matching retained original reference and resource pin', resource: pinned ? resource : null }, raw });
      }
      // Ambiguous identities must never select an arbitrary original or detail.
      const unique = <T extends { key: string }>(items: T[], reasons: string[]) => {
        const counts = new Map<string, number>(); for (const item of items) counts.set(item.key, (counts.get(item.key) ?? 0) + 1);
        if ([...counts.values()].some(count => count > 1)) reasons.push('Captured record identities are ambiguous');
        return items.filter(item => counts.get(item.key) === 1);
      };
      const section = <T>(name: 'inventory' | 'documents', data: JsonRow | null, items: T[], reasons: string[]): SavedCatalogSection<T> => {
        const pin = manifest.sections[name], exclusions = manifest.exclusions.filter(row => row.section === name);
        for (const value of rows(data?.exclusions)) {
          const row = object(value);
          if (row?.section === name && text(row.code) && text(row.label)
            && !exclusions.some(prior => prior.code === row.code && prior.label === row.label))
            exclusions.push({ section: name, code: text(row.code)!, label: text(row.label)! });
        }
        const caches = rows(data?.caches);
        if (caches.some(value => object(value)?.status === 'access-revoked')) reasons.push('Captured source coverage was withheld');
        if (!data) reasons.push('Retained section unavailable');
        return { ...pin, state: data ? pin.state === 'complete' && (reasons.length || exclusions.length) ? 'partial' : pin.state
          : pin.state === 'not-configured' ? 'not-configured' : 'unavailable', items, exclusions, reasons,
          caches, sources: rows(data?.sources) };
      };
      const catalog: SavedCatalog = freeze({ kind: 'saved', key: house.key, snapshotId: house.snapshotId,
        localRevision: house.localRevision, capturedAt: house.capturedAt, completeness: manifest.completeness, exclusions: manifest.exclusions,
        inventory: section('inventory', inventoryRoot, unique(inventory, inventoryReasons), inventoryReasons),
        documents: section('documents', documentRoot, unique(documents, documentReasons), documentReasons) });
      await guard(selected);
      return {
        catalog,
        inventoryDetail(key) { selected.throwIfAborted(); return catalog.inventory.items.find(row => row.key === key) ?? null; },
        documentDetail(key) { selected.throwIfAborted(); return catalog.documents.items.find(row => row.key === key) ?? null; },
        async openOriginal(key, signal) {
          const active = AbortSignal.any([selected, signal]); await guard(active);
          const document = catalog.documents.items.find(row => row.key === key), pin = originalPins.get(key);
          needPack(document && pin);
          const bytes = await read(pin.resource, active); await guard(active);
          return { kind: 'saved-original', capturedAt: house.capturedAt, snapshotId: house.snapshotId, localRevision: house.localRevision,
            documentId: text(document.raw.recordId)!, documentRevision: document.revision, assetId: pin.assetId,
            assetRevision: pin.assetRevision, sha256: pin.resource.sha256, contentType: pin.resource.contentType, bytes };
        },
        withdraw() { lifetime.abort(new DOMException('Saved catalog selection changed', 'AbortError')); },
      };
    },
  };
}
