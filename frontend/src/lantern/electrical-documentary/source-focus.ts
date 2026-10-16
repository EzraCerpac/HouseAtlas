import type { LocalSourceReaderStore } from './local-source-reader';

/** Focus path between a source opener and the one reader of its store. It
 * holds elements and display IDs only, never source content, and moves focus
 * only for the user's own Open, Go to source and Close actions. Every reveal
 * is fenced immediately before it runs by the exact display ID: the store must
 * still be showing that display (its lifetime signal live and its frame and
 * selection current) and the registered reader must belong to it. A stale
 * effect or action does nothing. */
interface Reader { readonly id: number; readonly element: HTMLElement }
interface Path { opener: HTMLElement | null; fallback: HTMLElement | null; reader: Reader | null }
const paths = new WeakMap<LocalSourceReaderStore, Path>();
const path = (store: LocalSourceReaderStore) => {
  let found = paths.get(store);
  if (!found) { found = { opener: null, fallback: null, reader: null }; paths.set(store, found); }
  return found;
};
const usable = (element: HTMLElement | null): element is HTMLElement => element !== null && element.isConnected
  && element.closest('[hidden]') === null && !(element as HTMLButtonElement).disabled;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const reveal = (element: HTMLElement) => {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
};

/** The control that asked to open the next source. */
export function rememberOpener(store: LocalSourceReaderStore, element: HTMLElement) { path(store).opener = element; }
/** A current control to return to when the opener is gone. */
export function setFocusFallback(store: LocalSourceReaderStore, element: HTMLElement | null) { path(store).fallback = element; }
/** Registers the reader element of display `id`. */
export function setReaderTarget(store: LocalSourceReaderStore, id: number, element: HTMLElement) { path(store).reader = { id, element }; }
/** Drops display `id`'s reader; a newer display's registration is kept. */
export function clearReaderTarget(store: LocalSourceReaderStore, id: number) {
  const found = path(store);
  if (found.reader?.id === id) found.reader = null;
}
/** The reader of display `id`, only while that exact display is shown and current. */
function shownReader(store: LocalSourceReaderStore, id: number): HTMLElement | null {
  const display = store.snapshot(), { reader } = path(store);
  if (!store.isShowing(id) || display?.id !== id || display.status !== 'shown' || display.signal.aborted || reader?.id !== id) return null;
  return usable(reader.element) ? reader.element : null;
}

/** After display `id` is shown: takes the user to it unless they have moved on. */
export function revealShownSource(store: LocalSourceReaderStore, id: number) {
  const { opener } = path(store), active = document.activeElement;
  if (active !== null && active !== document.body && active !== opener) return;
  const reader = shownReader(store, id);
  if (reader) reveal(reader);
}
/** The explicit Go to source action for display `id`. */
export function goToSource(store: LocalSourceReaderStore, id: number) {
  const reader = shownReader(store, id);
  if (reader) reveal(reader);
}
/** Ordinary Close: back to the surviving opener, else the current fallback. */
export function returnFromSource(store: LocalSourceReaderStore) {
  const { opener, fallback } = path(store);
  const target = usable(opener) ? opener : usable(fallback) ? fallback : null;
  target?.focus();
}
