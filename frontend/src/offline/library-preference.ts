const KEY = 'houseatlas.keep-native-library.v1';
const EVENT = 'houseatlas-library-preference';
let temporary: boolean | null = null;
/** A device preference only; it carries no account, grant or resource identity. */
export function keepLibrary(): boolean {
  if (temporary !== null) return temporary;
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setKeepLibrary(value: boolean): void {
  try { localStorage.setItem(KEY, value ? 'on' : 'off'); temporary = null; }
  catch { temporary = value; /* Honor this page's choice even when durable preference storage fails. */ }
  dispatchEvent(new Event(EVENT));
}
export function subscribeKeepLibrary(changed: () => void): () => void {
  addEventListener(EVENT, changed); addEventListener('storage', changed);
  return () => { removeEventListener(EVENT, changed); removeEventListener('storage', changed); };
}
