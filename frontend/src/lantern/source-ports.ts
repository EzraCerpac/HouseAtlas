import { createContext, useContext } from 'react';
import type { SourceDocumentsPort } from './source-documents/types';
import type { LocalModelReviewOptions } from './electrical-documentary/types';
import type { SiteSourcePort } from './site-artifacts/types';

/** Browser-only model file reading. No saved model or site publication is
 * connected here; those artifact reads stay absent until they are live.
 * Electrical review stays unavailable unless the composition injects a
 * bridge factory and explicit targets; `session` retires a renderer owner
 * when the session or scope changes. */
export interface SourceModelPort extends LocalModelReviewOptions {
  readonly localFiles: 'browser-only';
  /** One pinned site artifact publication; absent leaves the Site view out. */
  readonly site?: SiteSourcePort;
}
/** Optional source-export ports. Absence leaves every native capability intact. */
export interface SourcePorts { readonly models?: SourceModelPort; readonly documents?: SourceDocumentsPort }
export const SourcePortsContext = createContext<SourcePorts>({});
export const useSourcePorts = () => useContext(SourcePortsContext);
