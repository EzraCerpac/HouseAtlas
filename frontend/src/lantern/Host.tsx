import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { AtlasContentActions } from '../app/App';
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
  const projection = useMemo(() => projectView(view), [view]);
  const ports = useMemo(() => ({ ...actions, nativeContent }), [actions, nativeContent]);
  return <StoreProvider key={projection.house.id} projection={projection} actions={ports}>
    <App />
    <NativeActions />
    {actions.notice && <p className="lantern-reload-notice" role="status">{actions.notice}</p>}
  </StoreProvider>;
}
