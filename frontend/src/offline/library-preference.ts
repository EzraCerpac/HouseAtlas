const KEY = 'houseatlas.keep-native-library.v1';
const EVENT = 'houseatlas-library-preference';
/** A device preference only; it carries no account, grant or resource identity. */
export function keepLibrary(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setKeepLibrary(value: boolean): void {
  try { localStorage.setItem(KEY, value ? 'on' : 'off'); } catch { /* The current action can still fill this copy. */ }
  dispatchEvent(new Event(EVENT));
}
export function subscribeKeepLibrary(changed: () => void): () => void {
  addEventListener(EVENT, changed); addEventListener('storage', changed);
  return () => { removeEventListener(EVENT, changed); removeEventListener('storage', changed); };
}
