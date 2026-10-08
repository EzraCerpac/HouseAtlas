import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AtlasContentActions } from '../app/App';
import { createGeometryClient, type GeometryRead } from '../api/geometry-client';
import type { ReadyView } from '../app/types';
import { projectView } from './adapters/read';
import { StoreProvider } from './state/store';
import { NativeActions } from './components/NativeActions';
import { App } from './App';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/atlas.css';
import './styles/panels.css';
import './styles/integration.css';

/** The existing session/view/stock owners remain above this presentation seam. */
export function LanternHost({ view, actions, nativeContent }: {
  view: ReadyView; actions: AtlasContentActions; nativeContent: ReactNode;
}) {
  const client = useMemo(() => createGeometryClient(), []);
  const session = actions.session?.expiresAt;
  const [geometry, setGeometry] = useState<{ view: ReadyView; session: typeof session; read: GeometryRead } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void client.read(view.scope, controller.signal).then((read) => {
      if (!controller.signal.aborted) setGeometry({ view, session, read });
    }).catch(() => {
      if (!controller.signal.aborted) setGeometry({ view, session, read: { status: 'unavailable' } });
    });
    return () => controller.abort();
  }, [client, view, session]);
  const current = geometry?.view === view && geometry.session === session ? geometry.read : { status: 'loading' as const };
  const projection = useMemo(() => projectView(view, current), [view, current]);
  const ports = useMemo(() => ({ ...actions, nativeContent }), [actions, nativeContent]);
  return <StoreProvider key={projection.house.id} projection={projection} actions={ports}>
    <App />
    <NativeActions />
    {actions.notice && <p className="lantern-reload-notice" role="status">{actions.notice}</p>}
  </StoreProvider>;
}
