import type { OperationHistoryRead } from '../../api/operation-history-client';
import type { GeometryPayloadMappingsItem } from '../../api/generated/contracts';
import type { GeometryPublicRecord, GeometryRead } from '../../api/geometry-client';
import type { Attachment, Entry, ReadyView } from '../../app/types';
import type { Doc, HouseData, Item, Space, Task } from '../data/types';
import { visibleEntries } from '../../app/model.ts';

/** Access is issued by the source. A stored file can exist without an issued URL. */
export interface DocAccess {
  storage: 'stored' | 'link';
  href: string | null;
  previewHref: string | null;
  available: boolean;
}

/** The source records remain authoritative; Lantern records are display-only. */
export interface LanternProjection {
  house: HouseData;
  entries: ReadonlyMap<string, Entry>;
  attachments: ReadonlyMap<string, Attachment>;
  docAccess: ReadonlyMap<string, DocAccess>;
  view: ReadyView;
  geometryMetadata: GeometryRead;
  operationHistory: OperationHistoryRead;
  loadMoreOperations: (() => void) | null;
  geometryMappings: ReadonlyMap<string, Array<{ record: GeometryPublicRecord; mapping: GeometryPayloadMappingsItem }>>;
}

type Prefix = 'sp' | 'it' | 'uk' | 'doc' | 'mt';

function scopedId(prefix: Prefix, entry: Entry, suffix?: string): string {
  return `${prefix}-${JSON.stringify([
    entry.workspaceId,
    entry.homeId,
    entry.key,
    ...(suffix === undefined ? [] : [suffix]),
  ])}`;
}

function kindOf(entry: Entry): 'sp' | 'it' | 'uk' {
  return entry.kind === 'place' ? 'sp' : entry.kind === 'item' ? 'it' : 'uk';
}

function sourceText(entry: Entry): string | undefined {
  const parts = [entry.entity.description, entry.entity.notes]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  if (entry.aliases.length) parts.push(`Aliases: ${entry.aliases.join(', ')}`);
  if (entry.kind === 'place' && entry.entity.modelNumber) parts.push(`Model: ${entry.entity.modelNumber}`);
  if (entry.kind === 'place' && entry.entity.serialNumber) parts.push(`Serial: ${entry.entity.serialNumber}`);
  return parts.length ? parts.join('\n\n') : undefined;
}

function documentKind(attachment: Attachment): Doc['kind'] {
  if (attachment.kind === 'stored-file' && attachment.contentType?.startsWith('image/')) {
    return 'photo';
  }
  return 'note';
}

