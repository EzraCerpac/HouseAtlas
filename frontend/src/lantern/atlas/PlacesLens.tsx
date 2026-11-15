import { lazy } from 'react';
import { DeferredView } from '../DeferredView';

// Loaded when the lens first opens, as the Network lens is; no source read
// starts on load or mount. The building ledger and native place tools ride along.
const PlacesContent = lazy(() => import('../views/RoomsView').then(module => ({ default: module.PlacesContent })));

/** The HomeBox and Atlas topology half of the Rooms & places lens. Its
 * owners are unchanged: building and level records and native place actions
 * through the topology provider, HomeBox places through the store selection,
 * geometry records through the projection. Rendered only while the lens is
 * open, so topology reads start and stop with it. Native model rooms, where a
 * model is open, are listed above it by the Atlas itself; no join between the
 * two is drawn here. */
export function PlacesLens() {
  return <div className="lens-sources">
    <DeferredView label="Rooms & places"><PlacesContent /></DeferredView>
  </div>;
}
