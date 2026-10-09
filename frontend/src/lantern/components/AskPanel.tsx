import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AiSettingsSection } from '../../ai/host/index.js';
import { useStore } from '../state/store';
import { Icon } from './Icon';

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

/** Same Lantern panel; the existing scoped host owns real AI lifecycle/receipts. */
export function AskPanel() {
  const { state, dispatch } = useStore();
  const blocked = !!state.dialog || state.settingsOpen || state.nativeOpen || state.searchOpen;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const panel = useRef<HTMLElement>(null);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const [modal, setModal] = useState(() => window.matchMedia('(max-width: 759px)').matches);
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = panel.current;
    const narrow = window.matchMedia('(max-width: 759px)');
    const focus = () => (el?.querySelector<HTMLButtonElement>('button') ?? el)?.focus();
    focus();
    const resize = () => {
      setModal(narrow.matches);
      if (narrow.matches && !blockedRef.current && !el?.contains(document.activeElement)) focus();
    };
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || blockedRef.current || !el) return;
      const activeModal = event.target instanceof HTMLElement ? event.target.closest('[aria-modal="true"]') : null;
      if (activeModal && activeModal !== el) return;
      if (!narrow.matches && !el.contains(document.activeElement)) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        dispatchRef.current({ type: 'ask', open: false }); return;
      }
      if (event.key !== 'Tab' || !narrow.matches) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(item => item.tabIndex >= 0 && !item.matches(':disabled') && !item.closest('[hidden], [inert]') && item.getClientRects().length > 0);
      const first = items[0], last = items[items.length - 1];
      if (!first || !last) { event.preventDefault(); el.focus(); }
      else if (!el.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key, true);
    narrow.addEventListener('change', resize);
    return () => {
      document.removeEventListener('keydown', key, true);
      narrow.removeEventListener('change', resize);
      (opener?.isConnected && opener.getClientRects().length ? opener : document.getElementById('main'))?.focus();
    };
  }, []);
  useEffect(() => {
    if (modal && !blocked && !panel.current?.contains(document.activeElement))
      (panel.current?.querySelector<HTMLButtonElement>('button') ?? panel.current)?.focus();
  }, [modal, blocked]);
  return <aside ref={panel} className="ask" role={modal && !blocked ? 'dialog' : undefined} aria-modal={modal && !blocked ? true : undefined} inert={blocked} aria-labelledby="ask-title" tabIndex={-1}>
    <header className="ask-head"><div><h2 id="ask-title">Ask the atlas</h2></div>
      <button type="button" className="icon-btn" aria-label="Close assistant" onClick={() => dispatch({ type: 'ask', open: false })}><Icon name="close" size={18} /></button>
    </header>
    <div className="ask-log"><AiSettingsSection /></div>
  </aside>;
}
