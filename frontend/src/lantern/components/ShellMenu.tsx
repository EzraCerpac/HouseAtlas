import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';
import { Icon } from './Icon';

/** The phone layout in app.css, where the strip's tools share this menu. */
const NARROW = '(max-width: 759px)';

export interface ShellMenuItem {
  readonly label: string;
  readonly icon: string;
  readonly open: () => void;
  /** The same tool standing in the strip on wider screens. */
  readonly equivalent?: RefObject<HTMLElement | null>;
}

/** The title strip's narrow form: tools that stand in the strip on wider
 * screens share one menu. Choosing a row hands focus back to the menu button
 * first, so the dialog it opens returns focus there when it closes. Either way
 * across the breakpoint the menu closes and focus follows the tool it was on:
 * widening moves focus held inside the menu to the row's own tool in the
 * strip, narrowing moves focus on a strip tool to the menu's button; the main
 * sheet takes it when neither is shown. */
export function ShellMenu({ items }: { readonly items: readonly ShellMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = useRef(items);
  current.current = items;
  // Whether focus is in this menu, kept even if the browser drops focus to the
  // document when the menu is hidden.
  const held = useRef(false);
  useEffect(() => {
    const query = window.matchMedia?.(NARROW);
    if (!query) return;
    // The last element to take focus anywhere: if the browser drops focus to
    // the document as a strip tool is hidden, this still names that tool.
    let last: Element | null = document.activeElement;
    const focused = (event: globalThis.FocusEvent) => { last = event.target instanceof Element ? event.target : null; };
    const changed = () => {
      setOpen(false);
      if (query.matches) {
        // Narrowing hides the strip's own tools: focus on one of them moves to
        // this menu's button. Focus anywhere else, such as a dialog, stays.
        const active = document.activeElement;
        const dropped = active === null || active === document.body;
        const tools = current.current.flatMap(item => item.equivalent?.current ? [item.equivalent.current] : []);
        if (!tools.some(tool => tool === active || (dropped && tool === last))) return;
        const target = button.current;
        (target?.isConnected && target.getClientRects().length > 0 ? target : document.getElementById('main'))?.focus({ preventScroll: true });
        return;
      }
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && !!root.current?.contains(active);
      // Focus elsewhere was put there deliberately; only focus this menu held moves.
      if (!inside && !(held.current && (active === null || active === document.body))) return;
      held.current = false;
      const row = inside && active instanceof HTMLElement ? active.closest<HTMLElement>('[data-shell-item]') : null;
      const target = current.current.find(item => item.label === row?.dataset.shellItem)?.equivalent?.current;
      (target?.isConnected && target.getClientRects().length > 0 ? target : document.getElementById('main'))?.focus({ preventScroll: true });
    };
    document.addEventListener('focusin', focused);
    query.addEventListener('change', changed);
    return () => {
      document.removeEventListener('focusin', focused);
      query.removeEventListener('change', changed);
    };
  }, []);
  const blur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    if (next !== null) held.current = false;
    setOpen(false);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault(); event.stopPropagation();
    setOpen(false); button.current?.focus();
  };
  return <div ref={root} className="shell-menu" onFocus={() => { held.current = true; }} onBlur={blur} onKeyDown={key}>
    <button ref={button} type="button" className="icon-btn shell-menu-btn" aria-label="More tools" aria-expanded={open}
      aria-controls={panelId} onClick={() => setOpen(value => !value)}><Icon name="menu" size={20} /></button>
    <div id={panelId} className="shell-menu-panel" hidden={!open}>
      {items.map(item => <button key={item.label} type="button" className="shell-menu-row" data-shell-item={item.label} onClick={() => {
        button.current?.focus(); setOpen(false); item.open();
      }}><Icon name={item.icon} size={18} /><span>{item.label}</span></button>)}
    </div>
  </div>;
}
