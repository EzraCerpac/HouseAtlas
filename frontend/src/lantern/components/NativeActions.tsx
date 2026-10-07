import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';

/** Preserve the existing feature surfaces while they migrate to Lantern seams.
 * Kept mounted within the same session/scope boundary to retain uncertain receipts. */
export function NativeActions() {
  const { state, dispatch, actions } = useStore();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state.nativeOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); dispatch({ type: 'nativeOpen', open: false }); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); if (previous?.isConnected) previous.focus(); };
  }, [state.nativeOpen, dispatch]);
  return <div ref={panel} className="native-actions-panel" hidden={!state.nativeOpen} role="region" aria-label="Atlas tools">
    <button type="button" onClick={() => dispatch({ type: 'nativeOpen', open: false })}>Close Atlas tools</button>
    {actions.nativeContent}
  </div>;
}