export function projectView(view: ReadyView, geometryMetadata: GeometryRead = { status: 'loading' }, operationHistory: OperationHistoryRead = { status: 'loading' }, loadMoreOperations: (() => void) | null = null): LanternProjection {
  const entries = new Map<string, Entry>();
  const attachments = new Map<string, Attachment>();
  const docAccess = new Map<string, DocAccess>();
  const spaces: Space[] = [];
  const items: Item[] = [];
  const docs: Doc[] = [];
  const tasks: Task[] = [];

  // ReadyView may retain records for other homes and archived records. Only
  // current records in the selected scope are projected into this house; the
  // complete view is retained above.
  for (const entry of visibleEntries(view, false)) {
    if (entry.workspaceId !== view.scope.workspaceId || entry.homeId !== view.scope.homeId) continue;

    const id = scopedId(kindOf(entry), entry);
    entries.set(id, entry);

    if (entry.kind === 'place') {
      const space: Space & { semanticKind: Entry['semanticKind'] } = {
        id,
        name: entry.entity.name,
        floorId: 'fl-index',
        // Lantern requires a kind. This compatibility value is never a
        // classification; consumers must use semanticKind from the source.
        kind: 'service',
        semanticKind: entry.semanticKind,
        geometry: 'none',
        homeboxRef: entry.source.externalId,
        ...(sourceText(entry) ? { note: sourceText(entry) } : {}),
      };
      spaces.push(space);
    } else {
      items.push({
        id,
        name: entry.entity.name,
        category: entry.entity.entityType?.name || 'Unknown',
        locationClaim: 'unknown',
        ...(entry.entity.modelNumber ? { model: entry.entity.modelNumber } : {}),
        ...(entry.entity.serialNumber ? { serial: entry.entity.serialNumber } : {}),
        ...(sourceText(entry) ? { note: sourceText(entry) } : {}),
        illustration: 'box',
        homeboxRef: entry.source.externalId,
        rev: 0,
      });
    }

    entry.attachments.forEach((attachment) => {
      const docId = scopedId('doc', entry, attachment.attachmentId);
      // Source IDs identify attachments; reject rather than collapse duplicates.
      if (entries.has(docId)) throw new TypeError('Duplicate attachment identity');
      const storage = attachment.kind === 'stored-file' ? 'stored' : 'link';
      const href = attachment.kind === 'stored-file' ? attachment.downloadHref : attachment.url;
      const previewHref = attachment.kind === 'stored-file' ? attachment.previewHref : null;
      entries.set(docId, entry);
      attachments.set(docId, attachment);
      docAccess.set(docId, { storage, href, previewHref, available: Boolean(href || previewHref) });
      docs.push({
        id: docId,
        title: attachment.title?.trim() || 'Untitled attachment',
        kind: documentKind(attachment),
        storage,
        ...(attachment.kind === 'stored-file' && attachment.byteSize !== null
          ? { sizeKb: attachment.byteSize / 1024 }
          : {}),
        ...(href ? { url: href } : {}),
        source: 'HomeBox',
        addedBy: 'Unknown',
        addedAt: '',
        linkedTo: [id],
        version: 0,
        preview: 'none',
        owner: 'HomeBox',
      });
    });

    entry.maintenance.forEach((maintenance) => {
      const taskId = scopedId('mt', entry, maintenance.entryId);
      if (entries.has(taskId)) throw new TypeError('Duplicate maintenance identity');
      entries.set(taskId, entry);
      tasks.push({
        id: taskId,
        title: maintenance.name,
        targetId: id,
        ...(maintenance.scheduledDate ? { due: maintenance.scheduledDate } : {}),
        status: maintenance.completedDate ? 'done' : maintenance.scheduledDate ? 'scheduled' : 'unknown',
        ...(maintenance.completedDate ? { completedAt: maintenance.completedDate } : {}),
        ...(maintenance.description ? { note: maintenance.description } : {}),
        ...(maintenance.cost !== null ? { cost: maintenance.cost } : {}),
        evidenceIds: [],
      });
    });
  }

  const homeboxSyncedAt = view.caches
    .filter((cache) => cache.owner === 'homebox' && cache.lastSuccessfulFetchAt)
    .map((cache) => cache.lastSuccessfulFetchAt as string)
    .sort()
    .at(-1) ?? '';

  const house: HouseData = {
    id: JSON.stringify([view.scope.workspaceId, view.scope.homeId]),
    displayNow: view.now,
    name: view.homeLabel,
    tagline: '',
    geometry: 'none',
    floors: [{ id: 'fl-index', name: 'Rooms & places', short: '—', hasPlan: false, order: 0 }],
    spaces,
    openings: [],
    containers: [],
    items,
    panels: [],
    circuits: [],
    outlets: [],
    loads: [],
    valves: [],
    devices: [],
    links: [],
    cables: [],
    docs,
    tasks,
    history: [],
    writes: [],
    sources: { homeboxSyncedAt, networkObservedAt: '', networkRetrievedAt: '' },
    people: [],
  };

  const geometryMappings = new Map<string, Array<{ record: GeometryPublicRecord; mapping: GeometryPayloadMappingsItem }>>();
  if (geometryMetadata.status === 'ready') {
    for (const space of spaces) {
      const entry = entries.get(space.id)!;
      for (const record of geometryMetadata.records) {
        for (const mapping of record.payload.mappings) {
          const ref = mapping.homeboxEntity;
          if (ref && ref.workspaceId === entry.workspaceId && ref.homeId === entry.homeId
            && ref.key.sourceKind === 'homebox-entity'
            && ref.key.sourceInstanceId === entry.source.sourceInstanceId
            && ref.key.collectionId === entry.source.collectionId
            && ref.key.sourceKind === entry.source.sourceKind
            && ref.key.externalId === entry.source.externalId) {
            const matches = geometryMappings.get(space.id) ?? [];
            matches.push({ record, mapping });
            geometryMappings.set(space.id, matches);
          }
        }
      }
    }
  }
  return { house, entries, attachments, docAccess, view, geometryMetadata, geometryMappings, operationHistory, loadMoreOperations };
}
