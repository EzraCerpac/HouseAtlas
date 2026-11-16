import type { SearchHit } from '../data/query';
import type { HouseData } from '../data/types';
import type { Action } from '../state/store';
import type { Location, TopologyIndex } from './model';

/** A native identity stays separate from saved-view record IDs. The visible
 * line says who owns the place and what tells it apart; `description` keeps
 * the full Atlas identity for assistive technology and the opened record. */
export interface NativePlaceSearchHit extends SearchHit {
  readonly location: Location;
  readonly owner: 'Atlas place';
  readonly description: string;
}

/** The reviewed Atlas places that hold this one, innermost first, followed
 * while each place has exactly one accepted membership parent. Any edge that is
 * not supported keeps its uncertainty beside the parent's name. */
function atlasParents(index: TopologyIndex, location: Location): string[] {
  const names: string[] = [], seen = new Set([location.id]);
  for (let id = location.id; names.length < 6;) {
    const edges = index.membership.filter(edge => edge.payload.to.ref.recordId === id);
    const parent = edges.length === 1 ? index.locations.get(edges[0]!.payload.from.ref.recordId) : undefined;
    if (!parent || seen.has(parent.id)) break;
    const status = edges[0]!.payload.uncertainty.status;
    names.push(status === 'supported' ? parent.label : `${parent.label} (${status})`);
    seen.add(id = parent.id);
  }
  return names;
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
    const owner = location.labelOwner === 'atlas' ? 'Atlas name' : location.labelOwner === 'homebox' ? 'Name from HomeBox'
      : location.labelOwner === 'conflict' ? 'Naming withheld: multiple reviewed classifications' : 'Name not supplied';
    const source = [...new Set(index.data.sourceStatuses)].join(', ');
    const kinds = location.semantics.map(semantic => semantic.payload.semanticKind).join(', ');
    const classification = kinds ? kinds.charAt(0).toUpperCase() + kinds.slice(1) : 'Classification not reviewed';
    const parents = atlasParents(index, location);
    const context = [parents.length ? `In ${parents.join(', ')}` : null, classification,
      location.labelOwner === 'atlas' ? null : owner, `Atlas records ${source}`,
      location.selectId ? null : 'Opens whole-home Places'].filter(Boolean).join(' · ');
    return [{ id: location.id, kind: 'space' as const, title, score, location, owner: 'Atlas place' as const, context,
      description: `${owner}. Atlas identity ${location.id}.` }];
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
