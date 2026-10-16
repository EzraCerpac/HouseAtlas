import { createContext, useContext } from 'react';
import type { SourceDocumentsPort } from './source-documents/types';
import type { LocalModelReviewOptions } from './electrical-documentary/types';
import type { SiteSourcePort } from './site-artifacts/types';
import type { ModelOverviewPort } from './source-models/overview-types';

/** Local model files plus optional source-owned saved overview/site readers.
 * Electrical review stays unavailable unless the composition injects a
 * bridge factory and explicit targets; `session` retires a renderer owner
 * when the session or scope changes. */
export interface SourceModelPort extends LocalModelReviewOptions {
  readonly localFiles: 'browser-only';
  readonly overview?: ModelOverviewPort;
  /** One pinned site artifact publication; absent leaves the Site view out. */
  readonly site?: SiteSourcePort;
}
/** Optional source-export ports. Absence leaves every native capability intact. */
export interface SourcePorts { readonly models?: SourceModelPort; readonly documents?: SourceDocumentsPort }
export const SourcePortsContext = createContext<SourcePorts>({});
export const useSourcePorts = () => useContext(SourcePortsContext);
