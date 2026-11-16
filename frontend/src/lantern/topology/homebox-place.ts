import type { Cache, Entry, ReadyView } from '../../app/types';
import type { SourceKey } from '../../api/generated/contracts';
import type { TopologyIndex } from './model';

/** The HomeBox place a reviewed binding names for an Atlas place.
 * `unlinked`: no active, accepted HomeBox binding; `ambiguous`: accepted
 * bindings name more than one HomeBox record; `absent`: the named record is
 * not a place in saved HomeBox information. */
export type HomeboxPlaceLink =
  | { readonly status: 'unlinked' | 'ambiguous' | 'absent' }
  | { readonly status: 'linked'; readonly place: Entry };

const sameKey = (a: SourceKey, b: SourceKey) => a.sourceInstanceId === b.sourceInstanceId
  && a.collectionId === b.collectionId && a.sourceKind === b.sourceKind && a.externalId === b.externalId;

/** Joins only through the index's reviewed bindings (active, accepted, for
 * this active Atlas location) on the complete source key, within the view's
 * scope. Never compares an Atlas ID with a HomeBox ID, and never uses names,
 * graph position or tree depth. */
export function homeboxPlaceOf(index: TopologyIndex, view: ReadyView, atlasPlaceId: string): HomeboxPlaceLink {
  const keys: SourceKey[] = [];
  for (const { payload } of index.locations.get(atlasPlaceId)?.bindings ?? [])
    if (payload.source.sourceKind === 'homebox-entity' && !keys.some(key => sameKey(key, payload.source))) keys.push(payload.source);
  if (keys.length === 0) return { status: 'unlinked' };
  if (keys.length > 1) return { status: 'ambiguous' };
  const places = view.entries.filter(entry => entry.workspaceId === view.scope.workspaceId && entry.homeId === view.scope.homeId
    && entry.kind === 'place' && sameKey(entry.source, keys[0]!));
  return places.length === 1 ? { status: 'linked', place: places[0]! } : { status: places.length ? 'ambiguous' : 'absent' };
}

/** A retained record HomeBox no longer holds as present and active:
 * archived, confirmed deleted, unresolved or awaiting review. */
export const flaggedRecord = (entry: Entry) => entry.entity.archived || entry.sourceState !== 'present';

/** HomeBox's own parentage within the place's source collection: records
 * recorded directly in the place, present and active ones first, then
 * flagged ones (each in source order). Items and records of unknown kind
 * (`unclassified`) are both listed; places inside it are counted, and their
 * contents are not included. */
export function homeboxContents(entries: Iterable<readonly [string, Entry]>, place: Entry) {
  const belongings: { readonly id: string; readonly entry: Entry; readonly flagged: boolean; readonly unclassified: boolean }[] = [];
  let innerPlaces = 0;
  for (const [id, entry] of entries) {
    if (entry.workspaceId !== place.workspaceId || entry.homeId !== place.homeId || entry.source.sourceInstanceId !== place.source.sourceInstanceId
      || entry.source.collectionId !== place.source.collectionId || entry.source.sourceKind !== place.source.sourceKind
      || entry.entity.parent?.id !== place.entity.id) continue;
    if (entry.kind === 'place') innerPlaces++;
    else belongings.push({ id, entry, flagged: flaggedRecord(entry), unclassified: entry.kind !== 'item' });
  }
  return { belongings: [...belongings.filter(row => !row.flagged), ...belongings.filter(row => row.flagged)], innerPlaces };
}

/** The HomeBox copy state for the place's own collection: a cache naming that
 * source instance and collection, or the one cache whose unnamed identifiers
 * do not contradict them. Otherwise null: freshness for it is not known. */
export function homeboxCacheFor(place: Entry, caches: readonly Cache[]): Cache | null {
  const fits = caches.filter(cache => cache.owner === 'homebox'
    && (cache.sourceInstanceId == null || cache.sourceInstanceId === place.source.sourceInstanceId)
    && (cache.collectionId == null || cache.collectionId === place.source.collectionId));
  return fits.find(cache => cache.sourceInstanceId === place.source.sourceInstanceId && cache.collectionId === place.source.collectionId)
    ?? (fits.length === 1 ? fits[0]! : null);
}

/** What the card shows for a linked place, from the visible Home records
 * (archive choice applied): `hidden` when the place itself is archived and
 * archived records are not included. */
export function homeboxPlaceRecords(place: Entry, visible: readonly (readonly [string, Entry])[], caches: readonly Cache[]) {
  if ((place.entity.archived || place.sourceState === 'archived') && !visible.some(([, entry]) => entry.key === place.key
    && entry.workspaceId === place.workspaceId && entry.homeId === place.homeId)) return { hidden: true as const };
  return { hidden: false as const, flagged: flaggedRecord(place), ...homeboxContents(visible, place), cache: homeboxCacheFor(place, caches) };
}
