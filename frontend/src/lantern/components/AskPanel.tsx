import { useEffect } from 'react';
import { AiSettingsSection } from '../../ai/host/index.js';
import { useStore } from '../state/store';
import { Icon } from './Icon';

/** Same Lantern panel; the existing scoped host owns real AI lifecycle/receipts. */
export function AskPanel() {
  const { dispatch } = useStore();
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') dispatch({ type: 'ask', open: false }); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); opener?.focus(); };
  }, [dispatch]);
  return <aside className="ask" aria-labelledby="ask-title">
    <header className="ask-head"><div><h2 id="ask-title">Ask the atlas</h2></div>
      <button type="button" className="icon-btn" aria-label="Close assistant" onClick={() => dispatch({ type: 'ask', open: false })}><Icon name="close" size={18} /></button>
    </header>
    <div className="ask-log"><AiSettingsSection /></div>
  </aside>;
}
