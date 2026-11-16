import type { Entry, ReadyView } from '../../app/types';
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

/** HomeBox's own parentage within the place's source collection: entries
 * recorded directly in the place. Places inside it are counted, and their
 * belongings are not included. */
export function homeboxContents(entries: Iterable<readonly [string, Entry]>, place: Entry) {
  const belongings: { readonly id: string; readonly entry: Entry }[] = [];
  let innerPlaces = 0;
  for (const [id, entry] of entries) {
    if (entry.workspaceId !== place.workspaceId || entry.homeId !== place.homeId || entry.source.sourceInstanceId !== place.source.sourceInstanceId
      || entry.source.collectionId !== place.source.collectionId || entry.source.sourceKind !== place.source.sourceKind
      || entry.entity.parent?.id !== place.entity.id) continue;
    if (entry.kind === 'item') belongings.push({ id, entry });
    else if (entry.kind === 'place') innerPlaces++;
  }
  return { belongings, innerPlaces };
}
