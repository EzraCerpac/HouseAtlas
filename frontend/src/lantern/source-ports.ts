import { createContext, useContext } from 'react';
import type { SourceDocumentsPort } from './source-documents/types';
import type { ElectricalLibraryPort } from './electrical-library/types';
import type { SiteSourcePort } from './site-artifacts/types';
import type { UnifiedAtlasPort } from './unified-atlas/types';

/** Optional source-owned house model and site readers. */
export interface SourceModelPort {
  /** The selected house model publication; with a selection it is the Atlas. */
  readonly atlas?: UnifiedAtlasPort;
  /** One pinned site artifact publication; absent leaves the Site view out. */
  readonly site?: SiteSourcePort;
}
/** Optional source-export ports. Absence leaves every native capability intact. */
export interface SourcePorts {
  readonly models?: SourceModelPort;
  readonly documents?: SourceDocumentsPort;
  readonly electricalLibrary?: ElectricalLibraryPort;
}
export const SourcePortsContext = createContext<SourcePorts>({});
export const useSourcePorts = () => useContext(SourcePortsContext);
