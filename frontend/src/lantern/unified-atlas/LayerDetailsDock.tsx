import { useLayoutEffect, useRef, useSyncExternalStore, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react';

const SHORT_VIEWPORT = '(max-height: 480px)';
const subscribe = (changed: () => void) => {
  const query = window.matchMedia(SHORT_VIEWPORT);
  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
};
const shortViewport = () => window.matchMedia(SHORT_VIEWPORT).matches;
const serverViewport = () => false;

/** Same height boundary as the short-stage CSS; compactness comes from the stage. */
export function useShortLayerDetails(compact: boolean) {
  return useSyncExternalStore(subscribe, shortViewport, serverViewport) && compact;
}

type Drawer = 'floors' | 'layers' | null;

/** Coordinate the stage's queued focus with the dock's child layout effect.
 * A desktop key can disappear before the parent opens the compact drawer.
 * When that drawer opens modally, replace its temporary Close focus with
 * the original key, then reveal that key within the reading area. */
export function useLayerDetailsFocus({ compact, drawer, dock, trigger, focusOrigin, setDrawer }: {
  readonly compact: boolean;
  readonly drawer: Drawer;
  readonly dock: RefObject<HTMLDialogElement | null>;
  readonly trigger: RefObject<HTMLButtonElement | null>;
  readonly focusOrigin: RefObject<HTMLElement | null>;
  readonly setDrawer: Dispatch<SetStateAction<Drawer>>;
}) {
  const modeFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const active = document.activeElement;
    const origin = active instanceof HTMLElement && active !== document.body ? active : focusOrigin.current;
    if (!origin) return;
    const keys = dock.current;
    if (compact && keys?.contains(origin) && keys.getClientRects().length === 0) {
      modeFocus.current = origin; setDrawer('layers');
    } else if (!compact && origin === trigger.current) {
      setDrawer(value => value === 'layers' ? null : value);
      dock.current?.querySelector<HTMLElement>('.ua-key-head')?.focus({ preventScroll: true });
    }
  }, [compact, dock, trigger, focusOrigin, setDrawer]);
  useLayoutEffect(() => {
    const target = modeFocus.current; modeFocus.current = null;
    const active = document.activeElement, keys = dock.current;
    const lost = active === null || active === document.body;
    const modalInitialFocus = keys?.matches(':modal') && active === keys.querySelector('.ua-layer-details-close');
    if (target && (lost || modalInitialFocus) && target.isConnected && target.getClientRects().length > 0
      && getComputedStyle(target).visibility === 'visible' && !target.closest('[inert], [hidden], [aria-hidden="true"]')
      && !target.matches(':disabled')) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [drawer, dock]);
}

const TABBABLE = 'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
/** Tab past either end of the modal sheet wraps inside it. A native modal
 * leaves the page inert but still lets Tab reach the browser's own controls. */
function wrapTab(dialog: HTMLElement, event: { readonly shiftKey: boolean; preventDefault(): void }) {
  const stops = [...dialog.querySelectorAll<HTMLElement>(TABBABLE)].filter(element => !element.matches(':disabled')
    && element.getClientRects().length > 0 && !element.closest('[inert], [hidden]'));
  const first = stops[0], last = stops.at(-1), active = document.activeElement;
  if (!first || !last) return;
  if (event.shiftKey ? active === first || !dialog.contains(active) : active === last) {
    event.preventDefault(); (event.shiftKey ? last : first).focus();
  }
}

/** A short sheet stops above the selected room's row, so the room stays in
 * view while its layers are read; at most half the height is held back. */
function reserveRoomRow(dialog: HTMLDialogElement) {
  const head = dialog.closest('.ua-shell')?.querySelector<HTMLElement>('.ua-inspector .ua-sheet-head');
  const rect = head && head.getClientRects().length > 0 ? head.getBoundingClientRect() : null;
  const height = window.innerHeight;
  const reserve = rect && rect.top < height && rect.bottom > 0 ? Math.min(height / 2, Math.ceil(height - rect.top)) : 0;
  dialog.style.setProperty('--ua-room-row', `${reserve}px`);
}

/** Keep one dock and one set of keys mounted across the responsive boundary.
 * Only showModal enters the top layer; native modal behavior makes the rest
 * of the document inert and contains keyboard focus until close or resize. */
export function LayerDetailsDock({ dock, trigger, id, short, expanded, close, children }: {
  readonly dock: RefObject<HTMLDialogElement | null>;
  readonly trigger: RefObject<HTMLButtonElement | null>;
  readonly id: string;
  readonly short: boolean;
  readonly expanded: boolean;
  readonly close: () => void;
  readonly children: ReactNode;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const dialog = dock.current;
    if (!dialog) return;
    const wasModal = dialog.matches(':modal');
    const active = document.activeElement;
    const focused = active instanceof HTMLElement ? active : null;
    const heldFocus = focused !== null && dialog.contains(focused);
    if (short && expanded) {
      if (!wasModal) {
        // An open nonmodal dialog must close before it can become modal.
        if (dialog.open) dialog.close();
        dialog.showModal();
        // A focused key remains the same key when the viewport becomes short,
        // revealed in the body that now scrolls instead of the dock.
        if (heldFocus) { focused.focus({ preventScroll: true }); focused.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        else closeButton.current?.focus({ preventScroll: true });
      }
      return;
    }
    if (dialog.open && (wasModal || short)) dialog.close();
    // The nonmodal dock participates in the original desktop/phone layout.
    if (!short) dialog.setAttribute('open', '');
    if (wasModal) {
      const available = (element: HTMLElement | null): element is HTMLElement => element !== null
        && element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible'
        && !element.closest('[inert], [hidden]');
      const opener = trigger.current;
      const target = !short && heldFocus && focused !== closeButton.current ? focused
        : available(opener) ? opener : dialog.querySelector<HTMLElement>('.ua-key-head');
      (available(target) ? target : dialog.closest('.ua-shell')?.querySelector<HTMLElement>('.ua-viewport'))
        ?.focus({ preventScroll: true });
    }
  }, [dock, trigger, short, expanded]);

  useLayoutEffect(() => {
    const dialog = dock.current;
    if (!dialog || !short || !expanded) return;
    const measure = () => reserveRoomRow(dialog);
    measure(); window.addEventListener('resize', measure);
    return () => { window.removeEventListener('resize', measure); dialog.style.removeProperty('--ua-room-row'); };
  }, [dock, short, expanded]);

  useLayoutEffect(() => {
    const dialog = dock.current;
    return () => { if (dialog?.open) dialog.close(); };
  }, [dock]);

  return <dialog ref={dock} id={id} open className={`ua-keys ua-layer-dialog${expanded && !short ? ' is-unfolded' : ''}`}
    role={short ? 'dialog' : 'group'} aria-modal={short && expanded ? true : undefined}
    aria-label={short ? undefined : 'Layer details'} aria-labelledby={short ? `${id}-title` : undefined}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
    onKeyDown={event => {
      if (short && expanded && event.key === 'Tab') { wrapTab(event.currentTarget, event); return; }
      if (!short || event.key !== 'Escape') return;
      event.stopPropagation();
      if (event.nativeEvent.isComposing) return;
      event.preventDefault(); close();
    }}>
    <header className="ua-layer-details-head">
      <h2 id={`${id}-title`}>Layer details</h2>
      <button ref={closeButton} type="button" className="ua-layer-details-close" aria-label="Close Layer details" onClick={close}>Close</button>
    </header>
    <div className="ua-layer-details-body">{children}</div>
  </dialog>;
}
