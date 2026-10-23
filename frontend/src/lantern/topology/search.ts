import type { SearchHit } from '../data/query';
import type { HouseData } from '../data/types';
import type { Action } from '../state/store';
import type { Location, TopologyIndex } from './model';

/** A native identity stays separate from saved-view record IDs. */
export interface NativePlaceSearchHit extends SearchHit {
  readonly location: Location;
}

export function nativePlaceSearch(index: TopologyIndex | null, status: string, query: string): NativePlaceSearchHit[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (status !== 'ready' || !index || !terms.length) return [];
  return [...index.locations.values()].flatMap(location => {
    const title = location.label, text = title.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (text.startsWith(term)) score += 100;
      else if (text.split(/[\s,()'-]+/).some(word => word.startsWith(term))) score += 70;
      else if (text.includes(term)) score += 45;
      else return [];
    }
    const owner = location.labelOwner === 'atlas' ? 'Atlas name' : location.labelOwner === 'homebox' ? 'HomeBox name'
      : location.labelOwner === 'conflict' ? 'Naming withheld: multiple reviewed classifications' : 'Name not supplied';
    const source = [...new Set(index.data.sourceStatuses)].join(', ');
    const classification = location.semantics.map(semantic => semantic.payload.semanticKind).join(', ') || 'not reviewed';
    return [{ id: location.id, kind: 'space' as const, title, score, location,
      context: `${owner} · Atlas identity ${location.id} · Classification: ${classification} · Atlas records: ${source}${location.selectId ? '' : ' · Opens whole-home Places'}` }];
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/** Revalidate the exact admitted location on activation, including its current
 * saved-view join. A native UUID is never sent to saved-view selection. */
export function openNativePlaceSearchHit(hit: NativePlaceSearchHit, index: TopologyIndex | null, status: string,
  house: HouseData, ports: {
    readonly select: (id: null) => void;
    readonly chooseSaved: (hit: Pick<SearchHit, 'id' | 'kind'>) => void;
    readonly chooseBuilding: (id: null) => void;
    readonly dispatch: (action: Action) => void;
    readonly close: () => void;
  }): boolean {
  if (status !== 'ready' || index?.locations.get(hit.id) !== hit.location) return false;
  const id = hit.location.selectId;
  if (id && house.spaces.some(space => space.id === id)) {
    ports.chooseSaved({ id, kind: 'space' });
  } else {
    ports.select(null);
    ports.chooseBuilding(null);
    ports.dispatch({ type: 'view', view: 'rooms' });
    ports.close();
  }
  return true;
}
