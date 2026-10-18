import type { ReadyView, Scope } from '../src/app/types';
import type { NativeSourceDocumentReaderOptions } from './native-source-document-reader';
import type { SourceDocumentReader, SourceDocumentsPort } from '../src/lantern/source-documents/types';

type Session = { readonly expiresAt: string };
type State = { readonly session: Session | null; readonly scope: Scope | null; readonly view: ReadyView | null };
/** One port per completed authenticated view. Host changes synchronously retire
 * its binding, independently of React's eventual effect cleanup. */
export function createSourceDocumentsService(options: {
  readonly state: () => State;
  readonly origin: string;
  readonly loadReader: () => Promise<{ createNativeSourceDocumentReader(options: NativeSourceDocumentReaderOptions): SourceDocumentReader }>;
}) {
  const unavailable: SourceDocumentsPort = { async createReader() { throw new Error('Source documents are unavailable for the current view'); } };
  const listeners = new Set<() => void>();
  let selected: { readonly session: Session; readonly scope: Scope; readonly view: ReadyView;
    readonly expiresAt: string; readonly port: SourceDocumentsPort } | null = null;
  function current(): SourceDocumentsPort {
    const { session, scope, view } = options.state();
    const service = view?.sourceDocumentsService;
    const admitted = session && scope && view && view.scope === scope
      && service?.profile === 'houseatlas.geodata-document-read.v2' && service.available === true
      && Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt) > Date.now();
    if (admitted && selected?.session === session && selected.scope === scope && selected.view === view
      && selected.expiresAt === session.expiresAt) return selected.port;
    if (!admitted && !selected) return unavailable;
    selected = null;
    if (admitted) {
      // Unique even when a replacement view reuses the session and scope objects.
      const binding = Object.freeze({ sessionIdentity: Object.freeze({}), expiresAt: session.expiresAt, scope });
      const port: SourceDocumentsPort = { async createReader() {
        const isCurrent = () => current() === port;
        if (!isCurrent()) throw new Error('Source documents are unavailable for the current view');
        const module = await options.loadReader();
        if (!isCurrent()) throw new Error('Source documents are unavailable for the current view');
        return module.createNativeSourceDocumentReader({ origin: options.origin,
          getBinding: () => isCurrent() ? binding : null,
          subscribeBinding(changed) { listeners.add(changed); return () => { listeners.delete(changed); }; },
        });
      } };
      selected = { session, scope, view, expiresAt: session.expiresAt, port };
    }
    for (const changed of [...listeners]) changed();
    return selected?.port ?? unavailable;
  }
  return { current, refresh: () => { current(); } };
}
