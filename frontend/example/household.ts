/** The example's Home records, derived from the generated Atlas companion so
 * Home and Atlas show one fictional household. There is one place per
 * building with floors, per floor and per room with a selectable part, named
 * and nested as the companion lists them. A room on several floors sits under
 * the floor of its first selectable part. Every identifier is generated here. */
import type { Entry, ReadyView } from '../src/app/types';

export const EXAMPLE_LABEL = 'Synthetic example house';
/** The example's own generated scope; no configured home uses it. */
export const EXAMPLE_SCOPE = Object.freeze({
  workspaceId: '00000000-0000-4000-8000-0000000e0800',
  homeId: '00000000-0000-4000-8000-0000000e0801',
});
const SOURCE = '00000000-0000-4000-8000-0000000e0900';
const COLLECTION = 'synthetic-example-house';
const LOCATION_TYPE = { id: '00000000-0000-4000-8000-0000000e0901', name: 'Generated location', isLocation: true };
const RETRIEVED = '2026-01-03T10:15:00Z';

/** The parts of the generated companion the Home records are derived from. */
export interface ExampleCompanion {
  readonly scope: Readonly<{ workspaceId: string; homeId: string }>;
  readonly buildings: readonly Readonly<{ buildingId: string; label: string; levelIds: readonly string[] }>[];
  readonly levels: readonly Readonly<{ levelId: string; buildingId: string; label: string }>[];
  readonly rooms: readonly Readonly<{ roomId: string; label: string; occurrenceIds: readonly string[] }>[];
  readonly occurrences: readonly Readonly<{ spaceOccurrenceId: string; levelId: string }>[];
  readonly coverage: Readonly<{ selectableOccurrences: readonly string[] }>;
}

export function exampleHomeView(companion: ExampleCompanion): ReadyView {
  const { workspaceId, homeId } = companion.scope;
  const entries: Entry[] = [], ids = new Map<string, string>();
  const place = (sourceId: string, name: string, semanticKind: Entry['semanticKind'], parent: string | null) => {
    const id = `00000000-0000-4000-8000-${(0xe1000 + entries.length).toString(16).padStart(12, '0')}`;
    ids.set(sourceId, id);
    entries.push({
      workspaceId, homeId, key: JSON.stringify([workspaceId, homeId, SOURCE, COLLECTION, 'homebox-entity', id]),
      source: { sourceInstanceId: SOURCE, collectionId: COLLECTION, sourceKind: 'homebox-entity', externalId: id },
      entity: { id, name, description: '', entityType: LOCATION_TYPE, parent: parent === null ? null : { id: parent }, archived: false,
        quantity: null, manufacturer: null, modelNumber: null, serialNumber: null, notes: null },
      kind: 'place', semanticKind, sourceState: 'present', cacheStatus: 'fresh', sourceUpdatedAt: null, retrievedAt: RETRIEVED,
      aliases: [], mobility: 'unknown', attachments: [], maintenance: [], nativeLinks: [],
      networkBound: false, networkStates: [], networkRelations: [],
    });
  };
  for (const building of companion.buildings)
    if (building.levelIds.length > 0) place(building.buildingId, building.label, 'building', null);
  for (const level of companion.levels) place(level.levelId, level.label, 'floor', ids.get(level.buildingId) ?? null);
  const levelOf = new Map(companion.occurrences.map(row => [row.spaceOccurrenceId, row.levelId]));
  const selectable = new Set(companion.coverage.selectableOccurrences);
  for (const room of companion.rooms) {
    const first = room.occurrenceIds.find(id => selectable.has(id));
    if (first !== undefined) place(room.roomId, room.label, 'room', ids.get(levelOf.get(first) ?? '') ?? null);
  }
  return {
    status: 'ready', scope: { workspaceId, homeId }, homeLabel: EXAMPLE_LABEL, now: RETRIEVED, canEdit: false,
    homes: [{ workspaceId, homeId, label: EXAMPLE_LABEL }], entries,
    caches: [{ owner: 'homebox', status: 'fresh', displayStatus: 'fresh', sourceInstanceId: SOURCE, collectionId: COLLECTION,
      lastSuccessfulFetchAt: RETRIEVED }],
  };
}
