import { lazy } from 'react';
import { DeferredView } from '../DeferredView';

// Loaded when the lens first opens, as the Network view was; no source read
// starts on load or mount. The relations read stays behind its own button.
const NetworkSources = lazy(() => import('../views/NetworkView').then(module => ({ default: module.NetworkSources })));

/** The saved Network half of the Network lens: relations in the saved view,
 * the explicit paged read and the projected house's observed links where it
 * has devices. Rendered only while the lens is open. */
export function NetworkLens() {
  return <section className="lens-sources" aria-labelledby="network-lens-saved">
    <h3 id="network-lens-saved" className="lens-source-title">Saved Network relations</h3>
    <DeferredView label="Network"><NetworkSources /></DeferredView>
  </section>;
}
