import { useLayoutEffect, useRef } from 'react';
import { useStore } from '../state/store';

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

/** Preserve the existing feature surfaces while they migrate to Lantern seams.
 * Kept mounted within the same session/scope boundary to retain uncertain receipts. */
export function NativeActions() {
  const { state, dispatch, actions } = useStore();
  const panel = useRef<HTMLDivElement>(null);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useLayoutEffect(() => {
    if (!state.nativeOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = panel.current;
    if (!el) return;
    // Isolate sibling branches without hiding or unmounting native receipts.
    const ownedInert = new Set<HTMLElement>();
    const isolate = () => {
      for (let branch: HTMLElement | null = el; branch && branch !== document.body; branch = branch.parentElement) {
        const parent = branch.parentElement;
        if (!parent) break;
        for (const sibling of parent.children) {
          if (sibling !== branch && sibling instanceof HTMLElement && !sibling.inert) {
            sibling.inert = true;
            ownedInert.add(sibling);
          }
        }
      }
    };
    isolate();
    const observer = new MutationObserver(isolate);
    for (let branch: HTMLElement | null = el; branch && branch !== document.body; branch = branch.parentElement) {
      if (branch.parentElement) observer.observe(branch.parentElement, { childList: true });
    }
    (el?.querySelector<HTMLButtonElement>('button') ?? el)?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !el) return;
      const modal = event.target instanceof HTMLElement ? event.target.closest('[aria-modal="true"]') : null;
      if (modal && modal !== el) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        dispatchRef.current({ type: 'nativeOpen', open: false }); return;
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(item => item.tabIndex >= 0 && !item.matches(':disabled') && !item.closest('[hidden], [inert]') && item.getClientRects().length > 0);
      const first = items[0], last = items[items.length - 1];
      if (!first || !last) { event.preventDefault(); el.focus(); }
      else if (!el.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      observer.disconnect();
      for (const sibling of ownedInert) sibling.inert = false;
      (previous?.isConnected && previous.getClientRects().length ? previous : document.getElementById('main'))?.focus();
    };
  }, [state.nativeOpen]);
  return <div ref={panel} className="native-actions-panel" hidden={!state.nativeOpen} role="dialog" aria-modal={state.nativeOpen ? true : undefined} aria-label="Atlas tools" tabIndex={-1}>
    <button type="button" onClick={() => dispatch({ type: 'nativeOpen', open: false })}>Close Atlas tools</button>
    {actions.nativeContent}
  </div>;
}
