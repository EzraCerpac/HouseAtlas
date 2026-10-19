import { PlacesContent } from '../views/RoomsView';

/** The HomeBox and Atlas topology half of the Rooms & places lens. Its
 * owners are unchanged: building and level records and native place actions
 * through the topology provider, HomeBox places through the store selection,
 * geometry records through the projection. Rendered only while the lens is
 * open, so topology reads start and stop with it. Native model rooms, where a
 * model is open, are listed above it by the Atlas itself; no join between the
 * two is drawn here. */
export function PlacesLens() {
  return <div className="lens-sources">
    <PlacesContent />
  </div>;
}
